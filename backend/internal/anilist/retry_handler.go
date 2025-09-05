package anilist

import (
	"context"
	"fmt"
	"math"
	"math/rand"
	"net"
	"net/url"
	"strings"
	"time"
)

// RetryHandler gerencia tentativas de retry com backoff exponencial
type RetryHandler struct {
	maxRetries      int
	baseDelay       time.Duration
	maxDelay        time.Duration
	backoffFactor   float64
	jitterEnabled   bool
	logger          Logger
	circuitBreaker  *CircuitBreaker
}

// RetryConfig configuração para o sistema de retry
type RetryConfig struct {
	MaxRetries    int           // Máximo de tentativas (padrão: 3)
	BaseDelay     time.Duration // Delay inicial (padrão: 1s)
	MaxDelay      time.Duration // Delay máximo (padrão: 30s)
	BackoffFactor float64       // Fator multiplicador (padrão: 2.0)
	JitterEnabled bool          // Adicionar jitter para evitar thundering herd
}

// ErrorType tipo de erro para classificação
type ErrorType int

const (
	ErrorTypeNetwork ErrorType = iota
	ErrorTypeTimeout
	ErrorTypeRateLimit
	ErrorTypeServerError
	ErrorTypeClientError
	ErrorTypeUnknown
)

// RetryableError encapsula um erro com informações de retry
type RetryableError struct {
	Err         error
	Type        ErrorType
	Retryable   bool
	RetryAfter  time.Duration
	Attempt     int
	MaxAttempts int
	Context     map[string]interface{}
}

func (re *RetryableError) Error() string {
	return fmt.Sprintf("retry %d/%d failed: %v", re.Attempt, re.MaxAttempts, re.Err)
}

func (re *RetryableError) Unwrap() error {
	return re.Err
}

// NewRetryHandler cria um novo handler de retry
func NewRetryHandler(config RetryConfig, logger Logger) *RetryHandler {
	// Valores padrão
	if config.MaxRetries == 0 {
		config.MaxRetries = 3
	}
	if config.BaseDelay == 0 {
		config.BaseDelay = time.Second
	}
	if config.MaxDelay == 0 {
		config.MaxDelay = 30 * time.Second
	}
	if config.BackoffFactor == 0 {
		config.BackoffFactor = 2.0
	}

	return &RetryHandler{
		maxRetries:     config.MaxRetries,
		baseDelay:      config.BaseDelay,
		maxDelay:       config.MaxDelay,
		backoffFactor:  config.BackoffFactor,
		jitterEnabled:  config.JitterEnabled,
		logger:         logger,
		circuitBreaker: NewCircuitBreaker(logger),
	}
}

// ExecuteWithRetry executa uma função com retry automático
func (rh *RetryHandler) ExecuteWithRetry(ctx context.Context, operation func() error, operationName string) error {
	// Verificar circuit breaker
	if !rh.circuitBreaker.CanExecute() {
		rh.logger.Warn("Circuit breaker is open, skipping operation", 
			"operation", operationName,
			"state", rh.circuitBreaker.GetState())
		return fmt.Errorf("circuit breaker is open for operation: %s", operationName)
	}

	var lastErr error
	
	for attempt := 1; attempt <= rh.maxRetries; attempt++ {
		rh.logger.Debug("Executing operation with retry", 
			"operation", operationName,
			"attempt", attempt,
			"max_attempts", rh.maxRetries)

		// Executar operação
		err := operation()

		if err == nil {
			// Sucesso - notificar circuit breaker
			rh.circuitBreaker.RecordSuccess()
			if attempt > 1 {
				rh.logger.Info("Operation succeeded after retry", 
					"operation", operationName,
					"successful_attempt", attempt)
			}
			return nil
		}

		// Classificar erro
		retryableErr := rh.classifyError(err, attempt, rh.maxRetries)
		lastErr = retryableErr

		// Log do erro
		rh.logger.Warn("Operation failed", 
			"operation", operationName,
			"attempt", attempt,
			"error", err.Error(),
			"error_type", rh.getErrorTypeName(retryableErr.Type),
			"retryable", retryableErr.Retryable)

		// Verificar se deve fazer retry
		if !retryableErr.Retryable || attempt >= rh.maxRetries {
			// Notificar circuit breaker sobre falha
			rh.circuitBreaker.RecordFailure()
			break
		}

		// Verificar cancelamento do contexto
		if ctx.Err() != nil {
			rh.logger.Debug("Context cancelled, stopping retries", 
				"operation", operationName,
				"attempt", attempt)
			return ctx.Err()
		}

		// Calcular delay para próxima tentativa
		delay := rh.calculateDelay(attempt, retryableErr.RetryAfter)
		
		rh.logger.Debug("Waiting before retry", 
			"operation", operationName,
			"attempt", attempt,
			"delay", delay.String())

		// Aguardar antes da próxima tentativa
		select {
		case <-time.After(delay):
			// Continuar para próxima tentativa
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	rh.logger.Error("Operation failed after all retries", 
		"operation", operationName,
		"attempts", rh.maxRetries,
		"final_error", lastErr.Error())

	return lastErr
}

// classifyError classifica um erro e determina se é retryável
func (rh *RetryHandler) classifyError(err error, attempt, maxAttempts int) *RetryableError {
	retryableErr := &RetryableError{
		Err:         err,
		Type:        ErrorTypeUnknown,
		Retryable:   false,
		Attempt:     attempt,
		MaxAttempts: maxAttempts,
		Context:     make(map[string]interface{}),
	}

	if err == nil {
		return retryableErr
	}

	errStr := strings.ToLower(err.Error())

	// Errors de rede (retryable)
	if isNetworkError(err) {
		retryableErr.Type = ErrorTypeNetwork
		retryableErr.Retryable = true
		retryableErr.Context["network_error"] = true
		return retryableErr
	}

	// Timeout errors (retryable)
	if strings.Contains(errStr, "timeout") || strings.Contains(errStr, "deadline exceeded") {
		retryableErr.Type = ErrorTypeTimeout
		retryableErr.Retryable = true
		retryableErr.Context["timeout"] = true
		return retryableErr
	}

	// Rate limit errors (retryable com delay especial)
	if strings.Contains(errStr, "rate limit") || strings.Contains(errStr, "too many requests") {
		retryableErr.Type = ErrorTypeRateLimit
		retryableErr.Retryable = true
		retryableErr.RetryAfter = 60 * time.Second // Wait longer for rate limits
		retryableErr.Context["rate_limited"] = true
		return retryableErr
	}

	// Server errors 5xx (retryable)
	if strings.Contains(errStr, "500") || strings.Contains(errStr, "502") || 
	   strings.Contains(errStr, "503") || strings.Contains(errStr, "504") {
		retryableErr.Type = ErrorTypeServerError
		retryableErr.Retryable = true
		retryableErr.Context["server_error"] = true
		return retryableErr
	}

	// Client errors 4xx (geralmente não retryable, exceto alguns casos)
	if strings.Contains(errStr, "400") || strings.Contains(errStr, "401") || 
	   strings.Contains(errStr, "403") || strings.Contains(errStr, "404") {
		retryableErr.Type = ErrorTypeClientError
		retryableErr.Retryable = false // Geralmente não retryable
		retryableErr.Context["client_error"] = true
		return retryableErr
	}

	// Casos especiais retryáveis
	if strings.Contains(errStr, "connection reset") || 
	   strings.Contains(errStr, "connection refused") ||
	   strings.Contains(errStr, "no such host") {
		retryableErr.Type = ErrorTypeNetwork
		retryableErr.Retryable = true
		retryableErr.Context["connection_issue"] = true
		return retryableErr
	}

	// Default: unknown error, não retryable por segurança
	retryableErr.Type = ErrorTypeUnknown
	retryableErr.Retryable = false
	
	return retryableErr
}

// calculateDelay calcula o delay para a próxima tentativa
func (rh *RetryHandler) calculateDelay(attempt int, retryAfter time.Duration) time.Duration {
	// Se há um retry-after específico, usar ele
	if retryAfter > 0 {
		return retryAfter
	}

	// Calcular backoff exponencial
	delay := float64(rh.baseDelay) * math.Pow(rh.backoffFactor, float64(attempt-1))
	
	// Aplicar limite máximo
	if time.Duration(delay) > rh.maxDelay {
		delay = float64(rh.maxDelay)
	}

	// Adicionar jitter se habilitado (±25% do delay)
	if rh.jitterEnabled {
		jitterRange := delay * 0.25
		jitter := (rand.Float64() - 0.5) * 2 * jitterRange
		delay += jitter
		
		// Garantir que o delay não seja negativo
		if delay < 0 {
			delay = float64(rh.baseDelay)
		}
	}

	return time.Duration(delay)
}

// isNetworkError verifica se o erro é relacionado à rede
func isNetworkError(err error) bool {
	// Verificar tipos específicos de erro de rede
	if netErr, ok := err.(net.Error); ok {
		return netErr.Temporary() || netErr.Timeout()
	}

	// Verificar outros tipos específicos de erro HTTP
	if urlErr, ok := err.(*url.Error); ok {
		return urlErr.Temporary()
	}

	return false
}

// getErrorTypeName retorna o nome do tipo de erro
func (rh *RetryHandler) getErrorTypeName(errType ErrorType) string {
	switch errType {
	case ErrorTypeNetwork:
		return "network"
	case ErrorTypeTimeout:
		return "timeout"
	case ErrorTypeRateLimit:
		return "rate_limit"
	case ErrorTypeServerError:
		return "server_error"
	case ErrorTypeClientError:
		return "client_error"
	default:
		return "unknown"
	}
}

// GetStats retorna estatísticas do retry handler
func (rh *RetryHandler) GetStats() map[string]interface{} {
	stats := map[string]interface{}{
		"max_retries":      rh.maxRetries,
		"base_delay":       rh.baseDelay.String(),
		"max_delay":        rh.maxDelay.String(),
		"backoff_factor":   rh.backoffFactor,
		"jitter_enabled":   rh.jitterEnabled,
	}

	// Adicionar stats do circuit breaker
	if rh.circuitBreaker != nil {
		cbStats := rh.circuitBreaker.GetStats()
		stats["circuit_breaker"] = cbStats
	}

	return stats
}

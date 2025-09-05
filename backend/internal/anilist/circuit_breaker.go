package anilist

import (
	"sync"
	"time"
)

// CircuitBreakerState representa o estado do circuit breaker
type CircuitBreakerState int

const (
	StateClosed CircuitBreakerState = iota
	StateOpen
	StateHalfOpen
)

// CircuitBreaker implementa padrão circuit breaker para fallback automático
type CircuitBreaker struct {
	mutex           sync.RWMutex
	state           CircuitBreakerState
	failureCount    int
	successCount    int
	lastFailureTime time.Time
	lastSuccessTime time.Time
	
	// Configurações
	failureThreshold    int           // Número de falhas antes de abrir (padrão: 5)
	successThreshold    int           // Sucessos necessários para fechar quando half-open (padrão: 3)
	timeout             time.Duration // Tempo antes de tentar half-open (padrão: 60s)
	
	// Estatísticas
	totalRequests       int64
	totalFailures       int64
	totalSuccesses      int64
	stateChangeCount    int64
	lastStateChange     time.Time
	
	logger Logger
}

// CircuitBreakerConfig configuração do circuit breaker
type CircuitBreakerConfig struct {
	FailureThreshold int
	SuccessThreshold int
	Timeout          time.Duration
}

// NewCircuitBreaker cria um novo circuit breaker
func NewCircuitBreaker(logger Logger) *CircuitBreaker {
	return NewCircuitBreakerWithConfig(CircuitBreakerConfig{
		FailureThreshold: 5,
		SuccessThreshold: 3,
		Timeout:          60 * time.Second,
	}, logger)
}

// NewCircuitBreakerWithConfig cria circuit breaker com configuração personalizada
func NewCircuitBreakerWithConfig(config CircuitBreakerConfig, logger Logger) *CircuitBreaker {
	// Valores padrão
	if config.FailureThreshold == 0 {
		config.FailureThreshold = 5
	}
	if config.SuccessThreshold == 0 {
		config.SuccessThreshold = 3
	}
	if config.Timeout == 0 {
		config.Timeout = 60 * time.Second
	}

	cb := &CircuitBreaker{
		state:            StateClosed,
		failureThreshold: config.FailureThreshold,
		successThreshold: config.SuccessThreshold,
		timeout:          config.Timeout,
		logger:           logger,
		lastStateChange:  time.Now(),
	}

	logger.Info("Circuit breaker initialized", 
		"failure_threshold", config.FailureThreshold,
		"success_threshold", config.SuccessThreshold,
		"timeout", config.Timeout.String())

	return cb
}

// CanExecute verifica se a operação pode ser executada
func (cb *CircuitBreaker) CanExecute() bool {
	cb.mutex.Lock()
	defer cb.mutex.Unlock()

	cb.totalRequests++

	switch cb.state {
	case StateClosed:
		return true
	case StateOpen:
		// Verificar se devemos tentar half-open
		if time.Since(cb.lastFailureTime) >= cb.timeout {
			cb.changeState(StateHalfOpen)
			cb.logger.Info("Circuit breaker transitioning to half-open", 
				"time_since_failure", time.Since(cb.lastFailureTime).String())
			return true
		}
		return false
	case StateHalfOpen:
		return true
	default:
		return false
	}
}

// RecordSuccess registra uma operação bem-sucedida
func (cb *CircuitBreaker) RecordSuccess() {
	cb.mutex.Lock()
	defer cb.mutex.Unlock()

	cb.totalSuccesses++
	cb.lastSuccessTime = time.Now()

	switch cb.state {
	case StateClosed:
		// Reset failure count on success
		cb.failureCount = 0
	case StateHalfOpen:
		cb.successCount++
		if cb.successCount >= cb.successThreshold {
			cb.changeState(StateClosed)
			cb.failureCount = 0
			cb.successCount = 0
			cb.logger.Info("Circuit breaker closed after successful recovery", 
				"consecutive_successes", cb.successCount)
		}
	case StateOpen:
		// Não deveria acontecer, mas resetar se acontecer
		cb.logger.Warn("Unexpected success recorded while circuit breaker is open")
	}
}

// RecordFailure registra uma falha na operação
func (cb *CircuitBreaker) RecordFailure() {
	cb.mutex.Lock()
	defer cb.mutex.Unlock()

	cb.totalFailures++
	cb.lastFailureTime = time.Now()
	cb.failureCount++

	switch cb.state {
	case StateClosed:
		if cb.failureCount >= cb.failureThreshold {
			cb.changeState(StateOpen)
			cb.logger.Warn("Circuit breaker opened due to failures", 
				"failure_count", cb.failureCount,
				"threshold", cb.failureThreshold)
		}
	case StateHalfOpen:
		// Voltar para open em qualquer falha durante half-open
		cb.changeState(StateOpen)
		cb.successCount = 0
		cb.logger.Warn("Circuit breaker returned to open state after failure during half-open")
	case StateOpen:
		// Já está aberto, apenas contar
	}
}

// GetState retorna o estado atual do circuit breaker
func (cb *CircuitBreaker) GetState() CircuitBreakerState {
	cb.mutex.RLock()
	defer cb.mutex.RUnlock()
	return cb.state
}

// GetStateName retorna o nome do estado atual
func (cb *CircuitBreaker) GetStateName() string {
	state := cb.GetState()
	switch state {
	case StateClosed:
		return "closed"
	case StateOpen:
		return "open"
	case StateHalfOpen:
		return "half-open"
	default:
		return "unknown"
	}
}

// IsHealthy verifica se o circuit breaker está saudável
func (cb *CircuitBreaker) IsHealthy() bool {
	return cb.GetState() == StateClosed
}

// ForceOpen força o circuit breaker para o estado aberto
func (cb *CircuitBreaker) ForceOpen() {
	cb.mutex.Lock()
	defer cb.mutex.Unlock()
	
	if cb.state != StateOpen {
		cb.changeState(StateOpen)
		cb.logger.Warn("Circuit breaker manually forced to open state")
	}
}

// ForceClose força o circuit breaker para o estado fechado
func (cb *CircuitBreaker) ForceClose() {
	cb.mutex.Lock()
	defer cb.mutex.Unlock()
	
	if cb.state != StateClosed {
		cb.changeState(StateClosed)
		cb.failureCount = 0
		cb.successCount = 0
		cb.logger.Info("Circuit breaker manually forced to closed state")
	}
}

// Reset reseta todas as estatísticas do circuit breaker
func (cb *CircuitBreaker) Reset() {
	cb.mutex.Lock()
	defer cb.mutex.Unlock()
	
	cb.state = StateClosed
	cb.failureCount = 0
	cb.successCount = 0
	cb.totalRequests = 0
	cb.totalFailures = 0
	cb.totalSuccesses = 0
	cb.stateChangeCount = 0
	cb.lastStateChange = time.Now()
	
	cb.logger.Info("Circuit breaker reset to initial state")
}

// changeState muda o estado interno (deve ser chamado com lock)
func (cb *CircuitBreaker) changeState(newState CircuitBreakerState) {
	if cb.state != newState {
		oldState := cb.state
		cb.state = newState
		cb.stateChangeCount++
		cb.lastStateChange = time.Now()
		
		cb.logger.Info("Circuit breaker state changed", 
			"from", cb.getStateNameInternal(oldState),
			"to", cb.getStateNameInternal(newState),
			"change_count", cb.stateChangeCount)
	}
}

// getStateNameInternal retorna nome do estado (versão interna)
func (cb *CircuitBreaker) getStateNameInternal(state CircuitBreakerState) string {
	switch state {
	case StateClosed:
		return "closed"
	case StateOpen:
		return "open"
	case StateHalfOpen:
		return "half-open"
	default:
		return "unknown"
	}
}

// GetStats retorna estatísticas detalhadas do circuit breaker
func (cb *CircuitBreaker) GetStats() map[string]interface{} {
	cb.mutex.RLock()
	defer cb.mutex.RUnlock()

	uptime := time.Since(cb.lastStateChange)
	successRate := float64(0)
	if cb.totalRequests > 0 {
		successRate = float64(cb.totalSuccesses) / float64(cb.totalRequests) * 100
	}

	return map[string]interface{}{
		"state":               cb.getStateNameInternal(cb.state),
		"state_uptime":        uptime.String(),
		"failure_count":       cb.failureCount,
		"success_count":       cb.successCount,
		"failure_threshold":   cb.failureThreshold,
		"success_threshold":   cb.successThreshold,
		"timeout":             cb.timeout.String(),
		"total_requests":      cb.totalRequests,
		"total_failures":      cb.totalFailures,
		"total_successes":     cb.totalSuccesses,
		"success_rate":        successRate,
		"state_change_count":  cb.stateChangeCount,
		"last_failure_time":   cb.lastFailureTime,
		"last_success_time":   cb.lastSuccessTime,
		"last_state_change":   cb.lastStateChange,
		"is_healthy":          cb.state == StateClosed,
	}
}

// GetHealthStatus retorna status de saúde resumido
func (cb *CircuitBreaker) GetHealthStatus() map[string]interface{} {
	stats := cb.GetStats()
	
	return map[string]interface{}{
		"healthy":       stats["is_healthy"],
		"state":         stats["state"],
		"success_rate":  stats["success_rate"],
		"uptime":        stats["state_uptime"],
	}
}

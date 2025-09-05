package anilist

import (
	"fmt"
	"strings"
	"time"
)

// ErrorHandler gerencia tradução e tratamento de erros amigáveis
type ErrorHandler struct {
	logger Logger
}

// FriendlyError representa um erro com mensagem amigável para o usuário
type FriendlyError struct {
	OriginalError   error                  `json:"-"`
	UserMessage     string                 `json:"user_message"`
	TechnicalMessage string                `json:"technical_message,omitempty"`
	ErrorCode       string                 `json:"error_code"`
	Severity        ErrorSeverity          `json:"severity"`
	Suggestions     []string               `json:"suggestions,omitempty"`
	RetryAfter      *time.Duration         `json:"retry_after,omitempty"`
	Context         map[string]interface{} `json:"context,omitempty"`
	Timestamp       time.Time              `json:"timestamp"`
}

// ErrorSeverity níveis de severidade dos erros
type ErrorSeverity string

const (
	SeverityInfo    ErrorSeverity = "info"
	SeverityWarning ErrorSeverity = "warning"
	SeverityError   ErrorSeverity = "error"
	SeverityCritical ErrorSeverity = "critical"
)

// NewErrorHandler cria um novo handler de erros amigáveis
func NewErrorHandler(logger Logger) *ErrorHandler {
	return &ErrorHandler{
		logger: logger,
	}
}

// TranslateError converte um erro técnico em erro amigável
func (eh *ErrorHandler) TranslateError(err error, context map[string]interface{}) *FriendlyError {
	if err == nil {
		return nil
	}

	friendlyErr := &FriendlyError{
		OriginalError:    err,
		TechnicalMessage: err.Error(),
		Timestamp:        time.Now(),
		Context:          context,
	}

	if context == nil {
		friendlyErr.Context = make(map[string]interface{})
	}

	// Analisar o erro e traduzir
	eh.analyzeAndTranslate(friendlyErr)

	// Log do erro traduzido
	eh.logger.Error("Error translated for user", 
		"original_error", err.Error(),
		"user_message", friendlyErr.UserMessage,
		"error_code", friendlyErr.ErrorCode,
		"severity", string(friendlyErr.Severity))

	return friendlyErr
}

// analyzeAndTranslate analisa o erro e define mensagem amigável
func (eh *ErrorHandler) analyzeAndTranslate(friendlyErr *FriendlyError) {
	errStr := strings.ToLower(friendlyErr.OriginalError.Error())

	// Erros de conectividade de rede
	if eh.isNetworkConnectivityError(errStr) {
		friendlyErr.UserMessage = "Não foi possível conectar com a AniList. Verifique sua conexão com a internet."
		friendlyErr.ErrorCode = "NETWORK_CONNECTIVITY"
		friendlyErr.Severity = SeverityWarning
		friendlyErr.Suggestions = []string{
			"Verifique sua conexão com a internet",
			"Tente novamente em alguns instantes",
			"Use a entrada manual de metadados como alternativa",
		}
		retryAfter := 30 * time.Second
		friendlyErr.RetryAfter = &retryAfter
		return
	}

	// Erros de timeout
	if eh.isTimeoutError(errStr) {
		friendlyErr.UserMessage = "A busca na AniList está demorando mais que o esperado."
		friendlyErr.ErrorCode = "SEARCH_TIMEOUT"
		friendlyErr.Severity = SeverityWarning
		friendlyErr.Suggestions = []string{
			"Tente uma busca com termos mais específicos",
			"Aguarde alguns minutos e tente novamente",
			"Use a entrada manual se precisar continuar",
		}
		retryAfter := 60 * time.Second
		friendlyErr.RetryAfter = &retryAfter
		return
	}

	// Erros de rate limiting
	if eh.isRateLimitError(errStr) {
		friendlyErr.UserMessage = "Muitas buscas foram feitas recentemente. Aguarde um momento antes de tentar novamente."
		friendlyErr.ErrorCode = "RATE_LIMITED"
		friendlyErr.Severity = SeverityInfo
		friendlyErr.Suggestions = []string{
			"Aguarde 1-2 minutos antes de fazer nova busca",
			"Use o cache de resultados anteriores",
			"Continue com entrada manual dos metadados",
		}
		retryAfter := 90 * time.Second
		friendlyErr.RetryAfter = &retryAfter
		return
	}

	// Erros de servidor da AniList (5xx)
	if eh.isServerError(errStr) {
		friendlyErr.UserMessage = "A AniList está temporariamente indisponível. Tente novamente em alguns minutos."
		friendlyErr.ErrorCode = "ANILIST_SERVER_ERROR"
		friendlyErr.Severity = SeverityError
		friendlyErr.Suggestions = []string{
			"Aguarde alguns minutos e tente novamente",
			"Verifique o status da AniList em suas redes sociais",
			"Use a entrada manual para não perder tempo",
		}
		retryAfter := 5 * time.Minute
		friendlyErr.RetryAfter = &retryAfter
		return
	}

	// Erros de busca sem resultados
	if eh.isNoResultsError(errStr) {
		friendlyErr.UserMessage = "Nenhum manga foi encontrado com esse nome na AniList."
		friendlyErr.ErrorCode = "NO_SEARCH_RESULTS"
		friendlyErr.Severity = SeverityInfo
		friendlyErr.Suggestions = []string{
			"Tente buscar com o nome em inglês ou japonês",
			"Verifique a ortografia do nome",
			"Use termos mais genéricos (ex: só o nome principal)",
			"Preencha os metadados manualmente",
		}
		return
	}

	// Erros de autorização/autenticação
	if eh.isAuthError(errStr) {
		friendlyErr.UserMessage = "Problema de autorização com a AniList. O serviço pode estar temporariamente indisponível."
		friendlyErr.ErrorCode = "AUTHORIZATION_ERROR"
		friendlyErr.Severity = SeverityError
		friendlyErr.Suggestions = []string{
			"Tente novamente em alguns minutos",
			"Entre em contato com o suporte se o problema persistir",
			"Use a entrada manual como alternativa",
		}
		retryAfter := 10 * time.Minute
		friendlyErr.RetryAfter = &retryAfter
		return
	}

	// Erros de parsing/formato de dados
	if eh.isDataFormatError(errStr) {
		friendlyErr.UserMessage = "Os dados retornados pela AniList estão em formato inesperado."
		friendlyErr.ErrorCode = "DATA_FORMAT_ERROR"
		friendlyErr.Severity = SeverityError
		friendlyErr.Suggestions = []string{
			"Tente buscar outro manga para verificar se o problema persiste",
			"Reporte este problema aos desenvolvedores",
			"Use a entrada manual para este manga específico",
		}
		return
	}

	// Erros de circuit breaker (API indisponível)
	if eh.isCircuitBreakerError(errStr) {
		friendlyErr.UserMessage = "A integração com AniList foi temporariamente desabilitada devido a problemas recorrentes."
		friendlyErr.ErrorCode = "SERVICE_UNAVAILABLE"
		friendlyErr.Severity = SeverityWarning
		friendlyErr.Suggestions = []string{
			"A funcionalidade será restaurada automaticamente quando o serviço estabilizar",
			"Use a entrada manual de metadados",
			"Tente novamente em 10-15 minutos",
		}
		retryAfter := 15 * time.Minute
		friendlyErr.RetryAfter = &retryAfter
		return
	}

	// Erro genérico/desconhecido
	friendlyErr.UserMessage = "Ocorreu um erro inesperado ao buscar na AniList."
	friendlyErr.ErrorCode = "UNKNOWN_ERROR"
	friendlyErr.Severity = SeverityError
	friendlyErr.Suggestions = []string{
		"Tente novamente em alguns instantes",
		"Verifique sua conexão com a internet",
		"Use a entrada manual de metadados",
		"Entre em contato com o suporte se o problema persistir",
	}
}

// isNetworkConnectivityError verifica erros de conectividade
func (eh *ErrorHandler) isNetworkConnectivityError(errStr string) bool {
	networkErrors := []string{
		"connection refused",
		"no such host",
		"network is unreachable",
		"connection reset",
		"connection timed out",
		"dial tcp",
		"no route to host",
	}

	for _, netErr := range networkErrors {
		if strings.Contains(errStr, netErr) {
			return true
		}
	}
	return false
}

// isTimeoutError verifica erros de timeout
func (eh *ErrorHandler) isTimeoutError(errStr string) bool {
	timeoutErrors := []string{
		"timeout",
		"deadline exceeded",
		"context deadline exceeded",
		"request timeout",
	}

	for _, timeoutErr := range timeoutErrors {
		if strings.Contains(errStr, timeoutErr) {
			return true
		}
	}
	return false
}

// isRateLimitError verifica erros de rate limiting
func (eh *ErrorHandler) isRateLimitError(errStr string) bool {
	rateLimitErrors := []string{
		"rate limit",
		"too many requests",
		"429",
		"quota exceeded",
		"throttled",
	}

	for _, rateErr := range rateLimitErrors {
		if strings.Contains(errStr, rateErr) {
			return true
		}
	}
	return false
}

// isServerError verifica erros de servidor (5xx)
func (eh *ErrorHandler) isServerError(errStr string) bool {
	serverErrors := []string{
		"500", "501", "502", "503", "504", "505",
		"internal server error",
		"bad gateway",
		"service unavailable",
		"gateway timeout",
	}

	for _, serverErr := range serverErrors {
		if strings.Contains(errStr, serverErr) {
			return true
		}
	}
	return false
}

// isNoResultsError verifica se não houve resultados
func (eh *ErrorHandler) isNoResultsError(errStr string) bool {
	noResultsErrors := []string{
		"no results",
		"not found",
		"404",
		"empty results",
		"zero results",
	}

	for _, noResultErr := range noResultsErrors {
		if strings.Contains(errStr, noResultErr) {
			return true
		}
	}
	return false
}

// isAuthError verifica erros de autorização
func (eh *ErrorHandler) isAuthError(errStr string) bool {
	authErrors := []string{
		"401", "403",
		"unauthorized",
		"forbidden",
		"authentication",
		"authorization",
		"access denied",
	}

	for _, authErr := range authErrors {
		if strings.Contains(errStr, authErr) {
			return true
		}
	}
	return false
}

// isDataFormatError verifica erros de formato de dados
func (eh *ErrorHandler) isDataFormatError(errStr string) bool {
	formatErrors := []string{
		"json",
		"parse",
		"unmarshal",
		"invalid format",
		"malformed",
		"syntax error",
	}

	for _, formatErr := range formatErrors {
		if strings.Contains(errStr, formatErr) {
			return true
		}
	}
	return false
}

// isCircuitBreakerError verifica erros de circuit breaker
func (eh *ErrorHandler) isCircuitBreakerError(errStr string) bool {
	circuitErrors := []string{
		"circuit breaker",
		"circuit breaker is open",
		"service temporarily unavailable",
	}

	for _, circuitErr := range circuitErrors {
		if strings.Contains(errStr, circuitErr) {
			return true
		}
	}
	return false
}

// CreateUserFriendlyMessage cria mensagem amigável customizada
func (eh *ErrorHandler) CreateUserFriendlyMessage(code, message string, severity ErrorSeverity, suggestions []string) *FriendlyError {
	return &FriendlyError{
		UserMessage: message,
		ErrorCode:   code,
		Severity:    severity,
		Suggestions: suggestions,
		Timestamp:   time.Now(),
		Context:     make(map[string]interface{}),
	}
}

// GetRecoveryMessage retorna mensagem de recuperação quando serviço volta ao normal
func (eh *ErrorHandler) GetRecoveryMessage() *FriendlyError {
	return &FriendlyError{
		UserMessage: "A integração com AniList foi restaurada e está funcionando normalmente.",
		ErrorCode:   "SERVICE_RECOVERED",
		Severity:    SeverityInfo,
		Suggestions: []string{
			"Agora você pode fazer buscas na AniList normalmente",
			"Os resultados em cache ainda estão disponíveis",
		},
		Timestamp: time.Now(),
		Context:   make(map[string]interface{}),
	}
}

// Error implementa interface error
func (fe *FriendlyError) Error() string {
	return fmt.Sprintf("[%s] %s", fe.ErrorCode, fe.UserMessage)
}

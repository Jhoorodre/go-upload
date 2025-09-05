package uploaders

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wabarc/go-catbox"
)

// CircuitBreakerState representa os estados do circuit breaker
type CircuitBreakerState int32

const (
	Closed CircuitBreakerState = iota
	Open
	HalfOpen
)

// CircuitBreaker implementa o padrão circuit breaker para prevenir falhas em cascata
type CircuitBreaker struct {
	maxFailures     int32
	timeout         time.Duration
	failureCount    int32
	lastFailTime    time.Time
	state           CircuitBreakerState
	mutex           sync.RWMutex
	onStateChange   func(from, to CircuitBreakerState)
}

// AdaptiveRateLimiter implementa rate limiting adaptativo baseado na resposta do serviço
type AdaptiveRateLimiter struct {
	currentRate     int64
	maxRate         int64
	minRate         int64
	lastAdjustment  time.Time
	successCount    int64
	errorCount      int64
	mutex           sync.RWMutex
	ticker          *time.Ticker
	stopChan        chan struct{}
}

// ConnectionPool gerencia conexões HTTP persistentes para alta performance
type ConnectionPool struct {
	client          *http.Client
	maxConnections  int
	activeConns     int64
	mutex           sync.Mutex
}

// CatboxUploader implementa o uploader para Catbox.moe com recursos avançados
type CatboxUploader struct {
	// Core components
	client           *catbox.Catbox
	connPool         *ConnectionPool
	circuitBreaker   *CircuitBreaker
	rateLimiter      *AdaptiveRateLimiter
	
	// Configuration
	maxRetries       int
	baseDelay        time.Duration
	maxDelay         time.Duration
	timeout          time.Duration
	
	// Metrics
	totalRequests    int64
	successRequests  int64
	failedRequests   int64
	avgResponseTime  time.Duration
	lastRequestTime  time.Time
	mutex            sync.RWMutex
	
	// Lifecycle
	ctx              context.Context
	cancel           context.CancelFunc
	wg               sync.WaitGroup
}

// NewCircuitBreaker cria um novo circuit breaker
func NewCircuitBreaker(maxFailures int32, timeout time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		maxFailures:  maxFailures,
		timeout:      timeout,
		state:        Closed,
	}
}

// Execute executa uma função com proteção do circuit breaker
func (cb *CircuitBreaker) Execute(fn func() error) error {
	cb.mutex.RLock()
	state := cb.state
	cb.mutex.RUnlock()

	switch state {
	case Open:
		cb.mutex.RLock()
		if time.Since(cb.lastFailTime) > cb.timeout {
			cb.mutex.RUnlock()
			cb.setState(HalfOpen)
		} else {
			cb.mutex.RUnlock()
			return fmt.Errorf("circuit breaker is open")
		}
	case HalfOpen:
		// Permite uma tentativa em half-open
	}

	err := fn()
	if err != nil {
		cb.onFailure()
		return err
	}

	cb.onSuccess()
	return nil
}

// onSuccess é chamado quando uma operação é bem-sucedida
func (cb *CircuitBreaker) onSuccess() {
	cb.mutex.Lock()
	defer cb.mutex.Unlock()

	cb.failureCount = 0
	if cb.state == HalfOpen {
		cb.setState(Closed)
	}
}

// onFailure é chamado quando uma operação falha
func (cb *CircuitBreaker) onFailure() {
	cb.mutex.Lock()
	defer cb.mutex.Unlock()

	cb.failureCount++
	cb.lastFailTime = time.Now()

	if cb.failureCount >= cb.maxFailures {
		cb.setState(Open)
	}
}

// setState muda o estado do circuit breaker
func (cb *CircuitBreaker) setState(newState CircuitBreakerState) {
	oldState := cb.state
	cb.state = newState

	if cb.onStateChange != nil {
		cb.onStateChange(oldState, newState)
	}
}

// GetState retorna o estado atual do circuit breaker
func (cb *CircuitBreaker) GetState() CircuitBreakerState {
	cb.mutex.RLock()
	defer cb.mutex.RUnlock()
	return cb.state
}

// NewAdaptiveRateLimiter cria um novo rate limiter adaptativo
func NewAdaptiveRateLimiter(initialRate, maxRate, minRate int64) *AdaptiveRateLimiter {
	rl := &AdaptiveRateLimiter{
		currentRate:    initialRate,
		maxRate:        maxRate,
		minRate:        minRate,
		lastAdjustment: time.Now(),
		stopChan:       make(chan struct{}),
	}
	
	// Inicia ajuste automático da taxa
	rl.ticker = time.NewTicker(10 * time.Second)
	go rl.adjustRate()
	
	return rl
}

// adjustRate ajusta a taxa baseado no desempenho recente
func (rl *AdaptiveRateLimiter) adjustRate() {
	for {
		select {
		case <-rl.ticker.C:
			rl.mutex.Lock()
			
			successRate := float64(rl.successCount) / (float64(rl.successCount + rl.errorCount) + 0.001)
			
			if successRate > 0.95 && rl.currentRate < rl.maxRate {
				// Alta taxa de sucesso, aumenta a velocidade
				newRate := int64(float64(rl.currentRate) * 1.2)
				if newRate > rl.maxRate {
					newRate = rl.maxRate
				}
				rl.currentRate = newRate
			} else if successRate < 0.8 && rl.currentRate > rl.minRate {
				// Taxa de sucesso baixa, diminui a velocidade
				newRate := int64(float64(rl.currentRate) * 0.8)
				if newRate < rl.minRate {
					newRate = rl.minRate
				}
				rl.currentRate = newRate
			}
			
			// Reset counters
			rl.successCount = 0
			rl.errorCount = 0
			rl.lastAdjustment = time.Now()
			
			rl.mutex.Unlock()
			
		case <-rl.stopChan:
			return
		}
	}
}

// Wait aguarda respeitando o rate limit atual
func (rl *AdaptiveRateLimiter) Wait() {
	rl.mutex.RLock()
	rate := rl.currentRate
	rl.mutex.RUnlock()
	
	if rate > 0 {
		delay := time.Duration(1000000000/rate) * time.Nanosecond // 1 segundo / rate
		time.Sleep(delay)
	}
}

// RecordSuccess registra uma operação bem-sucedida
func (rl *AdaptiveRateLimiter) RecordSuccess() {
	atomic.AddInt64(&rl.successCount, 1)
}

// RecordError registra uma operação com erro
func (rl *AdaptiveRateLimiter) RecordError() {
	atomic.AddInt64(&rl.errorCount, 1)
}

// GetCurrentRate retorna a taxa atual
func (rl *AdaptiveRateLimiter) GetCurrentRate() int64 {
	rl.mutex.RLock()
	defer rl.mutex.RUnlock()
	return rl.currentRate
}

// Close para o rate limiter
func (rl *AdaptiveRateLimiter) Close() {
	if rl.ticker != nil {
		rl.ticker.Stop()
	}
	close(rl.stopChan)
}

// NewConnectionPool cria um pool de conexões otimizado
func NewConnectionPool(maxConns int) *ConnectionPool {
	return &ConnectionPool{
		client: &http.Client{
			Timeout: 60 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:           maxConns,
				MaxIdleConnsPerHost:    maxConns/4,
				IdleConnTimeout:        120 * time.Second,
				TLSHandshakeTimeout:    10 * time.Second,
				ExpectContinueTimeout:  1 * time.Second,
				MaxConnsPerHost:        maxConns/2,
				ResponseHeaderTimeout:  30 * time.Second,
			},
		},
		maxConnections: maxConns,
	}
}

// GetClient retorna o cliente HTTP do pool
func (cp *ConnectionPool) GetClient() *http.Client {
	atomic.AddInt64(&cp.activeConns, 1)
	return cp.client
}

// ReleaseClient libera uma conexão do pool
func (cp *ConnectionPool) ReleaseClient() {
	atomic.AddInt64(&cp.activeConns, -1)
}

// GetActiveConnections retorna o número de conexões ativas
func (cp *ConnectionPool) GetActiveConnections() int64 {
	return atomic.LoadInt64(&cp.activeConns)
}

// NewCatboxUploader cria um novo uploader Catbox com recursos avançados
func NewCatboxUploader() *CatboxUploader {
	ctx, cancel := context.WithCancel(context.Background())
	
	// Connection pool otimizado para alta concorrência
	connPool := NewConnectionPool(200)
	
	// Circuit breaker: 10 falhas em 60 segundos abre o circuito
	circuitBreaker := NewCircuitBreaker(10, 60*time.Second)
	
	// Rate limiter adaptativo: inicia com 50/min, máx 100/min, mín 10/min
	rateLimiter := NewAdaptiveRateLimiter(50, 100, 10)
	
	uploader := &CatboxUploader{
		client:         catbox.New(connPool.GetClient()),
		connPool:       connPool,
		circuitBreaker: circuitBreaker,
		rateLimiter:    rateLimiter,
		maxRetries:     5,
		baseDelay:      500 * time.Millisecond,
		maxDelay:       30 * time.Second,
		timeout:        60 * time.Second,
		ctx:            ctx,
		cancel:         cancel,
	}
	
	// Callback para mudanças de estado do circuit breaker
	circuitBreaker.onStateChange = func(from, to CircuitBreakerState) {
		uploader.onCircuitBreakerStateChange(from, to)
	}
	
	// Inicia goroutine de monitoramento
	uploader.wg.Add(1)
	go uploader.metricsCollector()
	
	return uploader
}

// onCircuitBreakerStateChange é chamado quando o estado do circuit breaker muda
func (cu *CatboxUploader) onCircuitBreakerStateChange(from, to CircuitBreakerState) {
	cu.mutex.Lock()
	defer cu.mutex.Unlock()
	
	// Log da mudança de estado para monitoramento
	switch to {
	case Open:
		cu.rateLimiter.RecordError() // Força redução da taxa
	case Closed:
		// Circuit fechado, pode aumentar gradualmente a taxa
	}
}

// metricsCollector coleta métricas em background
func (cu *CatboxUploader) metricsCollector() {
	defer cu.wg.Done()
	
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case <-ticker.C:
			cu.logMetrics()
		case <-cu.ctx.Done():
			return
		}
	}
}

// logMetrics registra métricas atuais
func (cu *CatboxUploader) logMetrics() {
	cu.mutex.RLock()
	total := cu.totalRequests
	success := cu.successRequests
	failed := cu.failedRequests
	avgTime := cu.avgResponseTime
	cu.mutex.RUnlock()
	
	successRate := float64(0)
	if total > 0 {
		successRate = float64(success) / float64(total) * 100
	}
	
	currentRate := cu.rateLimiter.GetCurrentRate()
	cbState := cu.circuitBreaker.GetState()
	activeConns := cu.connPool.GetActiveConnections()
	
	fmt.Printf("[CatboxUploader] Total: %d, Success: %.1f%%, Failed: %d, AvgTime: %v, Rate: %d/min, CB: %v, ActiveConns: %d\n",
		total, successRate, failed, avgTime, currentRate, cbState, activeConns)
}

// Upload realiza upload de um arquivo para Catbox com proteções avançadas
func (cu *CatboxUploader) Upload(filePath string) (string, error) {
	startTime := time.Now()
	atomic.AddInt64(&cu.totalRequests, 1)
	
	defer func() {
		cu.connPool.ReleaseClient()
		cu.updateResponseTime(time.Since(startTime))
	}()
	
	// Aguarda rate limiting
	cu.rateLimiter.Wait()
	
	var lastErr error
	
	var uploadedURL string
	
	for attempt := 0; attempt <= cu.maxRetries; attempt++ {
		// Usa circuit breaker para proteção
		err := cu.circuitBreaker.Execute(func() error {
			// Context com timeout para a requisição
			ctx, cancel := context.WithTimeout(cu.ctx, cu.timeout)
			defer cancel()
			
			// Upload com contexto
			url, err := cu.uploadWithContext(ctx, filePath)
			if err != nil {
				return err
			}
			
			// Sucesso - registra métricas
			uploadedURL = url
			atomic.AddInt64(&cu.successRequests, 1)
			cu.rateLimiter.RecordSuccess()
			lastErr = nil // Reset do erro
			
			return nil
		})
		
		if err == nil {
			// Upload bem-sucedido
			return uploadedURL, nil
		}
		
		lastErr = err
		atomic.AddInt64(&cu.failedRequests, 1)
		cu.rateLimiter.RecordError()
		
		// Se circuit breaker está aberto, não tenta novamente
		if cu.circuitBreaker.GetState() == Open {
			break
		}
		
		// Se não é o último attempt, aguarda com backoff exponencial
		if attempt < cu.maxRetries {
			delay := cu.calculateBackoffDelay(attempt)
			select {
			case <-time.After(delay):
				// Continue
			case <-cu.ctx.Done():
				return "", cu.ctx.Err()
			}
		}
	}
	
	return "", fmt.Errorf("catbox upload failed after %d attempts: %v", cu.maxRetries+1, lastErr)
}

// uploadWithContext faz upload com suporte a contexto
func (cu *CatboxUploader) uploadWithContext(ctx context.Context, filePath string) (string, error) {
	// Usa o cliente do pool
	client := cu.connPool.GetClient()
	
	// Cria um novo cliente catbox com o contexto
	catboxClient := catbox.New(client)
	
	// TODO: Implementar upload com contexto quando a biblioteca suportar
	// Por enquanto, usa o upload normal
	url, err := catboxClient.Upload(filePath)
	if err != nil {
		return "", err
	}
	
	// Armazena URL para recuperação em caso de sucesso
	cu.mutex.Lock()
	cu.lastRequestTime = time.Now()
	cu.mutex.Unlock()
	
	return url, nil
}

// updateResponseTime atualiza o tempo médio de resposta
func (cu *CatboxUploader) updateResponseTime(duration time.Duration) {
	cu.mutex.Lock()
	defer cu.mutex.Unlock()
	
	// Média móvel simples
	if cu.avgResponseTime == 0 {
		cu.avgResponseTime = duration
	} else {
		cu.avgResponseTime = (cu.avgResponseTime + duration) / 2
	}
}


// GetName retorna o nome do uploader
func (cu *CatboxUploader) GetName() string {
	return "catbox"
}

// GetRateLimit retorna as limitações de taxa do Catbox (adaptativo)
func (cu *CatboxUploader) GetRateLimit() (int, time.Duration) {
	currentRate := cu.rateLimiter.GetCurrentRate()
	return int(currentRate), time.Minute
}

// GetMetrics retorna métricas detalhadas do uploader
func (cu *CatboxUploader) GetMetrics() map[string]interface{} {
	cu.mutex.RLock()
	defer cu.mutex.RUnlock()
	
	total := cu.totalRequests
	success := cu.successRequests
	failed := cu.failedRequests
	
	successRate := float64(0)
	if total > 0 {
		successRate = float64(success) / float64(total) * 100
	}
	
	return map[string]interface{}{
		"total_requests":     total,
		"successful_requests": success,
		"failed_requests":    failed,
		"success_rate":       successRate,
		"avg_response_time":  cu.avgResponseTime.String(),
		"current_rate":       cu.rateLimiter.GetCurrentRate(),
		"circuit_breaker_state": cu.circuitBreaker.GetState(),
		"active_connections":  cu.connPool.GetActiveConnections(),
		"last_request_time":   cu.lastRequestTime,
	}
}

// HealthCheck verifica a saúde do uploader
func (cu *CatboxUploader) HealthCheck() bool {
	// Considera saudável se:
	// 1. Circuit breaker não está aberto
	// 2. Taxa de sucesso > 80% (se houver requests)
	cu.mutex.RLock()
	defer cu.mutex.RUnlock()
	
	if cu.circuitBreaker.GetState() == Open {
		return false
	}
	
	if cu.totalRequests > 10 {
		successRate := float64(cu.successRequests) / float64(cu.totalRequests)
		return successRate > 0.8
	}
	
	return true
}

// Close encerra o uploader e libera recursos
func (cu *CatboxUploader) Close() error {
	cu.cancel()
	cu.rateLimiter.Close()
	cu.wg.Wait()
	return nil
}

// calculateBackoffDelay calcula o delay para retry com backoff exponencial
func (cu *CatboxUploader) calculateBackoffDelay(attempt int) time.Duration {
	// Backoff exponencial: baseDelay * 2^attempt com jitter
	delay := time.Duration(float64(cu.baseDelay) * math.Pow(2, float64(attempt)))
	
	if delay > cu.maxDelay {
		delay = cu.maxDelay
	}
	
	// Adicionar jitter aleatório de ±25%
	jitter := float64(delay) * 0.25
	nanoFloat := float64(time.Now().UnixNano())
	jitterAmount := time.Duration(int64(nanoFloat)%int64(jitter) - int64(jitter/2))
	
	return delay + jitterAmount
}

// UploadToCatbox mantém compatibilidade com código existente
func UploadToCatbox(filePath string) (string, error) {
	uploader := NewCatboxUploader()
	defer uploader.Close() // Cleanup após uso
	return uploader.Upload(filePath)
}

// BatchUpload realiza upload de múltiplos arquivos com paralelismo controlado
func (cu *CatboxUploader) BatchUpload(filePaths []string, maxConcurrency int) ([]UploadResult, error) {
	if maxConcurrency <= 0 {
		maxConcurrency = 10 // Default
	}
	
	results := make([]UploadResult, len(filePaths))
	semaphore := make(chan struct{}, maxConcurrency)
	var wg sync.WaitGroup
	
	for i, filePath := range filePaths {
		wg.Add(1)
		go func(index int, path string) {
			defer wg.Done()
			
			// Adquire semaforo
			semaphore <- struct{}{}
			defer func() { <-semaphore }()
			
			startTime := time.Now()
			url, err := cu.Upload(path)
			duration := time.Since(startTime)
			
			results[index] = UploadResult{
				FilePath: path,
				URL:      url,
				Error:    err,
				Duration: duration,
			}
		}(i, filePath)
	}
	
	wg.Wait()
	return results, nil
}

// UploadResult representa o resultado de um upload
type UploadResult struct {
	FilePath string        `json:"filePath"`
	URL      string        `json:"url"`
	Error    error         `json:"error"`
	Duration time.Duration `json:"duration"`
}

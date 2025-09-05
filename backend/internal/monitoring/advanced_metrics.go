package monitoring

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
)

// AdvancedMetrics gerencia métricas avançadas para operações massivas
type AdvancedMetrics struct {
	// Collection metrics
	activeCollections    int64
	totalCollections     int64
	completedCollections int64
	failedCollections    int64
	
	// File processing metrics
	totalFiles           int64
	processedFiles       int64
	failedFiles          int64
	totalBytesProcessed  int64
	
	// Performance metrics
	averageUploadTime    time.Duration
	peakUploadRate       float64  // files per second
	currentUploadRate    float64
	
	// System metrics
	startTime            time.Time
	lastMetricsUpdate    time.Time
	peakMemoryUsage      uint64
	currentMemoryUsage   uint64
	
	// Error tracking
	errorCounts          map[string]int64
	errorMutex           sync.RWMutex
	
	// Circuit breaker metrics
	circuitBreakerStats  map[string]*CircuitBreakerMetrics
	cbMutex              sync.RWMutex
	
	// Rate limiter metrics
	rateLimiterStats     map[string]*RateLimiterMetrics
	rlMutex              sync.RWMutex
	
	// Collection-specific metrics
	collectionMetrics    map[string]*CollectionMetrics
	cmMutex              sync.RWMutex
	
	// Historical data (last hour, bucketed by minute)
	historicalMetrics    []*HistoricalSnapshot
	hmMutex              sync.RWMutex
	
	// Thresholds and alerts
	thresholds           *MetricThresholds
	alertCallbacks       []AlertCallback
	
	// Lifecycle
	mutex                sync.RWMutex
	stopChan             chan struct{}
	ticker               *time.Ticker
	wg                   sync.WaitGroup
}

// CircuitBreakerMetrics métricas específicas do circuit breaker
type CircuitBreakerMetrics struct {
	State            string    `json:"state"`
	TotalRequests    int64     `json:"totalRequests"`
	SuccessfulRequests int64   `json:"successfulRequests"`
	FailedRequests   int64     `json:"failedRequests"`
	LastStateChange  time.Time `json:"lastStateChange"`
	OpenCount        int64     `json:"openCount"`
	HalfOpenCount    int64     `json:"halfOpenCount"`
}

// RateLimiterMetrics métricas do rate limiter
type RateLimiterMetrics struct {
	CurrentRate      int64     `json:"currentRate"`
	MaxRate          int64     `json:"maxRate"`
	MinRate          int64     `json:"minRate"`
	TotalRequests    int64     `json:"totalRequests"`
	ThrottledRequests int64    `json:"throttledRequests"`
	AdjustmentCount  int64     `json:"adjustmentCount"`
	LastAdjustment   time.Time `json:"lastAdjustment"`
}

// CollectionMetrics métricas específicas de uma coleção
type CollectionMetrics struct {
	Name             string        `json:"name"`
	StartTime        time.Time     `json:"startTime"`
	EndTime          *time.Time    `json:"endTime,omitempty"`
	Status           string        `json:"status"`
	TotalObras       int           `json:"totalObras"`
	CompletedObras   int           `json:"completedObras"`
	TotalChapters    int           `json:"totalChapters"`
	CompletedChapters int          `json:"completedChapters"`
	TotalFiles       int           `json:"totalFiles"`
	ProcessedFiles   int           `json:"processedFiles"`
	FailedFiles      int           `json:"failedFiles"`
	TotalBytes       int64         `json:"totalBytes"`
	ProcessedBytes   int64         `json:"processedBytes"`
	AverageFileSize  int64         `json:"averageFileSize"`
	CurrentSpeed     float64       `json:"currentSpeed"`
	PeakSpeed        float64       `json:"peakSpeed"`
	ErrorCount       int64         `json:"errorCount"`
	RetryCount       int64         `json:"retryCount"`
}

// HistoricalSnapshot snapshot histórico das métricas
type HistoricalSnapshot struct {
	Timestamp        time.Time `json:"timestamp"`
	ActiveCollections int64    `json:"activeCollections"`
	UploadRate       float64   `json:"uploadRate"`
	MemoryUsage      uint64    `json:"memoryUsage"`
	ErrorRate        float64   `json:"errorRate"`
	TotalFiles       int64     `json:"totalFiles"`
	ProcessedFiles   int64     `json:"processedFiles"`
	FailedFiles      int64     `json:"failedFiles"`
}

// MetricThresholds thresholds para alertas
type MetricThresholds struct {
	MaxMemoryUsageMB     uint64  `json:"maxMemoryUsageMB"`
	MinUploadRate        float64 `json:"minUploadRate"`
	MaxErrorRate         float64 `json:"maxErrorRate"`
	MaxCollectionTime    time.Duration `json:"maxCollectionTime"`
	MaxActiveCollections int64   `json:"maxActiveCollections"`
}

// AlertCallback callback para alertas
type AlertCallback func(alertType string, message string, severity AlertSeverity)

// AlertSeverity níveis de severidade dos alertas
type AlertSeverity int

const (
	SeverityInfo AlertSeverity = iota
	SeverityWarning
	SeverityError
	SeverityCritical
)

// String implementa Stringer para AlertSeverity
func (s AlertSeverity) String() string {
	switch s {
	case SeverityInfo:
		return "INFO"
	case SeverityWarning:
		return "WARNING"
	case SeverityError:
		return "ERROR"
	case SeverityCritical:
		return "CRITICAL"
	default:
		return "UNKNOWN"
	}
}

// NewAdvancedMetrics cria um novo sistema de métricas avançadas
func NewAdvancedMetrics() *AdvancedMetrics {
	am := &AdvancedMetrics{
		startTime:           time.Now(),
		lastMetricsUpdate:   time.Now(),
		errorCounts:         make(map[string]int64),
		circuitBreakerStats: make(map[string]*CircuitBreakerMetrics),
		rateLimiterStats:    make(map[string]*RateLimiterMetrics),
		collectionMetrics:   make(map[string]*CollectionMetrics),
		historicalMetrics:   make([]*HistoricalSnapshot, 0, 60), // 1 hora de dados
		thresholds: &MetricThresholds{
			MaxMemoryUsageMB:     2048,  // 2GB
			MinUploadRate:        10.0,  // 10 files/min
			MaxErrorRate:         0.05,  // 5%
			MaxCollectionTime:    6 * time.Hour,
			MaxActiveCollections: 10,
		},
		stopChan: make(chan struct{}),
	}
	
	// Inicia coleta de métricas em background
	am.ticker = time.NewTicker(1 * time.Minute)
	am.wg.Add(1)
	go am.metricsCollector()
	
	return am
}

// metricsCollector coleta métricas em background
func (am *AdvancedMetrics) metricsCollector() {
	defer am.wg.Done()
	
	for {
		select {
		case <-am.ticker.C:
			am.collectSystemMetrics()
			am.createHistoricalSnapshot()
			am.checkThresholds()
			am.cleanupOldMetrics()
			
		case <-am.stopChan:
			return
		}
	}
}

// collectSystemMetrics coleta métricas do sistema
func (am *AdvancedMetrics) collectSystemMetrics() {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	
	currentMem := m.Alloc
	atomic.StoreUint64(&am.currentMemoryUsage, currentMem)
	
	// Atualiza pico de memória
	for {
		peak := atomic.LoadUint64(&am.peakMemoryUsage)
		if currentMem <= peak || atomic.CompareAndSwapUint64(&am.peakMemoryUsage, peak, currentMem) {
			break
		}
	}
	
	am.mutex.Lock()
	am.lastMetricsUpdate = time.Now()
	am.mutex.Unlock()
}

// createHistoricalSnapshot cria um snapshot histórico
func (am *AdvancedMetrics) createHistoricalSnapshot() {
	now := time.Now()
	
	snapshot := &HistoricalSnapshot{
		Timestamp:        now,
		ActiveCollections: atomic.LoadInt64(&am.activeCollections),
		UploadRate:       am.currentUploadRate,
		MemoryUsage:      atomic.LoadUint64(&am.currentMemoryUsage),
		TotalFiles:       atomic.LoadInt64(&am.totalFiles),
		ProcessedFiles:   atomic.LoadInt64(&am.processedFiles),
		FailedFiles:      atomic.LoadInt64(&am.failedFiles),
	}
	
	// Calcula taxa de erro
	total := snapshot.ProcessedFiles + snapshot.FailedFiles
	if total > 0 {
		snapshot.ErrorRate = float64(snapshot.FailedFiles) / float64(total)
	}
	
	am.hmMutex.Lock()
	am.historicalMetrics = append(am.historicalMetrics, snapshot)
	
	// Mantém apenas os últimos 60 minutos
	if len(am.historicalMetrics) > 60 {
		am.historicalMetrics = am.historicalMetrics[1:]
	}
	am.hmMutex.Unlock()
}

// checkThresholds verifica thresholds e dispara alertas
func (am *AdvancedMetrics) checkThresholds() {
	if am.thresholds == nil || len(am.alertCallbacks) == 0 {
		return
	}
	
	// Verifica uso de memória
	memUsageMB := atomic.LoadUint64(&am.currentMemoryUsage) / (1024 * 1024)
	if memUsageMB > am.thresholds.MaxMemoryUsageMB {
		am.triggerAlert("memory_usage", 
			fmt.Sprintf("Memory usage exceeded threshold: %dMB > %dMB", 
				memUsageMB, am.thresholds.MaxMemoryUsageMB), 
			SeverityWarning)
	}
	
	// Verifica taxa de upload
	if am.currentUploadRate < am.thresholds.MinUploadRate {
		am.triggerAlert("upload_rate", 
			fmt.Sprintf("Upload rate below threshold: %.2f < %.2f files/min", 
				am.currentUploadRate, am.thresholds.MinUploadRate), 
			SeverityWarning)
	}
	
	// Verifica taxa de erro
	total := atomic.LoadInt64(&am.processedFiles) + atomic.LoadInt64(&am.failedFiles)
	if total > 0 {
		errorRate := float64(atomic.LoadInt64(&am.failedFiles)) / float64(total)
		if errorRate > am.thresholds.MaxErrorRate {
			am.triggerAlert("error_rate", 
				fmt.Sprintf("Error rate exceeded threshold: %.3f > %.3f", 
					errorRate, am.thresholds.MaxErrorRate), 
				SeverityError)
		}
	}
	
	// Verifica número de coleções ativas
	activeCollections := atomic.LoadInt64(&am.activeCollections)
	if activeCollections > am.thresholds.MaxActiveCollections {
		am.triggerAlert("active_collections", 
			fmt.Sprintf("Too many active collections: %d > %d", 
				activeCollections, am.thresholds.MaxActiveCollections), 
			SeverityWarning)
	}
}

// cleanupOldMetrics limpa métricas antigas para evitar memory leak
func (am *AdvancedMetrics) cleanupOldMetrics() {
	cutoff := time.Now().Add(-24 * time.Hour)
	
	// Limpa métricas de coleções antigas
	am.cmMutex.Lock()
	for id, metrics := range am.collectionMetrics {
		if metrics.EndTime != nil && metrics.EndTime.Before(cutoff) {
			delete(am.collectionMetrics, id)
		}
	}
	am.cmMutex.Unlock()
}

// RegisterAlertCallback registra um callback para alertas
func (am *AdvancedMetrics) RegisterAlertCallback(callback AlertCallback) {
	am.mutex.Lock()
	am.alertCallbacks = append(am.alertCallbacks, callback)
	am.mutex.Unlock()
}

// triggerAlert dispara um alerta
func (am *AdvancedMetrics) triggerAlert(alertType, message string, severity AlertSeverity) {
	am.mutex.RLock()
	callbacks := make([]AlertCallback, len(am.alertCallbacks))
	copy(callbacks, am.alertCallbacks)
	am.mutex.RUnlock()
	
	for _, callback := range callbacks {
		go callback(alertType, message, severity)
	}
}

// StartCollection inicia métricas para uma nova coleção
func (am *AdvancedMetrics) StartCollection(id, name string) {
	atomic.AddInt64(&am.activeCollections, 1)
	atomic.AddInt64(&am.totalCollections, 1)
	
	metrics := &CollectionMetrics{
		Name:      name,
		StartTime: time.Now(),
		Status:    "running",
	}
	
	am.cmMutex.Lock()
	am.collectionMetrics[id] = metrics
	am.cmMutex.Unlock()
}

// UpdateCollectionMetrics atualiza métricas de uma coleção
func (am *AdvancedMetrics) UpdateCollectionMetrics(id string, update func(*CollectionMetrics)) {
	am.cmMutex.Lock()
	defer am.cmMutex.Unlock()
	
	if metrics, exists := am.collectionMetrics[id]; exists {
		update(metrics)
	}
}

// CompleteCollection marca uma coleção como completa
func (am *AdvancedMetrics) CompleteCollection(id string, success bool) {
	atomic.AddInt64(&am.activeCollections, -1)
	
	if success {
		atomic.AddInt64(&am.completedCollections, 1)
	} else {
		atomic.AddInt64(&am.failedCollections, 1)
	}
	
	am.cmMutex.Lock()
	if metrics, exists := am.collectionMetrics[id]; exists {
		endTime := time.Now()
		metrics.EndTime = &endTime
		if success {
			metrics.Status = "completed"
		} else {
			metrics.Status = "failed"
		}
	}
	am.cmMutex.Unlock()
}

// RecordFileProcessed registra um arquivo processado
func (am *AdvancedMetrics) RecordFileProcessed(collectionID string, fileSize int64, duration time.Duration, success bool) {
	atomic.AddInt64(&am.totalFiles, 1)
	atomic.AddInt64(&am.totalBytesProcessed, fileSize)
	
	if success {
		atomic.AddInt64(&am.processedFiles, 1)
	} else {
		atomic.AddInt64(&am.failedFiles, 1)
	}
	
	// Atualiza tempo médio de upload
	am.updateAverageUploadTime(duration)
	
	// Atualiza taxa de upload atual
	am.updateCurrentUploadRate()
	
	// Atualiza métricas da coleção
	if collectionID != "" {
		am.UpdateCollectionMetrics(collectionID, func(metrics *CollectionMetrics) {
			metrics.TotalFiles++
			metrics.TotalBytes += fileSize
			metrics.ProcessedBytes += fileSize
			
			if success {
				metrics.ProcessedFiles++
			} else {
				metrics.FailedFiles++
				metrics.ErrorCount++
			}
			
			// Atualiza tamanho médio do arquivo
			if metrics.TotalFiles > 0 {
				metrics.AverageFileSize = metrics.TotalBytes / int64(metrics.TotalFiles)
			}
			
			// Calcula velocidade atual
			elapsed := time.Since(metrics.StartTime).Minutes()
			if elapsed > 0 {
				metrics.CurrentSpeed = float64(metrics.ProcessedFiles) / elapsed
				if metrics.CurrentSpeed > metrics.PeakSpeed {
					metrics.PeakSpeed = metrics.CurrentSpeed
				}
			}
		})
	}
}

// RecordError registra um erro
func (am *AdvancedMetrics) RecordError(errorType, errorMessage string) {
	am.errorMutex.Lock()
	am.errorCounts[errorType]++
	am.errorMutex.Unlock()
}

// UpdateCircuitBreakerMetrics atualiza métricas do circuit breaker
func (am *AdvancedMetrics) UpdateCircuitBreakerMetrics(name, state string, totalReq, successReq, failedReq int64) {
	am.cbMutex.Lock()
	defer am.cbMutex.Unlock()
	
	metrics, exists := am.circuitBreakerStats[name]
	if !exists {
		metrics = &CircuitBreakerMetrics{}
		am.circuitBreakerStats[name] = metrics
	}
	
	oldState := metrics.State
	metrics.State = state
	metrics.TotalRequests = totalReq
	metrics.SuccessfulRequests = successReq
	metrics.FailedRequests = failedReq
	
	if oldState != state {
		metrics.LastStateChange = time.Now()
		switch state {
		case "open":
			metrics.OpenCount++
		case "half-open":
			metrics.HalfOpenCount++
		}
	}
}

// UpdateRateLimiterMetrics atualiza métricas do rate limiter
func (am *AdvancedMetrics) UpdateRateLimiterMetrics(name string, currentRate, maxRate, minRate, totalReq, throttledReq int64) {
	am.rlMutex.Lock()
	defer am.rlMutex.Unlock()
	
	metrics, exists := am.rateLimiterStats[name]
	if !exists {
		metrics = &RateLimiterMetrics{}
		am.rateLimiterStats[name] = metrics
	}
	
	oldRate := metrics.CurrentRate
	metrics.CurrentRate = currentRate
	metrics.MaxRate = maxRate
	metrics.MinRate = minRate
	metrics.TotalRequests = totalReq
	metrics.ThrottledRequests = throttledReq
	
	if oldRate != currentRate {
		metrics.AdjustmentCount++
		metrics.LastAdjustment = time.Now()
	}
}

// updateAverageUploadTime atualiza tempo médio de upload
func (am *AdvancedMetrics) updateAverageUploadTime(duration time.Duration) {
	am.mutex.Lock()
	defer am.mutex.Unlock()
	
	if am.averageUploadTime == 0 {
		am.averageUploadTime = duration
	} else {
		// Média móvel simples
		am.averageUploadTime = (am.averageUploadTime + duration) / 2
	}
}

// updateCurrentUploadRate atualiza taxa de upload atual
func (am *AdvancedMetrics) updateCurrentUploadRate() {
	processed := atomic.LoadInt64(&am.processedFiles)
	elapsed := time.Since(am.startTime).Minutes()
	
	if elapsed > 0 {
		rate := float64(processed) / elapsed
		am.mutex.Lock()
		am.currentUploadRate = rate
		if rate > am.peakUploadRate {
			am.peakUploadRate = rate
		}
		am.mutex.Unlock()
	}
}

// GetComprehensiveStats retorna estatísticas completas
func (am *AdvancedMetrics) GetComprehensiveStats() map[string]interface{} {
	am.mutex.RLock()
	defer am.mutex.RUnlock()
	
	// Métricas básicas
	stats := map[string]interface{}{
		"system": map[string]interface{}{
			"uptime":                time.Since(am.startTime).String(),
			"last_update":           am.lastMetricsUpdate,
			"current_memory_mb":     atomic.LoadUint64(&am.currentMemoryUsage) / (1024 * 1024),
			"peak_memory_mb":        atomic.LoadUint64(&am.peakMemoryUsage) / (1024 * 1024),
		},
		"collections": map[string]interface{}{
			"active":    atomic.LoadInt64(&am.activeCollections),
			"total":     atomic.LoadInt64(&am.totalCollections),
			"completed": atomic.LoadInt64(&am.completedCollections),
			"failed":    atomic.LoadInt64(&am.failedCollections),
		},
		"files": map[string]interface{}{
			"total":            atomic.LoadInt64(&am.totalFiles),
			"processed":        atomic.LoadInt64(&am.processedFiles),
			"failed":           atomic.LoadInt64(&am.failedFiles),
			"total_bytes":      atomic.LoadInt64(&am.totalBytesProcessed),
			"average_upload_time": am.averageUploadTime.String(),
		},
		"performance": map[string]interface{}{
			"current_upload_rate": am.currentUploadRate,
			"peak_upload_rate":    am.peakUploadRate,
		},
		"thresholds": am.thresholds,
	}
	
	// Erros
	am.errorMutex.RLock()
	errorStats := make(map[string]int64)
	for errorType, count := range am.errorCounts {
		errorStats[errorType] = count
	}
	am.errorMutex.RUnlock()
	stats["errors"] = errorStats
	
	// Circuit breakers
	am.cbMutex.RLock()
	cbStats := make(map[string]*CircuitBreakerMetrics)
	for name, metrics := range am.circuitBreakerStats {
		cbStats[name] = metrics
	}
	am.cbMutex.RUnlock()
	stats["circuit_breakers"] = cbStats
	
	// Rate limiters
	am.rlMutex.RLock()
	rlStats := make(map[string]*RateLimiterMetrics)
	for name, metrics := range am.rateLimiterStats {
		rlStats[name] = metrics
	}
	am.rlMutex.RUnlock()
	stats["rate_limiters"] = rlStats
	
	// Coleções ativas
	am.cmMutex.RLock()
	collectionStats := make(map[string]*CollectionMetrics)
	for id, metrics := range am.collectionMetrics {
		collectionStats[id] = metrics
	}
	am.cmMutex.RUnlock()
	stats["active_collections"] = collectionStats
	
	// Dados históricos
	am.hmMutex.RLock()
	historicalData := make([]*HistoricalSnapshot, len(am.historicalMetrics))
	copy(historicalData, am.historicalMetrics)
	am.hmMutex.RUnlock()
	stats["historical"] = historicalData
	
	return stats
}

// ExportToFile exporta métricas para arquivo JSON
func (am *AdvancedMetrics) ExportToFile(filePath string) error {
	stats := am.GetComprehensiveStats()
	
	data, err := json.MarshalIndent(stats, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal metrics: %v", err)
	}
	
	return os.WriteFile(filePath, data, 0644)
}

// Stop para o sistema de métricas
func (am *AdvancedMetrics) Stop() {
	if am.ticker != nil {
		am.ticker.Stop()
	}
	
	close(am.stopChan)
	am.wg.Wait()
}

// SetThresholds define novos thresholds
func (am *AdvancedMetrics) SetThresholds(thresholds *MetricThresholds) {
	am.mutex.Lock()
	am.thresholds = thresholds
	am.mutex.Unlock()
}

// GetCollectionMetrics retorna métricas de uma coleção específica
func (am *AdvancedMetrics) GetCollectionMetrics(id string) (*CollectionMetrics, bool) {
	am.cmMutex.RLock()
	defer am.cmMutex.RUnlock()
	
	metrics, exists := am.collectionMetrics[id]
	return metrics, exists
}

// GetHistoricalData retorna dados históricos
func (am *AdvancedMetrics) GetHistoricalData(minutes int) []*HistoricalSnapshot {
	am.hmMutex.RLock()
	defer am.hmMutex.RUnlock()
	
	if minutes <= 0 || minutes > len(am.historicalMetrics) {
		minutes = len(am.historicalMetrics)
	}
	
	start := len(am.historicalMetrics) - minutes
	if start < 0 {
		start = 0
	}
	
	result := make([]*HistoricalSnapshot, len(am.historicalMetrics[start:]))
	copy(result, am.historicalMetrics[start:])
	
	return result
}
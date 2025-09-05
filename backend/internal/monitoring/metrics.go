package monitoring

import (
	"context"
	"encoding/json"
	"log"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
)

// Metrics representa as métricas do sistema
type Metrics struct {
	// Métricas de upload
	TotalUploads        int64     `json:"totalUploads"`
	SuccessfulUploads   int64     `json:"successfulUploads"`
	FailedUploads       int64     `json:"failedUploads"`
	BytesUploaded       int64     `json:"bytesUploaded"`
	AverageUploadTime   int64     `json:"averageUploadTime"` // em milliseconds
	CurrentUploadRate   float64   `json:"currentUploadRate"` // uploads por segundo
	
	// Métricas de descoberta
	TotalDiscoveries    int64     `json:"totalDiscoveries"`
	FilesDiscovered     int64     `json:"filesDiscovered"`
	AverageDiscoveryTime int64    `json:"averageDiscoveryTime"` // em milliseconds
	
	// Métricas de WebSocket
	ActiveConnections   int32     `json:"activeConnections"`
	TotalConnections    int64     `json:"totalConnections"`
	MessagesReceived    int64     `json:"messagesReceived"`
	MessagesSent        int64     `json:"messagesSent"`
	
	// Métricas de sistema
	MemoryUsageMB       float64   `json:"memoryUsageMb"`
	CPUUsagePercent     float64   `json:"cpuUsagePercent"`
	GoroutineCount      int       `json:"goroutineCount"`
	
	// Métricas de performance
	UploadQueueSize     int       `json:"uploadQueueSize"`
	ActiveUploads       int32     `json:"activeUploads"`
	RateLimitHits       int64     `json:"rateLimitHits"`
	RetryAttempts       int64     `json:"retryAttempts"`
	
	// Timestamp da última atualização
	LastUpdated         time.Time `json:"lastUpdated"`
}

// PerformanceMetrics métricas detalhadas de performance
type PerformanceMetrics struct {
	UploadLatency    LatencyStats `json:"uploadLatency"`
	DiscoveryLatency LatencyStats `json:"discoveryLatency"`
	SystemLoad       SystemStats  `json:"systemLoad"`
	NetworkStats     NetworkStats `json:"networkStats"`
}

// LatencyStats estatísticas de latência
type LatencyStats struct {
	Min        time.Duration `json:"min"`
	Max        time.Duration `json:"max"`
	Mean       time.Duration `json:"mean"`
	P50        time.Duration `json:"p50"`
	P90        time.Duration `json:"p90"`
	P95        time.Duration `json:"p95"`
	P99        time.Duration `json:"p99"`
	SampleSize int           `json:"sampleSize"`
}

// SystemStats estatísticas do sistema
type SystemStats struct {
	CPUCores        int     `json:"cpuCores"`
	MemoryTotal     int64   `json:"memoryTotal"`
	MemoryUsed      int64   `json:"memoryUsed"`
	MemoryPercent   float64 `json:"memoryPercent"`
	GCPauses        int64   `json:"gcPauses"`
	HeapObjects     uint64  `json:"heapObjects"`
	StackInUse      uint64  `json:"stackInUse"`
}

// NetworkStats estatísticas de rede
type NetworkStats struct {
	BytesSent       int64   `json:"bytesSent"`
	BytesReceived   int64   `json:"bytesReceived"`
	PacketsSent     int64   `json:"packetsSent"`
	PacketsReceived int64   `json:"packetsReceived"`
	Errors          int64   `json:"errors"`
	ActiveSockets   int32   `json:"activeSockets"`
}

// Monitor gerencia coleta e exposição de métricas
type Monitor struct {
	metrics         *Metrics
	perfMetrics     *PerformanceMetrics
	uploadTimes     []time.Duration
	discoveryTimes  []time.Duration
	mu              sync.RWMutex
	ctx             context.Context
	cancel          context.CancelFunc
	wg              sync.WaitGroup
	collectors      []MetricCollector
	
	// Advanced metrics integration
	advancedMetrics *AdvancedMetrics
}

// MetricCollector interface para coletores de métricas personalizados
type MetricCollector interface {
	Collect() interface{}
	Name() string
}

// NewMonitor cria um novo monitor de métricas
func NewMonitor() *Monitor {
	ctx, cancel := context.WithCancel(context.Background())
	
	// Criar sistema de métricas avançadas
	advancedMetrics := NewAdvancedMetrics()
	
	monitor := &Monitor{
		metrics: &Metrics{
			LastUpdated: time.Now(),
		},
		perfMetrics: &PerformanceMetrics{
			SystemLoad: SystemStats{
				CPUCores: runtime.NumCPU(),
			},
		},
		uploadTimes:     make([]time.Duration, 0, 1000),
		discoveryTimes:  make([]time.Duration, 0, 100),
		ctx:             ctx,
		cancel:          cancel,
		collectors:      make([]MetricCollector, 0),
		advancedMetrics: advancedMetrics,
	}
	
	// Registrar callback de alerta
	advancedMetrics.RegisterAlertCallback(monitor.handleAlert)
	
	// Iniciar coleta periódica de métricas
	monitor.wg.Add(1)
	go monitor.collectSystemMetrics()
	
	return monitor
}

// handleAlert processa alertas do sistema de métricas avançadas
func (m *Monitor) handleAlert(alertType, message string, severity AlertSeverity) {
	log.Printf("[ALERT:%s] %s: %s", severity.String(), alertType, message)
	
	// Aqui você pode integrar com sistemas de notificação externos
	// como Slack, PagerDuty, email, etc.
}

// RecordUpload registra uma operação de upload
func (m *Monitor) RecordUpload(success bool, duration time.Duration, bytes int64) {
	atomic.AddInt64(&m.metrics.TotalUploads, 1)
	
	if success {
		atomic.AddInt64(&m.metrics.SuccessfulUploads, 1)
		atomic.AddInt64(&m.metrics.BytesUploaded, bytes)
	} else {
		atomic.AddInt64(&m.metrics.FailedUploads, 1)
	}
	
	// Atualizar tempos de upload
	m.mu.Lock()
	m.uploadTimes = append(m.uploadTimes, duration)
	
	// Manter apenas os últimos 1000 registros
	if len(m.uploadTimes) > 1000 {
		m.uploadTimes = m.uploadTimes[len(m.uploadTimes)-1000:]
	}
	
	// Calcular tempo médio
	if len(m.uploadTimes) > 0 {
		var total time.Duration
		for _, t := range m.uploadTimes {
			total += t
		}
		m.metrics.AverageUploadTime = int64(total / time.Duration(len(m.uploadTimes)) / time.Millisecond)
	}
	m.mu.Unlock()
}

// RecordDiscovery registra uma operação de descoberta
func (m *Monitor) RecordDiscovery(duration time.Duration, filesFound int64) {
	atomic.AddInt64(&m.metrics.TotalDiscoveries, 1)
	atomic.AddInt64(&m.metrics.FilesDiscovered, filesFound)
	
	m.mu.Lock()
	m.discoveryTimes = append(m.discoveryTimes, duration)
	
	// Manter apenas os últimos 100 registros
	if len(m.discoveryTimes) > 100 {
		m.discoveryTimes = m.discoveryTimes[len(m.discoveryTimes)-100:]
	}
	
	// Calcular tempo médio
	if len(m.discoveryTimes) > 0 {
		var total time.Duration
		for _, t := range m.discoveryTimes {
			total += t
		}
		m.metrics.AverageDiscoveryTime = int64(total / time.Duration(len(m.discoveryTimes)) / time.Millisecond)
	}
	m.mu.Unlock()
}

// RecordWebSocketConnection registra uma conexão WebSocket
func (m *Monitor) RecordWebSocketConnection(connected bool) {
	if connected {
		atomic.AddInt32(&m.metrics.ActiveConnections, 1)
		atomic.AddInt64(&m.metrics.TotalConnections, 1)
	} else {
		atomic.AddInt32(&m.metrics.ActiveConnections, -1)
	}
}

// RecordMessage registra uma mensagem WebSocket
func (m *Monitor) RecordMessage(sent bool) {
	if sent {
		atomic.AddInt64(&m.metrics.MessagesSent, 1)
	} else {
		atomic.AddInt64(&m.metrics.MessagesReceived, 1)
	}
}

// RecordRateLimitHit registra um hit no rate limit
func (m *Monitor) RecordRateLimitHit() {
	atomic.AddInt64(&m.metrics.RateLimitHits, 1)
}

// RecordRetryAttempt registra uma tentativa de retry
func (m *Monitor) RecordRetryAttempt() {
	atomic.AddInt64(&m.metrics.RetryAttempts, 1)
}

// SetActiveUploads define o número de uploads ativos
func (m *Monitor) SetActiveUploads(count int32) {
	atomic.StoreInt32(&m.metrics.ActiveUploads, count)
}

// SetUploadQueueSize define o tamanho da fila de uploads
func (m *Monitor) SetUploadQueueSize(size int) {
	m.mu.Lock()
	m.metrics.UploadQueueSize = size
	m.mu.Unlock()
}

// GetMetrics retorna as métricas atuais
func (m *Monitor) GetMetrics() *Metrics {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	// Criar cópia das métricas
	metrics := *m.metrics
	metrics.LastUpdated = time.Now()
	
	return &metrics
}

// GetPerformanceMetrics retorna métricas detalhadas de performance
func (m *Monitor) GetPerformanceMetrics() *PerformanceMetrics {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	perfMetrics := *m.perfMetrics
	
	// Calcular estatísticas de latência para uploads
	if len(m.uploadTimes) > 0 {
		perfMetrics.UploadLatency = m.calculateLatencyStats(m.uploadTimes)
	}
	
	// Calcular estatísticas de latência para descoberta
	if len(m.discoveryTimes) > 0 {
		perfMetrics.DiscoveryLatency = m.calculateLatencyStats(m.discoveryTimes)
	}
	
	return &perfMetrics
}

// calculateLatencyStats calcula estatísticas de latência
func (m *Monitor) calculateLatencyStats(durations []time.Duration) LatencyStats {
	if len(durations) == 0 {
		return LatencyStats{}
	}
	
	// Copiar e ordenar
	sorted := make([]time.Duration, len(durations))
	copy(sorted, durations)
	
	// Ordenação simples (bubble sort para arrays pequenos)
	for i := 0; i < len(sorted)-1; i++ {
		for j := 0; j < len(sorted)-i-1; j++ {
			if sorted[j] > sorted[j+1] {
				sorted[j], sorted[j+1] = sorted[j+1], sorted[j]
			}
		}
	}
	
	// Calcular estatísticas
	var total time.Duration
	for _, d := range sorted {
		total += d
	}
	
	stats := LatencyStats{
		Min:        sorted[0],
		Max:        sorted[len(sorted)-1],
		Mean:       total / time.Duration(len(sorted)),
		SampleSize: len(sorted),
	}
	
	// Percentis
	stats.P50 = sorted[len(sorted)*50/100]
	stats.P90 = sorted[len(sorted)*90/100]
	stats.P95 = sorted[len(sorted)*95/100]
	stats.P99 = sorted[len(sorted)*99/100]
	
	return stats
}

// collectSystemMetrics coleta métricas do sistema periodicamente
func (m *Monitor) collectSystemMetrics() {
	defer m.wg.Done()
	
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	
	var lastGC uint32
	
	for {
		select {
		case <-ticker.C:
			// Coletar métricas de runtime
			var memStats runtime.MemStats
			runtime.ReadMemStats(&memStats)
			
			m.mu.Lock()
			m.metrics.MemoryUsageMB = float64(memStats.Alloc) / 1024 / 1024
			m.metrics.GoroutineCount = runtime.NumGoroutine()
			
			// Atualizar métricas de performance
			m.perfMetrics.SystemLoad.MemoryUsed = int64(memStats.Alloc)
			m.perfMetrics.SystemLoad.MemoryTotal = int64(memStats.Sys)
			m.perfMetrics.SystemLoad.MemoryPercent = float64(memStats.Alloc) / float64(memStats.Sys) * 100
			m.perfMetrics.SystemLoad.HeapObjects = memStats.HeapObjects
			m.perfMetrics.SystemLoad.StackInUse = memStats.StackInuse
			
			// Contar pausas de GC
			if memStats.NumGC > lastGC {
				m.perfMetrics.SystemLoad.GCPauses += int64(memStats.NumGC - lastGC)
				lastGC = memStats.NumGC
			}
			
			// Calcular taxa de upload atual (últimos 60 segundos)
			now := time.Now()
			recentUploads := int64(0)
			for _, duration := range m.uploadTimes {
				if now.Sub(now.Add(-duration)) <= 60*time.Second {
					recentUploads++
				}
			}
			m.metrics.CurrentUploadRate = float64(recentUploads) / 60.0
			
			m.mu.Unlock()
			
			// Executar coletores personalizados
			for _, collector := range m.collectors {
				go func(c MetricCollector) {
					defer func() {
						if r := recover(); r != nil {
							log.Printf("Collector %s panicked: %v", c.Name(), r)
						}
					}()
					c.Collect()
				}(collector)
			}
			
		case <-m.ctx.Done():
			return
		}
	}
}

// RegisterCollector registra um coletor de métricas personalizado
func (m *Monitor) RegisterCollector(collector MetricCollector) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.collectors = append(m.collectors, collector)
}

// ExportMetrics exporta métricas em formato JSON
func (m *Monitor) ExportMetrics() ([]byte, error) {
	metrics := m.GetMetrics()
	return json.Marshal(metrics)
}

// ExportPerformanceMetrics exporta métricas de performance em JSON
func (m *Monitor) ExportPerformanceMetrics() ([]byte, error) {
	perfMetrics := m.GetPerformanceMetrics()
	return json.Marshal(perfMetrics)
}

// Reset reseta todas as métricas
func (m *Monitor) Reset() {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.metrics = &Metrics{
		LastUpdated: time.Now(),
	}
	m.uploadTimes = m.uploadTimes[:0]
	m.discoveryTimes = m.discoveryTimes[:0]
}

// RecordCollectionStart registra início de uma coleção
func (m *Monitor) RecordCollectionStart(id, name string) {
	m.advancedMetrics.StartCollection(id, name)
}

// RecordCollectionComplete registra conclusão de uma coleção
func (m *Monitor) RecordCollectionComplete(id string, success bool) {
	m.advancedMetrics.CompleteCollection(id, success)
}

// RecordFileProcessed registra processamento de arquivo
func (m *Monitor) RecordFileProcessed(collectionID string, fileSize int64, duration time.Duration, success bool) {
	m.advancedMetrics.RecordFileProcessed(collectionID, fileSize, duration, success)
}

// RecordError registra um erro
func (m *Monitor) RecordError(errorType, errorMessage string) {
	m.advancedMetrics.RecordError(errorType, errorMessage)
}

// UpdateCircuitBreakerMetrics atualiza métricas do circuit breaker
func (m *Monitor) UpdateCircuitBreakerMetrics(name, state string, totalReq, successReq, failedReq int64) {
	m.advancedMetrics.UpdateCircuitBreakerMetrics(name, state, totalReq, successReq, failedReq)
}

// UpdateRateLimiterMetrics atualiza métricas do rate limiter
func (m *Monitor) UpdateRateLimiterMetrics(name string, currentRate, maxRate, minRate, totalReq, throttledReq int64) {
	m.advancedMetrics.UpdateRateLimiterMetrics(name, currentRate, maxRate, minRate, totalReq, throttledReq)
}

// GetAdvancedMetrics retorna métricas avançadas completas
func (m *Monitor) GetAdvancedMetrics() map[string]interface{} {
	return m.advancedMetrics.GetComprehensiveStats()
}

// GetCollectionMetrics retorna métricas de uma coleção específica
func (m *Monitor) GetCollectionMetrics(id string) (*CollectionMetrics, bool) {
	return m.advancedMetrics.GetCollectionMetrics(id)
}

// GetHistoricalData retorna dados históricos
func (m *Monitor) GetHistoricalData(minutes int) []*HistoricalSnapshot {
	return m.advancedMetrics.GetHistoricalData(minutes)
}

// ExportAdvancedMetrics exporta métricas avançadas para arquivo
func (m *Monitor) ExportAdvancedMetrics(filePath string) error {
	return m.advancedMetrics.ExportToFile(filePath)
}

// SetMetricThresholds define novos thresholds para alertas
func (m *Monitor) SetMetricThresholds(thresholds *MetricThresholds) {
	m.advancedMetrics.SetThresholds(thresholds)
}

// CreateComprehensiveSnapshot cria um snapshot completo incluindo métricas avançadas
func (m *Monitor) CreateComprehensiveSnapshot() *ComprehensiveSnapshot {
	return &ComprehensiveSnapshot{
		Timestamp:        time.Now(),
		BasicMetrics:     m.GetMetrics(),
		Performance:      m.GetPerformanceMetrics(),
		AdvancedMetrics:  m.GetAdvancedMetrics(),
		Custom:           make(map[string]interface{}),
	}
}

// Close fecha o monitor
func (m *Monitor) Close() {
	log.Println("=== FINAL METRICS ===")
	m.LogMetrics()
	
	// Para sistema de métricas avançadas
	if m.advancedMetrics != nil {
		m.advancedMetrics.Stop()
	}
	
	m.cancel()
	m.wg.Wait()
}

// LogMetrics registra métricas no log
func (m *Monitor) LogMetrics() {
	metrics := m.GetMetrics()
	log.Printf("Metrics - Uploads: %d/%d success, Connections: %d active, Memory: %.2f MB, Goroutines: %d",
		metrics.SuccessfulUploads, metrics.TotalUploads,
		metrics.ActiveConnections, metrics.MemoryUsageMB, metrics.GoroutineCount)
}

// MetricsSnapshot representa um snapshot das métricas para análise
type MetricsSnapshot struct {
	Timestamp   time.Time             `json:"timestamp"`
	Metrics     *Metrics              `json:"metrics"`
	Performance *PerformanceMetrics   `json:"performance"`
	Custom      map[string]interface{} `json:"custom,omitempty"`
}

// CreateSnapshot cria um snapshot completo das métricas
func (m *Monitor) CreateSnapshot() *MetricsSnapshot {
	return &MetricsSnapshot{
		Timestamp:   time.Now(),
		Metrics:     m.GetMetrics(),
		Performance: m.GetPerformanceMetrics(),
		Custom:      make(map[string]interface{}),
	}
}

// ComprehensiveSnapshot representa um snapshot completo incluindo métricas avançadas
type ComprehensiveSnapshot struct {
	Timestamp       time.Time             `json:"timestamp"`
	BasicMetrics    *Metrics              `json:"basicMetrics"`
	Performance     *PerformanceMetrics   `json:"performance"`
	AdvancedMetrics map[string]interface{} `json:"advancedMetrics"`
	Custom          map[string]interface{} `json:"custom,omitempty"`
}
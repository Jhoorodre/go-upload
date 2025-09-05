package anilist

import (
	"sync"
	"time"
)

// PerformanceMetrics coleta estatísticas de performance da integração AniList
type PerformanceMetrics struct {
	mutex                sync.RWMutex
	
	// Contadores de requests
	SearchRequests       int64 `json:"search_requests"`
	DetailsRequests      int64 `json:"details_requests"`
	CacheHits           int64 `json:"cache_hits"`
	CacheMisses         int64 `json:"cache_misses"`
	
	// Timings em milliseconds
	AverageSearchTime   float64 `json:"average_search_time_ms"`
	AverageDetailsTime  float64 `json:"average_details_time_ms"`
	FastestSearch       int64   `json:"fastest_search_ms"`
	SlowestSearch       int64   `json:"slowest_search_ms"`
	FastestDetails      int64   `json:"fastest_details_ms"`
	SlowestDetails      int64   `json:"slowest_details_ms"`
	
	// Dados para cálculo de média
	totalSearchTime     int64
	totalDetailsTime    int64
	
	// Status da API
	APIErrors           int64     `json:"api_errors"`
	RateLimitHits       int64     `json:"rate_limit_hits"`
	LastAPICall         time.Time `json:"last_api_call"`
	
	// Estatísticas de cache
	CacheSize           int       `json:"cache_size"`
	CacheHitRate        float64   `json:"cache_hit_rate_percent"`
	
	// Payload optimization
	DataTransferredKB   float64   `json:"data_transferred_kb"`
	AveragePayloadKB    float64   `json:"average_payload_kb"`
	
	StartTime           time.Time `json:"start_time"`
}

// NewPerformanceMetrics inicializa as métricas
func NewPerformanceMetrics() *PerformanceMetrics {
	return &PerformanceMetrics{
		FastestSearch:  999999,
		SlowestSearch:  0,
		FastestDetails: 999999,
		SlowestDetails: 0,
		StartTime:      time.Now(),
	}
}

// RecordSearchRequest registra uma busca realizada
func (pm *PerformanceMetrics) RecordSearchRequest(duration time.Duration, cached bool, payloadSizeKB float64) {
	pm.mutex.Lock()
	defer pm.mutex.Unlock()
	
	durationMs := duration.Milliseconds()
	
	pm.SearchRequests++
	pm.totalSearchTime += durationMs
	pm.AverageSearchTime = float64(pm.totalSearchTime) / float64(pm.SearchRequests)
	
	if durationMs < pm.FastestSearch {
		pm.FastestSearch = durationMs
	}
	if durationMs > pm.SlowestSearch {
		pm.SlowestSearch = durationMs
	}
	
	if cached {
		pm.CacheHits++
	} else {
		pm.CacheMisses++
		pm.LastAPICall = time.Now()
		pm.DataTransferredKB += payloadSizeKB
	}
	
	pm.updateCacheHitRate()
	pm.updateAveragePayload()
}

// RecordDetailsRequest registra uma busca de detalhes
func (pm *PerformanceMetrics) RecordDetailsRequest(duration time.Duration, cached bool, payloadSizeKB float64) {
	pm.mutex.Lock()
	defer pm.mutex.Unlock()
	
	durationMs := duration.Milliseconds()
	
	pm.DetailsRequests++
	pm.totalDetailsTime += durationMs
	pm.AverageDetailsTime = float64(pm.totalDetailsTime) / float64(pm.DetailsRequests)
	
	if durationMs < pm.FastestDetails {
		pm.FastestDetails = durationMs
	}
	if durationMs > pm.SlowestDetails {
		pm.SlowestDetails = durationMs
	}
	
	if cached {
		pm.CacheHits++
	} else {
		pm.CacheMisses++
		pm.LastAPICall = time.Now()
		pm.DataTransferredKB += payloadSizeKB
	}
	
	pm.updateCacheHitRate()
	pm.updateAveragePayload()
}

// RecordAPIError registra um erro da API
func (pm *PerformanceMetrics) RecordAPIError() {
	pm.mutex.Lock()
	defer pm.mutex.Unlock()
	
	pm.APIErrors++
}

// RecordRateLimitHit registra quando rate limit é atingido
func (pm *PerformanceMetrics) RecordRateLimitHit() {
	pm.mutex.Lock()
	defer pm.mutex.Unlock()
	
	pm.RateLimitHits++
}

// UpdateCacheSize atualiza o tamanho do cache
func (pm *PerformanceMetrics) UpdateCacheSize(size int) {
	pm.mutex.Lock()
	defer pm.mutex.Unlock()
	
	pm.CacheSize = size
}

// updateCacheHitRate calcula a taxa de acerto do cache
func (pm *PerformanceMetrics) updateCacheHitRate() {
	totalRequests := pm.CacheHits + pm.CacheMisses
	if totalRequests > 0 {
		pm.CacheHitRate = (float64(pm.CacheHits) / float64(totalRequests)) * 100
	}
}

// updateAveragePayload calcula o tamanho médio do payload
func (pm *PerformanceMetrics) updateAveragePayload() {
	apiCalls := pm.CacheMisses // Cache misses = chamadas reais à API
	if apiCalls > 0 {
		pm.AveragePayloadKB = pm.DataTransferredKB / float64(apiCalls)
	}
}

// GetSnapshot retorna uma cópia thread-safe das métricas
func (pm *PerformanceMetrics) GetSnapshot() PerformanceMetrics {
	pm.mutex.RLock()
	defer pm.mutex.RUnlock()
	
	return *pm
}

// GetSummary retorna um resumo das métricas para logging
func (pm *PerformanceMetrics) GetSummary() map[string]interface{} {
	snapshot := pm.GetSnapshot()
	uptime := time.Since(snapshot.StartTime)
	
	return map[string]interface{}{
		"uptime_minutes":        uptime.Minutes(),
		"total_requests":        snapshot.SearchRequests + snapshot.DetailsRequests,
		"cache_hit_rate":        snapshot.CacheHitRate,
		"average_search_ms":     snapshot.AverageSearchTime,
		"average_details_ms":    snapshot.AverageDetailsTime,
		"api_errors":           snapshot.APIErrors,
		"rate_limit_hits":      snapshot.RateLimitHits,
		"data_transferred_mb":  snapshot.DataTransferredKB / 1024,
		"cache_size":           snapshot.CacheSize,
	}
}

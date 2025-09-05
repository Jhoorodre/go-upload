package anilist

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shurcooL/graphql"
	"go-upload/backend/internal/metadata"
)

// AniListService fornece acesso à API da AniList usando cliente simples
type AniListService struct {
	client         *graphql.Client
	rateLimiter    *RateLimiter
	logger         Logger
	cache          *AniListCache
	metrics        *PerformanceMetrics
	queryOptimizer *QueryOptimizer
	imageLoader    *ImageLoader
	retryHandler   *RetryHandler
	errorHandler   *ErrorHandler
	configManager  *ConfigManager
}

// Logger interface para logs estruturados
type Logger interface {
	Debug(msg string, fields ...interface{})
	Info(msg string, fields ...interface{})
	Warn(msg string, fields ...interface{})
	Error(msg string, fields ...interface{})
}

// DefaultLogger implementação simples do Logger
type DefaultLogger struct{}

func (l *DefaultLogger) Debug(msg string, fields ...interface{}) {
	log.Printf("[DEBUG] AniList: %s %v", msg, fields)
}

func (l *DefaultLogger) Info(msg string, fields ...interface{}) {
	log.Printf("[INFO] AniList: %s %v", msg, fields)
}

func (l *DefaultLogger) Warn(msg string, fields ...interface{}) {
	log.Printf("[WARN] AniList: %s %v", msg, fields)
}

func (l *DefaultLogger) Error(msg string, fields ...interface{}) {
	log.Printf("[ERROR] AniList: %s %v", msg, fields)
}

// RateLimiter implementa rate limiting para AniList API (90 req/min)
type RateLimiter struct {
	requests []time.Time
	mutex    sync.Mutex
	limit    int           // número máximo de requests
	window   time.Duration // janela de tempo
}

// NewRateLimiter cria um novo rate limiter
func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	return &RateLimiter{
		requests: make([]time.Time, 0),
		limit:    limit,
		window:   window,
	}
}

// Allow verifica se uma request pode ser feita agora
func (rl *RateLimiter) Allow() bool {
	rl.mutex.Lock()
	defer rl.mutex.Unlock()

	now := time.Now()
	
	// Remove requests antigas (fora da janela)
	cutoff := now.Add(-rl.window)
	validRequests := make([]time.Time, 0)
	for _, reqTime := range rl.requests {
		if reqTime.After(cutoff) {
			validRequests = append(validRequests, reqTime)
		}
	}
	rl.requests = validRequests

	// Verifica se pode fazer nova request
	if len(rl.requests) >= rl.limit {
		return false
	}

	// Adiciona nova request
	rl.requests = append(rl.requests, now)
	return true
}

// Wait aguarda até que uma request possa ser feita
func (rl *RateLimiter) Wait(ctx context.Context) error {
	for {
		if rl.Allow() {
			return nil
		}
		
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(1 * time.Second):
			// Continua tentando
		}
	}
}

// ============================================
// SISTEMA DE CACHE
// ============================================

// CacheEntry representa uma entrada no cache com TTL
type CacheEntry struct {
	Data      interface{} `json:"data"`
	ExpiresAt time.Time   `json:"expires_at"`
	CreatedAt time.Time   `json:"created_at"`
	Key       string      `json:"key"`
}

// IsExpired verifica se a entrada do cache expirou
func (ce *CacheEntry) IsExpired() bool {
	return time.Now().After(ce.ExpiresAt)
}

// AniListCache gerencia cache em memória e persistente para AniList
type AniListCache struct {
	searchCache   map[string]*CacheEntry
	detailsCache  map[string]*CacheEntry
	mutex         sync.RWMutex
	ttl           time.Duration
	persistPath   string
	logger        Logger
	cleanupTicker *time.Ticker
	stopCleanup   chan bool
}

// NewAniListCache cria um novo cache para AniList
func NewAniListCache(ttl time.Duration, persistPath string, logger Logger) *AniListCache {
	cache := &AniListCache{
		searchCache:  make(map[string]*CacheEntry),
		detailsCache: make(map[string]*CacheEntry),
		ttl:          ttl,
		persistPath:  persistPath,
		logger:       logger,
		stopCleanup:  make(chan bool),
	}
	
	// Tentar carregar cache persistente
	if persistPath != "" {
		cache.loadFromDisk()
	}
	
	// Iniciar limpeza automática a cada 30 minutos
	cache.cleanupTicker = time.NewTicker(30 * time.Minute)
	go cache.cleanupRoutine()
	
	logger.Info("AniList cache initialized", 
		"ttl", ttl.String(), 
		"persist_path", persistPath)
	
	return cache
}

// generateCacheKey gera uma chave única para o cache baseada nos parâmetros
func (c *AniListCache) generateCacheKey(prefix string, params ...interface{}) string {
	key := prefix
	for _, param := range params {
		key += fmt.Sprintf(":%v", param)
	}
	
	// Usar hash MD5 para chaves longas
	if len(key) > 100 {
		hash := md5.Sum([]byte(key))
		return prefix + ":" + hex.EncodeToString(hash[:])
	}
	
	return key
}

// GetSearchResult busca resultado de pesquisa no cache
func (c *AniListCache) GetSearchResult(query string, page, perPage int) (*SearchResult, bool) {
	c.mutex.RLock()
	defer c.mutex.RUnlock()
	
	key := c.generateCacheKey("search", query, page, perPage)
	entry, exists := c.searchCache[key]
	
	if !exists || entry.IsExpired() {
		return nil, false
	}
	
	if result, ok := entry.Data.(*SearchResult); ok {
		c.logger.Debug("Cache hit for search", "key", key, "age", time.Since(entry.CreatedAt).String())
		return result, true
	}
	
	return nil, false
}

// SetSearchResult armazena resultado de pesquisa no cache
func (c *AniListCache) SetSearchResult(query string, page, perPage int, result *SearchResult) {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	
	key := c.generateCacheKey("search", query, page, perPage)
	entry := &CacheEntry{
		Data:      result,
		ExpiresAt: time.Now().Add(c.ttl),
		CreatedAt: time.Now(),
		Key:       key,
	}
	
	c.searchCache[key] = entry
	c.logger.Debug("Cache set for search", "key", key, "ttl", c.ttl.String())
	
	// Salvar no disco se configurado
	if c.persistPath != "" {
		go c.saveToDisk()
	}
}

// GetMangaDetails busca detalhes de mangá no cache
func (c *AniListCache) GetMangaDetails(id int) (*MangaDetailsQuery, bool) {
	c.mutex.RLock()
	defer c.mutex.RUnlock()
	
	key := c.generateCacheKey("details", id)
	entry, exists := c.detailsCache[key]
	
	if !exists || entry.IsExpired() {
		return nil, false
	}
	
	if details, ok := entry.Data.(*MangaDetailsQuery); ok {
		c.logger.Debug("Cache hit for details", "key", key, "id", id, "age", time.Since(entry.CreatedAt).String())
		return details, true
	}
	
	return nil, false
}

// SetMangaDetails armazena detalhes de mangá no cache
func (c *AniListCache) SetMangaDetails(id int, details *MangaDetailsQuery) {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	
	key := c.generateCacheKey("details", id)
	entry := &CacheEntry{
		Data:      details,
		ExpiresAt: time.Now().Add(c.ttl),
		CreatedAt: time.Now(),
		Key:       key,
	}
	
	c.detailsCache[key] = entry
	c.logger.Debug("Cache set for details", "key", key, "id", id, "ttl", c.ttl.String())
	
	// Salvar no disco se configurado
	if c.persistPath != "" {
		go c.saveToDisk()
	}
}

// cleanupRoutine remove entradas expiradas automaticamente
func (c *AniListCache) cleanupRoutine() {
	for {
		select {
		case <-c.cleanupTicker.C:
			c.cleanup()
		case <-c.stopCleanup:
			c.cleanupTicker.Stop()
			return
		}
	}
}

// cleanup remove entradas expiradas do cache
func (c *AniListCache) cleanup() {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	
	now := time.Now()
	removedSearch := 0
	removedDetails := 0
	
	// Limpar cache de busca
	for key, entry := range c.searchCache {
		if now.After(entry.ExpiresAt) {
			delete(c.searchCache, key)
			removedSearch++
		}
	}
	
	// Limpar cache de detalhes
	for key, entry := range c.detailsCache {
		if now.After(entry.ExpiresAt) {
			delete(c.detailsCache, key)
			removedDetails++
		}
	}
	
	if removedSearch > 0 || removedDetails > 0 {
		c.logger.Info("Cache cleanup completed", 
			"removed_search", removedSearch,
			"removed_details", removedDetails,
			"remaining_search", len(c.searchCache),
			"remaining_details", len(c.detailsCache))
	}
}

// GetStats retorna estatísticas do cache
func (c *AniListCache) GetStats() map[string]interface{} {
	c.mutex.RLock()
	defer c.mutex.RUnlock()
	
	return map[string]interface{}{
		"search_entries":  len(c.searchCache),
		"details_entries": len(c.detailsCache),
		"ttl":            c.ttl.String(),
		"persist_path":   c.persistPath,
	}
}

// Clear limpa todo o cache
func (c *AniListCache) Clear() {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	
	searchCount := len(c.searchCache)
	detailsCount := len(c.detailsCache)
	
	c.searchCache = make(map[string]*CacheEntry)
	c.detailsCache = make(map[string]*CacheEntry)
	
	c.logger.Info("Cache cleared", 
		"cleared_search", searchCount,
		"cleared_details", detailsCount)
	
	// Remover arquivo persistente
	if c.persistPath != "" {
		os.Remove(c.persistPath)
	}
}

// loadFromDisk carrega cache do arquivo persistente
func (c *AniListCache) loadFromDisk() {
	if c.persistPath == "" {
		return
	}
	
	data, err := os.ReadFile(c.persistPath)
	if err != nil {
		c.logger.Debug("No persistent cache found", "path", c.persistPath)
		return
	}
	
	var persistentCache struct {
		SearchCache  map[string]*CacheEntry `json:"search_cache"`
		DetailsCache map[string]*CacheEntry `json:"details_cache"`
		SavedAt      time.Time              `json:"saved_at"`
	}
	
	if err := json.Unmarshal(data, &persistentCache); err != nil {
		c.logger.Error("Failed to load persistent cache", "error", err)
		return
	}
	
	c.mutex.Lock()
	defer c.mutex.Unlock()
	
	now := time.Now()
	loadedSearch := 0
	loadedDetails := 0
	
	// Carregar cache de busca (apenas não expirados)
	for key, entry := range persistentCache.SearchCache {
		if now.Before(entry.ExpiresAt) {
			c.searchCache[key] = entry
			loadedSearch++
		}
	}
	
	// Carregar cache de detalhes (apenas não expirados)
	for key, entry := range persistentCache.DetailsCache {
		if now.Before(entry.ExpiresAt) {
			c.detailsCache[key] = entry
			loadedDetails++
		}
	}
	
	c.logger.Info("Persistent cache loaded", 
		"loaded_search", loadedSearch,
		"loaded_details", loadedDetails,
		"saved_at", persistentCache.SavedAt.Format(time.RFC3339))
}

// saveToDisk salva cache no arquivo persistente
func (c *AniListCache) saveToDisk() {
	if c.persistPath == "" {
		return
	}
	
	c.mutex.RLock()
	persistentCache := struct {
		SearchCache  map[string]*CacheEntry `json:"search_cache"`
		DetailsCache map[string]*CacheEntry `json:"details_cache"`
		SavedAt      time.Time              `json:"saved_at"`
	}{
		SearchCache:  c.searchCache,
		DetailsCache: c.detailsCache,
		SavedAt:      time.Now(),
	}
	c.mutex.RUnlock()
	
	data, err := json.MarshalIndent(persistentCache, "", "  ")
	if err != nil {
		c.logger.Error("Failed to marshal cache data", "error", err)
		return
	}
	
	// Criar diretório se não existir
	if dir := filepath.Dir(c.persistPath); dir != "." {
		os.MkdirAll(dir, 0755)
	}
	
	if err := os.WriteFile(c.persistPath, data, 0644); err != nil {
		c.logger.Error("Failed to save persistent cache", "error", err)
		return
	}
	
	c.logger.Debug("Persistent cache saved", "path", c.persistPath)
}

// Close fecha o cache e salva no disco
func (c *AniListCache) Close() {
	close(c.stopCleanup)
	if c.persistPath != "" {
		c.saveToDisk()
	}
	c.logger.Info("AniList cache closed")
}

// SearchResult encapsula resultados de busca com informações de paginação
type SearchResult struct {
	Results     []MangaBasic `json:"results"`
	Total       int          `json:"total"`
	CurrentPage int          `json:"current_page"`
	LastPage    int          `json:"last_page"`
	HasNextPage bool         `json:"has_next_page"`
	Query       string       `json:"query"`
	TimeMS      int64        `json:"time_ms"`
}

// NewAniListService cria uma nova instância do serviço AniList
func NewAniListService() *AniListService {
	return NewAniListServiceWithLogger(&DefaultLogger{})
}

// NewAniListServiceWithLogger cria uma nova instância do serviço AniList com logger customizado
func NewAniListServiceWithLogger(logger Logger) *AniListService {
	return NewAniListServiceWithCache(logger, time.Hour, "")
}

// NewAniListServiceWithCache cria uma nova instância com cache customizado
func NewAniListServiceWithCache(logger Logger, cacheTTL time.Duration, cachePersistPath string) *AniListService {
	return NewAniListServiceOptimized(logger, cacheTTL, cachePersistPath, true, "")
}

// NewAniListServiceOptimized cria uma nova instância com todas as otimizações da Fase 4.1
func NewAniListServiceOptimized(logger Logger, cacheTTL time.Duration, cachePersistPath string, useOptimizedQueries bool, imageCacheDir string) *AniListService {
	// Configurar cliente HTTP com timeout apropriado e connection pooling
	httpClient := &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 10,
			IdleConnTimeout:     90 * time.Second,
			DisableCompression:  false, // Permitir compressão para economizar banda
		},
	}
	
	// Criar cliente GraphQL simples
	client := graphql.NewClient("https://graphql.anilist.co", httpClient)
	
	// Rate limiter: 90 requests por minuto (AniList API limit)
	rateLimiter := NewRateLimiter(90, time.Minute)
	
	// Cache com TTL configurável
	cache := NewAniListCache(cacheTTL, cachePersistPath, logger)
	
	// Inicializar métricas de performance
	metrics := NewPerformanceMetrics()
	
	// Otimizador de queries
	queryOptimizer := NewQueryOptimizer(useOptimizedQueries, logger)
	
	// Image loader (se diretório especificado)
	var imageLoader *ImageLoader
	if imageCacheDir != "" {
		imageLoader = NewImageLoader(imageCacheDir, 3, logger, metrics) // 3 workers para images
	}
	
	// Configurar retry handler com backoff exponencial
	retryConfig := RetryConfig{
		MaxRetries:    3,
		BaseDelay:     time.Second,
		MaxDelay:      30 * time.Second,
		BackoffFactor: 2.0,
		JitterEnabled: true,
	}
	retryHandler := NewRetryHandler(retryConfig, logger)
	
	// Error handler para mensagens amigáveis
	errorHandler := NewErrorHandler(logger)
	
	// Config manager (assumindo dataDir na raiz do cache)
	dataDir := filepath.Dir(cachePersistPath)
	if dataDir == "." || dataDir == "" {
		dataDir = "data" // diretório padrão se não especificado
	}
	configManager := NewConfigManager(dataDir)
	
	logger.Info("AniList service initialized with optimizations", 
		"rate_limit", "90 req/min",
		"cache_ttl", cacheTTL.String(),
		"cache_persist", cachePersistPath != "",
		"optimized_queries", useOptimizedQueries,
		"image_cache", imageCacheDir != "",
		"connection_pooling", true,
		"retry_enabled", true,
		"error_handling", true,
		"config_enabled", true)
	
	service := &AniListService{
		client:         client,
		rateLimiter:    rateLimiter,
		logger:         logger,
		cache:          cache,
		metrics:        metrics,
		queryOptimizer: queryOptimizer,
		imageLoader:    imageLoader,
		retryHandler:   retryHandler,
		errorHandler:   errorHandler,
		configManager:  configManager,
	}
	
	// Atualizar tamanho do cache nas métricas
	service.updateCacheMetrics()
	
	return service
}

type MangaSlim struct {
	ID         int      `graphql:"id"`
	Title      Title    `graphql:"title"`
	Status     string   `graphql:"status"`
	MeanScore  *int     `graphql:"meanScore"`
	CoverImage struct {
		Medium *string `graphql:"medium"`
	} `graphql:"coverImage"`
	Staff struct {
		Edges []struct {
			Role string `graphql:"role"`
			Node struct {
				Name struct {
					Full string `graphql:"full"`
				} `graphql:"name"`
			} `graphql:"node"`
		} `graphql:"edges"`
	} `graphql:"staff(perPage: 2, sort: RELEVANCE)"` // Apenas os 2 mais relevantes (autor/artista)
}

// Estruturas para resposta da AniList
type SearchMangaQuery struct {
	Page struct {
		PageInfo struct {
			Total       int  `graphql:"total"`
			CurrentPage int  `graphql:"currentPage"`
			LastPage    int  `graphql:"lastPage"`
			HasNextPage bool `graphql:"hasNextPage"`
		} `graphql:"pageInfo"`
		Media []MangaSlim `graphql:"media(search: $search, type: MANGA)"` // Otimizado para MangaSlim
	} `graphql:"Page(page: $page, perPage: $perPage)"`
}

type MangaDetailsQuery struct {
	Media MangaDetailed `graphql:"Media(id: $id, type: MANGA)"`
}

type MangaBasic struct {
	ID          int      `graphql:"id"`
	Title       Title    `graphql:"title"`
	Description *string  `graphql:"description(asHtml: false)"`
	Status      string   `graphql:"status"`
	Chapters    *int     `graphql:"chapters"`
	Volumes     *int     `graphql:"volumes"`
	Genres      []string `graphql:"genres"`
	Synonyms    []string `graphql:"synonyms"`
	MeanScore   *int     `graphql:"meanScore"`
	Popularity  int      `graphql:"popularity"`
	CoverImage  Image    `graphql:"coverImage"`
	Staff       Staff    `graphql:"staff(perPage: 5)"`
}

type MangaDetailed struct {
	ID          int           `graphql:"id"`
	Title       Title         `graphql:"title"`
	Description *string       `graphql:"description(asHtml: false)"`
	Status      string        `graphql:"status"`
	Format      *string       `graphql:"format"`
	StartDate   *Date         `graphql:"startDate"`
	EndDate     *Date         `graphql:"endDate"`
	Chapters    *int          `graphql:"chapters"`
	Volumes     *int          `graphql:"volumes"`
	Genres      []string      `graphql:"genres"`
	Synonyms    []string      `graphql:"synonyms"`
	MeanScore   *int          `graphql:"meanScore"`
	Popularity  int           `graphql:"popularity"`
	CoverImage  Image         `graphql:"coverImage"`
	BannerImage *string       `graphql:"bannerImage"`
	Staff       Staff         `graphql:"staff"`
	ExternalLinks []ExternalLink `graphql:"externalLinks"`
	Tags        []Tag         `graphql:"tags"`
}

type Title struct {
	Romaji  *string `graphql:"romaji"`
	English *string `graphql:"english"`
	Native  *string `graphql:"native"`
}

type Image struct {
	ExtraLarge *string `graphql:"extraLarge"`
	Large      *string `graphql:"large"`
	Medium     *string `graphql:"medium"`
	Color      *string `graphql:"color"`
}

type Date struct {
	Year  *int `graphql:"year"`
	Month *int `graphql:"month"`
	Day   *int `graphql:"day"`
}

type Staff struct {
	Edges []StaffEdge `graphql:"edges"`
}

type StaffEdge struct {
	Role string    `graphql:"role"`
	Node StaffNode `graphql:"node"`
}

type StaffNode struct {
	Name struct {
		Full string `graphql:"full"`
	} `graphql:"name"`
	PrimaryOccupations []string `graphql:"primaryOccupations"`
}

type ExternalLink struct {
	URL  *string `graphql:"url"`
	Site *string `graphql:"site"`
	Type *string `graphql:"type"`
}

type Tag struct {
	Name           string `graphql:"name"`
	Description    *string `graphql:"description"`
	Rank           *int    `graphql:"rank"`
	IsMediaSpoiler bool    `graphql:"isMediaSpoiler"`
}

// SearchManga busca mangás por título com rate limiting e logs detalhados
func (s *AniListService) SearchManga(ctx context.Context, search string, page, perPage int) (*SearchResult, error) {
	// Verificar se a integração está habilitada
	if !s.IsIntegrationEnabled() {
		return nil, fmt.Errorf("integração AniList está desabilitada")
	}

	startTime := time.Now()
	
	s.logger.Debug("Starting manga search", 
		"query", search, 
		"page", page, 
		"per_page", perPage)
	
	// Validar parâmetros
	if strings.TrimSpace(search) == "" {
		s.logger.Error("Empty search query provided")
		return nil, fmt.Errorf("search query cannot be empty")
	}
	
	if page < 1 {
		page = 1
	}
	
	if perPage < 1 || perPage > 50 {
		perPage = 10 // Default da AniList
	}
	
	// Verificar cache primeiro (se habilitado na configuração)
	if s.ShouldUseCache() {
		if cachedResult, found := s.cache.GetSearchResult(search, page, perPage); found {
			duration := time.Since(startTime)
			
			// Registrar métricas de cache hit
			if s.metrics != nil {
				s.metrics.RecordSearchRequest(duration, true, 0)
			}
			
			s.logger.Info("Search result from cache",
			"query", search,
			"results_count", len(cachedResult.Results),
			"total", cachedResult.Total,
			"page", cachedResult.CurrentPage,
			"duration_ms", duration.Milliseconds(),
			"source", "cache")
		
			// Iniciar lazy loading das imagens em background
			s.preloadImagesAsync(cachedResult.Results)
			
			// Atualizar timing para refletir tempo de cache
			cachedResult.TimeMS = duration.Milliseconds()
			return cachedResult, nil
		}
	}
	
	// Cache miss - fazer request à API
	s.logger.Debug("Cache miss, making API request")
	
	// Aguardar rate limiting
	s.logger.Debug("Checking rate limit")
	if err := s.rateLimiter.Wait(ctx); err != nil {
		s.logger.Error("Rate limiter cancelled", "error", err)
		if s.metrics != nil {
			s.metrics.RecordRateLimitHit()
		}
		return nil, fmt.Errorf("rate limit wait cancelled: %w", err)
	}
	
	s.logger.Debug("Rate limit passed, making API request")
	
	// Determinar se usar query otimizada
	useOptimized := s.queryOptimizer != nil && s.queryOptimizer.ShouldUseOptimizedSearch(perPage)
	
	var result *SearchResult
	var payloadSize float64
	var err error
	
	if useOptimized {
		// Usar query otimizada
		result, payloadSize, err = s.searchMangaOptimized(ctx, search, page, perPage)
	} else {
		// Usar query padrão
		result, payloadSize, err = s.searchMangaStandard(ctx, search, page, perPage)
	}
	
	if err != nil {
		if s.metrics != nil {
			s.metrics.RecordAPIError()
		}
		return nil, err
	}
	
	duration := time.Since(startTime)
	result.TimeMS = duration.Milliseconds()
	
	// Registrar métricas
	if s.metrics != nil {
		s.metrics.RecordSearchRequest(duration, false, payloadSize)
	}
	
	// Armazenar no cache
	s.cache.SetSearchResult(search, page, perPage, result)
	
	// Iniciar lazy loading das imagens em background
	s.preloadImagesAsync(result.Results)
	
	s.logger.Info("Search completed successfully",
		"query", search,
		"results_count", len(result.Results),
		"total", result.Total,
		"page", result.CurrentPage,
		"duration_ms", result.TimeMS,
		"source", "api",
		"optimized", useOptimized,
		"payload_kb", payloadSize)
	
	return result, nil
}

// SearchMangaSimple busca mangás com parâmetros padrão (primeira página, 10 resultados)
func (s *AniListService) SearchMangaSimple(ctx context.Context, search string) (*SearchResult, error) {
	return s.SearchMangaWithRetry(ctx, search, 1, 10)
}

// SearchMangaWithRetry busca mangás com retry automático e tratamento de erros robusto
func (s *AniListService) SearchMangaWithRetry(ctx context.Context, search string, page, perPage int) (*SearchResult, error) {
	// Verificar se a integração está habilitada
	if !s.IsIntegrationEnabled() {
		return nil, fmt.Errorf("integração AniList está desabilitada")
	}

	// Contexto com informações para error handling
	errorContext := map[string]interface{}{
		"operation": "search_manga",
		"query":     search,
		"page":      page,
		"per_page":  perPage,
	}

	var result *SearchResult
	var searchErr error

	// Executar busca com retry automático
	retryErr := s.retryHandler.ExecuteWithRetry(ctx, func() error {
		var err error
		result, err = s.SearchManga(ctx, search, page, perPage)
		searchErr = err
		return err
	}, "search_manga")

	// Se houve erro, traduzir para mensagem amigável
	if retryErr != nil {
		// Verificar se é erro de circuit breaker
		if strings.Contains(retryErr.Error(), "circuit breaker is open") {
			// Retornar uma resposta vazia em vez de erro para permitir fallback
			s.logger.Info("Circuit breaker open, returning empty results for fallback", 
				"query", search)
			return &SearchResult{
				Results:     []MangaBasic{},
				Total:       0,
				CurrentPage: page,
				LastPage:    page,
				HasNextPage: false,
				Query:       search,
				TimeMS:      0,
			}, nil
		}

		// Traduzir erro para mensagem amigável
		friendlyErr := s.errorHandler.TranslateError(searchErr, errorContext)
		
		// Log com contexto completo
		s.logger.Error("Search failed after retries", 
			"query", search,
			"original_error", searchErr.Error(),
			"user_message", friendlyErr.UserMessage,
			"error_code", friendlyErr.ErrorCode)
		
		// Retornar erro amigável
		return nil, friendlyErr
	}

	return result, nil
}

// GetMangaDetailsWithRetry obtém detalhes completos com retry automático e tratamento de erros
func (s *AniListService) GetMangaDetailsWithRetry(ctx context.Context, id int) (*MangaDetailsQuery, error) {
	// Verificar se a integração está habilitada
	if !s.IsIntegrationEnabled() {
		return nil, fmt.Errorf("integração AniList está desabilitada")
	}

	// Contexto com informações para error handling
	errorContext := map[string]interface{}{
		"operation":  "get_manga_details",
		"manga_id":   id,
	}

	var result *MangaDetailsQuery
	var detailsErr error

	// Executar busca com retry automático
	retryErr := s.retryHandler.ExecuteWithRetry(ctx, func() error {
		var err error
		result, err = s.GetMangaDetails(ctx, id)
		detailsErr = err
		return err
	}, "get_manga_details")

	// Se houve erro, traduzir para mensagem amigável
	if retryErr != nil {
		// Verificar se é erro de circuit breaker
		if strings.Contains(retryErr.Error(), "circuit breaker is open") {
			// Para detalhes, não podemos fazer fallback, então retornar erro informativo
			s.logger.Info("Circuit breaker open, manga details unavailable", 
				"manga_id", id)
			
			friendlyErr := s.errorHandler.CreateUserFriendlyMessage(
				"SERVICE_UNAVAILABLE",
				"A integração com AniList está temporariamente indisponível. Tente novamente em alguns minutos.",
				SeverityWarning,
				[]string{
					"A funcionalidade será restaurada automaticamente",
					"Tente novamente em 10-15 minutos",
					"Use a entrada manual para este manga",
				},
			)
			return nil, friendlyErr
		}

		// Traduzir erro para mensagem amigável
		friendlyErr := s.errorHandler.TranslateError(detailsErr, errorContext)
		
		// Log com contexto completo
		s.logger.Error("Get manga details failed after retries", 
			"manga_id", id,
			"original_error", detailsErr.Error(),
			"user_message", friendlyErr.UserMessage,
			"error_code", friendlyErr.ErrorCode)
		
		// Retornar erro amigável
		return nil, friendlyErr
	}

	return result, nil
}

// GetMangaDetails obtém detalhes completos de um mangá por ID com rate limiting e logs
func (s *AniListService) GetMangaDetails(ctx context.Context, id int) (*MangaDetailsQuery, error) {
	startTime := time.Now()
	
	s.logger.Debug("Getting manga details", "id", id)
	
	// Validar ID
	if id <= 0 {
		s.logger.Error("Invalid manga ID provided", "id", id)
		return nil, fmt.Errorf("manga ID must be positive, got %d", id)
	}
	
	// Verificar cache primeiro (se habilitado na configuração)
	if s.ShouldUseCache() {
		if cachedDetails, found := s.cache.GetMangaDetails(id); found {
				duration := time.Since(startTime)
				s.logger.Info("Manga details from cache",
					"id", id,
					"title", mapTitle(cachedDetails.Media.Title),
					"duration_ms", duration.Milliseconds(),
					"source", "cache")
				return cachedDetails, nil
			}
		}
	
	// Cache miss - fazer request à API
	s.logger.Debug("Cache miss for details, making API request")
	
	// Aguardar rate limiting
	s.logger.Debug("Checking rate limit for details request")
	if err := s.rateLimiter.Wait(ctx); err != nil {
		s.logger.Error("Rate limiter cancelled for details", "error", err, "id", id)
		return nil, fmt.Errorf("rate limit wait cancelled: %w", err)
	}
	
	s.logger.Debug("Rate limit passed, requesting manga details")
	
	var query MangaDetailsQuery
	variables := map[string]interface{}{
		"id": graphql.Int(id),
	}
	
	err := s.client.Query(ctx, &query, variables)
	if err != nil {
		s.logger.Error("GraphQL details query failed", 
			"error", err,
			"id", id)
		return nil, fmt.Errorf("AniList API error for ID %d: %w", id, err)
	}
	
	duration := time.Since(startTime)
	
	// Armazenar no cache
	s.cache.SetMangaDetails(id, &query)
	
	s.logger.Info("Manga details retrieved successfully",
		"id", id,
		"title", mapTitle(query.Media.Title),
		"duration_ms", duration.Milliseconds(),
		"source", "api")
	
	return &query, nil
}

// Health verifica se o serviço está funcionando
func (s *AniListService) Health(ctx context.Context) error {
	s.logger.Debug("Performing health check")
	
	// Fazer uma busca simples para testar conectividade
	result, err := s.SearchManga(ctx, "test", 1, 1)
	if err != nil {
		s.logger.Error("Health check failed", "error", err)
		return fmt.Errorf("health check failed: %w", err)
	}
	
	s.logger.Info("Health check passed", "response_time_ms", result.TimeMS)
	return nil
}

// GetRateLimitStatus retorna informações sobre o rate limiting atual
func (s *AniListService) GetRateLimitStatus() map[string]interface{} {
	s.rateLimiter.mutex.Lock()
	defer s.rateLimiter.mutex.Unlock()
	
	now := time.Now()
	cutoff := now.Add(-s.rateLimiter.window)
	
	// Contar requests válidas
	validRequests := 0
	for _, reqTime := range s.rateLimiter.requests {
		if reqTime.After(cutoff) {
			validRequests++
		}
	}
	
	remaining := s.rateLimiter.limit - validRequests
	if remaining < 0 {
		remaining = 0
	}
	
	return map[string]interface{}{
		"limit":     s.rateLimiter.limit,
		"used":      validRequests,
		"remaining": remaining,
		"window":    s.rateLimiter.window.String(),
	}
}

// ============================================
// GERENCIAMENTO DE CACHE
// ============================================

// GetCacheStats retorna estatísticas do cache
func (s *AniListService) GetCacheStats() map[string]interface{} {
	return s.cache.GetStats()
}

// ClearCache limpa todo o cache
func (s *AniListService) ClearCache() {
	s.cache.Clear()
}

// GetCacheStatus retorna status combinado de cache e rate limiting
func (s *AniListService) GetCacheStatus() map[string]interface{} {
	return map[string]interface{}{
		"rate_limiting": s.GetRateLimitStatus(),
		"cache":         s.GetCacheStats(),
	}
}

// Close fecha o serviço e salva cache
func (s *AniListService) Close() {
	if s.cache != nil {
		s.cache.Close()
	}
	s.logger.Info("AniList service closed")
}

// ============================================
// MAPEAMENTO ANILIST → SISTEMA ATUAL
// ============================================

// MapAniListToMangaMetadata converte dados da AniList para o sistema atual
func MapAniListToMangaMetadata(manga MangaDetailed) metadata.MangaMetadata {
	return metadata.MangaMetadata{
		ID:          strconv.Itoa(manga.ID),
		Title:       mapTitle(manga.Title),
		Description: mapDescription(manga.Description),
		Artist:      extractStaffRole(manga.Staff, "Art"),
		Author:      extractStaffRole(manga.Staff, "Story"),
		Cover:       mapCoverImage(manga.CoverImage),
		Status:      mapStatus(manga.Status),
	}
}

// MapAniListBasicToMangaMetadata converte dados básicos da AniList para o sistema atual
func MapAniListBasicToMangaMetadata(manga MangaBasic) metadata.MangaMetadata {
	return metadata.MangaMetadata{
		ID:          strconv.Itoa(manga.ID),
		Title:       mapTitle(manga.Title),
		Description: mapDescription(manga.Description),
		Artist:      extractStaffRole(manga.Staff, "Art"),
		Author:      extractStaffRole(manga.Staff, "Story"),
		Cover:       mapCoverImage(manga.CoverImage),
		Status:      mapStatus(manga.Status),
	}
}

// mapTitle trata títulos múltiplos da AniList (prioriza English > Romaji > Native)
func mapTitle(title Title) string {
	if title.English != nil && strings.TrimSpace(*title.English) != "" {
		return strings.TrimSpace(*title.English)
	}
	if title.Romaji != nil && strings.TrimSpace(*title.Romaji) != "" {
		return strings.TrimSpace(*title.Romaji)
	}
	if title.Native != nil && strings.TrimSpace(*title.Native) != "" {
		return strings.TrimSpace(*title.Native)
	}
	return "Título Desconhecido"
}

// mapDescription trata descrição da AniList
func mapDescription(description *string) string {
	if description != nil && strings.TrimSpace(*description) != "" {
		// Limitar descrição a 500 caracteres para evitar JSONs muito grandes
		desc := strings.TrimSpace(*description)
		if len(desc) > 500 {
			desc = desc[:500] + "..."
		}
		return desc
	}
	return ""
}

// mapStatus converte status da AniList para português
func mapStatus(status string) string {
	statusMap := map[string]string{
		"FINISHED":          "Completo",
		"RELEASING":         "Em Lançamento",
		"NOT_YET_RELEASED":  "Não Lançado",
		"CANCELLED":         "Cancelado",
		"HIATUS":           "Em Hiato",
	}
	
	if mappedStatus, exists := statusMap[status]; exists {
		return mappedStatus
	}
	
	// Fallback: retornar status original se não encontrar mapeamento
	return status
}

// extractStaffRole extrai autor ou artista baseado no role
func extractStaffRole(staff Staff, role string) string {
	var candidates []string
	
	for _, edge := range staff.Edges {
		// Verificar se o role corresponde (case-insensitive e variações)
		if matchesRole(edge.Role, role) {
			if edge.Node.Name.Full != "" {
				candidates = append(candidates, edge.Node.Name.Full)
			}
		}
	}
	
	// Se encontrou candidatos, retornar o primeiro
	if len(candidates) > 0 {
		return candidates[0]
	}
	
	// Fallback: se não encontrou role específico, procurar variações
	fallbackRoles := getFallbackRoles(role)
	for _, fallbackRole := range fallbackRoles {
		for _, edge := range staff.Edges {
			if matchesRole(edge.Role, fallbackRole) {
				if edge.Node.Name.Full != "" {
					return edge.Node.Name.Full
				}
			}
		}
	}
	
	return ""
}

// matchesRole verifica se um role corresponde ao procurado (case-insensitive)
func matchesRole(staffRole, targetRole string) bool {
	staffRoleLower := strings.ToLower(strings.TrimSpace(staffRole))
	targetRoleLower := strings.ToLower(strings.TrimSpace(targetRole))
	
	// Correspondência exata
	if staffRoleLower == targetRoleLower {
		return true
	}
	
	// Correspondências parciais comuns
	switch targetRoleLower {
	case "story":
		return strings.Contains(staffRoleLower, "story") || 
			   strings.Contains(staffRoleLower, "original creator") ||
			   strings.Contains(staffRoleLower, "author") ||
			   strings.Contains(staffRoleLower, "writer")
	case "art":
		return strings.Contains(staffRoleLower, "art") ||
			   strings.Contains(staffRoleLower, "artist") ||
			   strings.Contains(staffRoleLower, "illustrator")
	}
	
	return false
}

// getFallbackRoles retorna roles alternativos para busca
func getFallbackRoles(role string) []string {
	switch strings.ToLower(role) {
	case "story":
		return []string{"Original Creator", "Author", "Writer", "Creator"}
	case "art":
		return []string{"Artist", "Illustrator", "Character Design"}
	default:
		return []string{}
	}
}

// mapCoverImage extrai URL da capa (prioriza Large > Medium > ExtraLarge)
func mapCoverImage(coverImage Image) string {
	if coverImage.Large != nil && strings.TrimSpace(*coverImage.Large) != "" {
		return strings.TrimSpace(*coverImage.Large)
	}
	if coverImage.Medium != nil && strings.TrimSpace(*coverImage.Medium) != "" {
		return strings.TrimSpace(*coverImage.Medium)
	}
	if coverImage.ExtraLarge != nil && strings.TrimSpace(*coverImage.ExtraLarge) != "" {
		return strings.TrimSpace(*coverImage.ExtraLarge)
	}
	return ""
}

// MergeWithExistingMetadata preserva metadados existentes quando AniList não tem informação
func MergeWithExistingMetadata(existing metadata.MangaMetadata, anilist metadata.MangaMetadata) metadata.MangaMetadata {
	result := existing // Começar com dados existentes
	
	// Atualizar apenas campos não-vazios da AniList
	if anilist.Title != "" && anilist.Title != "Título Desconhecido" {
		result.Title = anilist.Title
	}
	if anilist.Description != "" {
		result.Description = anilist.Description
	}
	if anilist.Artist != "" {
		result.Artist = anilist.Artist
	}
	if anilist.Author != "" {
		result.Author = anilist.Author
	}
	if anilist.Cover != "" {
		result.Cover = anilist.Cover
	}
	if anilist.Status != "" {
		result.Status = anilist.Status
	}
	
	// Atualizar ID apenas se não existir
	if result.ID == "" {
		result.ID = anilist.ID
	}
	
	return result
}

// ============================================
// MÉTODOS OTIMIZADOS - FASE 4.1
// ============================================

// searchMangaStandard executa busca com query padrão
func (s *AniListService) searchMangaStandard(ctx context.Context, search string, page, perPage int) (*SearchResult, float64, error) {
	s.logger.Debug("Starting searchMangaStandard", "search", search, "page", page, "perPage", perPage)
	
	var query SearchMangaQuery
	variables := map[string]interface{}{
		"search":  graphql.String(search),
		"page":    graphql.Int(page),
		"perPage": graphql.Int(perPage),
	}
	
	s.logger.Debug("GraphQL variables prepared", "variables", variables)
	s.logger.Debug("Making GraphQL query to AniList API...")
	
	// Teste simples primeiro
	s.logger.Debug("Testing simple query to verify API connectivity...")
	
	err := s.client.Query(ctx, &query, variables)
	if err != nil {
		s.logger.Error("GraphQL query failed", 
			"error", err,
			"error_type", fmt.Sprintf("%T", err),
			"query", search,
			"page", page)
		
		// Log mais detalhado do erro
		s.logger.Error("Error details", "error_string", err.Error())
		
		// Verificar tipo específico de erro
		if ctx.Err() == context.DeadlineExceeded {
			s.logger.Error("Context deadline exceeded - timeout occurred")
			return nil, 0, fmt.Errorf("timeout na busca AniList: %w", err)
		}
		if ctx.Err() == context.Canceled {
			s.logger.Error("Context was cancelled")
			return nil, 0, fmt.Errorf("busca AniList cancelada: %w", err)
		}
		
		// Verificar se é erro de conectividade
		if strings.Contains(err.Error(), "connection") || strings.Contains(err.Error(), "timeout") {
			s.logger.Error("Connection or timeout error detected")
			return nil, 0, fmt.Errorf("erro de conexão com AniList: %w", err)
		}
		
		return nil, 0, fmt.Errorf("AniList API error: %w", err)
	}
	
	s.logger.Debug("GraphQL query successful", "results_count", len(query.Page.Media))
	
	// Estimar tamanho do payload
	payloadSize := 15.0 // ~15KB estimado para query padrão
	if s.queryOptimizer != nil {
		payloadSize = s.queryOptimizer.EstimatePayloadSize("search", false)
	}
	
	// Estruturar resultado - converter MangaSlim para MangaBasic
	mangaBasics := make([]MangaBasic, len(query.Page.Media))
	for i, slim := range query.Page.Media {
		mangaBasics[i] = convertSlimToBasic(slim)
	}
	
	result := &SearchResult{
		Results:     mangaBasics,
		Total:       query.Page.PageInfo.Total,
		CurrentPage: query.Page.PageInfo.CurrentPage,
		LastPage:    query.Page.PageInfo.LastPage,
		HasNextPage: query.Page.PageInfo.HasNextPage,
		Query:       search,
	}
	
	return result, payloadSize, nil
}

// searchMangaOptimized executa busca com query otimizada
func (s *AniListService) searchMangaOptimized(ctx context.Context, search string, page, perPage int) (*SearchResult, float64, error) {
	var query SearchMangaOptimized
	variables := map[string]interface{}{
		"search":  graphql.String(search),
		"page":    graphql.Int(page),
		"perPage": graphql.Int(perPage),
	}
	
	err := s.client.Query(ctx, &query, variables)
	if err != nil {
		s.logger.Error("Optimized GraphQL query failed", 
			"error", err,
			"query", search,
			"page", page)
		return nil, 0, fmt.Errorf("AniList API error: %w", err)
	}
	
	// Converter resultados otimizados para formato padrão
	standardResults := ConvertOptimizedSearchResult(query.Page.Media)
	
	// Estimar tamanho do payload (otimizado é ~40% menor)
	payloadSize := s.queryOptimizer.EstimatePayloadSize("search", true)
	
	// Estruturar resultado
	result := &SearchResult{
		Results:     standardResults,
		Total:       query.Page.PageInfo.Total,
		CurrentPage: query.Page.PageInfo.CurrentPage,
		LastPage:    query.Page.PageInfo.LastPage,
		HasNextPage: query.Page.PageInfo.HasNextPage,
		Query:       search,
	}
	
	s.logger.Debug("Used optimized search query",
		"payload_reduction", "40%",
		"estimated_kb", payloadSize)
	
	return result, payloadSize, nil
}

// extractImageURL extrai a melhor URL de imagem disponível
func extractImageURL(image Image) string {
	if image.Large != nil && *image.Large != "" {
		return *image.Large
	}
	if image.Medium != nil && *image.Medium != "" {
		return *image.Medium
	}
	if image.ExtraLarge != nil && *image.ExtraLarge != "" {
		return *image.ExtraLarge
	}
	return ""
}

// preloadImagesAsync inicia carregamento lazy das imagens em background
func (s *AniListService) preloadImagesAsync(results []MangaBasic) {
	if s.imageLoader == nil {
		return // Image loader não configurado
	}
	
	for i, manga := range results {
		imageURL := extractImageURL(manga.CoverImage)
		if imageURL == "" {
			continue
		}
		
		// Prioridade baseada na posição: primeiros resultados têm prioridade maior
		priority := 1 // Alta prioridade para primeiros 3
		if i >= 3 && i < 7 {
			priority = 2 // Média prioridade para 4-7
		} else if i >= 7 {
			priority = 3 // Baixa prioridade para resto
		}
		
		// Iniciar carregamento assíncrono
		s.imageLoader.LoadImageAsync(imageURL, priority, func(localPath string, err error) {
			if err != nil {
				s.logger.Debug("Image preload failed", 
					"url", imageURL,
					"error", err)
			} else {
				s.logger.Debug("Image preloaded successfully",
					"url", imageURL,
					"local_path", localPath)
			}
		})
	}
}

// updateCacheMetrics atualiza métricas do cache
func (s *AniListService) updateCacheMetrics() {
	if s.metrics == nil || s.cache == nil {
		return
	}
	
	// Obter estatísticas do cache
	cacheStats := s.cache.GetStats()
	
	// Extrair tamanho total do cache
	searchEntries, ok1 := cacheStats["search_entries"].(int)
	detailsEntries, ok2 := cacheStats["details_entries"].(int)
	
	totalSize := 0
	if ok1 && ok2 {
		totalSize = searchEntries + detailsEntries
	}
	
	s.metrics.UpdateCacheSize(totalSize)
}

// GetPerformanceMetrics retorna métricas de performance atual
func (s *AniListService) GetPerformanceMetrics() map[string]interface{} {
	if s.metrics == nil {
		return map[string]interface{}{
			"metrics_enabled": false,
		}
	}
	
	// Atualizar métricas de cache
	s.updateCacheMetrics()
	
	summary := s.metrics.GetSummary()
	summary["metrics_enabled"] = true
	
	// Adicionar estatísticas do image loader se disponível
	if s.imageLoader != nil {
		imageStats := s.imageLoader.GetCacheStats()
		summary["image_cache"] = imageStats
	}
	
	return summary
}

// GetOptimizationStatus retorna status das otimizações ativas
func (s *AniListService) GetOptimizationStatus() map[string]interface{} {
	return map[string]interface{}{
		"optimized_queries": s.queryOptimizer != nil && s.queryOptimizer.useOptimizedQueries,
		"image_lazy_loading": s.imageLoader != nil,
		"connection_pooling": true,
		"performance_metrics": s.metrics != nil,
		"cache_enabled": s.cache != nil,
	}
}

// ValidateMetadata verifica se os metadados estão completos
func ValidateMetadata(metadata metadata.MangaMetadata) []string {
	var issues []string
	
	if metadata.Title == "" || metadata.Title == "Título Desconhecido" {
		issues = append(issues, "Título ausente ou inválido")
	}
	if metadata.Author == "" {
		issues = append(issues, "Autor não encontrado")
	}
	if metadata.Status == "" {
		issues = append(issues, "Status não encontrado")
	}
	
	return issues
}

// convertSlimToBasic converte MangaSlim para MangaBasic
func convertSlimToBasic(slim MangaSlim) MangaBasic {
	// Converter a estrutura limitada de CoverImage de MangaSlim para Image completo de MangaBasic
	coverImage := Image{
		Medium: slim.CoverImage.Medium,
	}
	
	// Converter Staff
	staff := Staff{
		Edges: make([]StaffEdge, len(slim.Staff.Edges)),
	}
	for i, edge := range slim.Staff.Edges {
		staff.Edges[i] = StaffEdge{
			Role: edge.Role,
			Node: StaffNode{
				Name: struct {
					Full string `graphql:"full"`
				}{
					Full: edge.Node.Name.Full,
				},
				PrimaryOccupations: []string{}, // Não disponível em MangaSlim
			},
		}
	}
	
	return MangaBasic{
		ID:          slim.ID,
		Title:       slim.Title,
		Description: nil,        // Não disponível em MangaSlim
		Status:      slim.Status,
		Chapters:    nil,        // Não disponível em MangaSlim
		Volumes:     nil,        // Não disponível em MangaSlim
		Genres:      []string{}, // Não disponível em MangaSlim
		MeanScore:   slim.MeanScore,
		Popularity:  0,          // Não disponível em MangaSlim
		CoverImage:  coverImage,
		Staff:       staff,
	}
}

// IsHealthy verifica se o serviço AniList está saudável
func (s *AniListService) IsHealthy() bool {
	if s.retryHandler == nil || s.retryHandler.circuitBreaker == nil {
		return true // Se não temos circuit breaker, assumir saudável
	}
	return s.retryHandler.circuitBreaker.IsHealthy()
}

// GetServiceStatus retorna status detalhado do serviço
func (s *AniListService) GetServiceStatus() map[string]interface{} {
	status := map[string]interface{}{
		"healthy":   s.IsHealthy(),
		"timestamp": time.Now(),
	}

	// Adicionar status do circuit breaker se disponível
	if s.retryHandler != nil && s.retryHandler.circuitBreaker != nil {
		status["circuit_breaker"] = s.retryHandler.circuitBreaker.GetHealthStatus()
	}

	// Adicionar estatísticas de retry se disponível
	if s.retryHandler != nil {
		status["retry_handler"] = s.retryHandler.GetStats()
	}

	// Adicionar métricas de performance se disponível
	if s.metrics != nil {
		perfMetrics := s.GetPerformanceMetrics()
		status["performance"] = perfMetrics
	}

	// Adicionar estatísticas de configuração
	if s.configManager != nil {
		status["config"] = s.configManager.GetStats()
	}

	return status
}

// RecoverFromFailure força recuperação do circuit breaker (use com cuidado)
func (s *AniListService) RecoverFromFailure() {
	if s.retryHandler != nil && s.retryHandler.circuitBreaker != nil {
		s.retryHandler.circuitBreaker.ForceClose()
		s.logger.Info("AniList service recovery forced - circuit breaker closed manually")
	}
}

// ==============================================
//           MÉTODOS DE CONFIGURAÇÃO
// ==============================================

// GetConfig retorna as configurações atuais
func (s *AniListService) GetConfig() *AniListConfig {
	if s.configManager == nil {
		return GetDefaultConfig()
	}
	return s.configManager.Get()
}

// UpdateConfig atualiza as configurações
func (s *AniListService) UpdateConfig(config *AniListConfig) error {
	if s.configManager == nil {
		return fmt.Errorf("config manager não inicializado")
	}
	
	s.logger.Info("Updating AniList configuration", 
		"enabled", config.Enabled,
		"language", string(config.LanguagePreference),
		"fill_mode", string(config.FillMode))
	
	return s.configManager.Update(config)
}

// UpdateConfigField atualiza um campo específico
func (s *AniListService) UpdateConfigField(field string, value interface{}) error {
	if s.configManager == nil {
		return fmt.Errorf("config manager não inicializado")
	}
	
	s.logger.Debug("Updating config field", "field", field, "value", value)
	return s.configManager.UpdateField(field, value)
}

// IsIntegrationEnabled verifica se a integração está habilitada
func (s *AniListService) IsIntegrationEnabled() bool {
	if s.configManager == nil {
		return true // padrão habilitado se não houver config
	}
	return s.configManager.IsEnabled()
}

// GetLanguagePreference retorna o idioma preferido
func (s *AniListService) GetLanguagePreference() LanguagePreference {
	if s.configManager == nil {
		return LanguageRomaji
	}
	return s.configManager.GetLanguagePreference()
}

// GetFillMode retorna o modo de preenchimento
func (s *AniListService) GetFillMode() FillMode {
	if s.configManager == nil {
		return FillModeManual
	}
	return s.configManager.GetFillMode()
}

// ShouldUseCache retorna se deve usar cache baseado na configuração
func (s *AniListService) ShouldUseCache() bool {
	if s.configManager == nil {
		return true // padrão usar cache
	}
	return s.configManager.IsCacheEnabled()
}

// ShouldAutoSearch retorna se deve fazer busca automática
func (s *AniListService) ShouldAutoSearch() bool {
	if s.configManager == nil {
		return true // padrão busca automática
	}
	return s.configManager.IsAutoSearchEnabled()
}

// ResetConfig restaura configurações padrão
func (s *AniListService) ResetConfig() error {
	if s.configManager == nil {
		return fmt.Errorf("config manager não inicializado")
	}
	
	s.logger.Info("Resetting AniList configuration to defaults")
	return s.configManager.Reset()
}
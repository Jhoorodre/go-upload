package anilist

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ImageLoader gerencia o carregamento lazy de imagens da AniList
type ImageLoader struct {
	cacheDir     string
	client       *http.Client
	loadingQueue chan *ImageRequest
	workers      int
	logger       Logger
	mutex        sync.RWMutex
	loadingMap   map[string]bool // Rastreia imagens sendo carregadas
	metrics      *PerformanceMetrics
}

// ImageRequest representa uma solicitação de carregamento de imagem
type ImageRequest struct {
	URL        string
	Priority   int       // 1 = alta, 2 = média, 3 = baixa
	Callback   func(string, error) // callback com caminho local ou erro
	RequestedAt time.Time
}

// ImageCache representa metadados de uma imagem em cache
type ImageCache struct {
	OriginalURL  string    `json:"original_url"`
	LocalPath    string    `json:"local_path"`
	FileName     string    `json:"file_name"`
	Size         int64     `json:"size_bytes"`
	CachedAt     time.Time `json:"cached_at"`
	LastAccessed time.Time `json:"last_accessed"`
}

// NewImageLoader cria um novo carregador de imagens
func NewImageLoader(cacheDir string, workers int, logger Logger, metrics *PerformanceMetrics) *ImageLoader {
	// Criar diretório de cache se não existir
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		logger.Error("Failed to create image cache directory", "error", err, "path", cacheDir)
	}
	
	loader := &ImageLoader{
		cacheDir:     cacheDir,
		client:       &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        100,
				MaxIdleConnsPerHost: 10,
				IdleConnTimeout:     90 * time.Second,
			},
		},
		loadingQueue: make(chan *ImageRequest, 100),
		workers:      workers,
		logger:       logger,
		loadingMap:   make(map[string]bool),
		metrics:      metrics,
	}
	
	// Iniciar workers
	for i := 0; i < workers; i++ {
		go loader.worker(i)
	}
	
	logger.Info("Image loader initialized", 
		"cache_dir", cacheDir,
		"workers", workers)
	
	return loader
}

// worker processa requests de imagem em background
func (il *ImageLoader) worker(id int) {
	il.logger.Debug("Image loader worker started", "worker_id", id)
	
	for request := range il.loadingQueue {
		il.processImageRequest(request)
	}
}

// LoadImageAsync carrega uma imagem de forma assíncrona
func (il *ImageLoader) LoadImageAsync(url string, priority int, callback func(string, error)) {
	if url == "" {
		if callback != nil {
			callback("", fmt.Errorf("empty URL"))
		}
		return
	}
	
	// Verificar se já está em cache
	if localPath := il.getFromCache(url); localPath != "" {
		il.logger.Debug("Image found in cache", "url", url, "path", localPath)
		if callback != nil {
			callback(localPath, nil)
		}
		return
	}
	
	// Verificar se já está sendo carregada
	il.mutex.Lock()
	if il.loadingMap[url] {
		il.mutex.Unlock()
		il.logger.Debug("Image already being loaded", "url", url)
		// Poderia implementar uma lista de callbacks para múltiplas solicitações da mesma imagem
		return
	}
	il.loadingMap[url] = true
	il.mutex.Unlock()
	
	// Adicionar à queue
	request := &ImageRequest{
		URL:         url,
		Priority:    priority,
		Callback:    callback,
		RequestedAt: time.Now(),
	}
	
	select {
	case il.loadingQueue <- request:
		il.logger.Debug("Image queued for loading", "url", url, "priority", priority)
	default:
		il.logger.Warn("Image loading queue full, dropping request", "url", url)
		il.mutex.Lock()
		delete(il.loadingMap, url)
		il.mutex.Unlock()
		if callback != nil {
			callback("", fmt.Errorf("loading queue full"))
		}
	}
}

// processImageRequest processa uma solicitação de imagem
func (il *ImageLoader) processImageRequest(request *ImageRequest) {
	startTime := time.Now()
	url := request.URL
	
	defer func() {
		il.mutex.Lock()
		delete(il.loadingMap, url)
		il.mutex.Unlock()
	}()
	
	il.logger.Debug("Processing image request", 
		"url", url,
		"priority", request.Priority,
		"queue_time_ms", time.Since(request.RequestedAt).Milliseconds())
	
	// Fazer download
	localPath, err := il.downloadImage(url)
	
	duration := time.Since(startTime)
	
	if err != nil {
		il.logger.Error("Failed to download image", 
			"url", url,
			"error", err,
			"duration_ms", duration.Milliseconds())
	} else {
		il.logger.Info("Image downloaded successfully",
			"url", url,
			"local_path", localPath,
			"duration_ms", duration.Milliseconds())
	}
	
	// Executar callback
	if request.Callback != nil {
		request.Callback(localPath, err)
	}
}

// downloadImage faz o download de uma imagem
func (il *ImageLoader) downloadImage(url string) (string, error) {
	// Gerar nome do arquivo baseado na URL
	fileName := il.generateFileName(url)
	localPath := filepath.Join(il.cacheDir, fileName)
	
	// Verificar se já existe
	if _, err := os.Stat(localPath); err == nil {
		il.updateAccessTime(localPath)
		return localPath, nil
	}
	
	// Fazer request HTTP
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", fmt.Errorf("creating request: %w", err)
	}
	
	// Headers para evitar bloqueios
	req.Header.Set("User-Agent", "AniList-Integration/1.0")
	req.Header.Set("Referer", "https://anilist.co/")
	
	resp, err := il.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("downloading image: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, resp.Status)
	}
	
	// Criar arquivo local
	file, err := os.Create(localPath)
	if err != nil {
		return "", fmt.Errorf("creating local file: %w", err)
	}
	defer file.Close()
	
	// Copiar dados
	size, err := io.Copy(file, resp.Body)
	if err != nil {
		os.Remove(localPath) // Cleanup em caso de erro
		return "", fmt.Errorf("writing image data: %w", err)
	}
	
	il.logger.Debug("Image downloaded",
		"url", url,
		"local_path", localPath,
		"size_bytes", size)
	
	return localPath, nil
}

// generateFileName gera um nome de arquivo único baseado na URL
func (il *ImageLoader) generateFileName(url string) string {
	// Usar hash MD5 da URL para evitar problemas com caracteres especiais
	hash := md5.Sum([]byte(url))
	hashStr := hex.EncodeToString(hash[:])
	
	// Tentar extrair extensão da URL
	ext := ".jpg" // Default
	if idx := strings.LastIndex(url, "."); idx != -1 {
		urlExt := url[idx:]
		if len(urlExt) <= 5 && (strings.Contains(urlExt, "jpg") || 
			strings.Contains(urlExt, "jpeg") || 
			strings.Contains(urlExt, "png") || 
			strings.Contains(urlExt, "webp")) {
			ext = strings.Split(urlExt, "?")[0] // Remove query params
		}
	}
	
	return "anilist_" + hashStr + ext
}

// getFromCache verifica se uma imagem está em cache
func (il *ImageLoader) getFromCache(url string) string {
	fileName := il.generateFileName(url)
	localPath := filepath.Join(il.cacheDir, fileName)
	
	if _, err := os.Stat(localPath); err == nil {
		il.updateAccessTime(localPath)
		return localPath
	}
	
	return ""
}

// updateAccessTime atualiza o tempo de acesso de um arquivo
func (il *ImageLoader) updateAccessTime(path string) {
	// Simples touch no arquivo para indicar uso recente
	now := time.Now()
	os.Chtimes(path, now, now)
}

// LoadImageSync carrega uma imagem de forma síncrona (blocking)
func (il *ImageLoader) LoadImageSync(url string, timeout time.Duration) (string, error) {
	if url == "" {
		return "", fmt.Errorf("empty URL")
	}
	
	// Verificar cache primeiro
	if localPath := il.getFromCache(url); localPath != "" {
		return localPath, nil
	}
	
	// Canal para receber resultado
	resultChan := make(chan struct {
		path string
		err  error
	}, 1)
	
	// Fazer request assíncrono
	il.LoadImageAsync(url, 1, func(path string, err error) {
		resultChan <- struct {
			path string
			err  error
		}{path, err}
	})
	
	// Aguardar resultado ou timeout
	select {
	case result := <-resultChan:
		return result.path, result.err
	case <-time.After(timeout):
		return "", fmt.Errorf("timeout loading image")
	}
}

// CleanupOldImages remove imagens antigas do cache
func (il *ImageLoader) CleanupOldImages(maxAge time.Duration) error {
	il.logger.Info("Starting image cache cleanup", "max_age", maxAge)
	
	cutoff := time.Now().Add(-maxAge)
	removed := 0
	var totalSize int64
	
	err := filepath.Walk(il.cacheDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		
		if !info.IsDir() && strings.HasPrefix(info.Name(), "anilist_") {
			if info.ModTime().Before(cutoff) {
				il.logger.Debug("Removing old cached image", "path", path, "age", time.Since(info.ModTime()))
				totalSize += info.Size()
				if err := os.Remove(path); err != nil {
					il.logger.Warn("Failed to remove old image", "path", path, "error", err)
				} else {
					removed++
				}
			}
		}
		
		return nil
	})
	
	il.logger.Info("Image cache cleanup completed",
		"removed_files", removed,
		"freed_mb", float64(totalSize)/(1024*1024))
	
	return err
}

// GetCacheStats retorna estatísticas do cache de imagens
func (il *ImageLoader) GetCacheStats() map[string]interface{} {
	var fileCount int
	var totalSize int64
	
	filepath.Walk(il.cacheDir, func(path string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() && strings.HasPrefix(info.Name(), "anilist_") {
			fileCount++
			totalSize += info.Size()
		}
		return nil
	})
	
	return map[string]interface{}{
		"cache_dir":         il.cacheDir,
		"cached_images":     fileCount,
		"total_size_mb":     float64(totalSize) / (1024 * 1024),
		"queue_length":      len(il.loadingQueue),
		"active_workers":    il.workers,
	}
}

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"go-upload/backend/internal/anilist"
	"go-upload/backend/internal/collection"
	"go-upload/backend/internal/discovery"
	"go-upload/backend/internal/github"
	"go-upload/backend/internal/metadata"
	"go-upload/backend/internal/monitoring"
	"go-upload/backend/internal/upload"
	"go-upload/backend/internal/workstealing"
	wsmanager "go-upload/backend/internal/websocket"
	"go-upload/backend/uploaders"
)

// --- Constants ---
const (
	LIBRARY_ROOT            = "manga_library" // Default root directory for all scans
	DEFAULT_MAX_WORKERS     = 100             // Maximum concurrent upload workers
	DEFAULT_MAX_CONNECTIONS = 1000            // Maximum WebSocket connections
	SERVER_PORT             = ":8080"
	DISCOVERY_WORKERS       = 20              // Workers for concurrent discovery
)

// --- High-Performance Server ---
type HighPerformanceServer struct {
	// Core components
	wsManager         *wsmanager.Manager
	batchUploader     *upload.BatchUploader
	discoverer        *discovery.ConcurrentDiscoverer
	monitor           *monitoring.Monitor
	collectionProcessor *collection.CollectionProcessor
	workerPool        *workstealing.WorkerPool
	jsonGenerator     *metadata.JSONGenerator
	anilistService    *anilist.AniListService  // Phase 2.3: AniList integration
	githubService     *github.GitHubService   // GitHub integration
	
	// JSON generation tracking
	uploadResults     map[string][]metadata.UploadedFile  // Track real upload results by batchID
	batchMangaTitles  map[string]map[string]string         // Track manga titles by batchID -> mangaID -> title
	uploadResultsMu   sync.RWMutex                        // Protect upload tracking maps
	
	// Configuration
	config            *ServerConfig
	
	// Lifecycle management
	ctx               context.Context
	cancel            context.CancelFunc
	wg                sync.WaitGroup
	
	// HTTP server
	httpServer        *http.Server
}

// ServerConfig holds server configuration
type ServerConfig struct {
	MaxWorkers       int    `json:"maxWorkers"`
	MaxConnections   int    `json:"maxConnections"`
	DiscoveryWorkers int    `json:"discoveryWorkers"`
	Port             string `json:"port"`
	LibraryRoot      string `json:"libraryRoot"`
	MetadataOutput   string `json:"metadataOutput"`
	EnableMetrics    bool   `json:"enableMetrics"`
	LogLevel         string `json:"logLevel"`
}

// WebSocket request/response types (updated for new architecture)
type WebSocketRequest struct {
	Action          string                     `json:"action"`
	RequestID       string                     `json:"requestId,omitempty"`
	BasePath        string                     `json:"basePath,omitempty"`
	FullPath        string                     `json:"fullPath,omitempty"`
	Host            string                     `json:"host,omitempty"`
	Manga           string                     `json:"manga,omitempty"`
	Chapter         string                     `json:"chapter,omitempty"`
	FileName        string                     `json:"fileName,omitempty"`
	FileContent     string                     `json:"fileContent,omitempty"`
	Uploads         []upload.UploadRequest     `json:"uploads,omitempty"`
	Options         *upload.BatchOptions       `json:"options,omitempty"`
	BatchID         string                     `json:"batchId,omitempty"`
	
	// JSON generation fields (new)
	IncludeJSON              bool                       `json:"includeJSON,omitempty"`
	GenerateIndividualJSONs  bool                       `json:"generateIndividualJSONs,omitempty"`
	MangaList               []string                   `json:"mangaList,omitempty"`
	Files                   []BatchFileInfo            `json:"files,omitempty"`
	UpdateMode              string                     `json:"updateMode,omitempty"`
	
	// Collection processing fields
	CollectionName  string                     `json:"collectionName,omitempty"`
	CollectionID    string                     `json:"collectionId,omitempty"`
	ParallelLimit   int                        `json:"parallelLimit,omitempty"`
	CollectionOptions *CollectionProcessingOptions `json:"collectionOptions,omitempty"`
	
	// Metadata editing fields
	Payload         map[string]interface{}     `json:"payload,omitempty"`
	
	// AniList integration fields (Phase 2.3)
	SearchQuery     string                     `json:"searchQuery,omitempty"`
	AniListID       int                        `json:"anilistId,omitempty"`
	MangaTitle      string                     `json:"mangaTitle,omitempty"`
	SelectedResult  map[string]interface{}     `json:"selectedResult,omitempty"`
	
	// GitHub integration fields
	Token           string                     `json:"token,omitempty"`
	Repo            string                     `json:"repo,omitempty"`
	Branch          string                     `json:"branch,omitempty"`
	Folder          string                     `json:"folder,omitempty"`
	GitHubSettings  map[string]interface{}     `json:"githubSettings,omitempty"`
}

// BatchFileInfo represents file information from frontend
type BatchFileInfo struct {
	Manga     string `json:"manga"`
	MangaID   string `json:"mangaId"`
	Chapter   string `json:"chapter"`
	FileName  string `json:"fileName"`
	FileSize  int64  `json:"fileSize"`
}

// CollectionProcessingOptions define as opções para processamento de coleções
type CollectionProcessingOptions struct {
	ResumeFrom       string `json:"resumeFrom,omitempty"`
	SkipExisting     bool   `json:"skipExisting"`
	MaxConcurrency   int    `json:"maxConcurrency"`
	BatchSize        int    `json:"batchSize"`
	RetryAttempts    int    `json:"retryAttempts"`
	EnablePersistence bool  `json:"enablePersistence"`
}

// Legacy compatibility types
type WebSocketResponse struct {
	Status     string               `json:"status"`
	File       string               `json:"file,omitempty"`
	URL        string               `json:"url,omitempty"`
	Error      string               `json:"error,omitempty"`
	Payload    interface{}          `json:"payload,omitempty"`
	Metadata   *HierarchyMetadata   `json:"metadata,omitempty"`
	
	// JSON generation fields (new)
	MangaID    string               `json:"mangaId,omitempty"`
	MangaTitle string               `json:"mangaTitle,omitempty"`
	JSONPath   string               `json:"jsonPath,omitempty"`
}

type HierarchyMetadata struct {
	RootLevel    string            `json:"rootLevel"`
	MaxDepth     int               `json:"maxDepth"`
	TotalLevels  int               `json:"totalLevels"`
	LevelMap     map[string]string `json:"levelMap"`
	Stats        HierarchyStats    `json:"stats"`
}

type HierarchyStats struct {
	TotalDirectories int `json:"totalDirectories"`
	TotalImages      int `json:"totalImages"`
	TotalChapters    int `json:"totalChapters"`
}

// WebSocket upgrader with optimized settings
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	EnableCompression: true,
}

// safeSend sends a WebSocket response safely, handling closed connections
func safeSend(conn *wsmanager.Connection, response wsmanager.Response) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("⚠️ Recovered from WebSocket send panic: %v", r)
		}
	}()
	
	if conn == nil {
		log.Printf("⚠️ Cannot send to nil WebSocket connection")
		return
	}
	
	if err := conn.Send(response); err != nil {
		log.Printf("⚠️ Failed to send WebSocket response: %v", err)
	}
}

// generateOrderedJSON creates JSON with consistent field order
func generateOrderedJSON(data map[string]interface{}) ([]byte, error) {
	// Safely get values with fallbacks
	getValue := func(key string) string {
		if val, ok := data[key]; ok {
			if str, ok := val.(string); ok {
				return str
			}
		}
		return ""
	}
	
	// Get chapters data
	chapters := make(map[string]interface{})
	if ch, ok := data["chapters"]; ok {
		if chMap, ok := ch.(map[string]interface{}); ok {
			chapters = chMap
		}
	}
	
	// Marshal chapters separately to get proper formatting
	chaptersJSON, err := json.MarshalIndent(chapters, "  ", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal chapters: %v", err)
	}
	
	// Remove leading spaces from chapters JSON for proper indentation
	chaptersStr := strings.ReplaceAll(string(chaptersJSON), "\n  ", "\n    ")
	chaptersStr = strings.TrimPrefix(chaptersStr, "  ")
	
	// Build JSON manually with exact field order and indentation
	jsonStr := fmt.Sprintf(`{
  "title": %q,
  "description": %q,
  "artist": %q,
  "author": %q,
  "cover": %q,
  "status": %q,
  "group": %q,
  "chapters": %s
}`,
		getValue("title"),
		getValue("description"),
		getValue("artist"),
		getValue("author"),
		getValue("cover"),
		getValue("status"),
		getValue("group"),
		chaptersStr)
	
	return []byte(jsonStr), nil
}

// NewHighPerformanceServer creates a new high-performance server instance
func NewHighPerformanceServer(config *ServerConfig) *HighPerformanceServer {
	ctx, cancel := context.WithCancel(context.Background())
	
	// Initialize monitoring
	monitor := monitoring.NewMonitor()
	
	// Initialize WebSocket manager
	wsManager := wsmanager.NewManager()
	
	// Initialize batch uploader with high concurrency
	batchUploader := upload.NewBatchUploader(wsManager, config.MaxWorkers)
	
	// Initialize concurrent discoverer
	discoverer := discovery.NewConcurrentDiscoverer(config.DiscoveryWorkers)
	
	// Initialize worker pool for massive processing
	workerPool := workstealing.NewWorkerPool(config.MaxWorkers)
	
	// Initialize collection processor with advanced capabilities
	collectionConfig := &collection.ProcessorConfig{
		MaxConcurrency:    config.MaxWorkers,
		BatchSize:         50,
		RetryAttempts:     3,
		RetryDelay:        2 * time.Second,
		ProgressInterval:  5 * time.Second,
		EnablePersistence: true,
		StateFilePath:     "collection_state",
	}
	collectionProcessor := collection.NewCollectionProcessor(collectionConfig)
	
	// Initialize JSON generator
	jsonGenerator := metadata.NewJSONGenerator(config.LibraryRoot, "scan_group")
	
	// Initialize AniList service (Phase 2.3)
	anilistService := anilist.NewAniListService()
	
	// Initialize GitHub service
	githubService := github.NewGitHubService()
	
	// Register uploaders
	catboxUploader := uploaders.NewCatboxUploader()
	batchUploader.RegisterUploader("catbox", catboxUploader)
	
	server := &HighPerformanceServer{
		wsManager:           wsManager,
		batchUploader:       batchUploader,
		discoverer:          discoverer,
		monitor:             monitor,
		collectionProcessor: collectionProcessor,
		workerPool:          workerPool,
		jsonGenerator:       jsonGenerator,
		anilistService:      anilistService,  // Phase 2.3: AniList integration
		githubService:       githubService,   // GitHub integration
		uploadResults:       make(map[string][]metadata.UploadedFile),
		batchMangaTitles:    make(map[string]map[string]string),
		config:              config,
		ctx:                 ctx,
		cancel:              cancel,
	}
	
	// Register upload result callback for JSON generation
	batchUploader.SetResultCallback(server.handleUploadResult)
	
	// Register WebSocket handlers
	server.registerWebSocketHandlers()
	
	// Setup HTTP server with optimized settings
	server.setupHTTPServer()
	
	return server
}

// registerWebSocketHandlers registers all WebSocket message handlers
func (s *HighPerformanceServer) registerWebSocketHandlers() {
	// Discovery handler (parallel processing)
	s.wsManager.RegisterHandler("discover", s.handleDiscovery)
	
	// Library discovery handler (first level only)
	s.wsManager.RegisterHandler("discover_library", s.handleLibraryDiscovery)
	
	// Metadata handlers
	s.wsManager.RegisterHandler("save_metadata", s.handleSaveMetadata)
	s.wsManager.RegisterHandler("load_metadata", s.handleLoadMetadata)
	
	// Single upload handler (legacy compatibility)
	s.wsManager.RegisterHandler("upload", s.handleSingleUpload)
	
	// Batch upload handler (new high-performance feature)
	s.wsManager.RegisterHandler("batch_upload", s.handleBatchUpload)
	
	// Cancel batch handler
	s.wsManager.RegisterHandler("cancel_batch", s.handleCancelBatch)
	
	// Collection processing handlers (massive scale)
	s.wsManager.RegisterHandler("process_collection", s.handleProcessCollection)
	s.wsManager.RegisterHandler("get_collection_status", s.handleGetCollectionStatus)
	s.wsManager.RegisterHandler("cancel_collection", s.handleCancelCollection)
	s.wsManager.RegisterHandler("pause_collection", s.handlePauseCollection)
	s.wsManager.RegisterHandler("resume_collection", s.handleResumeCollection)
	
	// Metrics handler
	s.wsManager.RegisterHandler("get_metrics", s.handleGetMetrics)
	
	// Status handler
	s.wsManager.RegisterHandler("get_status", s.handleGetStatus)
	
	// Worker pool handlers
	s.wsManager.RegisterHandler("get_worker_stats", s.handleGetWorkerStats)
	
	// AniList integration handlers (Phase 2.3)
	s.wsManager.RegisterHandler("search_anilist", s.handleSearchAniList)
	s.wsManager.RegisterHandler("select_anilist_result", s.handleSelectAniListResult)
	
	// AniList configuration handlers (Phase 4.3)
	s.wsManager.RegisterHandler("get_anilist_config", s.handleGetAniListConfig)
	s.wsManager.RegisterHandler("update_anilist_config", s.handleUpdateAniListConfig)
	s.wsManager.RegisterHandler("reset_anilist_config", s.handleResetAniListConfig)
	
	// GitHub integration handlers
	s.wsManager.RegisterHandler("github_folders", s.handleGitHubFolders)
	s.wsManager.RegisterHandler("github_upload", s.handleGitHubUpload)
}

// handleDiscovery processes discovery requests with parallel scanning
func (s *HighPerformanceServer) handleDiscovery(conn *wsmanager.Connection, msg wsmanager.Message) error {
	var req WebSocketRequest
	reqData, _ := json.Marshal(msg.Data)
	if err := json.Unmarshal(reqData, &req); err != nil {
		return fmt.Errorf("invalid discovery request: %v", err)
	}
	
	go func() {
		startTime := time.Now()
		
		var targetPath string
		if req.FullPath != "" {
			targetPath = req.FullPath
			log.Printf("Starting parallel discovery on full path: %s", targetPath)
		} else {
			targetPath = filepath.Join(s.config.LibraryRoot, req.BasePath)
			log.Printf("Starting parallel discovery on relative path: %s", targetPath)
		}
		
		// Verify path exists
		if _, err := os.Stat(targetPath); os.IsNotExist(err) {
			response := wsmanager.Response{
				Status:    "error",
				Error:     fmt.Sprintf("Path does not exist: %s", targetPath),
				RequestID: req.RequestID,
			}
			safeSend(conn, response)
			return
		}
		
		// Progress callback for real-time updates
		progressCallback := func(processed, total int, currentPath string) {
			progress := wsmanager.Progress{
				Current:     processed,
				Total:       total,
				Percentage:  int((float64(processed) / float64(total)) * 100),
				CurrentFile: filepath.Base(currentPath),
				Stage:       "discovering",
			}
			
			response := wsmanager.Response{
				Status:    "discovery_progress",
				RequestID: req.RequestID,
				Progress:  &progress,
			}
			safeSend(conn, response)
		}
		
		// Perform concurrent discovery
		result, err := s.discoverer.DiscoverStructure(targetPath, progressCallback)
		
		duration := time.Since(startTime)
		
		if err != nil {
			s.monitor.RecordDiscovery(duration, 0)
			response := wsmanager.Response{
				Status:    "error",
				Error:     fmt.Sprintf("Failed to discover structure: %v", err),
				RequestID: req.RequestID,
			}
			safeSend(conn, response)
			return
		}
		
		// Record metrics
		s.monitor.RecordDiscovery(duration, int64(result.Metadata.Stats.TotalImages))
		
		// Convert to legacy format for compatibility
		legacyMetadata := &HierarchyMetadata{
			RootLevel:   result.Metadata.RootLevel,
			MaxDepth:    result.Metadata.MaxDepth,
			TotalLevels: result.Metadata.TotalLevels,
			LevelMap:    result.Metadata.LevelMap,
			Stats: HierarchyStats{
				TotalDirectories: result.Metadata.Stats.TotalDirectories,
				TotalImages:      result.Metadata.Stats.TotalImages,
				TotalChapters:    result.Metadata.Stats.TotalChapters,
			},
		}
		
		response := wsmanager.Response{
			Status:    "discover_complete",
			Payload:   result.Tree,
			Metadata:  legacyMetadata,
			RequestID: req.RequestID,
		}
		
		log.Printf("Discovery completed in %v: %s with %d levels and %d images",
			duration, result.Metadata.RootLevel, result.Metadata.TotalLevels, result.Metadata.Stats.TotalImages)
		
		safeSend(conn, response)
	}()
	
	return nil
}

// handleLibraryDiscovery processes library discovery requests (first level only)
func (s *HighPerformanceServer) handleLibraryDiscovery(conn *wsmanager.Connection, msg wsmanager.Message) error {
	var req WebSocketRequest
	reqData, _ := json.Marshal(msg.Data)
	log.Printf("DEBUG: msg.Data = %+v", msg.Data)
	log.Printf("DEBUG: reqData = %s", string(reqData))
	if err := json.Unmarshal(reqData, &req); err != nil {
		return fmt.Errorf("invalid library discovery request: %v", err)
	}
	log.Printf("DEBUG: parsed req = %+v", req)
	
	go func() {
		startTime := time.Now()
		
		var targetPath string
		if req.FullPath != "" {
			targetPath = req.FullPath
			log.Printf("Starting library discovery on full path: %s", targetPath)
		} else {
			targetPath = filepath.Join(s.config.LibraryRoot, req.BasePath)
			log.Printf("Starting library discovery on relative path: %s (basePath: %s)", targetPath, req.BasePath)
		}
		
		log.Printf("DEBUG: req.FullPath='%s', req.BasePath='%s', targetPath='%s'", req.FullPath, req.BasePath, targetPath)
		
		// Verify path exists
		if _, err := os.Stat(targetPath); os.IsNotExist(err) {
			response := wsmanager.Response{
				Status:    "error",
				Error:     fmt.Sprintf("Path does not exist: %s", targetPath),
				RequestID: req.RequestID,
			}
			conn.Send(response)
			return
		}
		
		// Progress callback for real-time updates
		progressCallback := func(processed, total int, currentPath string) {
			progress := wsmanager.Progress{
				Current:     processed,
				Total:       total,
				Percentage:  int((float64(processed) / float64(total)) * 100),
				CurrentFile: filepath.Base(currentPath),
				Stage:       "discovering",
			}
			
			response := wsmanager.Response{
				Status:    "discovery_progress",
				RequestID: req.RequestID,
				Progress:  &progress,
			}
			conn.Send(response)
		}
		
		// Perform first-level discovery only
		result, err := s.discoverer.DiscoverFirstLevel(targetPath, progressCallback)
		
		duration := time.Since(startTime)
		
		if err != nil {
			s.monitor.RecordDiscovery(duration, 0)
			response := wsmanager.Response{
				Status:    "error",
				Error:     fmt.Sprintf("Failed to discover library: %v", err),
				RequestID: req.RequestID,
			}
			conn.Send(response)
			return
		}
		
		// Record metrics
		s.monitor.RecordDiscovery(duration, int64(result.Metadata.Stats.TotalImages))
		
		// Convert to legacy format for compatibility
		legacyMetadata := &HierarchyMetadata{
			RootLevel:   result.Metadata.RootLevel,
			MaxDepth:    result.Metadata.MaxDepth,
			TotalLevels: result.Metadata.TotalLevels,
			LevelMap:    result.Metadata.LevelMap,
			Stats: HierarchyStats{
				TotalDirectories: result.Metadata.Stats.TotalDirectories,
				TotalImages:      result.Metadata.Stats.TotalImages,
				TotalChapters:    result.Metadata.Stats.TotalChapters,
			},
		}
		
		response := wsmanager.Response{
			Status:    "discover_complete",
			Payload:   result.Tree,
			Metadata:  legacyMetadata,
			RequestID: req.RequestID,
		}
		
		log.Printf("Library discovery completed in %v: %s with %d manga directories",
			duration, result.Metadata.RootLevel, result.Metadata.Stats.TotalDirectories)
		
		conn.Send(response)
	}()
	
	return nil
}

// handleSaveMetadata processes metadata saving requests
func (s *HighPerformanceServer) handleSaveMetadata(conn *wsmanager.Connection, msg wsmanager.Message) error {
	// Extract payload data
	var payloadData map[string]interface{}
	var ok bool
	
	if msg.Data != nil {
		payloadData, ok = msg.Data.(map[string]interface{})
	} else if msg.Payload != nil {
		payloadData, ok = msg.Payload.(map[string]interface{})
	}
	
	if !ok || payloadData == nil {
		return fmt.Errorf("invalid payload format - not a map")
	}
	
	go func() {
		// Extract manga path and metadata from payload (usando payloadData processado)
		if payloadData == nil {
			response := wsmanager.Response{
				Status:    "error",
				Error:     "Invalid payload format",
				RequestID: msg.RequestID,
			}
			conn.Send(response)
			return
		}
		
		metadata, ok := payloadData["metadata"].(map[string]interface{})
		if !ok {
			response := wsmanager.Response{
				Status:    "error",
				Error:     "Missing metadata in payload", 
				RequestID: msg.RequestID,
			}
			conn.Send(response)
			return
		}
		
		// Extract mangaID to determine the correct filename (consistent with stable ID system)
		mangaID, mangaIDOk := payloadData["mangaID"].(string)
		mangaPath, pathOk := payloadData["mangaPath"].(string)
		
		var sanitizedFolderName string
		
		if mangaIDOk && mangaID != "" {
			// Use mangaID for consistent filename generation (preferred method)
			folderName := mangaID
			if strings.HasPrefix(mangaID, "auto-") {
				folderName = strings.TrimPrefix(mangaID, "auto-")
			}
			sanitizedFolderName = sanitizeFilename(folderName)
			log.Printf("🔍 SAVE DEBUG: Usando mangaID: %s → %s", mangaID, sanitizedFolderName)
		} else if pathOk && mangaPath != "" {
			// Fallback to mangaPath extraction (legacy method)
			folderName := filepath.Base(mangaPath)
			sanitizedFolderName = sanitizeFilename(folderName)
			log.Printf("🔍 SAVE DEBUG: Fallback mangaPath: %s → %s", mangaPath, sanitizedFolderName)
		} else {
			response := wsmanager.Response{
				Status:    "error", 
				Error:     "Missing mangaID or mangaPath in payload",
				RequestID: msg.RequestID,
			}
			conn.Send(response)
			return
		}
		
		log.Printf("🔍 SAVE DEBUG: mangaPath: %s", mangaPath) 
		log.Printf("🔍 SAVE DEBUG: sanitized: %s", sanitizedFolderName)
		
		// Use JSON output directory from payload first, then settings, then default
		jsonOutputDir := ""
		if metadataOutputFromPayload, ok := payloadData["metadataOutput"].(string); ok && metadataOutputFromPayload != "" {
			jsonOutputDir = metadataOutputFromPayload
			log.Printf("🔍 SAVE DEBUG: Usando diretório do payload: %s", jsonOutputDir)
		} else {
			jsonOutputDir = s.config.MetadataOutput
			if jsonOutputDir == "" {
				jsonOutputDir = "json"
			}
			log.Printf("🔍 SAVE DEBUG: Usando diretório padrão/config: %s", jsonOutputDir)
		}
		
		// Create the JSON file path with consistent filename based on folder name
		jsonFileName := fmt.Sprintf("%s.json", sanitizedFolderName)
		metadataPath := filepath.Join(jsonOutputDir, jsonFileName)
		
		log.Printf("🔍 SAVE DEBUG: Salvando em: %s", metadataPath)
		log.Printf("🔍 SAVE DEBUG: Arquivo JSON: %s", jsonFileName)
		
		// Ensure JSON directory exists
		if err := os.MkdirAll(jsonOutputDir, 0755); err != nil {
			response := wsmanager.Response{
				Status:    "error",
				Error:     fmt.Sprintf("Failed to create JSON directory: %v", err),
				RequestID: msg.RequestID,
			}
			conn.Send(response)
			return
		}
		
		// Smart merge: Load existing JSON and update only changed fields
		var existingData map[string]interface{}
		
		// Try to load existing JSON file
		if existingBytes, err := os.ReadFile(metadataPath); err == nil {
			if err := json.Unmarshal(existingBytes, &existingData); err != nil {
				log.Printf("⚠️ Erro ao fazer parse do JSON existente: %v", err)
				existingData = make(map[string]interface{})
			} else {
				log.Printf("📄 JSON existente carregado com %d campos", len(existingData))
			}
		} else {
			log.Printf("📄 Arquivo JSON não existe, criando novo")
			existingData = make(map[string]interface{})
		}
		
		// Initialize with default structure if empty
		if len(existingData) == 0 {
			existingData = map[string]interface{}{
				"title":       "",
				"description": "",
				"artist":      "",
				"author":      "",
				"cover":       "",
				"status":      "",
				"group":       "",
				"chapters":    map[string]interface{}{},
			}
		}
		
		// Smart merge: Update only valid fields that are present in the new metadata
		validFields := map[string]string{
			"nome":      "title",
			"title":     "title",
			"descricao": "description",
			"description": "description",
			"autor":     "author",
			"author":    "author",
			"artista":   "artist",
			"artist":    "artist",
			"capa":      "cover",
			"cover":     "cover",
			"grupo":     "group",
			"group":     "group",
			"status":    "status",
		}
		
		fieldsUpdated := []string{}
		for key, value := range metadata {
			// Skip invalid fields that shouldn't be in the JSON
			jsonKey, isValidField := validFields[key]
			if !isValidField {
				log.Printf("⚠️ Campo '%s' ignorado (não válido para JSON)", key)
				continue
			}
			
			// Only update if the value is different or if the field doesn't exist
			if existingValue, exists := existingData[jsonKey]; !exists || existingValue != value {
				existingData[jsonKey] = value
				fieldsUpdated = append(fieldsUpdated, jsonKey)
				log.Printf("🔄 Campo '%s' atualizado: %v → %v", jsonKey, existingValue, value)
			} else {
				log.Printf("✅ Campo '%s' inalterado: %v", jsonKey, value)
			}
		}
		
		log.Printf("📝 Campos atualizados: %v", fieldsUpdated)
		
		// If no fields were updated, keep original file unchanged
		if len(fieldsUpdated) == 0 {
			log.Printf("✅ Nenhum campo alterado, mantendo arquivo original inalterado")
			response := wsmanager.Response{
				Status:    "metadata_saved",
				Payload:   map[string]interface{}{"metadata": existingData},
				RequestID: msg.RequestID,
			}
			conn.Send(response)
			return
		}
		
		// Convert back to JSON preserving field order
		var jsonData []byte
		var err error
		
		// Try to preserve original formatting and field order if file exists
		if existingBytes, readErr := os.ReadFile(metadataPath); readErr == nil {
			// Preserve field order by modifying original JSON text
			originalText := string(existingBytes)
			updatedText := originalText
			
			// Update only the changed fields in the original text
			for _, fieldName := range fieldsUpdated {
				if newValue, exists := existingData[fieldName]; exists {
					// Convert value to JSON string
					newValueJSON, marshalErr := json.Marshal(newValue)
					if marshalErr != nil {
						continue
					}
					
					// Find and replace the field in original text preserving indentation
					fieldPattern := fmt.Sprintf(`(\s*)"%s":\s*[^,\n}]*`, fieldName)
					replacement := fmt.Sprintf(`$1"%s": %s`, fieldName, string(newValueJSON))
					
					// Use simple string replacement to preserve structure
					re, regexErr := regexp.Compile(fieldPattern)
					if regexErr == nil {
						updatedText = re.ReplaceAllString(updatedText, replacement)
						log.Printf("🔄 Campo '%s' atualizado no texto original", fieldName)
					}
				}
			}
			
			// Validate that updated text is still valid JSON
			var testData map[string]interface{}
			if validateErr := json.Unmarshal([]byte(updatedText), &testData); validateErr == nil {
				jsonData = []byte(updatedText)
				log.Printf("📄 JSON atualizado preservando ordem original dos campos")
			} else {
				// Fallback to standard marshaling if text manipulation failed
				jsonData, err = json.MarshalIndent(existingData, "", "  ")
				if err != nil {
					response := wsmanager.Response{
						Status:    "error",
						Error:     fmt.Sprintf("Failed to marshal updated JSON: %v", err),
						RequestID: msg.RequestID,
					}
					conn.Send(response)
					return
				}
				log.Printf("⚠️ Fallback: JSON regenerado com formatação padrão (ordem pode ter mudado)")
			}
		} else {
			// New file, generate JSON manually with exact field order
			jsonData, err = generateOrderedJSON(existingData)
			if err != nil {
				response := wsmanager.Response{
					Status:    "error",
					Error:     fmt.Sprintf("Failed to generate ordered JSON: %v", err),
					RequestID: msg.RequestID,
				}
				conn.Send(response)
				return
			}
			log.Printf("📄 Novo arquivo JSON criado com ordem consistente dos campos")
		}
		
		// Write JSON file
		if err := os.WriteFile(metadataPath, jsonData, 0644); err != nil {
			response := wsmanager.Response{
				Status:    "error",
				Error:     fmt.Sprintf("Failed to write metadata file: %v", err),
				RequestID: msg.RequestID,
			}
			conn.Send(response)
			return
		}
		
		log.Printf("Successfully saved metadata to: %s", metadataPath)
		
		// Send success response
		response := wsmanager.Response{
			Status:    "metadata_saved",
			Payload:   map[string]interface{}{
				"filePath": metadataPath,
				"metadata": metadata,
			},
			RequestID: msg.RequestID,
		}
		conn.Send(response)
	}()
	
	return nil
}

// handleLoadMetadata loads metadata from an existing JSON file
func (s *HighPerformanceServer) handleLoadMetadata(conn *wsmanager.Connection, msg wsmanager.Message) error {
	log.Printf("🌐 WEBSOCKET: Recebida mensagem load_metadata")
	log.Printf("🌐 WEBSOCKET: Message data: %+v", msg.Data)
	log.Printf("🌐 WEBSOCKET: Message payload: %+v", msg.Payload)
	
	// Extract payload data
	var payloadData map[string]interface{}
	var ok bool
	
	if msg.Data != nil {
		payloadData, ok = msg.Data.(map[string]interface{})
	} else if msg.Payload != nil {
		payloadData, ok = msg.Payload.(map[string]interface{})
	}
	
	if !ok || payloadData == nil {
		log.Printf("❌ WEBSOCKET: Payload inválido - não é um map")
		return fmt.Errorf("invalid payload format - not a map")
	}
	
	go func() {
		log.Printf("🔍 handleLoadMetadata iniciado para: %+v", payloadData)
		
		// Extract mangaID/mangaName from payload (same logic as save_metadata)
		mangaID, mangaIDOk := payloadData["mangaID"].(string)
		mangaName, nameOk := payloadData["mangaName"].(string)
		
		var sanitizedFolderName string
		
		if mangaIDOk && mangaID != "" {
			// Use mangaID for consistent filename generation (preferred method)
			folderName := mangaID
			if strings.HasPrefix(mangaID, "auto-") {
				folderName = strings.TrimPrefix(mangaID, "auto-")
			}
			sanitizedFolderName = sanitizeFilename(folderName)
			log.Printf("🔍 LOAD DEBUG: Usando mangaID: %s → %s", mangaID, sanitizedFolderName)
		} else if nameOk && mangaName != "" {
			// Fallback to mangaName sanitization (legacy method)
			sanitizedFolderName = sanitizeFilename(mangaName)
			log.Printf("🔍 LOAD DEBUG: Fallback mangaName: %s → %s", mangaName, sanitizedFolderName)
		} else {
			log.Printf("❌ MangaID/MangaName inválido: ID=%v, Name=%v", payloadData["mangaID"], payloadData["mangaName"])
			response := wsmanager.Response{
				Status:    "error",
				Error:     "Missing mangaID or mangaName in payload",
				RequestID: msg.RequestID,
			}
			conn.Send(response)
			return
		}
		
		log.Printf("📄 Procurando JSON para filename: %s", sanitizedFolderName)
		
		// Get JSON output directory from payload or config
		jsonOutputDir := ""
		if metadataOutputFromPayload, ok := payloadData["metadataOutput"].(string); ok && metadataOutputFromPayload != "" {
			jsonOutputDir = metadataOutputFromPayload
			log.Printf("🔍 LOAD DEBUG: Usando diretório do payload: %s", jsonOutputDir)
		} else {
			jsonOutputDir = s.config.MetadataOutput
			if jsonOutputDir == "" {
				jsonOutputDir = "json"
			}
			log.Printf("🔍 LOAD DEBUG: Usando diretório padrão/config: %s", jsonOutputDir)
		}
		
		log.Printf("📁 Diretório de busca: %s", jsonOutputDir)
		
		// Use the same filename generation logic as save_metadata for consistency
		jsonFileName := fmt.Sprintf("%s.json", sanitizedFolderName)
		log.Printf("📝 Procurando arquivo: %s", jsonFileName)
		
		// Try to load the JSON file using consistent filename
		jsonPath := filepath.Join(jsonOutputDir, jsonFileName)
		log.Printf("🔍 Carregando arquivo: %s", jsonPath)
		
		jsonData, err := os.ReadFile(jsonPath)
		if err != nil {
			log.Printf("❌ Arquivo JSON não encontrado: %s (erro: %v)", jsonPath, err)
			response := wsmanager.Response{
				Status:    "error",
				Error:     fmt.Sprintf("JSON file not found for filename: %s", jsonFileName),
				RequestID: msg.RequestID,
			}
			safeSend(conn, response)
			return
		}
		
		log.Printf("✅ Arquivo JSON carregado: %s", jsonPath)
		
		// Parse JSON data
		var metadata map[string]interface{}
		if err := json.Unmarshal(jsonData, &metadata); err != nil {
			response := wsmanager.Response{
				Status:    "error",
				Error:     fmt.Sprintf("Failed to parse JSON file: %v", err),
				RequestID: msg.RequestID,
			}
			safeSend(conn, response)
			return
		}
		
		log.Printf("Successfully loaded metadata from: %s", jsonPath)
		log.Printf("🔍 LOAD DEBUG: Retornando mangaID: %s, mangaName: %s", mangaID, mangaName)
		
		// Send success response WITH mangaID echoed back
		response := wsmanager.Response{
			Status:    "metadata_loaded",
			Payload:   map[string]interface{}{
				"filePath": jsonPath,
				"metadata": metadata,
				"mangaID":  mangaID, // Echo back the mangaID for filtering
				"mangaName": mangaName, // Echo back the mangaName as fallback
			},
			RequestID: msg.RequestID,
		}
		safeSend(conn, response)
	}()
	
	return nil
}

// handleSingleUpload processes single upload requests (legacy compatibility)
func (s *HighPerformanceServer) handleSingleUpload(conn *wsmanager.Connection, msg wsmanager.Message) error {
	var req WebSocketRequest
	reqData, _ := json.Marshal(msg.Data)
	if err := json.Unmarshal(reqData, &req); err != nil {
		return fmt.Errorf("invalid upload request: %v", err)
	}
	
	// Convert to batch upload with single item
	uploadReq := upload.UploadRequest{
		ID:          fmt.Sprintf("single_%d", time.Now().UnixNano()),
		Host:        req.Host,
		Manga:       req.Manga,
		Chapter:     req.Chapter,
		FileName:    req.FileName,
		FileContent: req.FileContent,
	}
	
	batchReq := upload.BatchUploadRequest{
		ID:      uploadReq.ID,
		Uploads: []upload.UploadRequest{uploadReq},
		Options: upload.BatchOptions{
			MaxConcurrency:   1,
			RetryAttempts:    3,
			RetryDelay:       2 * time.Second,
			ProgressInterval: 1 * time.Second,
		},
	}
	
	return s.batchUploader.StartBatch(batchReq)
}

// handleBatchUpload processes batch upload requests
func (s *HighPerformanceServer) handleBatchUpload(conn *wsmanager.Connection, msg wsmanager.Message) error {
	var req WebSocketRequest
	reqData, _ := json.Marshal(msg.Data)
	if err := json.Unmarshal(reqData, &req); err != nil {
		return fmt.Errorf("invalid batch upload request: %v", err)
	}
	
	// Handle new format with Files field or legacy Uploads field
	var uploads []upload.UploadRequest
	
	if len(req.Files) > 0 {
		// New format: convert BatchFileInfo to UploadRequest
		for _, fileInfo := range req.Files {
			uploadReq := upload.UploadRequest{
				ID:       fmt.Sprintf("file_%s_%s_%d", fileInfo.MangaID, fileInfo.Chapter, time.Now().UnixNano()),
				Host:     req.Host,
				Manga:    fileInfo.Manga,
				Chapter:  fileInfo.Chapter,
				FileName: fileInfo.FileName,
				// FileContent will be sent separately or streamed
			}
			uploads = append(uploads, uploadReq)
		}
	} else {
		// Legacy format
		uploads = req.Uploads
	}
	
	// Create batch request
	batchReq := upload.BatchUploadRequest{
		ID:      fmt.Sprintf("batch_%d", time.Now().UnixNano()),
		Uploads: uploads,
	}
	
	if req.Options != nil {
		batchReq.Options = *req.Options
	} else {
		// Default batch options for high performance
		batchReq.Options = upload.BatchOptions{
			MaxConcurrency:   min(len(uploads), s.config.MaxWorkers/2),
			RetryAttempts:    3,
			RetryDelay:       2 * time.Second,
			ProgressInterval: 2 * time.Second,
		}
	}
	
	// Send immediate confirmation
	response := wsmanager.Response{
		Status:    "batch_started",
		RequestID: req.RequestID,
		Data: map[string]interface{}{
			"batchId": batchReq.ID,
			"count":   len(uploads),
		},
	}
	conn.Send(response)
	
	// Store manga titles for JSON generation
	if req.GenerateIndividualJSONs && len(req.Files) > 0 {
		s.uploadResultsMu.Lock()
		s.batchMangaTitles[batchReq.ID] = make(map[string]string)
		for _, fileInfo := range req.Files {
			s.batchMangaTitles[batchReq.ID][fileInfo.MangaID] = fileInfo.Manga
		}
		s.uploadResultsMu.Unlock()
		
		go s.handleJSONGeneration(conn, req, batchReq.ID)
	}
	
	// Start batch upload
	return s.batchUploader.StartBatch(batchReq)
}

// handleCancelBatch cancels a batch upload
func (s *HighPerformanceServer) handleCancelBatch(conn *wsmanager.Connection, msg wsmanager.Message) error {
	var req WebSocketRequest
	reqData, _ := json.Marshal(msg.Data)
	if err := json.Unmarshal(reqData, &req); err != nil {
		return fmt.Errorf("invalid cancel batch request: %v", err)
	}
	
	err := s.batchUploader.CancelBatch(req.BatchID)
	status := "batch_canceled"
	var errorMsg string
	
	if err != nil {
		status = "error"
		errorMsg = err.Error()
	}
	
	response := wsmanager.Response{
		Status:    status,
		RequestID: req.RequestID,
		Error:     errorMsg,
		Data: map[string]interface{}{
			"batchId": req.BatchID,
		},
	}
	
	return conn.Send(response)
}

// handleJSONGeneration processes individual JSON generation for manga uploads
func (s *HighPerformanceServer) handleJSONGeneration(conn *wsmanager.Connection, req WebSocketRequest, batchID string) {
	log.Printf("Starting JSON generation for batch %s with %d manga(s)", batchID, len(req.MangaList))
	
	// Wait a bit for uploads to start
	time.Sleep(2 * time.Second)
	
	// Monitor batch progress and generate JSONs when uploads complete
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	
	processedMangas := make(map[string]bool)
	uploadResults := make(map[string][]metadata.UploadedFile)
	
	for {
		select {
		case <-ticker.C:
			// Check batch status
			batchProgress, err := s.batchUploader.GetBatchStatus(batchID)
			if err != nil {
				log.Printf("Error getting batch status: %v", err)
				continue
			}
			
			// Get real upload results from captured data
			s.getUploadResults(batchID, uploadResults)
			
			// Process JSONs for completed uploads
			for _, mangaID := range req.MangaList {
				if processedMangas[mangaID] {
					continue
				}
				
				// Check if this manga has uploaded files
				if files, exists := uploadResults[mangaID]; exists && len(files) > 0 {
					if err := s.generateMangaJSON(conn, mangaID, files, req); err != nil {
						log.Printf("Error generating JSON for manga %s: %v", mangaID, err)
						// Send error notification
						s.sendJSONError(conn, mangaID, err)
					} else {
						processedMangas[mangaID] = true
					}
				}
			}
			
			// Check if batch is complete
			if batchProgress.Completed+batchProgress.Failed >= batchProgress.Total {
				log.Printf("Batch %s completed, finishing JSON generation", batchID)
				return
			}
			
		case <-s.ctx.Done():
			return
		}
	}
}

// generateMangaJSON generates JSON for a specific manga
func (s *HighPerformanceServer) generateMangaJSON(conn *wsmanager.Connection, mangaID string, uploadedFiles []metadata.UploadedFile, req WebSocketRequest) error {
	// Get manga metadata from files
	var mangaTitle string
	for _, file := range uploadedFiles {
		if file.MangaID == mangaID {
			mangaTitle = file.MangaTitle
			break
		}
	}
	
	// Create manga metadata (in real implementation, this would come from a database or discovery)
	mangaMetadata := metadata.MangaMetadata{
		ID:          mangaID,
		Title:       mangaTitle,
		Description: fmt.Sprintf("Descrição da obra %s", mangaTitle),
		Artist:      "Artista Desconhecido",
		Author:      "Autor Desconhecido", 
		Cover:       fmt.Sprintf("https://placehold.co/200x300/1f2937/9ca3af?text=%s", mangaTitle),
		Status:      "Em Andamento",
	}
	
	metadataMap := map[string]metadata.MangaMetadata{
		mangaID: mangaMetadata,
	}
	
	// Send JSON generation start notification
	s.sendJSONProgress(conn, "json_generated", mangaID, mangaTitle, "")
	
	// Check if JSON already exists (use mangaID as unique identifier)
	// Extract folder name from mangaID (remove "auto-" prefix if present)
	folderName := mangaID
	if strings.HasPrefix(mangaID, "auto-") {
		folderName = strings.TrimPrefix(mangaID, "auto-")
	}
	sanitizedFolderName := s.jsonGenerator.SanitizeFilename(folderName)
	expectedJSONPath := filepath.Join("json", fmt.Sprintf("%s.json", sanitizedFolderName))
	
	var jsonPaths []string
	
	if _, statErr := os.Stat(expectedJSONPath); statErr == nil {
		// JSON exists - use update mode from request or default to smart
		updateMode := req.UpdateMode
		if updateMode == "" {
			updateMode = "smart" // Default mode
		}
		
		// Passar metadados opcionais se disponível para preservar informações base
		if mangaMetadata, exists := metadataMap[mangaID]; exists {
			if err := s.jsonGenerator.UpdateExistingJSON(expectedJSONPath, uploadedFiles, updateMode, mangaMetadata); err != nil {
				return fmt.Errorf("failed to update existing JSON: %v", err)
			}
		} else {
			// Sem metadados - apenas atualizar capítulos
			if err := s.jsonGenerator.UpdateExistingJSON(expectedJSONPath, uploadedFiles, updateMode); err != nil {
				return fmt.Errorf("failed to update existing JSON: %v", err)
			}
		}
		
		jsonPaths = []string{expectedJSONPath}
		log.Printf("Updated existing JSON for manga %s at %s using mode: %s", mangaID, expectedJSONPath, updateMode)
	} else {
		// JSON doesn't exist - create new one
		var err error
		jsonPaths, err = s.jsonGenerator.GenerateIndividualJSONs(uploadedFiles, metadataMap)
		if err != nil {
			return fmt.Errorf("failed to generate JSON: %v", err)
		}
		log.Printf("Generated new JSON for manga %s", mangaID)
	}
	
	// Send completion notification
	for _, jsonPath := range jsonPaths {
		s.sendJSONProgress(conn, "json_complete", mangaID, mangaTitle, jsonPath)
		log.Printf("JSON processing complete for manga %s at %s", mangaID, jsonPath)
	}
	
	return nil
}

// getUploadResults retrieves real upload results from captured data
func (s *HighPerformanceServer) getUploadResults(batchID string, uploadResults map[string][]metadata.UploadedFile) {
	s.uploadResultsMu.RLock()
	defer s.uploadResultsMu.RUnlock()
	
	// Get real results for this batch
	if realResults, exists := s.uploadResults[batchID]; exists {
		for _, uploadedFile := range realResults {
			uploadResults[uploadedFile.MangaID] = append(uploadResults[uploadedFile.MangaID], uploadedFile)
		}
		log.Printf("Retrieved %d real upload results for batch %s", len(realResults), batchID)
	}
}

// sendJSONProgress sends JSON progress notifications
func (s *HighPerformanceServer) sendJSONProgress(conn *wsmanager.Connection, status, mangaID, mangaTitle, jsonPath string) {
	response := wsmanager.Response{
		Status:    status,
		MangaID:   mangaID,
		MangaTitle: mangaTitle,
		JSONPath:  jsonPath,
	}
	
	conn.Send(response)
}

// sendJSONError sends JSON error notifications
func (s *HighPerformanceServer) sendJSONError(conn *wsmanager.Connection, mangaID string, err error) {
	response := wsmanager.Response{
		Status:  "json_error",
		MangaID: mangaID,
		Error:   err.Error(),
	}
	
	conn.Send(response)
}

// handleUploadResult captures real upload results for JSON generation
func (s *HighPerformanceServer) handleUploadResult(batchID string, result upload.UploadResult) {
	if result.Error != nil {
		// Skip failed uploads
		return
	}
	
	s.uploadResultsMu.Lock()
	defer s.uploadResultsMu.Unlock()
	
	// Extract manga information from result ID (format: file_{mangaID}_{chapter}_{timestamp})
	parts := strings.Split(result.ID, "_")
	if len(parts) < 3 {
		log.Printf("Invalid upload result ID format: %s", result.ID)
		return
	}
	
	mangaID := parts[1]
	chapterID := parts[2]
	
	// Get manga title from stored batch info
	var mangaTitle string
	if batchTitles, exists := s.batchMangaTitles[batchID]; exists {
		mangaTitle = batchTitles[mangaID]
	}
	
	// Create uploaded file entry with real URL and page index
	uploadedFile := metadata.UploadedFile{
		MangaID:    mangaID,
		MangaTitle: mangaTitle,
		ChapterID:  chapterID,
		FileName:   result.FileName,
		URL:        result.URL, // Real URL from upload
		PageIndex:  s.extractPageIndexFromFileName(result.FileName),
	}
	
	// Store result by batchID
	s.uploadResults[batchID] = append(s.uploadResults[batchID], uploadedFile)
	
	log.Printf("Captured real upload result: %s -> %s (page %d)", result.FileName, result.URL, uploadedFile.PageIndex)
}

// extractPageIndexFromFileName extrai o índice da página do nome do arquivo
func (s *HighPerformanceServer) extractPageIndexFromFileName(fileName string) int {
	// Usar a mesma lógica do JSONGenerator
	jsonGen := metadata.NewJSONGenerator("", "")
	return jsonGen.ExtractPageIndex(fileName)
}

// handleGetMetrics returns current system metrics
func (s *HighPerformanceServer) handleGetMetrics(conn *wsmanager.Connection, msg wsmanager.Message) error {
	metrics := s.monitor.GetMetrics()
	perfMetrics := s.monitor.GetPerformanceMetrics()
	
	response := wsmanager.Response{
		Status:    "metrics",
		RequestID: msg.RequestID,
		Data: map[string]interface{}{
			"metrics":     metrics,
			"performance": perfMetrics,
			"connections": s.wsManager.GetConnectionCount(),
		},
	}
	
	return conn.Send(response)
}

// handleGetStatus returns server status information
func (s *HighPerformanceServer) handleGetStatus(conn *wsmanager.Connection, msg wsmanager.Message) error {
	response := wsmanager.Response{
		Status:    "status",
		RequestID: msg.RequestID,
		Data: map[string]interface{}{
			"server":      "high-performance-manga-uploader",
			"version":     "2.0.0",
			"uptime":      time.Since(startTime).String(),
			"connections": s.wsManager.GetConnectionCount(),
			"config":      s.config,
		},
	}
	
	return conn.Send(response)
}

// handleProcessCollection processa uma coleção completa de mangás
func (s *HighPerformanceServer) handleProcessCollection(conn *wsmanager.Connection, msg wsmanager.Message) error {
	var req WebSocketRequest
	reqData, _ := json.Marshal(msg.Data)
	if err := json.Unmarshal(reqData, &req); err != nil {
		return fmt.Errorf("invalid process collection request: %v", err)
	}
	
	// Valida parâmetros obrigatórios
	if req.CollectionName == "" {
		return conn.Send(wsmanager.Response{
			Status:    "error",
			Error:     "collectionName is required",
			RequestID: req.RequestID,
		})
	}
	
	if req.BasePath == "" {
		return conn.Send(wsmanager.Response{
			Status:    "error", 
			Error:     "basePath is required",
			RequestID: req.RequestID,
		})
	}
	
	if req.Host == "" {
		req.Host = "catbox" // Default
	}
	
	// Gera ID único se não fornecido
	if req.CollectionID == "" {
		req.CollectionID = fmt.Sprintf("collection_%d", time.Now().UnixNano())
	}
	
	// Configura opções de processamento
	processorOptions := &collection.ProcessorConfig{
		MaxConcurrency:    req.ParallelLimit,
		BatchSize:         50,
		RetryAttempts:     3,
		RetryDelay:        2 * time.Second,
		ProgressInterval:  2 * time.Second,
		EnablePersistence: true,
		StateFilePath:     "collection_state",
	}
	
	if req.CollectionOptions != nil {
		if req.CollectionOptions.MaxConcurrency > 0 {
			processorOptions.MaxConcurrency = req.CollectionOptions.MaxConcurrency
		}
		if req.CollectionOptions.BatchSize > 0 {
			processorOptions.BatchSize = req.CollectionOptions.BatchSize
		}
		if req.CollectionOptions.RetryAttempts > 0 {
			processorOptions.RetryAttempts = req.CollectionOptions.RetryAttempts
		}
		processorOptions.EnablePersistence = req.CollectionOptions.EnablePersistence
		
		if req.CollectionOptions.ResumeFrom != "" {
			processorOptions.ResumeFrom = req.CollectionOptions.ResumeFrom
		}
		processorOptions.SkipExisting = req.CollectionOptions.SkipExisting
	}
	
	// Se não especificado, usa configuração padrão
	if processorOptions.MaxConcurrency <= 0 {
		processorOptions.MaxConcurrency = min(req.ParallelLimit, s.config.MaxWorkers)
		if processorOptions.MaxConcurrency <= 0 {
			processorOptions.MaxConcurrency = 100
		}
	}
	
	// Resolve caminho completo
	fullPath := req.BasePath
	if !filepath.IsAbs(fullPath) {
		fullPath = filepath.Join(s.config.LibraryRoot, req.BasePath)
	}
	
	// Callback de progresso - envia via WebSocket
	onProgress := func(update *collection.ProgressUpdate) {
		response := wsmanager.Response{
			Status:    "collection_progress",
			RequestID: req.RequestID,
			Data: map[string]interface{}{
				"collection":     req.CollectionName,
				"collectionId":   req.CollectionID,
				"progress":       update.Progress,
				"currentFile":    update.CurrentFile,
				"updateType":     update.Type,
				"timestamp":      update.Timestamp,
			},
		}
		conn.Send(response)
	}
	
	// Callback de conclusão
	onComplete := func(err error) {
		status := "collection_completed"
		errorMsg := ""
		
		if err != nil {
			status = "collection_failed"
			errorMsg = err.Error()
		}
		
		response := wsmanager.Response{
			Status:    status,
			RequestID: req.RequestID,
			Error:     errorMsg,
			Data: map[string]interface{}{
				"collection":   req.CollectionName,
				"collectionId": req.CollectionID,
				"timestamp":    time.Now(),
			},
		}
		conn.Send(response)
	}
	
	// Cria requisição de processamento
	collectionReq := &collection.CollectionRequest{
		ID:             req.CollectionID,
		CollectionName: req.CollectionName,
		BasePath:       fullPath,
		Host:           req.Host,
		Options:        processorOptions,
		OnProgress:     onProgress,
		OnComplete:     onComplete,
	}
	
	// Inicia processamento
	job, err := s.collectionProcessor.ProcessCollection(collectionReq)
	if err != nil {
		return conn.Send(wsmanager.Response{
			Status:    "error",
			Error:     fmt.Sprintf("Failed to start collection processing: %v", err),
			RequestID: req.RequestID,
		})
	}
	
	// Resposta imediata de confirmação
	response := wsmanager.Response{
		Status:    "collection_started",
		RequestID: req.RequestID,
		Data: map[string]interface{}{
			"collection":   req.CollectionName,
			"collectionId": job.ID,
			"basePath":     fullPath,
			"host":         req.Host,
			"options":      processorOptions,
			"timestamp":    job.StartTime,
		},
	}
	
	return conn.Send(response)
}

// handleGetCollectionStatus retorna o status de uma coleção
func (s *HighPerformanceServer) handleGetCollectionStatus(conn *wsmanager.Connection, msg wsmanager.Message) error {
	var req WebSocketRequest
	reqData, _ := json.Marshal(msg.Data)
	if err := json.Unmarshal(reqData, &req); err != nil {
		return fmt.Errorf("invalid get collection status request: %v", err)
	}
	
	if req.CollectionID == "" {
		return conn.Send(wsmanager.Response{
			Status:    "error",
			Error:     "collectionId is required",
			RequestID: req.RequestID,
		})
	}
	
	job, exists := s.collectionProcessor.GetJobStatus(req.CollectionID)
	if !exists {
		return conn.Send(wsmanager.Response{
			Status:    "error",
			Error:     "collection not found",
			RequestID: req.RequestID,
		})
	}
	
	// Calcula progresso atual (acessos thread-safe via métodos do job)
	progress := &collection.CollectionProgress{
		TotalObras:        job.TotalObras,
		CompletedObras:    job.CompletedObras,
		TotalChapters:     job.TotalChapters,
		CompletedChapters: job.CompletedChapters,
		TotalFiles:        job.TotalFiles,
		UploadedFiles:     job.UploadedFiles,
		FailedFiles:       job.FailedFiles,
		CurrentSpeed:      job.CurrentSpeed,
		AverageSpeed:      job.AverageSpeed,
	}
	
	if job.TotalFiles > 0 {
		progress.Percentage = float64(job.UploadedFiles) / float64(job.TotalFiles) * 100
	}
	
	if job.ETA != nil {
		progress.ETA = job.ETA.String()
	}
	
	response := wsmanager.Response{
		Status:    "collection_status",
		RequestID: req.RequestID,
		Data: map[string]interface{}{
			"collection":   job.Name,
			"collectionId": job.ID,
			"status":       job.Status,
			"progress":     progress,
			"startTime":    job.StartTime,
			"lastFile":     job.LastProcessedFile,
		},
	}
	
	return conn.Send(response)
}

// handleCancelCollection cancela uma coleção
func (s *HighPerformanceServer) handleCancelCollection(conn *wsmanager.Connection, msg wsmanager.Message) error {
	var req WebSocketRequest
	reqData, _ := json.Marshal(msg.Data)
	if err := json.Unmarshal(reqData, &req); err != nil {
		return fmt.Errorf("invalid cancel collection request: %v", err)
	}
	
	if req.CollectionID == "" {
		return conn.Send(wsmanager.Response{
			Status:    "error",
			Error:     "collectionId is required",
			RequestID: req.RequestID,
		})
	}
	
	err := s.collectionProcessor.CancelJob(req.CollectionID)
	status := "collection_cancelled"
	errorMsg := ""
	
	if err != nil {
		status = "error"
		errorMsg = err.Error()
	}
	
	response := wsmanager.Response{
		Status:    status,
		RequestID: req.RequestID,
		Error:     errorMsg,
		Data: map[string]interface{}{
			"collectionId": req.CollectionID,
			"timestamp":    time.Now(),
		},
	}
	
	return conn.Send(response)
}

// handlePauseCollection pausa uma coleção (placeholder para futura implementação)
func (s *HighPerformanceServer) handlePauseCollection(conn *wsmanager.Connection, msg wsmanager.Message) error {
	var req WebSocketRequest
	reqData, _ := json.Marshal(msg.Data)
	if err := json.Unmarshal(reqData, &req); err != nil {
		return fmt.Errorf("invalid pause collection request: %v", err)
	}
	
	// TODO: Implementar pause functionality no collection processor
	response := wsmanager.Response{
		Status:    "error",
		Error:     "pause functionality not yet implemented",
		RequestID: req.RequestID,
	}
	
	return conn.Send(response)
}

// handleResumeCollection retoma uma coleção (placeholder para futura implementação)
func (s *HighPerformanceServer) handleResumeCollection(conn *wsmanager.Connection, msg wsmanager.Message) error {
	var req WebSocketRequest
	reqData, _ := json.Marshal(msg.Data)
	if err := json.Unmarshal(reqData, &req); err != nil {
		return fmt.Errorf("invalid resume collection request: %v", err)
	}
	
	// TODO: Implementar resume functionality no collection processor
	response := wsmanager.Response{
		Status:    "error",
		Error:     "resume functionality not yet implemented",
		RequestID: req.RequestID,
	}
	
	return conn.Send(response)
}

// handleGetWorkerStats retorna estatísticas do worker pool
func (s *HighPerformanceServer) handleGetWorkerStats(conn *wsmanager.Connection, msg wsmanager.Message) error {
	workerStats := s.workerPool.GetStats()
	collectionStats := s.collectionProcessor.GetMetrics()
	
	response := wsmanager.Response{
		Status:    "worker_stats",
		RequestID: msg.RequestID,
		Data: map[string]interface{}{
			"workerPool":          workerStats,
			"collectionProcessor": collectionStats,
			"server": map[string]interface{}{
				"uptime":      time.Since(startTime).String(),
				"connections": s.wsManager.GetConnectionCount(),
			},
		},
	}
	
	return conn.Send(response)
}

// handleSearchAniList handles AniList search requests
func (s *HighPerformanceServer) handleSearchAniList(conn *wsmanager.Connection, msg wsmanager.Message) error {
	var req WebSocketRequest
	reqData, _ := json.Marshal(msg.Data)
	if err := json.Unmarshal(reqData, &req); err != nil {
		return fmt.Errorf("invalid search request: %v", err)
	}

	// DEBUG: Log da query recebida
	log.Printf("🔍 DEBUG SEARCH - Query recebida: '%s' (len: %d bytes)", req.SearchQuery, len(req.SearchQuery))
	log.Printf("🔍 DEBUG SEARCH - Query em hex: % x", []byte(req.SearchQuery))
	
	if req.SearchQuery == "" {
		response := wsmanager.Response{
			Status:    "error",
			Error:     "Search query is required",
			RequestID: req.RequestID,
		}
		return conn.Send(response)
	}
	
	go func() {
		startTime := time.Now()
		
		// Send progress update
		progressResponse := wsmanager.Response{
			Status:    "search_progress",
			RequestID: req.RequestID,
			Progress: &wsmanager.Progress{
				Current:    0,
				Total:      1,
				Percentage: 0,
				Stage:      "searching_anilist",
			},
		}
		safeSend(conn, progressResponse)
		
		// Perform AniList search with retry and error handling
		// Criar contexto com timeout para evitar busca infinita
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second) // 60 segundos de timeout
		defer cancel()
		
		results, err := s.anilistService.SearchMangaWithRetry(ctx, req.SearchQuery, 1, 10)
		
		duration := time.Since(startTime)
		log.Printf("AniList search completed in %v for query: %s", duration, req.SearchQuery)
		
		if err != nil {
			// Verificar se é um erro amigável (FriendlyError)
			var friendlyErr *anilist.FriendlyError
			var errorMessage string
			var errorData map[string]interface{}

			if errors.As(err, &friendlyErr) {
				// Erro amigável - usar mensagem personalizada
				errorMessage = friendlyErr.UserMessage
				errorData = map[string]interface{}{
					"error_code":        friendlyErr.ErrorCode,
					"severity":          string(friendlyErr.Severity),
					"suggestions":       friendlyErr.Suggestions,
					"user_message":      friendlyErr.UserMessage,
					"technical_message": friendlyErr.TechnicalMessage,
				}

				if friendlyErr.RetryAfter != nil {
					errorData["retry_after_seconds"] = int(friendlyErr.RetryAfter.Seconds())
				}
			} else {
				// Erro técnico - usar mensagem genérica
				errorMessage = "Erro inesperado ao buscar na AniList. Tente novamente ou use a entrada manual."
				errorData = map[string]interface{}{
					"error_code":     "UNEXPECTED_ERROR",
					"severity":       "error",
					"user_message":   errorMessage,
					"suggestions":    []string{"Tente novamente em alguns instantes", "Use a entrada manual de metadados"},
				}
			}

			response := wsmanager.Response{
				Status:    "anilist_error",
				Error:     errorMessage,
				RequestID: req.RequestID,
				Data:      errorData,
			}
			safeSend(conn, response)
			return
		}
		
		// Send successful response
		response := wsmanager.Response{
			Status:    "search_anilist_complete",
			RequestID: req.RequestID,
			Data: map[string]interface{}{
				"results":     results.Results,
				"resultCount": len(results.Results),
				"searchQuery": req.SearchQuery,
				"duration":    duration.String(),
				"total":       results.Total,
				"hasNextPage": results.HasNextPage,
			},
		}
		safeSend(conn, response)
	}()
	
	return nil
}

// handleSelectAniListResult handles selection of an AniList result and metadata integration
func (s *HighPerformanceServer) handleSelectAniListResult(conn *wsmanager.Connection, msg wsmanager.Message) error {
	var req WebSocketRequest
	reqData, _ := json.Marshal(msg.Data)
	if err := json.Unmarshal(reqData, &req); err != nil {
		return fmt.Errorf("invalid selection request: %v", err)
	}
	
	if req.AniListID == 0 {
		response := wsmanager.Response{
			Status:    "error",
			Error:     "AniList ID is required",
			RequestID: req.RequestID,
		}
		return conn.Send(response)
	}
	
	go func() {
		startTime := time.Now()
		
		// Send progress update
		progressResponse := wsmanager.Response{
			Status:    "anilist_fetch_progress",
			RequestID: req.RequestID,
			Progress: &wsmanager.Progress{
				Current:    0,
				Total:      2,
				Percentage: 0,
				Stage:      "fetching_details",
			},
		}
		safeSend(conn, progressResponse)
		
		// Fetch detailed information from AniList with retry and error handling
		details, err := s.anilistService.GetMangaDetailsWithRetry(context.Background(), req.AniListID)
		if err != nil {
			// Verificar se é um erro amigável (FriendlyError)
			var friendlyErr *anilist.FriendlyError
			var errorMessage string
			var errorData map[string]interface{}

			if errors.As(err, &friendlyErr) {
				// Erro amigável - usar mensagem personalizada
				errorMessage = friendlyErr.UserMessage
				errorData = map[string]interface{}{
					"error_code":        friendlyErr.ErrorCode,
					"severity":          string(friendlyErr.Severity),
					"suggestions":       friendlyErr.Suggestions,
					"user_message":      friendlyErr.UserMessage,
					"technical_message": friendlyErr.TechnicalMessage,
				}

				if friendlyErr.RetryAfter != nil {
					errorData["retry_after_seconds"] = int(friendlyErr.RetryAfter.Seconds())
				}
			} else {
				// Erro técnico - usar mensagem genérica
				errorMessage = "Erro inesperado ao obter detalhes da AniList. Tente novamente ou use a entrada manual."
				errorData = map[string]interface{}{
					"error_code":     "UNEXPECTED_ERROR",
					"severity":       "error",
					"user_message":   errorMessage,
					"suggestions":    []string{"Tente novamente em alguns instantes", "Use a entrada manual de metadados"},
				}
			}

			response := wsmanager.Response{
				Status:    "anilist_error",
				Error:     errorMessage,
				RequestID: req.RequestID,
				Data:      errorData,
			}
			safeSend(conn, response)
			return
		}
		
		// Update progress
		progressResponse.Progress.Current = 1
		progressResponse.Progress.Percentage = 50
		progressResponse.Progress.Stage = "processing_metadata"
		safeSend(conn, progressResponse)
		
		// Convert to metadata format (using the mapping function from anilist service)
		metadata := anilist.MapAniListToMangaMetadata(details.Media)
		
		duration := time.Since(startTime)
		log.Printf("AniList details fetched and processed in %v for ID: %d", duration, req.AniListID)
		
		// Send successful response with integrated metadata
		response := wsmanager.Response{
			Status:    "anilist_selection_complete",
			RequestID: req.RequestID,
			Data: map[string]interface{}{
				"anilistData": details,
				"metadata":    metadata,
				"mangaTitle":  req.MangaTitle,
				"duration":    duration.String(),
			},
			Metadata: metadata,
		}
		safeSend(conn, response)
	}()
	
	return nil
}

// setupHTTPServer configures the HTTP server with optimizations
func (s *HighPerformanceServer) setupHTTPServer() {
	mux := http.NewServeMux()
	
	// WebSocket endpoint with connection management
	mux.HandleFunc("/ws", s.handleWebSocket)
	
	// Metrics endpoint (optional HTTP endpoint for monitoring)
	if s.config.EnableMetrics {
		mux.HandleFunc("/metrics", s.handleHTTPMetrics)
		mux.HandleFunc("/health", s.handleHealthCheck)
	}
	
	// AniList metrics endpoint for performance monitoring
	mux.HandleFunc("/api/anilist/metrics", s.handleAniListMetrics)
	
	// AniList health status endpoint
	mux.HandleFunc("/api/anilist/health", s.handleAniListHealth)
	
	s.httpServer = &http.Server{
		Addr:         s.config.Port,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
}

// handleWebSocket handles WebSocket connections with enhanced management
func (s *HighPerformanceServer) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	
	// Generate unique connection ID
	connectionID := fmt.Sprintf("conn_%d_%s", time.Now().UnixNano(), r.RemoteAddr)
	
	// Create managed connection
	managedConn := s.wsManager.NewConnection(conn, connectionID)
	
	// Record connection metrics
	s.monitor.RecordWebSocketConnection(true)
	
	log.Printf("New WebSocket connection: %s", connectionID)
	
	// Connection will be automatically cleaned up by the manager
	_ = managedConn // Suppress unused variable warning
}

// handleHTTPMetrics serves metrics over HTTP for monitoring tools
func (s *HighPerformanceServer) handleHTTPMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	metrics := s.monitor.CreateSnapshot()
	if err := json.NewEncoder(w).Encode(metrics); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

// handleHealthCheck provides a health check endpoint
func (s *HighPerformanceServer) handleHealthCheck(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	health := map[string]interface{}{
		"status":      "healthy",
		"timestamp":   time.Now(),
		"uptime":      time.Since(startTime).String(),
		"connections": s.wsManager.GetConnectionCount(),
		"version":     "2.0.0",
	}
	
	json.NewEncoder(w).Encode(health)
}

// Start starts the high-performance server
func (s *HighPerformanceServer) Start() error {
	log.Printf("Starting High-Performance Manga Upload Server...")
	log.Printf("Configuration: %+v", s.config)
	
	// Start worker pool
	if err := s.workerPool.Start(); err != nil {
		return fmt.Errorf("failed to start worker pool: %v", err)
	}
	
	// Start collection processor
	if err := s.collectionProcessor.Start(); err != nil {
		return fmt.Errorf("failed to start collection processor: %v", err)
	}
	
	// Start metrics logging
	if s.config.EnableMetrics {
		s.wg.Add(1)
		go s.metricsLogger()
	}
	
	log.Printf("Server starting on %s", s.config.Port)
	log.Printf("Max workers: %d, Max connections: %d", s.config.MaxWorkers, s.config.MaxConnections)
	log.Printf("Discovery workers: %d", s.config.DiscoveryWorkers)
	
	return s.httpServer.ListenAndServe()
}

// metricsLogger periodically logs metrics
func (s *HighPerformanceServer) metricsLogger() {
	defer s.wg.Done()
	
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case <-ticker.C:
			s.monitor.LogMetrics()
		case <-s.ctx.Done():
			return
		}
	}
}

// GracefulShutdown gracefully shuts down the server
func (s *HighPerformanceServer) GracefulShutdown() {
	log.Println("Initiating graceful shutdown...")
	
	// Cancel context to stop all goroutines
	s.cancel()
	
	// Shutdown HTTP server
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	
	if err := s.httpServer.Shutdown(ctx); err != nil {
		log.Printf("HTTP server shutdown error: %v", err)
	}
	
	// Close components in proper order
	log.Println("Stopping collection processor...")
	if err := s.collectionProcessor.Stop(); err != nil {
		log.Printf("Collection processor shutdown error: %v", err)
	}
	
	log.Println("Stopping worker pool...")
	if err := s.workerPool.Stop(); err != nil {
		log.Printf("Worker pool shutdown error: %v", err)
	}
	
	log.Println("Closing remaining components...")
	s.batchUploader.Close()
	s.discoverer.Close()
	s.wsManager.Close()
	s.monitor.Close()
	
	// Wait for all goroutines to finish
	s.wg.Wait()
	
	log.Println("Graceful shutdown completed")
}


// Default configuration
func getDefaultConfig() *ServerConfig {
	// Try to read from environment variables
	maxWorkers := DEFAULT_MAX_WORKERS
	if env := os.Getenv("MAX_WORKERS"); env != "" {
		if val, err := strconv.Atoi(env); err == nil {
			maxWorkers = val
		}
	}
	
	maxConnections := DEFAULT_MAX_CONNECTIONS
	if env := os.Getenv("MAX_CONNECTIONS"); env != "" {
		if val, err := strconv.Atoi(env); err == nil {
			maxConnections = val
		}
	}
	
	port := SERVER_PORT
	if env := os.Getenv("PORT"); env != "" {
		if !strings.HasPrefix(env, ":") {
			env = ":" + env
		}
		port = env
	}
	
	return &ServerConfig{
		MaxWorkers:       maxWorkers,
		MaxConnections:   maxConnections,
		DiscoveryWorkers: DISCOVERY_WORKERS,
		Port:             port,
		LibraryRoot:      LIBRARY_ROOT,
		MetadataOutput:   "json", // Default directory for JSON files
		EnableMetrics:    true,
		LogLevel:         "INFO",
	}
}

// Global start time for uptime calculation
var startTime = time.Now()

// main function with graceful shutdown
func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	
	// Load configuration
	config := getDefaultConfig()
	
	// Create and configure server
	server := NewHighPerformanceServer(config)
	
	// Setup graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	
	// Start server in goroutine
	serverErr := make(chan error, 1)
	go func() {
		serverErr <- server.Start()
	}()
	
	// Wait for shutdown signal or server error
	select {
	case sig := <-sigChan:
		log.Printf("Received signal: %v", sig)
		server.GracefulShutdown()
	case err := <-serverErr:
		if err != nil && err != http.ErrServerClosed {
			log.Printf("Server error: %v", err)
		}
	}
}

// Utility functions
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// sanitizeFilename cleans a string for use as a filename with consistent behavior
func sanitizeFilename(input string) string {
	log.Printf("🧹 SANITIZE DEBUG: input='%s' bytes=%v", input, []byte(input))
	
	// Replace specific accented characters with their unaccented equivalents
	replacements := map[string]string{
		"ç": "c", "Ç": "C",
		"ã": "a", "Ã": "A",
		"à": "a", "À": "A",
		"á": "a", "Á": "A",
		"â": "a", "Â": "A",
		"ä": "a", "Ä": "A",
		"é": "e", "É": "E",
		"è": "e", "È": "E",
		"ê": "e", "Ê": "E",
		"ë": "e", "Ë": "E",
		"í": "i", "Í": "I",
		"ì": "i", "Ì": "I",
		"î": "i", "Î": "I",
		"ï": "i", "Ï": "I",
		"ó": "o", "Ó": "O",
		"ò": "o", "Ò": "O",
		"ô": "o", "Ô": "O",
		"õ": "o", "Õ": "O",
		"ö": "o", "Ö": "O",
		"ú": "u", "Ú": "U",
		"ù": "u", "Ù": "U",
		"û": "u", "Û": "U",
		"ü": "u", "Ü": "U",
		"ñ": "n", "Ñ": "N",
	}
	
	sanitized := input
	for accented, unaccented := range replacements {
		sanitized = strings.ReplaceAll(sanitized, accented, unaccented)
	}
	log.Printf("🧹 SANITIZE DEBUG: accents_replaced='%s'", sanitized)
	
	// Replace spaces with underscores
	sanitized = strings.ReplaceAll(sanitized, " ", "_")
	log.Printf("🧹 SANITIZE DEBUG: spaces_to_underscores='%s'", sanitized)
	
	// Only remove truly problematic filename characters: / \ : * ? " < > |
	problematicChars := []string{"/", "\\", ":", "*", "?", "\"", "<", ">", "|"}
	for _, char := range problematicChars {
		sanitized = strings.ReplaceAll(sanitized, char, "_")
	}
	log.Printf("🧹 SANITIZE DEBUG: removed_problematic='%s'", sanitized)
	
	// Remove multiple consecutive underscores
	multipleUnderscores := regexp.MustCompile(`_{2,}`)
	sanitized = multipleUnderscores.ReplaceAllString(sanitized, "_")
	
	// Trim underscores from beginning and end
	sanitized = strings.Trim(sanitized, "_")
	
	log.Printf("🧹 SANITIZE DEBUG: final='%s'", sanitized)
	return sanitized
}

// handleAniListMetrics provides performance metrics for the AniList integration
func (s *HighPerformanceServer) handleAniListMetrics(w http.ResponseWriter, r *http.Request) {
	if s.anilistService == nil {
		http.Error(w, "AniList service not initialized", http.StatusServiceUnavailable)
		return
	}
	
	// Get metrics from AniList service
	metrics := s.anilistService.GetPerformanceMetrics()
	
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	
	if err := json.NewEncoder(w).Encode(metrics); err != nil {
		log.Printf("Error encoding AniList metrics: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
}

// handleAniListHealth provides health status for the AniList integration
func (s *HighPerformanceServer) handleAniListHealth(w http.ResponseWriter, r *http.Request) {
	if s.anilistService == nil {
		http.Error(w, "AniList service not initialized", http.StatusServiceUnavailable)
		return
	}
	
	// Get health status from AniList service
	status := s.anilistService.GetServiceStatus()
	
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	
	// Set HTTP status code based on health
	if healthy, ok := status["healthy"].(bool); ok && !healthy {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	
	if err := json.NewEncoder(w).Encode(status); err != nil {
		log.Printf("Error encoding AniList health status: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
}

// =============================================
//         ANILIST CONFIGURATION HANDLERS
// =============================================

// handleGetAniListConfig retorna as configurações atuais da AniList
func (s *HighPerformanceServer) handleGetAniListConfig(conn *wsmanager.Connection, msg wsmanager.Message) error {
	log.Printf("🔧 handleGetAniListConfig: ===== HANDLER CHAMADO =====")
	log.Printf("🔧 handleGetAniListConfig: Requisição recebida - RequestID: %s", msg.RequestID)
	log.Printf("🔧 handleGetAniListConfig: Message Data: %+v", msg.Data)
	log.Printf("🔧 handleGetAniListConfig: Message Action: %s", msg.Action)
	
	if s.anilistService == nil {
		log.Printf("❌ handleGetAniListConfig: anilistService é nil")
		response := wsmanager.Response{
			Status:    "error",
			Error:     "AniList service not initialized",
			RequestID: msg.RequestID,
		}
		return conn.Send(response)
	}
	
	config := s.anilistService.GetConfig()
	log.Printf("✅ handleGetAniListConfig: Configuração obtida: %+v", config)
	
	response := wsmanager.Response{
		Status:    "config_retrieved",
		Data:      config,
		RequestID: msg.RequestID,
	}
	
	log.Printf("📤 handleGetAniListConfig: Enviando resposta - Status: %s", response.Status)
	return conn.Send(response)
}

// handleUpdateAniListConfig atualiza as configurações da AniList
func (s *HighPerformanceServer) handleUpdateAniListConfig(conn *wsmanager.Connection, msg wsmanager.Message) error {
	log.Printf("🔧 handleUpdateAniListConfig: ===== HANDLER CHAMADO =====")
	log.Printf("🔧 handleUpdateAniListConfig: Requisição recebida - RequestID: %s", msg.RequestID)
	
	// Verificar se o AniListService está disponível
	if s.anilistService == nil {
		log.Printf("❌ handleUpdateAniListConfig: anilistService é nil")
		return conn.Send(wsmanager.Response{
			Status:    "error",
			Error:     "AniList service not initialized",
			RequestID: msg.RequestID,
		})
	}
	
	// Extrair configuração dos dados da mensagem de forma mais simples
	data, ok := msg.Data.(map[string]interface{})
	if !ok {
		return conn.Send(wsmanager.Response{
			Status:    "error",
			Error:     "Invalid request data format",
			RequestID: msg.RequestID,
		})
	}
	
	configData, ok := data["config"].(map[string]interface{})
	if !ok {
		return conn.Send(wsmanager.Response{
			Status:    "error",
			Error:     "Missing or invalid config data",
			RequestID: msg.RequestID,
		})
	}
	
	// Obter configuração atual e aplicar atualizações
	currentConfig := s.anilistService.GetConfig()
	if currentConfig == nil {
		return conn.Send(wsmanager.Response{
			Status:    "error",
			Error:     "Failed to get current config",
			RequestID: msg.RequestID,
		})
	}
	
	// Aplicar atualizações campo por campo de forma segura
	if enabled, ok := configData["enabled"].(bool); ok {
		currentConfig.Enabled = enabled
	}
	if langPref, ok := configData["language_preference"].(string); ok {
		currentConfig.LanguagePreference = anilist.LanguagePreference(langPref)
	}
	if fillMode, ok := configData["fill_mode"].(string); ok {
		currentConfig.FillMode = anilist.FillMode(fillMode)
	}
	if autoSearch, ok := configData["auto_search"].(bool); ok {
		currentConfig.AutoSearch = autoSearch
	}
	if cacheEnabled, ok := configData["cache_enabled"].(bool); ok {
		currentConfig.CacheEnabled = cacheEnabled
	}
	if preferAniList, ok := configData["prefer_anilist"].(bool); ok {
		currentConfig.PreferAniList = preferAniList
	}
	
	// Atualizar configuração
	if err := s.anilistService.UpdateConfig(currentConfig); err != nil {
		log.Printf("❌ handleUpdateAniListConfig: Erro ao atualizar: %v", err)
		return conn.Send(wsmanager.Response{
			Status:    "error",
			Error:     "Failed to update config: " + err.Error(),
			RequestID: msg.RequestID,
		})
	}
	
	// Retornar configuração atualizada
	updatedConfig := s.anilistService.GetConfig()
	log.Printf("✅ handleUpdateAniListConfig: Configuração atualizada com sucesso")
	
	return conn.Send(wsmanager.Response{
		Status:    "config_updated",
		Data:      updatedConfig,
		RequestID: msg.RequestID,
	})
}

// handleResetAniListConfig restaura as configurações padrão
func (s *HighPerformanceServer) handleResetAniListConfig(conn *wsmanager.Connection, msg wsmanager.Message) error {
	if err := s.anilistService.ResetConfig(); err != nil {
		return conn.Send(wsmanager.Response{
			Status:    "error",
			Error:     "Failed to reset config: " + err.Error(),
			RequestID: msg.RequestID,
		})
	}
	
	// Retornar configuração resetada
	resetConfig := s.anilistService.GetConfig()
	return conn.Send(wsmanager.Response{
		Status:    "config_reset",
		Data:      resetConfig,
		RequestID: msg.RequestID,
	})
}

// =============================================
//         GITHUB INTEGRATION HANDLERS
// =============================================

// handleGitHubFolders lists folders in a GitHub repository
func (s *HighPerformanceServer) handleGitHubFolders(conn *wsmanager.Connection, msg wsmanager.Message) error {
	// Log received data for debugging
	log.Printf("🔍 GitHub folders request: %+v", msg.Data)

	// Extract data directly from msg.Data map
	data, ok := msg.Data.(map[string]interface{})
	if !ok {
		return conn.Send(wsmanager.Response{
			Status:    "error",
			Error:     "Invalid GitHub folders request format",
			RequestID: msg.RequestID,
		})
	}

	token, _ := data["token"].(string)
	repo, _ := data["repo"].(string)
	branch, _ := data["branch"].(string)
	maxDepth := 3 // Default depth for recursion
	
	// Check if depth parameter was provided
	if d, ok := data["maxDepth"].(float64); ok {
		maxDepth = int(d)
	}

	if token == "" || repo == "" {
		return conn.Send(wsmanager.Response{
			Status:    "error", 
			Error:     "GitHub token and repository are required",
			RequestID: msg.RequestID,
		})
	}

	if branch == "" {
		branch = "main"
	}

	go func() {
		log.Printf("Starting GitHub folders listing for repo: %s", repo)
		
		// Send progress update
		progressResponse := wsmanager.Response{
			Status:    "github_folders_progress",
			RequestID: msg.RequestID,
			Progress: &wsmanager.Progress{
				Current:    0,
				Total:      1,
				Percentage: 0,
				Stage:      "listing_folders",
			},
		}
		safeSend(conn, progressResponse)

		// List folders using GitHub service (recursively)
		folders, err := s.githubService.ListFoldersRecursively(token, repo, branch, maxDepth)
		if err != nil {
			log.Printf("GitHub folders error: %v", err)
			response := wsmanager.Response{
				Status:    "github_error",
				Error:     fmt.Sprintf("Failed to list GitHub folders: %v", err),
				RequestID: msg.RequestID,
				Data: map[string]interface{}{
					"error_type": "folders_list_failed",
					"repo":       repo,
					"branch":     branch,
				},
			}
			safeSend(conn, response)
			return
		}

		log.Printf("Successfully listed %d folders from GitHub repo %s", len(folders), repo)

		// Send success response
		response := wsmanager.Response{
			Status:    "github_folders_complete", 
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"folders":     folders,
				"folderCount": len(folders),
				"repo":        repo,
				"branch":      branch,
			},
		}
		log.Printf("📤 Sending GitHub folders response: %+v", response)
		safeSend(conn, response)
	}()

	return nil
}

// handleGitHubUpload uploads JSON files to GitHub repository
func (s *HighPerformanceServer) handleGitHubUpload(conn *wsmanager.Connection, msg wsmanager.Message) error {
	// Log received data for debugging
	log.Printf("🔍 GitHub upload request: %+v", msg.Data)

	// Extract data directly from msg.Data map
	data, ok := msg.Data.(map[string]interface{})
	if !ok {
		return conn.Send(wsmanager.Response{
			Status:    "error",
			Error:     "Invalid GitHub upload request format",
			RequestID: msg.RequestID,
		})
	}

	// Extract GitHub settings - support both direct fields and githubSettings object
	var token, repo, branch, folder, updateMode string
	var selectedWorks []string

	// Try direct fields first
	token, _ = data["token"].(string)
	repo, _ = data["repo"].(string)
	branch, _ = data["branch"].(string)
	folder, _ = data["folder"].(string)
	updateMode, _ = data["updateMode"].(string)

	// If direct fields not found, try githubSettings
	if token == "" {
		if githubSettings, ok := data["githubSettings"].(map[string]interface{}); ok {
			if t, ok := githubSettings["token"].(string); ok {
				token = t
			}
			if r, ok := githubSettings["repo"].(string); ok {
				repo = r
			}
			if b, ok := githubSettings["branch"].(string); ok {
				branch = b
			}
			if f, ok := githubSettings["folder"].(string); ok {
				folder = f
			}
			if u, ok := githubSettings["updateMode"].(string); ok {
				updateMode = u
			}
		}
	}

	// Get selected works from request
	if works, exists := data["selectedWorks"]; exists {
		if worksList, ok := works.([]interface{}); ok {
			for _, work := range worksList {
				if workStr, ok := work.(string); ok {
					selectedWorks = append(selectedWorks, workStr)
				}
			}
		}
	}

	log.Printf("🔍 Parsed GitHub settings - Token: %s, Repo: %s, Branch: %s, Folder: %s, Works: %d", 
		token[:10]+"...", repo, branch, folder, len(selectedWorks))

	if token == "" || repo == "" {
		return conn.Send(wsmanager.Response{
			Status:    "error",
			Error:     "GitHub token and repository are required",
			RequestID: msg.RequestID,
		})
	}

	if len(selectedWorks) == 0 {
		return conn.Send(wsmanager.Response{
			Status:    "error", 
			Error:     "No works selected for GitHub upload",
			RequestID: msg.RequestID,
		})
	}

	if branch == "" {
		branch = "main"
	}

	if updateMode == "" {
		updateMode = "smart"
	}

	go func() {
		log.Printf("Starting GitHub upload for %d JSON files to repo: %s", len(selectedWorks), repo)

		// Send progress update
		progressResponse := wsmanager.Response{
			Status:    "github_upload_progress",
			RequestID: msg.RequestID,
			Progress: &wsmanager.Progress{
				Current:    0,
				Total:      len(selectedWorks),
				Percentage: 0,
				Stage:      "preparing_upload",
			},
		}
		safeSend(conn, progressResponse)

		// Collect JSON files to upload
		jsonFiles := make(map[string]string)
		jsonOutputDir := s.config.MetadataOutput
		if jsonOutputDir == "" {
			jsonOutputDir = "json"
		}

		for i, work := range selectedWorks {
			// Progress update
			progressResponse.Progress.Current = i
			progressResponse.Progress.Percentage = int((float64(i) / float64(len(selectedWorks))) * 100)
			progressResponse.Progress.Stage = fmt.Sprintf("reading_json_%d", i+1)
			safeSend(conn, progressResponse)

			// Sanitize work name for filename
			sanitizedWorkName := sanitizeFilename(work)
			jsonFileName := fmt.Sprintf("%s.json", sanitizedWorkName)
			jsonFilePath := filepath.Join(jsonOutputDir, jsonFileName)

			// Read JSON file
			jsonContent, err := os.ReadFile(jsonFilePath)
			if err != nil {
				log.Printf("⚠️ Failed to read JSON file %s: %v", jsonFilePath, err)
				// Continue with other files instead of failing completely
				continue
			}

			jsonFiles[jsonFileName] = string(jsonContent)
			log.Printf("✅ Added JSON file: %s (%d bytes)", jsonFileName, len(jsonContent))
		}

		if len(jsonFiles) == 0 {
			response := wsmanager.Response{
				Status:    "github_error",
				Error:     "No JSON files found to upload",
				RequestID: msg.RequestID,
			}
			safeSend(conn, response)
			return
		}

		log.Printf("📦 Prepared %d JSON files for GitHub upload", len(jsonFiles))

		// Upload to GitHub
		progressResponse.Progress.Stage = "uploading_to_github"
		progressResponse.Progress.Percentage = 90
		safeSend(conn, progressResponse)

		commitResponse, err := s.githubService.UploadJSONFiles(token, repo, branch, folder, jsonFiles)
		if err != nil {
			log.Printf("GitHub upload error: %v", err)
			response := wsmanager.Response{
				Status:    "github_error",
				Error:     fmt.Sprintf("Failed to upload to GitHub: %v", err),
				RequestID: msg.RequestID,
				Data: map[string]interface{}{
					"error_type":    "upload_failed",
					"repo":          repo,
					"branch":        branch,
					"folder":        folder,
					"files_count":   len(jsonFiles),
				},
			}
			safeSend(conn, response)
			return
		}

		log.Printf("✅ Successfully uploaded %d JSON files to GitHub repo %s", len(jsonFiles), repo)

		// Send success response
		response := wsmanager.Response{
			Status:    "github_upload_complete",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"commit":        commitResponse,
				"uploadedCount": len(jsonFiles),
				"repo":          repo,
				"branch":        branch,
				"folder":        folder,
				"updateMode":    updateMode,
				"uploadedFiles": jsonFiles,
			},
		}
		safeSend(conn, response)
	}()

	return nil
}
package upload

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"go-upload/backend/internal/ratelimiter"
	"go-upload/backend/internal/websocket"
)

// UploadRequest representa uma solicitação de upload
type UploadRequest struct {
	ID          string `json:"id"`
	Host        string `json:"host"`
	Manga       string `json:"manga"`
	Chapter     string `json:"chapter"`
	FileName    string `json:"fileName"`
	FileContent string `json:"fileContent"`
	FilePath    string `json:"filePath,omitempty"` // Para streaming de arquivos grandes
	Priority    int    `json:"priority,omitempty"` // 0 = normal, 1 = high, 2 = urgent
}

// UploadResult representa o resultado de um upload
type UploadResult struct {
	ID       string    `json:"id"`
	FileName string    `json:"fileName"`
	URL      string    `json:"url"`
	Error    error     `json:"error,omitempty"`
	Duration time.Duration `json:"duration"`
}

// BatchUploadRequest representa uma solicitação de upload em lote
type BatchUploadRequest struct {
	ID        string          `json:"id"`
	Uploads   []UploadRequest `json:"uploads"`
	Priority  int             `json:"priority,omitempty"`
	Options   BatchOptions    `json:"options,omitempty"`
}

// BatchOptions configura opções para uploads em lote
type BatchOptions struct {
	MaxConcurrency    int           `json:"maxConcurrency,omitempty"`
	RetryAttempts     int           `json:"retryAttempts,omitempty"`
	RetryDelay        time.Duration `json:"retryDelay,omitempty"`
	ProgressInterval  time.Duration `json:"progressInterval,omitempty"`
	SkipExisting      bool          `json:"skipExisting,omitempty"`
	EnableCompression bool          `json:"enableCompression,omitempty"`
}

// BatchProgress representa o progresso de um lote
type BatchProgress struct {
	BatchID      string    `json:"batchId"`
	Completed    int64     `json:"completed"`
	Total        int64     `json:"total"`
	Failed       int64     `json:"failed"`
	Skipped      int64     `json:"skipped"`
	CurrentFile  string    `json:"currentFile"`
	StartTime    time.Time `json:"startTime"`
	EstimatedETA time.Time `json:"estimatedEta"`
	BytesUploaded int64    `json:"bytesUploaded"`
	TotalBytes    int64     `json:"totalBytes"`
}

// UploaderInterface define a interface para uploaders
type UploaderInterface interface {
	Upload(filePath string) (string, error)
	GetName() string
	GetRateLimit() (int, time.Duration) // tokens per interval
}

// ResultCallback é chamado quando um upload completa
type ResultCallback func(batchID string, result UploadResult)

// BatchUploader gerencia uploads em lote com alta concorrência
type BatchUploader struct {
	uploaders      map[string]UploaderInterface
	rateLimiters   map[string]*ratelimiter.RateLimiter
	wsManager      *websocket.Manager
	maxWorkers     int
	workerPool     chan struct{}
	pendingJobs    chan *uploadJob
	results        chan UploadResult
	batches        map[string]*batchState
	batchesMu      sync.RWMutex
	ctx            context.Context
	cancel         context.CancelFunc
	wg             sync.WaitGroup
	
	// Callback for upload results
	resultCallback ResultCallback
}

// batchState mantém o estado de um lote de uploads
type batchState struct {
	request   BatchUploadRequest
	progress  *BatchProgress
	results   []UploadResult
	startTime time.Time
	mu        sync.RWMutex
	ctx       context.Context
	cancel    context.CancelFunc
}

// uploadJob representa um trabalho de upload individual
type uploadJob struct {
	request     UploadRequest
	batchID     string
	attempt     int
	maxAttempts int
	retryDelay  time.Duration
	resultChan  chan<- UploadResult
}

// NewBatchUploader cria um novo uploader em lote
func NewBatchUploader(wsManager *websocket.Manager, maxWorkers int) *BatchUploader {
	if maxWorkers <= 0 {
		maxWorkers = 50 // Default para alta concorrência
	}
	
	ctx, cancel := context.WithCancel(context.Background())
	
	bu := &BatchUploader{
		uploaders:    make(map[string]UploaderInterface),
		rateLimiters: make(map[string]*ratelimiter.RateLimiter),
		wsManager:    wsManager,
		maxWorkers:   maxWorkers,
		workerPool:   make(chan struct{}, maxWorkers),
		pendingJobs:  make(chan *uploadJob, maxWorkers*10),
		results:      make(chan UploadResult, maxWorkers*5),
		batches:      make(map[string]*batchState),
		ctx:          ctx,
		cancel:       cancel,
	}
	
	// Inicializar workers
	for i := 0; i < maxWorkers; i++ {
		bu.wg.Add(1)
		go bu.worker()
	}
	
	// Inicializar processador de resultados
	bu.wg.Add(1)
	go bu.resultProcessor()
	
	return bu
}

// RegisterUploader registra um uploader para um host específico
func (bu *BatchUploader) RegisterUploader(host string, uploader UploaderInterface) {
	bu.uploaders[host] = uploader
	
	// Criar rate limiter baseado nas limitações do uploader
	tokens, interval := uploader.GetRateLimit()
	bu.rateLimiters[host] = ratelimiter.NewRateLimiter(tokens, interval)
}

// SetResultCallback registra um callback para resultados de upload
func (bu *BatchUploader) SetResultCallback(callback ResultCallback) {
	bu.resultCallback = callback
}

// StartBatch inicia um lote de uploads
func (bu *BatchUploader) StartBatch(req BatchUploadRequest) error {
	// Configurar opções padrão
	if req.Options.MaxConcurrency == 0 {
		req.Options.MaxConcurrency = bu.maxWorkers
	}
	if req.Options.RetryAttempts == 0 {
		req.Options.RetryAttempts = 3
	}
	if req.Options.RetryDelay == 0 {
		req.Options.RetryDelay = 5 * time.Second
	}
	if req.Options.ProgressInterval == 0 {
		req.Options.ProgressInterval = 2 * time.Second
	}
	
	batchCtx, batchCancel := context.WithCancel(bu.ctx)
	
	batch := &batchState{
		request:   req,
		progress:  &BatchProgress{
			BatchID:   req.ID,
			Total:     int64(len(req.Uploads)),
			StartTime: time.Now(),
		},
		results:   make([]UploadResult, 0, len(req.Uploads)),
		startTime: time.Now(),
		ctx:       batchCtx,
		cancel:    batchCancel,
	}
	
	bu.batchesMu.Lock()
	bu.batches[req.ID] = batch
	bu.batchesMu.Unlock()
	
	// Calcular tamanho total estimado
	go bu.calculateBatchSize(batch)
	
	// Iniciar workers do lote
	semaphore := make(chan struct{}, req.Options.MaxConcurrency)
	
	// Enviar trabalhos de upload
	go func() {
		defer close(semaphore)
		
		for i, uploadReq := range req.Uploads {
			select {
			case <-batchCtx.Done():
				return
			case semaphore <- struct{}{}:
				go func(req UploadRequest, index int) {
					defer func() { <-semaphore }()
					
					job := &uploadJob{
						request:     req,
						batchID:     batch.request.ID,
						maxAttempts: batch.request.Options.RetryAttempts,
						retryDelay:  batch.request.Options.RetryDelay,
						resultChan:  bu.results,
					}
					
					bu.pendingJobs <- job
				}(uploadReq, i)
			}
		}
	}()
	
	// Iniciar relatório de progresso
	go bu.progressReporter(batch)
	
	return nil
}

// worker processa trabalhos de upload
func (bu *BatchUploader) worker() {
	defer bu.wg.Done()
	
	for {
		select {
		case job := <-bu.pendingJobs:
			bu.processUploadJob(job)
		case <-bu.ctx.Done():
			return
		}
	}
}

// processUploadJob processa um trabalho de upload individual
func (bu *BatchUploader) processUploadJob(job *uploadJob) {
	start := time.Now()
	
	// Verificar se o uploader existe
	uploader, exists := bu.uploaders[job.request.Host]
	if !exists {
		job.resultChan <- UploadResult{
			ID:       job.request.ID,
			FileName: job.request.FileName,
			Error:    fmt.Errorf("uploader not found for host: %s", job.request.Host),
			Duration: time.Since(start),
		}
		return
	}
	
	// Aplicar rate limiting
	rateLimiter := bu.rateLimiters[job.request.Host]
	ctx, cancel := context.WithTimeout(bu.ctx, 30*time.Second)
	defer cancel()
	
	if err := rateLimiter.Acquire(ctx); err != nil {
		job.resultChan <- UploadResult{
			ID:       job.request.ID,
			FileName: job.request.FileName,
			Error:    fmt.Errorf("rate limit timeout: %v", err),
			Duration: time.Since(start),
		}
		return
	}
	defer rateLimiter.Release()
	
	// Processar upload com retry
	result := bu.uploadWithRetry(job, uploader, start)
	job.resultChan <- result
}

// uploadWithRetry executa upload com retry automático
func (bu *BatchUploader) uploadWithRetry(job *uploadJob, uploader UploaderInterface, startTime time.Time) UploadResult {
	var lastErr error
	
	for attempt := 0; attempt <= job.maxAttempts; attempt++ {
		// Preparar arquivo temporário
		tempFile, err := bu.prepareFile(job.request)
		if err != nil {
			return UploadResult{
				ID:       job.request.ID,
				FileName: job.request.FileName,
				Error:    fmt.Errorf("failed to prepare file: %v", err),
				Duration: time.Since(startTime),
			}
		}
		
		// Tentar upload
		url, err := uploader.Upload(tempFile)
		os.Remove(tempFile) // Limpar arquivo temporário
		
		if err == nil {
			return UploadResult{
				ID:       job.request.ID,
				FileName: job.request.FileName,
				URL:      url,
				Duration: time.Since(startTime),
			}
		}
		
		lastErr = err
		
		// Aguardar antes do retry
		if attempt < job.maxAttempts {
			select {
			case <-time.After(job.retryDelay):
			case <-bu.ctx.Done():
				return UploadResult{
					ID:       job.request.ID,
					FileName: job.request.FileName,
					Error:    bu.ctx.Err(),
					Duration: time.Since(startTime),
				}
			}
		}
	}
	
	return UploadResult{
		ID:       job.request.ID,
		FileName: job.request.FileName,
		Error:    fmt.Errorf("upload failed after %d attempts: %v", job.maxAttempts+1, lastErr),
		Duration: time.Since(startTime),
	}
}

// prepareFile prepara um arquivo para upload (decodifica base64 ou cria link para arquivo)
func (bu *BatchUploader) prepareFile(req UploadRequest) (string, error) {
	if req.FilePath != "" {
		// Usar arquivo existente
		if _, err := os.Stat(req.FilePath); err != nil {
			return "", fmt.Errorf("file not found: %s", req.FilePath)
		}
		return req.FilePath, nil
	}
	
	// Decodificar base64 para arquivo temporário
	fileData, err := base64.StdEncoding.DecodeString(req.FileContent)
	if err != nil {
		return "", fmt.Errorf("failed to decode base64: %v", err)
	}
	
	tmpFile, err := os.CreateTemp("", fmt.Sprintf("upload-%s-*", req.ID))
	if err != nil {
		return "", fmt.Errorf("failed to create temp file: %v", err)
	}
	defer tmpFile.Close()
	
	if _, err := tmpFile.Write(fileData); err != nil {
		os.Remove(tmpFile.Name())
		return "", fmt.Errorf("failed to write temp file: %v", err)
	}
	
	return tmpFile.Name(), nil
}

// resultProcessor processa resultados de upload
func (bu *BatchUploader) resultProcessor() {
	defer bu.wg.Done()
	
	for {
		select {
		case result := <-bu.results:
			bu.handleUploadResult(result)
		case <-bu.ctx.Done():
			return
		}
	}
}

// handleUploadResult processa o resultado de um upload
func (bu *BatchUploader) handleUploadResult(result UploadResult) {
	bu.batchesMu.RLock()
	var targetBatch *batchState
	batchID := ""
	
	// Encontrar o lote correto (assumindo que o ID do resultado corresponde ao lote)
	for id, batch := range bu.batches {
		for _, upload := range batch.request.Uploads {
			if upload.ID == result.ID {
				targetBatch = batch
				batchID = id
				break
			}
		}
		if targetBatch != nil {
			break
		}
	}
	bu.batchesMu.RUnlock()
	
	if targetBatch == nil {
		return
	}
	
	targetBatch.mu.Lock()
	targetBatch.results = append(targetBatch.results, result)
	
	if result.Error != nil {
		atomic.AddInt64(&targetBatch.progress.Failed, 1)
	} else {
		atomic.AddInt64(&targetBatch.progress.Completed, 1)
	}
	targetBatch.mu.Unlock()
	
	// Enviar resultado individual para WebSocket
	bu.sendUploadResult(batchID, result)
	
	// Call result callback if registered
	if bu.resultCallback != nil {
		bu.resultCallback(batchID, result)
	}
	
	// Verificar se o lote está completo
	bu.checkBatchCompletion(targetBatch)
}

// progressReporter envia atualizações de progresso
func (bu *BatchUploader) progressReporter(batch *batchState) {
	ticker := time.NewTicker(batch.request.Options.ProgressInterval)
	defer ticker.Stop()
	
	for {
		select {
		case <-ticker.C:
			bu.sendProgressUpdate(batch)
		case <-batch.ctx.Done():
			return
		}
	}
}

// sendProgressUpdate envia atualização de progresso via WebSocket
func (bu *BatchUploader) sendProgressUpdate(batch *batchState) {
	batch.mu.RLock()
	progress := *batch.progress
	progress.Completed = atomic.LoadInt64(&batch.progress.Completed)
	progress.Failed = atomic.LoadInt64(&batch.progress.Failed)
	progress.Skipped = atomic.LoadInt64(&batch.progress.Skipped)
	
	// Calcular ETA
	elapsed := time.Since(batch.startTime)
	if progress.Completed > 0 {
		avgTimePerFile := elapsed / time.Duration(progress.Completed)
		remaining := progress.Total - progress.Completed - progress.Failed
		progress.EstimatedETA = time.Now().Add(avgTimePerFile * time.Duration(remaining))
	}
	batch.mu.RUnlock()
	
	response := websocket.Response{
		Status: "progress",
		Progress: &websocket.Progress{
			Current:    int(progress.Completed),
			Total:      int(progress.Total),
			Percentage: int((progress.Completed * 100) / progress.Total),
			Stage:      "uploading",
		},
		Data: progress,
	}
	
	bu.wsManager.Broadcast(response)
}

// sendUploadResult envia resultado individual de upload
func (bu *BatchUploader) sendUploadResult(batchID string, result UploadResult) {
	status := "complete"
	if result.Error != nil {
		status = "error"
	}
	
	response := websocket.Response{
		Status: status,
		File:   result.FileName,
		URL:    result.URL,
		Data:   result,
	}
	
	if result.Error != nil {
		response.Error = result.Error.Error()
	}
	
	bu.wsManager.Broadcast(response)
}

// calculateBatchSize calcula o tamanho total do lote em bytes
func (bu *BatchUploader) calculateBatchSize(batch *batchState) {
	var totalBytes int64
	
	for _, upload := range batch.request.Uploads {
		if upload.FilePath != "" {
			if info, err := os.Stat(upload.FilePath); err == nil {
				totalBytes += info.Size()
			}
		} else if upload.FileContent != "" {
			// Estimar tamanho do base64 (aproximadamente 75% do tamanho codificado)
			totalBytes += int64(len(upload.FileContent) * 3 / 4)
		}
	}
	
	batch.mu.Lock()
	batch.progress.TotalBytes = totalBytes
	batch.mu.Unlock()
}

// checkBatchCompletion verifica se um lote foi completado
func (bu *BatchUploader) checkBatchCompletion(batch *batchState) {
	batch.mu.RLock()
	completed := atomic.LoadInt64(&batch.progress.Completed)
	failed := atomic.LoadInt64(&batch.progress.Failed)
	total := batch.progress.Total
	batch.mu.RUnlock()
	
	if completed+failed >= total {
		// Lote completado
		batch.cancel()
		
		// Enviar notificação final
		finalStatus := "batch_complete"
		if failed > 0 {
			finalStatus = "batch_complete_with_errors"
		}
		
		response := websocket.Response{
			Status: finalStatus,
			Data: map[string]interface{}{
				"batchId":   batch.request.ID,
				"completed": completed,
				"failed":    failed,
				"total":     total,
				"duration":  time.Since(batch.startTime).String(),
			},
		}
		
		bu.wsManager.Broadcast(response)
		
		// Remover lote da memória após um tempo
		go func() {
			time.Sleep(5 * time.Minute)
			bu.batchesMu.Lock()
			delete(bu.batches, batch.request.ID)
			bu.batchesMu.Unlock()
		}()
	}
}

// CancelBatch cancela um lote em andamento
func (bu *BatchUploader) CancelBatch(batchID string) error {
	bu.batchesMu.RLock()
	batch, exists := bu.batches[batchID]
	bu.batchesMu.RUnlock()
	
	if !exists {
		return fmt.Errorf("batch not found: %s", batchID)
	}
	
	batch.cancel()
	return nil
}

// GetBatchStatus retorna o status de um lote
func (bu *BatchUploader) GetBatchStatus(batchID string) (*BatchProgress, error) {
	bu.batchesMu.RLock()
	batch, exists := bu.batches[batchID]
	bu.batchesMu.RUnlock()
	
	if !exists {
		return nil, fmt.Errorf("batch not found: %s", batchID)
	}
	
	batch.mu.RLock()
	progress := *batch.progress
	progress.Completed = atomic.LoadInt64(&batch.progress.Completed)
	progress.Failed = atomic.LoadInt64(&batch.progress.Failed)
	progress.Skipped = atomic.LoadInt64(&batch.progress.Skipped)
	batch.mu.RUnlock()
	
	return &progress, nil
}

// Close fecha o uploader em lote
func (bu *BatchUploader) Close() {
	bu.cancel()
	
	// Fechar rate limiters
	for _, rl := range bu.rateLimiters {
		rl.Close()
	}
	
	// Cancelar todos os lotes
	bu.batchesMu.RLock()
	for _, batch := range bu.batches {
		batch.cancel()
	}
	bu.batchesMu.RUnlock()
	
	bu.wg.Wait()
	
	close(bu.pendingJobs)
	close(bu.results)
}
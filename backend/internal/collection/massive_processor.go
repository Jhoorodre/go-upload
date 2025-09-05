package collection

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"go-upload/backend/internal/workstealing"
	"go-upload/backend/uploaders"
)

// CollectionProcessor processa coleções massivas de mangás
type CollectionProcessor struct {
	// Core components
	workerPool     *workstealing.WorkerPool
	uploader       *uploaders.CatboxUploader
	
	// Configuration
	config         *ProcessorConfig
	
	// State management
	collections    map[string]*CollectionJob
	mutex          sync.RWMutex
	
	// Progress tracking
	progressChan   chan *ProgressUpdate
	
	// Lifecycle
	ctx            context.Context
	cancel         context.CancelFunc
	wg             sync.WaitGroup
	
	// Metrics
	totalFiles     int64
	processedFiles int64
	failedFiles    int64
	startTime      time.Time
}

// ProcessorConfig configura o processador de coleções
type ProcessorConfig struct {
	MaxConcurrency   int           `json:"maxConcurrency"`
	BatchSize        int           `json:"batchSize"`
	RetryAttempts    int           `json:"retryAttempts"`
	RetryDelay       time.Duration `json:"retryDelay"`
	ProgressInterval time.Duration `json:"progressInterval"`
	EnablePersistence bool         `json:"enablePersistence"`
	StateFilePath    string        `json:"stateFilePath"`
	ResumeFrom       string        `json:"resumeFrom"`
	SkipExisting     bool          `json:"skipExisting"`
}

// CollectionJob representa um job de processamento de coleção
type CollectionJob struct {
	ID               string                 `json:"id"`
	Name             string                 `json:"name"`
	BasePath         string                 `json:"basePath"`
	Host             string                 `json:"host"`
	Status           JobStatus              `json:"status"`
	StartTime        time.Time              `json:"startTime"`
	EstimatedEndTime *time.Time             `json:"estimatedEndTime,omitempty"`
	
	// Progress tracking
	TotalObras       int                    `json:"totalObras"`
	CompletedObras   int                    `json:"completedObras"`
	TotalChapters    int                    `json:"totalChapters"`
	CompletedChapters int                   `json:"completedChapters"`
	TotalFiles       int                    `json:"totalFiles"`
	UploadedFiles    int                    `json:"uploadedFiles"`
	FailedFiles      int                    `json:"failedFiles"`
	
	// Performance metrics
	CurrentSpeed     float64                `json:"currentSpeed"` // files per minute
	AverageSpeed     float64                `json:"averageSpeed"`
	ETA              *time.Duration         `json:"eta,omitempty"`
	
	// Structure
	Obras            []*ObraJob             `json:"obras"`
	
	// Configuration
	Options          *ProcessorConfig       `json:"options"`
	
	// Callbacks
	OnProgress       func(*ProgressUpdate)  `json:"-"`
	OnComplete       func(error)            `json:"-"`
	
	// State
	LastProcessedFile string                `json:"lastProcessedFile"`
	mutex            sync.RWMutex           `json:"-"`
}

// ObraJob representa o processamento de uma obra
type ObraJob struct {
	Name            string            `json:"name"`
	Path            string            `json:"path"`
	Status          JobStatus         `json:"status"`
	TotalChapters   int               `json:"totalChapters"`
	CompletedChapters int             `json:"completedChapters"`
	TotalFiles      int               `json:"totalFiles"`
	UploadedFiles   int               `json:"uploadedFiles"`
	FailedFiles     int               `json:"failedFiles"`
	Chapters        []*ChapterJob     `json:"chapters"`
	StartTime       time.Time         `json:"startTime"`
	EndTime         *time.Time        `json:"endTime,omitempty"`
	Error           string            `json:"error,omitempty"`
	mutex           sync.RWMutex      `json:"-"`
}

// ChapterJob representa o processamento de um capítulo
type ChapterJob struct {
	Name          string        `json:"name"`
	Path          string        `json:"path"`
	Status        JobStatus     `json:"status"`
	TotalFiles    int           `json:"totalFiles"`
	UploadedFiles int           `json:"uploadedFiles"`
	FailedFiles   int           `json:"failedFiles"`
	Files         []*FileJob    `json:"files"`
	StartTime     time.Time     `json:"startTime"`
	EndTime       *time.Time    `json:"endTime,omitempty"`
	Error         string        `json:"error,omitempty"`
	mutex         sync.RWMutex  `json:"-"`
}

// FileJob representa o processamento de um arquivo
type FileJob struct {
	Name      string        `json:"name"`
	Path      string        `json:"path"`
	Status    JobStatus     `json:"status"`
	URL       string        `json:"url,omitempty"`
	Size      int64         `json:"size"`
	StartTime time.Time     `json:"startTime"`
	EndTime   *time.Time    `json:"endTime,omitempty"`
	Duration  time.Duration `json:"duration"`
	Retries   int           `json:"retries"`
	Error     string        `json:"error,omitempty"`
}

// JobStatus representa os possíveis status de um job
type JobStatus string

const (
	StatusPending    JobStatus = "pending"
	StatusRunning    JobStatus = "running"
	StatusCompleted  JobStatus = "completed"
	StatusFailed     JobStatus = "failed"
	StatusCancelled  JobStatus = "cancelled"
	StatusPaused     JobStatus = "paused"
)

// ProgressUpdate representa uma atualização de progresso
type ProgressUpdate struct {
	CollectionID     string                `json:"collectionId"`
	Type             string                `json:"type"` // collection, obra, chapter, file
	Status           string                `json:"status"`
	Progress         *CollectionProgress   `json:"progress,omitempty"`
	CurrentFile      string                `json:"currentFile,omitempty"`
	Error            string                `json:"error,omitempty"`
	Timestamp        time.Time             `json:"timestamp"`
}

// CollectionProgress representa o progresso detalhado de uma coleção
type CollectionProgress struct {
	TotalObras        int           `json:"totalObras"`
	CompletedObras    int           `json:"completedObras"`
	TotalChapters     int           `json:"totalChapters"`
	CompletedChapters int           `json:"completedChapters"`
	TotalFiles        int           `json:"totalFiles"`
	UploadedFiles     int           `json:"uploadedFiles"`
	FailedFiles       int           `json:"failedFiles"`
	CurrentSpeed      float64       `json:"currentSpeed"`
	AverageSpeed      float64       `json:"averageSpeed"`
	ETA               string        `json:"eta"`
	Percentage        float64       `json:"percentage"`
}

// NewCollectionProcessor cria um novo processador de coleções
func NewCollectionProcessor(config *ProcessorConfig) *CollectionProcessor {
	if config == nil {
		config = &ProcessorConfig{
			MaxConcurrency:   100,
			BatchSize:        50,
			RetryAttempts:    3,
			RetryDelay:       2 * time.Second,
			ProgressInterval: 5 * time.Second,
			EnablePersistence: true,
			StateFilePath:    "collection_state.json",
		}
	}
	
	ctx, cancel := context.WithCancel(context.Background())
	
	// Worker pool com work stealing
	workerPool := workstealing.NewWorkerPool(config.MaxConcurrency)
	
	// Catbox uploader otimizado
	uploader := uploaders.NewCatboxUploader()
	
	processor := &CollectionProcessor{
		workerPool:   workerPool,
		uploader:     uploader,
		config:       config,
		collections:  make(map[string]*CollectionJob),
		progressChan: make(chan *ProgressUpdate, 1000),
		ctx:          ctx,
		cancel:       cancel,
		startTime:    time.Now(),
	}
	
	return processor
}

// Start inicia o processador
func (cp *CollectionProcessor) Start() error {
	// Inicia worker pool
	if err := cp.workerPool.Start(); err != nil {
		return fmt.Errorf("failed to start worker pool: %v", err)
	}
	
	// Inicia processamento de progresso
	cp.wg.Add(1)
	go cp.progressProcessor()
	
	return nil
}

// ProcessCollection processa uma coleção completa
func (cp *CollectionProcessor) ProcessCollection(request *CollectionRequest) (*CollectionJob, error) {
	// Valida requisição
	if err := cp.validateRequest(request); err != nil {
		return nil, fmt.Errorf("invalid request: %v", err)
	}
	
	// Cria job
	job := &CollectionJob{
		ID:        request.ID,
		Name:      request.CollectionName,
		BasePath:  request.BasePath,
		Host:      request.Host,
		Status:    StatusPending,
		StartTime: time.Now(),
		Options:   request.Options,
		OnProgress: request.OnProgress,
		OnComplete: request.OnComplete,
	}
	
	// Registra job
	cp.mutex.Lock()
	cp.collections[job.ID] = job
	cp.mutex.Unlock()
	
	// Carrega estado anterior se habilitado
	if cp.config.EnablePersistence {
		if err := cp.loadJobState(job); err != nil {
			// Log erro mas continua
			fmt.Printf("Failed to load job state: %v\n", err)
		}
	}
	
	// Inicia processamento em background
	cp.wg.Add(1)
	go func() {
		defer cp.wg.Done()
		cp.processCollectionAsync(job)
	}()
	
	return job, nil
}

// processCollectionAsync processa uma coleção de forma assíncrona
func (cp *CollectionProcessor) processCollectionAsync(job *CollectionJob) {
	defer func() {
		if r := recover(); r != nil {
			err := fmt.Errorf("collection processing panicked: %v", r)
			cp.completeJob(job, err)
		}
	}()
	
	// Atualiza status
	job.mutex.Lock()
	job.Status = StatusRunning
	job.mutex.Unlock()
	
	// Descobre estrutura da coleção
	if err := cp.discoverCollectionStructure(job); err != nil {
		cp.completeJob(job, err)
		return
	}
	
	// Processa todas as obras
	if err := cp.processObras(job); err != nil {
		cp.completeJob(job, err)
		return
	}
	
	// Sucesso
	cp.completeJob(job, nil)
}

// discoverCollectionStructure descobre a estrutura da coleção
func (cp *CollectionProcessor) discoverCollectionStructure(job *CollectionJob) error {
	basePath := job.BasePath
	
	// Lista diretórios (obras)
	entries, err := os.ReadDir(basePath)
	if err != nil {
		return fmt.Errorf("failed to read collection directory: %v", err)
	}
	
	job.mutex.Lock()
	defer job.mutex.Unlock()
	
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		
		obraPath := filepath.Join(basePath, entry.Name())
		obra := &ObraJob{
			Name:   entry.Name(),
			Path:   obraPath,
			Status: StatusPending,
		}
		
		// Descobre capítulos
		if err := cp.discoverObraStructure(obra); err != nil {
			// Log erro mas continua com outras obras
			fmt.Printf("Failed to discover obra %s: %v\n", obra.Name, err)
			continue
		}
		
		job.Obras = append(job.Obras, obra)
		job.TotalObras++
		job.TotalChapters += obra.TotalChapters
		job.TotalFiles += obra.TotalFiles
	}
	
	return nil
}

// discoverObraStructure descobre a estrutura de uma obra
func (cp *CollectionProcessor) discoverObraStructure(obra *ObraJob) error {
	entries, err := os.ReadDir(obra.Path)
	if err != nil {
		return fmt.Errorf("failed to read obra directory: %v", err)
	}
	
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		
		chapterPath := filepath.Join(obra.Path, entry.Name())
		chapter := &ChapterJob{
			Name:   entry.Name(),
			Path:   chapterPath,
			Status: StatusPending,
		}
		
		// Descobre arquivos
		if err := cp.discoverChapterFiles(chapter); err != nil {
			// Log erro mas continua
			fmt.Printf("Failed to discover chapter %s: %v\n", chapter.Name, err)
			continue
		}
		
		obra.Chapters = append(obra.Chapters, chapter)
		obra.TotalChapters++
		obra.TotalFiles += chapter.TotalFiles
	}
	
	return nil
}

// discoverChapterFiles descobre os arquivos de um capítulo
func (cp *CollectionProcessor) discoverChapterFiles(chapter *ChapterJob) error {
	entries, err := os.ReadDir(chapter.Path)
	if err != nil {
		return fmt.Errorf("failed to read chapter directory: %v", err)
	}
	
	supportedExts := map[string]bool{
		".jpg":  true,
		".jpeg": true,
		".png":  true,
		".webp": true,
		".avif": true,
		".bmp":  true,
		".tiff": true,
	}
	
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		
		ext := filepath.Ext(entry.Name())
		if !supportedExts[ext] {
			continue
		}
		
		filePath := filepath.Join(chapter.Path, entry.Name())
		
		// Obtém tamanho do arquivo
		info, err := entry.Info()
		var size int64
		if err == nil {
			size = info.Size()
		}
		
		file := &FileJob{
			Name:   entry.Name(),
			Path:   filePath,
			Size:   size,
			Status: StatusPending,
		}
		
		chapter.Files = append(chapter.Files, file)
		chapter.TotalFiles++
	}
	
	// Ordena arquivos por nome para processamento consistente
	sort.Slice(chapter.Files, func(i, j int) bool {
		return chapter.Files[i].Name < chapter.Files[j].Name
	})
	
	return nil
}

// processObras processa todas as obras da coleção
func (cp *CollectionProcessor) processObras(job *CollectionJob) error {
	for _, obra := range job.Obras {
		select {
		case <-cp.ctx.Done():
			return cp.ctx.Err()
		default:
		}
		
		// Verifica se deve pular (resume functionality)
		if cp.shouldSkipObra(job, obra) {
			continue
		}
		
		if err := cp.processObra(job, obra); err != nil {
			// Log erro mas continua com outras obras
			fmt.Printf("Failed to process obra %s: %v\n", obra.Name, err)
			obra.Error = err.Error()
			obra.Status = StatusFailed
		}
	}
	
	return nil
}

// processObra processa uma obra completa
func (cp *CollectionProcessor) processObra(job *CollectionJob, obra *ObraJob) error {
	obra.mutex.Lock()
	obra.Status = StatusRunning
	obra.StartTime = time.Now()
	obra.mutex.Unlock()
	
	// Processa capítulos em batches para controle de concorrência
	batchSize := cp.config.BatchSize
	if batchSize <= 0 {
		batchSize = 10
	}
	
	for i := 0; i < len(obra.Chapters); i += batchSize {
		end := i + batchSize
		if end > len(obra.Chapters) {
			end = len(obra.Chapters)
		}
		
		batch := obra.Chapters[i:end]
		if err := cp.processChapterBatch(job, obra, batch); err != nil {
			return err
		}
	}
	
	// Completa obra
	obra.mutex.Lock()
	obra.Status = StatusCompleted
	endTime := time.Now()
	obra.EndTime = &endTime
	obra.mutex.Unlock()
	
	// Atualiza progresso da coleção
	job.mutex.Lock()
	job.CompletedObras++
	job.mutex.Unlock()
	
	cp.sendProgressUpdate(job, "obra", obra.Name)
	return nil
}

// processChapterBatch processa um batch de capítulos
func (cp *CollectionProcessor) processChapterBatch(job *CollectionJob, obra *ObraJob, chapters []*ChapterJob) error {
	var wg sync.WaitGroup
	semaphore := make(chan struct{}, cp.config.MaxConcurrency)
	
	for _, chapter := range chapters {
		if cp.shouldSkipChapter(job, chapter) {
			continue
		}
		
		wg.Add(1)
		go func(ch *ChapterJob) {
			defer wg.Done()
			
			// Adquire semáforo
			semaphore <- struct{}{}
			defer func() { <-semaphore }()
			
			if err := cp.processChapter(job, obra, ch); err != nil {
				fmt.Printf("Failed to process chapter %s: %v\n", ch.Name, err)
				ch.Error = err.Error()
				ch.Status = StatusFailed
			}
		}(chapter)
	}
	
	wg.Wait()
	return nil
}

// processChapter processa um capítulo completo
func (cp *CollectionProcessor) processChapter(job *CollectionJob, obra *ObraJob, chapter *ChapterJob) error {
	chapter.mutex.Lock()
	chapter.Status = StatusRunning
	chapter.StartTime = time.Now()
	chapter.mutex.Unlock()
	
	// Submete arquivos para o worker pool com prioridades
	for i, file := range chapter.Files {
		if cp.shouldSkipFile(job, file) {
			continue
		}
		
		// Determina prioridade baseada na posição do arquivo
		priority := workstealing.PriorityNormal
		if i < 5 {
			priority = workstealing.PriorityHigh // Primeiros arquivos têm prioridade alta
		}
		
		task := &workstealing.Task{
			ID:         fmt.Sprintf("%s_%s_%s_%s", job.ID, obra.Name, chapter.Name, file.Name),
			Priority:   priority,
			MaxRetries: cp.config.RetryAttempts,
			Execute:    cp.createFileUploadTask(job, obra, chapter, file),
			OnComplete: cp.createFileCompleteCallback(job, obra, chapter, file),
		}
		
		if err := cp.workerPool.Submit(task); err != nil {
			return fmt.Errorf("failed to submit file task: %v", err)
		}
	}
	
	// Aguarda todos os arquivos serem processados
	cp.waitForChapterCompletion(chapter)
	
	// Completa capítulo
	chapter.mutex.Lock()
	chapter.Status = StatusCompleted
	endTime := time.Now()
	chapter.EndTime = &endTime
	chapter.mutex.Unlock()
	
	// Atualiza progresso
	obra.mutex.Lock()
	obra.CompletedChapters++
	obra.mutex.Unlock()
	
	job.mutex.Lock()
	job.CompletedChapters++
	job.mutex.Unlock()
	
	cp.sendProgressUpdate(job, "chapter", chapter.Name)
	return nil
}

// createFileUploadTask cria uma task para upload de arquivo
func (cp *CollectionProcessor) createFileUploadTask(job *CollectionJob, obra *ObraJob, chapter *ChapterJob, file *FileJob) func() error {
	return func() error {
		file.StartTime = time.Now()
		file.Status = StatusRunning
		
		// Faz upload
		url, err := cp.uploader.Upload(file.Path)
		if err != nil {
			file.Status = StatusFailed
			file.Error = err.Error()
			atomic.AddInt64(&cp.failedFiles, 1)
			return err
		}
		
		// Sucesso
		file.URL = url
		file.Status = StatusCompleted
		endTime := time.Now()
		file.EndTime = &endTime
		file.Duration = endTime.Sub(file.StartTime)
		
		atomic.AddInt64(&cp.processedFiles, 1)
		
		return nil
	}
}

// createFileCompleteCallback cria callback de conclusão de arquivo
func (cp *CollectionProcessor) createFileCompleteCallback(job *CollectionJob, obra *ObraJob, chapter *ChapterJob, file *FileJob) func(error) {
	return func(err error) {
		if err == nil {
			chapter.UploadedFiles++
			obra.UploadedFiles++
			job.UploadedFiles++
		} else {
			chapter.FailedFiles++
			obra.FailedFiles++
			job.FailedFiles++
		}
		
		// Salva estado se habilitado
		if cp.config.EnablePersistence {
			job.LastProcessedFile = file.Path
			cp.saveJobState(job)
		}
		
		cp.sendProgressUpdate(job, "file", file.Name)
	}
}

// waitForChapterCompletion aguarda a conclusão de todos os arquivos do capítulo
func (cp *CollectionProcessor) waitForChapterCompletion(chapter *ChapterJob) {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	
	for {
		select {
		case <-ticker.C:
			completed := 0
			for _, file := range chapter.Files {
				if file.Status == StatusCompleted || file.Status == StatusFailed {
					completed++
				}
			}
			
			if completed >= len(chapter.Files) {
				return
			}
			
		case <-cp.ctx.Done():
			return
		}
	}
}

// shouldSkipObra verifica se deve pular uma obra (resume functionality)
func (cp *CollectionProcessor) shouldSkipObra(job *CollectionJob, obra *ObraJob) bool {
	if job.Options == nil {
		return false
	}
	
	// Se tem resumeFrom e ainda não chegou nessa obra
	if job.Options.ResumeFrom != "" {
		if obra.Name < job.Options.ResumeFrom {
			return true
		}
	}
	
	return false
}

// shouldSkipChapter verifica se deve pular um capítulo
func (cp *CollectionProcessor) shouldSkipChapter(job *CollectionJob, chapter *ChapterJob) bool {
	if job.Options == nil {
		return false
	}
	
	// Se skipExisting está habilitado e capítulo já foi processado
	if job.Options.SkipExisting && chapter.Status == StatusCompleted {
		return true
	}
	
	return false
}

// shouldSkipFile verifica se deve pular um arquivo
func (cp *CollectionProcessor) shouldSkipFile(job *CollectionJob, file *FileJob) bool {
	if job.Options == nil {
		return false
	}
	
	// Se skipExisting está habilitado e arquivo já foi processado
	if job.Options.SkipExisting && file.Status == StatusCompleted && file.URL != "" {
		return true
	}
	
	return false
}

// sendProgressUpdate envia atualização de progresso
func (cp *CollectionProcessor) sendProgressUpdate(job *CollectionJob, updateType, item string) {
	job.mutex.RLock()
	progress := &CollectionProgress{
		TotalObras:        job.TotalObras,
		CompletedObras:    job.CompletedObras,
		TotalChapters:     job.TotalChapters,
		CompletedChapters: job.CompletedChapters,
		TotalFiles:        job.TotalFiles,
		UploadedFiles:     job.UploadedFiles,
		FailedFiles:       job.FailedFiles,
	}
	job.mutex.RUnlock()
	
	// Calcula velocidade e ETA
	elapsed := time.Since(job.StartTime)
	if progress.UploadedFiles > 0 && elapsed > 0 {
		filesPerSecond := float64(progress.UploadedFiles) / elapsed.Seconds()
		progress.CurrentSpeed = filesPerSecond * 60 // files per minute
		progress.AverageSpeed = progress.CurrentSpeed
		
		remainingFiles := progress.TotalFiles - progress.UploadedFiles
		if filesPerSecond > 0 {
			etaSeconds := float64(remainingFiles) / filesPerSecond
			eta := time.Duration(etaSeconds) * time.Second
			progress.ETA = eta.String()
		}
	}
	
	// Calcula porcentagem
	if progress.TotalFiles > 0 {
		progress.Percentage = float64(progress.UploadedFiles) / float64(progress.TotalFiles) * 100
	}
	
	update := &ProgressUpdate{
		CollectionID: job.ID,
		Type:         updateType,
		Status:       "progress",
		Progress:     progress,
		CurrentFile:  item,
		Timestamp:    time.Now(),
	}
	
	select {
	case cp.progressChan <- update:
	default:
		// Canal cheio, ignora update
	}
}

// progressProcessor processa atualizações de progresso
func (cp *CollectionProcessor) progressProcessor() {
	defer cp.wg.Done()
	
	for {
		select {
		case update := <-cp.progressChan:
			// Envia para callback se existir
			cp.mutex.RLock()
			if job, exists := cp.collections[update.CollectionID]; exists && job.OnProgress != nil {
				job.OnProgress(update)
			}
			cp.mutex.RUnlock()
			
		case <-cp.ctx.Done():
			return
		}
	}
}

// completeJob completa um job
func (cp *CollectionProcessor) completeJob(job *CollectionJob, err error) {
	job.mutex.Lock()
	if err != nil {
		job.Status = StatusFailed
	} else {
		job.Status = StatusCompleted
	}
	endTime := time.Now()
	job.EstimatedEndTime = &endTime
	job.mutex.Unlock()
	
	// Callback de conclusão
	if job.OnComplete != nil {
		go job.OnComplete(err)
	}
	
	// Salva estado final
	if cp.config.EnablePersistence {
		cp.saveJobState(job)
	}
}

// loadJobState carrega estado de um job
func (cp *CollectionProcessor) loadJobState(job *CollectionJob) error {
	if cp.config.StateFilePath == "" {
		return nil
	}
	
	filePath := fmt.Sprintf("%s_%s.json", cp.config.StateFilePath, job.ID)
	data, err := os.ReadFile(filePath)
	if err != nil {
		return err // Estado não existe
	}
	
	var savedJob CollectionJob
	if err := json.Unmarshal(data, &savedJob); err != nil {
		return err
	}
	
	// Mescla estado salvo com job atual
	job.LastProcessedFile = savedJob.LastProcessedFile
	job.CompletedObras = savedJob.CompletedObras
	job.CompletedChapters = savedJob.CompletedChapters
	job.UploadedFiles = savedJob.UploadedFiles
	job.FailedFiles = savedJob.FailedFiles
	
	return nil
}

// saveJobState salva estado de um job
func (cp *CollectionProcessor) saveJobState(job *CollectionJob) error {
	if cp.config.StateFilePath == "" {
		return nil
	}
	
	filePath := fmt.Sprintf("%s_%s.json", cp.config.StateFilePath, job.ID)
	
	data, err := json.Marshal(job)
	if err != nil {
		return err
	}
	
	return os.WriteFile(filePath, data, 0644)
}

// validateRequest valida uma requisição de processamento
func (cp *CollectionProcessor) validateRequest(request *CollectionRequest) error {
	if request.ID == "" {
		return fmt.Errorf("collection ID is required")
	}
	if request.CollectionName == "" {
		return fmt.Errorf("collection name is required")
	}
	if request.BasePath == "" {
		return fmt.Errorf("base path is required")
	}
	if request.Host == "" {
		return fmt.Errorf("host is required")
	}
	
	// Verifica se o caminho existe
	if _, err := os.Stat(request.BasePath); os.IsNotExist(err) {
		return fmt.Errorf("base path does not exist: %s", request.BasePath)
	}
	
	return nil
}

// GetJobStatus retorna o status de um job
func (cp *CollectionProcessor) GetJobStatus(jobID string) (*CollectionJob, bool) {
	cp.mutex.RLock()
	defer cp.mutex.RUnlock()
	
	job, exists := cp.collections[jobID]
	return job, exists
}

// CancelJob cancela um job
func (cp *CollectionProcessor) CancelJob(jobID string) error {
	cp.mutex.RLock()
	job, exists := cp.collections[jobID]
	cp.mutex.RUnlock()
	
	if !exists {
		return fmt.Errorf("job not found: %s", jobID)
	}
	
	job.mutex.Lock()
	job.Status = StatusCancelled
	job.mutex.Unlock()
	
	return nil
}

// GetMetrics retorna métricas do processador
func (cp *CollectionProcessor) GetMetrics() map[string]interface{} {
	total := atomic.LoadInt64(&cp.totalFiles)
	processed := atomic.LoadInt64(&cp.processedFiles)
	failed := atomic.LoadInt64(&cp.failedFiles)
	
	// Worker pool stats
	workerStats := cp.workerPool.GetStats()
	
	// Uploader stats
	uploaderStats := cp.uploader.GetMetrics()
	
	return map[string]interface{}{
		"total_files":     total,
		"processed_files": processed,
		"failed_files":    failed,
		"uptime":          time.Since(cp.startTime).String(),
		"active_jobs":     len(cp.collections),
		"worker_pool":     workerStats,
		"uploader":        uploaderStats,
	}
}

// Stop para o processador
func (cp *CollectionProcessor) Stop() error {
	// Para worker pool
	if err := cp.workerPool.Stop(); err != nil {
		return err
	}
	
	// Para uploader
	if err := cp.uploader.Close(); err != nil {
		return err
	}
	
	// Cancela contexto
	cp.cancel()
	
	// Aguarda goroutines terminarem
	cp.wg.Wait()
	
	return nil
}

// CollectionRequest representa uma requisição de processamento de coleção
type CollectionRequest struct {
	ID             string                    `json:"id"`
	CollectionName string                    `json:"collectionName"`
	BasePath       string                    `json:"basePath"`
	Host           string                    `json:"host"`
	Options        *ProcessorConfig          `json:"options,omitempty"`
	OnProgress     func(*ProgressUpdate)     `json:"-"`
	OnComplete     func(error)               `json:"-"`
}
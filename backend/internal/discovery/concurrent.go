package discovery

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// LibraryNode representa um nó na árvore da biblioteca
type LibraryNode map[string]interface{}

// SupportedExtensions define as extensões de arquivo suportadas
var SupportedExtensions = map[string]bool{
	".avif": true, ".jpg": true, ".jpeg": true, ".png": true,
	".webp": true, ".bmp": true, ".tiff": true, ".tif": true,
}

// HierarchyMetadata contém metadados sobre a estrutura hierárquica
type HierarchyMetadata struct {
	RootLevel    string            `json:"rootLevel"`
	MaxDepth     int               `json:"maxDepth"`
	TotalLevels  int               `json:"totalLevels"`
	LevelMap     map[string]string `json:"levelMap"`
	Stats        HierarchyStats    `json:"stats"`
}

// HierarchyStats contém estatísticas sobre a biblioteca
type HierarchyStats struct {
	TotalDirectories int `json:"totalDirectories"`
	TotalImages      int `json:"totalImages"`
	TotalChapters    int `json:"totalChapters"`
}

// DiscoveryResult contém o resultado da descoberta de estrutura
type DiscoveryResult struct {
	Tree     LibraryNode        `json:"tree"`
	Metadata *HierarchyMetadata `json:"metadata"`
	Error    error              `json:"error,omitempty"`
}

// ProgressCallback é chamada durante o progresso da descoberta
type ProgressCallback func(processed, total int, currentPath string)

// ConcurrentDiscoverer realiza descoberta de estrutura paralela
type ConcurrentDiscoverer struct {
	maxWorkers int
	ctx        context.Context
	cancel     context.CancelFunc
}

// NewConcurrentDiscoverer cria um novo descobridor concorrente
func NewConcurrentDiscoverer(maxWorkers int) *ConcurrentDiscoverer {
	if maxWorkers <= 0 {
		maxWorkers = runtime.NumCPU() * 2
	}
	
	ctx, cancel := context.WithCancel(context.Background())
	
	return &ConcurrentDiscoverer{
		maxWorkers: maxWorkers,
		ctx:        ctx,
		cancel:     cancel,
	}
}

// directoryJob representa um trabalho de processamento de diretório
type directoryJob struct {
	path     string
	depth    int
	parentCh chan<- directoryResult
}

// directoryResult contém o resultado do processamento de um diretório
type directoryResult struct {
	path     string
	node     LibraryNode
	files    []string
	subdirs  []string
	depth    int
	err      error
}

// DiscoverFirstLevel realiza descoberta apenas do primeiro nível (para bibliotecas)
func (cd *ConcurrentDiscoverer) DiscoverFirstLevel(startPath string, progressCb ProgressCallback) (*DiscoveryResult, error) {
	entries, err := os.ReadDir(startPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read directory: %v", err)
	}

	tree := make(LibraryNode)
	processedCount := 0
	totalCount := 0

	// Contar diretórios primeiro
	for _, entry := range entries {
		if entry.IsDir() {
			totalCount++
		}
	}

	// Processar apenas diretórios do primeiro nível
	for _, entry := range entries {
		if entry.IsDir() {
			dirPath := filepath.Join(startPath, entry.Name())
			
			// Verificar se é um diretório de manga (contém subdiretórios de capítulos)
			subEntries, err := os.ReadDir(dirPath)
			if err != nil {
				continue
			}

			hasSubdirs := false
			for _, subEntry := range subEntries {
				if subEntry.IsDir() {
					hasSubdirs = true
					break
				}
			}

			if hasSubdirs {
				// É um manga - adicionar à árvore apenas como referência
				tree[entry.Name()] = LibraryNode{
					"_type": "manga",
					"_path": dirPath,
				}
			}

			processedCount++
			if progressCb != nil {
				progressCb(processedCount, totalCount, dirPath)
			}
		}
	}

	// Criar metadados simples
	metadata := &HierarchyMetadata{
		RootLevel:   "Library",
		MaxDepth:    1,
		TotalLevels: 1,
		LevelMap:    map[string]string{"0": "Library", "1": "Manga"},
		Stats: HierarchyStats{
			TotalDirectories: totalCount,
			TotalImages:      0, // Não contamos aqui para performance
			TotalChapters:    0,
		},
	}

	return &DiscoveryResult{
		Tree:     tree,
		Metadata: metadata,
	}, nil
}

// DiscoverStructure realiza descoberta paralela da estrutura de arquivos
func (cd *ConcurrentDiscoverer) DiscoverStructure(startPath string, progressCb ProgressCallback) (*DiscoveryResult, error) {
	// Canal de trabalhos para distribuir entre workers
	jobs := make(chan directoryJob, cd.maxWorkers*2)
	results := make(chan directoryResult, cd.maxWorkers*2)
	
	// Iniciar workers
	var wg sync.WaitGroup
	for i := 0; i < cd.maxWorkers; i++ {
		wg.Add(1)
		go cd.worker(jobs, results, &wg)
	}

	// Goroutine para coletar resultados
	resultMap := make(map[string]directoryResult)
	var resultWg sync.WaitGroup
	resultWg.Add(1)
	
	go func() {
		defer resultWg.Done()
		for result := range results {
			if result.err != nil {
				continue // Log error but continue processing
			}
			resultMap[result.path] = result
		}
	}()

	// Descobrir estrutura inicial
	initialJob := directoryJob{
		path:     startPath,
		depth:    0,
		parentCh: results,
	}
	
	// Fila de trabalhos pendentes
	pendingJobs := []directoryJob{initialJob}
	processedCount := 0
	totalEstimate := 1

	// Processar trabalhos em lotes
	for len(pendingJobs) > 0 {
		// Enviar lote atual de trabalhos
		batchSize := min(len(pendingJobs), cd.maxWorkers)
		currentBatch := pendingJobs[:batchSize]
		pendingJobs = pendingJobs[batchSize:]

		// Enviar trabalhos para workers
		for _, job := range currentBatch {
			select {
			case jobs <- job:
			case <-cd.ctx.Done():
				close(jobs)
				wg.Wait()
				close(results)
				resultWg.Wait()
				return nil, cd.ctx.Err()
			}
		}

		// Esperar resultados do lote atual
		for i := 0; i < batchSize; i++ {
			select {
			case result := <-results:
				processedCount++
				
				if progressCb != nil {
					progressCb(processedCount, totalEstimate, result.path)
				}
				
				if result.err != nil {
					continue
				}
				
				resultMap[result.path] = result
				
				// Adicionar subdiretórios à fila de trabalhos
				for _, subdir := range result.subdirs {
					pendingJobs = append(pendingJobs, directoryJob{
						path:     subdir,
						depth:    result.depth + 1,
						parentCh: results,
					})
					totalEstimate++
				}
				
			case <-cd.ctx.Done():
				close(jobs)
				wg.Wait()
				close(results)
				resultWg.Wait()
				return nil, cd.ctx.Err()
			}
		}
	}

	// Fechar canais e aguardar conclusão
	close(jobs)
	wg.Wait()
	close(results)
	resultWg.Wait()

	// Construir árvore final
	tree, err := cd.buildTree(startPath, resultMap)
	if err != nil {
		return nil, err
	}

	// Analisar hierarquia
	metadata := cd.analyzeHierarchy(tree)

	return &DiscoveryResult{
		Tree:     tree,
		Metadata: metadata,
	}, nil
}

// worker processa trabalhos de diretório
func (cd *ConcurrentDiscoverer) worker(jobs <-chan directoryJob, results chan<- directoryResult, wg *sync.WaitGroup) {
	defer wg.Done()
	
	for job := range jobs {
		select {
		case <-cd.ctx.Done():
			return
		default:
			result := cd.processDirectory(job)
			
			select {
			case results <- result:
			case <-cd.ctx.Done():
				return
			}
		}
	}
}

// processDirectory processa um único diretório
func (cd *ConcurrentDiscoverer) processDirectory(job directoryJob) directoryResult {
	entries, err := os.ReadDir(job.path)
	if err != nil {
		return directoryResult{
			path:  job.path,
			depth: job.depth,
			err:   err,
		}
	}

	var files []string
	var subdirs []string

	for _, entry := range entries {
		if entry.IsDir() {
			subdirs = append(subdirs, filepath.Join(job.path, entry.Name()))
		} else if SupportedExtensions[strings.ToLower(filepath.Ext(entry.Name()))] {
			files = append(files, entry.Name())
		}
	}

	node := make(LibraryNode)
	if len(files) > 0 {
		node["_files"] = files
	}

	return directoryResult{
		path:    job.path,
		node:    node,
		files:   files,
		subdirs: subdirs,
		depth:   job.depth,
	}
}

// buildTree constrói a árvore final a partir dos resultados
func (cd *ConcurrentDiscoverer) buildTree(startPath string, resultMap map[string]directoryResult) (LibraryNode, error) {
	root := make(LibraryNode)
	
	// Processar resultados ordenados por profundidade
	for _, result := range resultMap {
		relPath, err := filepath.Rel(startPath, result.path)
		if err != nil {
			continue
		}
		
		if relPath == "." {
			// Diretório raiz
			for k, v := range result.node {
				root[k] = v
			}
			continue
		}
		
		// Navegar até o nó pai e adicionar subdiretório
		parts := strings.Split(relPath, string(os.PathSeparator))
		currentNode := root
		
		// Navegar até o nó pai
		for i, part := range parts[:len(parts)-1] {
			if _, exists := currentNode[part]; !exists {
				currentNode[part] = make(LibraryNode)
			}
			if next, ok := currentNode[part].(LibraryNode); ok {
				currentNode = next
			} else {
				return nil, fmt.Errorf("invalid node structure at path: %s", strings.Join(parts[:i+1], "/"))
			}
		}
		
		// Adicionar nó atual
		dirName := parts[len(parts)-1]
		currentNode[dirName] = result.node
	}
	
	return root, nil
}

// analyzeHierarchy analisa a hierarquia e detecta níveis automaticamente
func (cd *ConcurrentDiscoverer) analyzeHierarchy(node LibraryNode) *HierarchyMetadata {
	metadata := &HierarchyMetadata{
		LevelMap: make(map[string]string),
		Stats:    HierarchyStats{},
	}
	
	maxDepth := cd.analyzeDepthRecursive(node, 0)
	metadata.MaxDepth = maxDepth
	metadata.TotalLevels = maxDepth + 1
	
	// Detectar tipo de nível baseado na profundidade máxima
	switch maxDepth {
	case 0:
		metadata.RootLevel = "CAPÍTULO"
		metadata.LevelMap["0"] = "CAPÍTULO"
	case 1:
		metadata.RootLevel = "OBRA"
		metadata.LevelMap["0"] = "OBRA"
		metadata.LevelMap["1"] = "CAPÍTULO"
	case 2:
		metadata.RootLevel = "SCAN"
		metadata.LevelMap["0"] = "SCAN"
		metadata.LevelMap["1"] = "OBRA"
		metadata.LevelMap["2"] = "CAPÍTULO"
	case 3:
		metadata.RootLevel = "AGREGADOR"
		metadata.LevelMap["0"] = "AGREGADOR"
		metadata.LevelMap["1"] = "SCAN"
		metadata.LevelMap["2"] = "OBRA"
		metadata.LevelMap["3"] = "CAPÍTULO"
	default:
		metadata.RootLevel = "AGREGADOR"
		for i := 0; i <= maxDepth; i++ {
			if i == maxDepth {
				metadata.LevelMap[fmt.Sprintf("%d", i)] = "CAPÍTULO"
			} else {
				metadata.LevelMap[fmt.Sprintf("%d", i)] = fmt.Sprintf("NÍVEL_%d", i)
			}
		}
	}
	
	// Calcular estatísticas
	cd.calculateStats(node, &metadata.Stats)
	
	return metadata
}

// analyzeDepthRecursive encontra a profundidade onde estão os capítulos
func (cd *ConcurrentDiscoverer) analyzeDepthRecursive(node LibraryNode, currentDepth int) int {
	maxChapterDepth := -1
	
	for key, value := range node {
		if key != "_files" {
			if subNode, ok := value.(LibraryNode); ok {
				if _, hasFiles := subNode["_files"]; hasFiles {
					if maxChapterDepth < currentDepth {
						maxChapterDepth = currentDepth
					}
				} else {
					chapterDepth := cd.analyzeDepthRecursive(subNode, currentDepth+1)
					if chapterDepth >= 0 && chapterDepth > maxChapterDepth {
						maxChapterDepth = chapterDepth
					}
				}
			}
		}
	}
	
	return maxChapterDepth
}

// calculateStats calcula estatísticas da biblioteca
func (cd *ConcurrentDiscoverer) calculateStats(node LibraryNode, stats *HierarchyStats) {
	for key, value := range node {
		if key == "_files" {
			if files, ok := value.([]string); ok {
				stats.TotalImages += len(files)
				stats.TotalChapters++
			}
		} else if subNode, ok := value.(LibraryNode); ok {
			stats.TotalDirectories++
			cd.calculateStats(subNode, stats)
		}
	}
}

// Close cancela operações em andamento
func (cd *ConcurrentDiscoverer) Close() {
	cd.cancel()
}

// min retorna o menor de dois inteiros
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
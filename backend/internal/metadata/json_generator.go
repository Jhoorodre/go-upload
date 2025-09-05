package metadata

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// MangaJSON representa a estrutura de JSON de uma obra individual
type MangaJSON struct {
	Title       string              `json:"title"`
	Description string              `json:"description"`
	Artist      string              `json:"artist"`
	Author      string              `json:"author"`
	Cover       string              `json:"cover"`
	Status      string              `json:"status"`
	Chapters    map[string]Chapter  `json:"chapters"`
}

// Chapter representa um capítulo no JSON
type Chapter struct {
	Title       string                    `json:"title"`
	Volume      string                    `json:"volume"` 
	LastUpdated string                    `json:"last_updated"`
	Groups      map[string][]string       `json:"groups"`
}

// UploadedFile representa um arquivo que foi feito upload
type UploadedFile struct {
	MangaID      string
	MangaTitle   string
	ChapterID    string
	ChapterTitle string // Título personalizado do capítulo (ex: "O andar de testes")
	FileName     string
	URL          string
	PageIndex    int // Índice da página (0, 1, 2, ...)
}

// MangaMetadata representa metadados básicos de uma obra
type MangaMetadata struct {
	ID          string
	Title       string
	Description string
	Artist      string
	Author      string
	Cover       string
	Status      string
}

// JSONGenerator gera JSONs individuais para cada obra
type JSONGenerator struct {
	libraryRoot string
	groupName   string
}

// NewJSONGenerator cria um novo gerador de JSONs
func NewJSONGenerator(libraryRoot, groupName string) *JSONGenerator {
	if groupName == "" {
		groupName = "scan_group"
	}
	
	return &JSONGenerator{
		libraryRoot: libraryRoot,
		groupName:   groupName,
	}
}

// GenerateIndividualJSONs gera JSONs individuais para uma lista de arquivos uploadados
func (jg *JSONGenerator) GenerateIndividualJSONs(uploadedFiles []UploadedFile, mangaMetadata map[string]MangaMetadata) ([]string, error) {
	// Agrupar arquivos por mangaID
	filesByManga := jg.groupFilesByManga(uploadedFiles)
	
	var generatedPaths []string
	
	// Gerar JSON para cada obra
	for mangaID, files := range filesByManga {
		jsonPath, err := jg.generateSingleMangaJSON(mangaID, files, mangaMetadata[mangaID])
		if err != nil {
			return generatedPaths, fmt.Errorf("failed to generate JSON for manga %s: %v", mangaID, err)
		}
		
		generatedPaths = append(generatedPaths, jsonPath)
	}
	
	return generatedPaths, nil
}

// generateSingleMangaJSON gera o JSON individual de uma obra
func (jg *JSONGenerator) generateSingleMangaJSON(mangaID string, files []UploadedFile, metadata MangaMetadata) (string, error) {
	// Usar diretório json/ para compatibilidade com frontend
	jsonDir := "json"
	if err := os.MkdirAll(jsonDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create json directory: %v", err)
	}
	
	// Agrupar arquivos por capítulo
	chapterFiles := jg.groupFilesByChapter(files)
	
	// Construir estrutura de capítulos
	chapters := make(map[string]Chapter)
	
	for chapterID, chapterFileList := range chapterFiles {
		// Formatar ID do capítulo com zeros à esquerda (001, 002, etc.)
		chapterIndex := jg.formatChapterIndex(chapterID)
		
		// Ordenar URLs por índice numérico das páginas (não alfabético)
		sortedFiles := jg.sortFilesByPageIndex(chapterFileList)
		var urls []string
		for _, file := range sortedFiles {
			urls = append(urls, file.URL)
		}
		
		// Estimar volume baseado no número do capítulo
		volume := jg.estimateVolume(chapterID)
		
		// Determinar título do capítulo
		chapterTitle := jg.getChapterTitle(chapterID, chapterFileList)
		
		chapters[chapterIndex] = Chapter{
			Title:       chapterTitle,
			Volume:      volume,
			LastUpdated: fmt.Sprintf("%d", time.Now().Unix()),
			Groups: map[string][]string{
				jg.groupName: urls,
			},
		}
	}
	
	// Criar estrutura JSON final
	mangaJSON := MangaJSON{
		Title:       metadata.Title,
		Description: metadata.Description,
		Artist:      metadata.Artist,
		Author:      metadata.Author,
		Cover:       metadata.Cover,
		Status:      metadata.Status,
		Chapters:    chapters,
	}
	
	// Salvar JSON no arquivo usando mangaID como identificador único
	// Extract folder name from mangaID (remove "auto-" prefix if present)
	folderName := mangaID
	if strings.HasPrefix(mangaID, "auto-") {
		folderName = strings.TrimPrefix(mangaID, "auto-")
	}
	sanitizedFolderName := jg.SanitizeFilename(folderName)
	jsonPath := filepath.Join(jsonDir, fmt.Sprintf("%s.json", sanitizedFolderName))
	if err := jg.saveJSONFile(jsonPath, mangaJSON); err != nil {
		return "", fmt.Errorf("failed to save JSON file: %v", err)
	}
	
	return jsonPath, nil
}

// groupFilesByManga agrupa arquivos por mangaID
func (jg *JSONGenerator) groupFilesByManga(files []UploadedFile) map[string][]UploadedFile {
	filesByManga := make(map[string][]UploadedFile)
	
	for _, file := range files {
		filesByManga[file.MangaID] = append(filesByManga[file.MangaID], file)
	}
	
	return filesByManga
}

// groupFilesByChapter agrupa arquivos por capítulo
func (jg *JSONGenerator) groupFilesByChapter(files []UploadedFile) map[string][]UploadedFile {
	chapterFiles := make(map[string][]UploadedFile)
	
	for _, file := range files {
		chapterFiles[file.ChapterID] = append(chapterFiles[file.ChapterID], file)
	}
	
	return chapterFiles
}

// formatChapterIndex formata o índice do capítulo com zeros à esquerda
func (jg *JSONGenerator) formatChapterIndex(chapterID string) string {
	// Tentar converter para número e formatar
	if num, err := strconv.Atoi(chapterID); err == nil {
		return fmt.Sprintf("%03d", num)
	}
	
	// Se não conseguir converter, usar como está
	return chapterID
}

// estimateVolume estima o volume baseado no número do capítulo
func (jg *JSONGenerator) estimateVolume(chapterID string) string {
	if num, err := strconv.Atoi(chapterID); err == nil {
		// Seguir padrão do exemplo: apenas primeiro capítulo tem volume
		if num == 1 {
			return "1"
		}
	}
	
	return "" // Vazio para a maioria dos capítulos (padrão do exemplo)
}

// getChapterTitle determina o título do capítulo baseado nos metadados disponíveis
func (jg *JSONGenerator) getChapterTitle(chapterID string, files []UploadedFile) string {
	// Procurar por título personalizado nos arquivos
	for _, file := range files {
		if file.ChapterTitle != "" {
			return fmt.Sprintf("Cap %s - %s", chapterID, file.ChapterTitle)
		}
	}
	
	// Fallback: título padrão
	return fmt.Sprintf("Cap %s", chapterID)
}

// saveJSONFile salva a estrutura JSON em um arquivo com ordem correta dos campos
func (jg *JSONGenerator) saveJSONFile(path string, data MangaJSON) error {
	// Criar JSON manualmente para preservar ordem exata dos campos
	jsonContent := jg.buildOrderedJSON(data)
	
	// Escrever arquivo
	if err := os.WriteFile(path, []byte(jsonContent), 0644); err != nil {
		return fmt.Errorf("failed to write JSON file: %v", err)
	}
	
	return nil
}

// buildOrderedJSON constrói JSON com ordem exata dos campos como Tower_of_God
func (jg *JSONGenerator) buildOrderedJSON(data MangaJSON) string {
	var result strings.Builder
	
	// Cabeçalho do JSON
	result.WriteString("{\n")
	
	// Campos principais na ordem correta
	titleJSON, _ := json.Marshal(data.Title)
	descriptionJSON, _ := json.Marshal(data.Description)
	artistJSON, _ := json.Marshal(data.Artist)
	authorJSON, _ := json.Marshal(data.Author)
	coverJSON, _ := json.Marshal(data.Cover)
	statusJSON, _ := json.Marshal(data.Status)
	
	result.WriteString(fmt.Sprintf("  \"title\": %s,\n", string(titleJSON)))
	result.WriteString(fmt.Sprintf("  \"description\": %s,\n", string(descriptionJSON)))
	result.WriteString(fmt.Sprintf("  \"artist\": %s,\n", string(artistJSON)))
	result.WriteString(fmt.Sprintf("  \"author\": %s,\n", string(authorJSON)))
	result.WriteString(fmt.Sprintf("  \"cover\": %s,\n", string(coverJSON)))
	result.WriteString(fmt.Sprintf("  \"status\": %s,\n", string(statusJSON)))
	
	// Seção chapters
	result.WriteString("  \"chapters\": {\n")
	
	if len(data.Chapters) > 0 {
		// Ordenar chaves dos capítulos
		chapterKeys := make([]string, 0, len(data.Chapters))
		for key := range data.Chapters {
			chapterKeys = append(chapterKeys, key)
		}
		sort.Strings(chapterKeys)
		
		for i, chapterKey := range chapterKeys {
			chapter := data.Chapters[chapterKey]
			
			// Cada capítulo com ordem correta dos campos
			result.WriteString(fmt.Sprintf("    \"%s\": {\n", chapterKey))
			
			titleChapterJSON, _ := json.Marshal(chapter.Title)
			volumeJSON, _ := json.Marshal(chapter.Volume)
			
			result.WriteString(fmt.Sprintf("      \"title\": %s,\n", string(titleChapterJSON)))
			result.WriteString(fmt.Sprintf("      \"volume\": %s,\n", string(volumeJSON)))
			result.WriteString(fmt.Sprintf("      \"last_updated\": \"%s\",\n", chapter.LastUpdated))
			result.WriteString("      \"groups\": {\n")
			
			// Groups
			groupKeys := make([]string, 0, len(chapter.Groups))
			for key := range chapter.Groups {
				groupKeys = append(groupKeys, key)
			}
			sort.Strings(groupKeys)
			
			for j, groupKey := range groupKeys {
				urls := chapter.Groups[groupKey]
				urlsJSON, _ := json.Marshal(urls)
				
				groupNameJSON, _ := json.Marshal(groupKey)
				result.WriteString(fmt.Sprintf("        %s: %s", string(groupNameJSON), string(urlsJSON)))
				
				if j < len(groupKeys)-1 {
					result.WriteString(",")
				}
				result.WriteString("\n")
			}
			
			result.WriteString("      }\n")
			result.WriteString("    }")
			
			if i < len(chapterKeys)-1 {
				result.WriteString(",")
			}
			result.WriteString("\n")
		}
	}
	
	result.WriteString("  }\n")
	result.WriteString("}")
	
	return result.String()
}

// UpdateExistingJSON atualiza um JSON existente com novos dados e metadados opcionais
func (jg *JSONGenerator) UpdateExistingJSON(jsonPath string, newFiles []UploadedFile, updateMode string, mangaMetadata ...MangaMetadata) error {
	var existingData MangaJSON
	
	// Tentar carregar JSON existente
	if data, err := os.ReadFile(jsonPath); err == nil {
		json.Unmarshal(data, &existingData)
	}
	
	// Se não existe, criar estrutura vazia
	if existingData.Chapters == nil {
		existingData.Chapters = make(map[string]Chapter)
	}
	
	// Atualizar metadados base se fornecidos, mas sempre preservar metadados existentes
	if len(mangaMetadata) > 0 {
		metadata := mangaMetadata[0]
		// Atualizar apenas se novos valores não estiverem vazios, senão manter existentes
		if metadata.Title != "" {
			existingData.Title = metadata.Title
		}
		if metadata.Description != "" {
			existingData.Description = metadata.Description
		}
		if metadata.Artist != "" {
			existingData.Artist = metadata.Artist
		}
		if metadata.Author != "" {
			existingData.Author = metadata.Author
		}
		if metadata.Cover != "" {
			existingData.Cover = metadata.Cover
		}
		if metadata.Status != "" {
			existingData.Status = metadata.Status
		}
	}
	// Nota: Se não há metadados fornecidos, os existentes são automaticamente preservados
	
	// Agrupar novos arquivos por capítulo
	newChapterFiles := jg.groupFilesByChapter(newFiles)
	
	switch updateMode {
	case "replace":
		// Substituir todos os capítulos
		existingData.Chapters = make(map[string]Chapter)
		jg.addChaptersToJSON(&existingData, newChapterFiles)
		
	case "add":
		// Adicionar apenas novos capítulos, manter existentes
		jg.addOnlyNewChapters(&existingData, newChapterFiles)
		
	case "smart":
		// Modo inteligente: atualizar capítulos existentes, adicionar novos
		jg.smartMergeChapters(&existingData, newChapterFiles)
		
	default:
		// Modo padrão é smart
		jg.smartMergeChapters(&existingData, newChapterFiles)
	}
	
	// Atualizar timestamp
	for chapterIndex, chapter := range existingData.Chapters {
		chapter.LastUpdated = fmt.Sprintf("%d", time.Now().Unix())
		existingData.Chapters[chapterIndex] = chapter
	}
	
	// Salvar JSON atualizado
	return jg.saveJSONFile(jsonPath, existingData)
}

// addChaptersToJSON adiciona capítulos ao JSON
func (jg *JSONGenerator) addChaptersToJSON(mangaJSON *MangaJSON, chapterFiles map[string][]UploadedFile) {
	for chapterID, files := range chapterFiles {
		chapterIndex := jg.formatChapterIndex(chapterID)
		
		sortedFiles := jg.sortFilesByPageIndex(files)
		var urls []string
		for _, file := range sortedFiles {
			urls = append(urls, file.URL)
		}
		
		chapterTitle := jg.getChapterTitle(chapterID, files)
		
		mangaJSON.Chapters[chapterIndex] = Chapter{
			Title:       chapterTitle,
			Volume:      jg.estimateVolume(chapterID),
			LastUpdated: fmt.Sprintf("%d", time.Now().Unix()),
			Groups: map[string][]string{
				jg.groupName: urls,
			},
		}
	}
}

// addOnlyNewChapters adiciona apenas novos capítulos, sem modificar existentes
func (jg *JSONGenerator) addOnlyNewChapters(mangaJSON *MangaJSON, chapterFiles map[string][]UploadedFile) {
	for chapterID, files := range chapterFiles {
		chapterIndex := jg.formatChapterIndex(chapterID)
		
		// Verificar se o capítulo já existe
		if _, exists := mangaJSON.Chapters[chapterIndex]; exists {
			// Capítulo já existe, não adicionar/atualizar
			continue
		}
		
		// Capítulo não existe, adicionar
		sortedFiles := jg.sortFilesByPageIndex(files)
		var urls []string
		for _, file := range sortedFiles {
			urls = append(urls, file.URL)
		}
		
		chapterTitle := jg.getChapterTitle(chapterID, files)
		
		mangaJSON.Chapters[chapterIndex] = Chapter{
			Title:       chapterTitle,
			Volume:      jg.estimateVolume(chapterID),
			LastUpdated: fmt.Sprintf("%d", time.Now().Unix()),
			Groups: map[string][]string{
				jg.groupName: urls,
			},
		}
	}
}

// smartMergeChapters faz merge inteligente de capítulos
func (jg *JSONGenerator) smartMergeChapters(mangaJSON *MangaJSON, newChapterFiles map[string][]UploadedFile) {
	for chapterID, files := range newChapterFiles {
		chapterIndex := jg.formatChapterIndex(chapterID)
		
		sortedFiles := jg.sortFilesByPageIndex(files)
		var urls []string
		for _, file := range sortedFiles {
			urls = append(urls, file.URL)
		}
		
		// Se capítulo já existe, fazer merge inteligente. Se não, adicionar.
		if existingChapter, exists := mangaJSON.Chapters[chapterIndex]; exists {
			// Smart Mode: fazer merge das URLs existentes com as novas
			if existingChapter.Groups == nil {
				existingChapter.Groups = make(map[string][]string)
			}
			
			// Obter URLs existentes do grupo
			existingURLs := existingChapter.Groups[jg.groupName]
			
			// Fazer merge inteligente: combinar URLs existentes + novas, removendo duplicatas
			mergedURLs := jg.smartMergeURLs(existingURLs, urls)
			
			existingChapter.Groups[jg.groupName] = mergedURLs
			existingChapter.LastUpdated = fmt.Sprintf("%d", time.Now().Unix())
			mangaJSON.Chapters[chapterIndex] = existingChapter
		} else {
			// Adicionar novo capítulo
			chapterTitle := jg.getChapterTitle(chapterID, files)
			
			mangaJSON.Chapters[chapterIndex] = Chapter{
				Title:       chapterTitle,
				Volume:      jg.estimateVolume(chapterID),
				LastUpdated: fmt.Sprintf("%d", time.Now().Unix()),
				Groups: map[string][]string{
					jg.groupName: urls,
				},
			}
		}
	}
}

// smartMergeURLs faz merge inteligente de URLs, removendo duplicatas e preservando ordem
func (jg *JSONGenerator) smartMergeURLs(existingURLs, newURLs []string) []string {
	// Usar mapa para remover duplicatas rapidamente
	urlSet := make(map[string]bool)
	var result []string
	
	// Adicionar URLs existentes primeiro (preservar ordem original)
	for _, url := range existingURLs {
		if !urlSet[url] {
			urlSet[url] = true
			result = append(result, url)
		}
	}
	
	// Adicionar novas URLs que não existem
	for _, url := range newURLs {
		if !urlSet[url] {
			urlSet[url] = true
			result = append(result, url)
		}
	}
	
	return result
}

// GetMangaJSONPath retorna o caminho do JSON de uma obra
func (jg *JSONGenerator) GetMangaJSONPath(mangaID string) string {
	return filepath.Join(jg.libraryRoot, mangaID, "metadata.json")
}

// LoadMangaJSON carrega um JSON de obra existente
func (jg *JSONGenerator) LoadMangaJSON(mangaID string) (*MangaJSON, error) {
	jsonPath := jg.GetMangaJSONPath(mangaID)
	
	data, err := os.ReadFile(jsonPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read JSON file: %v", err)
	}
	
	var mangaJSON MangaJSON
	if err := json.Unmarshal(data, &mangaJSON); err != nil {
		return nil, fmt.Errorf("failed to parse JSON: %v", err)
	}
	
	return &mangaJSON, nil
}

// ValidateJSON verifica se um JSON tem a estrutura correta
func (jg *JSONGenerator) ValidateJSON(data []byte) error {
	var mangaJSON MangaJSON
	return json.Unmarshal(data, &mangaJSON)
}

// sortFilesByPageIndex ordena arquivos pelo índice numérico da página
func (jg *JSONGenerator) sortFilesByPageIndex(files []UploadedFile) []UploadedFile {
	// Fazer uma cópia para não modificar o slice original
	sortedFiles := make([]UploadedFile, len(files))
	copy(sortedFiles, files)
	
	// Extrair índices de página dos nomes de arquivo se não estiverem definidos
	for i := range sortedFiles {
		if sortedFiles[i].PageIndex == 0 {
			sortedFiles[i].PageIndex = jg.ExtractPageIndex(sortedFiles[i].FileName)
		}
	}
	
	// Ordenar por índice da página
	sort.Slice(sortedFiles, func(i, j int) bool {
		return sortedFiles[i].PageIndex < sortedFiles[j].PageIndex
	})
	
	return sortedFiles
}

// SanitizeFilename sanitiza nome de arquivo removendo caracteres inválidos (função pública)
func (jg *JSONGenerator) SanitizeFilename(filename string) string {
	// Remover caracteres especiais e substituir espaços por underscores
	reg := regexp.MustCompile(`[<>:"/\\|?*]`)
	sanitized := reg.ReplaceAllString(filename, "")
	
	// Substituir espaços por underscores
	sanitized = strings.ReplaceAll(sanitized, " ", "_")
	
	// Remover múltiplos underscores consecutivos
	reg2 := regexp.MustCompile(`_+`)
	sanitized = reg2.ReplaceAllString(sanitized, "_")
	
	// Remover underscores no início e fim
	sanitized = strings.Trim(sanitized, "_")
	
	return sanitized
}

// ExtractPageIndex extrai o índice numérico da página do nome do arquivo (função pública)
func (jg *JSONGenerator) ExtractPageIndex(fileName string) int {
	// Remover extensão
	baseName := strings.TrimSuffix(fileName, filepath.Ext(fileName))
	
	// Padrões comuns para páginas: page001, 001, p01, etc.
	patterns := []string{
		`page(\d+)`,    // page001, page1
		`p(\d+)`,       // p001, p1  
		`(\d+)$`,       // 001, 1 (números no final)
		`(\d+)`,        // qualquer número no nome
	}
	
	for _, pattern := range patterns {
		re := regexp.MustCompile(`(?i)` + pattern) // case insensitive
		matches := re.FindStringSubmatch(baseName)
		if len(matches) > 1 {
			if index, err := strconv.Atoi(matches[1]); err == nil {
				// Garantir que encontramos um número válido (não zero para páginas)
				if index > 0 {
					return index
				}
			}
		}
	}
	
	// Se não encontrar padrão, usar hash do nome para ordem determinística
	hash := 0
	for _, char := range fileName {
		hash = hash*31 + int(char)
	}
	result := hash % 9999 // Evitar conflito com páginas reais
	if result <= 0 {
		result = 9999 // Colocar no final se não conseguir extrair
	}
	return result
}
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"go-upload/backend/internal/metadata"
)

// Example demonstrating individual JSON generation
func main() {
	fmt.Println("=== Exemplo de Geração Individual de JSONs ===")
	
	// Simulate library root
	libraryRoot := "test_manga_library"
	os.MkdirAll(libraryRoot, 0755)
	defer os.RemoveAll(libraryRoot) // Cleanup after demo
	
	// Create JSON generator
	generator := metadata.NewJSONGenerator(libraryRoot, "scan_group")
	
	// Simulate uploaded files for multiple manga
	uploadedFiles := []metadata.UploadedFile{
		// Kagurabachi files
		{MangaID: "kagurabachi", MangaTitle: "Kagurabachi", ChapterID: "1", FileName: "page01.jpg", URL: "https://catbox.moe/c/kb_ch1_p1.jpg"},
		{MangaID: "kagurabachi", MangaTitle: "Kagurabachi", ChapterID: "1", FileName: "page02.jpg", URL: "https://catbox.moe/c/kb_ch1_p2.jpg"},
		{MangaID: "kagurabachi", MangaTitle: "Kagurabachi", ChapterID: "2", FileName: "page01.jpg", URL: "https://catbox.moe/c/kb_ch2_p1.jpg"},
		
		// Gachiakuta files
		{MangaID: "gachiakuta", MangaTitle: "Gachiakuta", ChapterID: "1", FileName: "page01.jpg", URL: "https://catbox.moe/c/ga_ch1_p1.jpg"},
		{MangaID: "gachiakuta", MangaTitle: "Gachiakuta", ChapterID: "1", FileName: "page02.jpg", URL: "https://catbox.moe/c/ga_ch1_p2.jpg"},
		
		// Mushoku files
		{MangaID: "mushoku", MangaTitle: "Mushoku Tensei", ChapterID: "1", FileName: "page01.jpg", URL: "https://catbox.moe/c/mt_ch1_p1.jpg"},
	}
	
	// Create metadata for each manga
	mangaMetadata := map[string]metadata.MangaMetadata{
		"kagurabachi": {
			ID:          "kagurabachi",
			Title:       "Kagurabachi",
			Description: "Chihiro busca vingança com a ajuda das lâminas encantadas forjadas por seu pai.",
			Artist:      "Takeru Hokazono",
			Author:      "Takeru Hokazono",
			Cover:       "https://placehold.co/200x300/1f2937/9ca3af?text=Kagurabachi",
			Status:      "Em Andamento",
		},
		"gachiakuta": {
			ID:          "gachiakuta",
			Title:       "Gachiakuta",
			Description: "Um jovem de uma favela luta para sobreviver em um mundo onde o lixo ganha vida.",
			Artist:      "Kei Urana",
			Author:      "Kei Urana",
			Cover:       "https://placehold.co/200x300/4f46e5/e0e7ff?text=Gachiakuta",
			Status:      "Em Andamento",
		},
		"mushoku": {
			ID:          "mushoku",
			Title:       "Mushoku Tensei",
			Description: "Um homem de 34 anos reencarna em um mundo de magia e decide viver sua nova vida ao máximo.",
			Artist:      "Yuka Fujikawa",
			Author:      "Rifujin na Magonote",
			Cover:       "https://placehold.co/200x300/1f2937/9ca3af?text=Mushoku+T.",
			Status:      "Em Andamento",
		},
	}
	
	// Generate individual JSONs
	fmt.Println("\n🚀 Gerando JSONs individuais...")
	jsonPaths, err := generator.GenerateIndividualJSONs(uploadedFiles, mangaMetadata)
	if err != nil {
		log.Fatalf("Erro ao gerar JSONs: %v", err)
	}
	
	fmt.Printf("✅ Gerados %d JSONs individuais:\n", len(jsonPaths))
	
	// Display generated JSONs
	for _, jsonPath := range jsonPaths {
		fmt.Printf("\n📁 %s\n", jsonPath)
		
		// Read and display JSON content
		data, err := os.ReadFile(jsonPath)
		if err != nil {
			log.Printf("Erro ao ler %s: %v", jsonPath, err)
			continue
		}
		
		// Pretty print JSON
		var jsonObj map[string]interface{}
		json.Unmarshal(data, &jsonObj)
		prettyJSON, _ := json.MarshalIndent(jsonObj, "", "  ")
		
		fmt.Printf("Conteúdo:\n%s\n", prettyJSON)
		fmt.Println(strings.Repeat("-", 50))
	}
	
	fmt.Println("\n🎯 Estrutura de diretórios criada:")
	fmt.Println("test_manga_library/")
	fmt.Println("├── kagurabachi/")
	fmt.Println("│   └── metadata.json")
	fmt.Println("├── gachiakuta/") 
	fmt.Println("│   └── metadata.json")
	fmt.Println("└── mushoku/")
	fmt.Println("    └── metadata.json")
	
	fmt.Println("\n✨ Cada obra tem seu JSON individual com:")
	fmt.Println("- Metadados únicos (título, autor, etc.)")
	fmt.Println("- Capítulos organizados por índice (001, 002, etc.)")
	fmt.Println("- URLs reais de imagens agrupadas por capítulo")
	fmt.Println("- Timestamps de atualização")
	fmt.Println("- Estrutura compatível com upload para GitHub")
}
package main

import (
	"context"
	"fmt"
	"log"

	"go-upload/backend/internal/anilist"
)

func main() {
	fmt.Println("🚀 Demonstração AniList Service - Fase 2.1")
	fmt.Println("==========================================")

	// Criar serviço
	service := anilist.NewAniListService()
	ctx := context.Background()

	// 1. Health Check
	fmt.Println("\n1. Health Check...")
	if err := service.Health(ctx); err != nil {
		log.Printf("❌ Health check failed: %v", err)
		return
	}
	fmt.Println("✅ AniList API está funcionando!")

	// 2. Rate Limit Status
	fmt.Println("\n2. Rate Limit Status...")
	status := service.GetRateLimitStatus()
	fmt.Printf("📊 Limite: %v/%v requests, Restantes: %v\n", 
		status["used"], status["limit"], status["remaining"])

	// 3. Busca Simples
	fmt.Println("\n3. Busca Simples...")
	result, err := service.SearchMangaSimple(ctx, "Attack on Titan")
	if err != nil {
		log.Printf("❌ Search failed: %v", err)
		return
	}

	fmt.Printf("✅ Encontrados %d resultados de %d total em %dms\n", 
		len(result.Results), result.Total, result.TimeMS)

	// 4. Mostrar primeiro resultado
	if len(result.Results) > 0 {
		first := result.Results[0]
		title := getTitle(first.Title)
		fmt.Printf("   Primeiro: %s (ID: %d)\n", title, first.ID)

		// 5. Buscar detalhes
		fmt.Println("\n4. Buscando detalhes...")
		details, err := service.GetMangaDetails(ctx, first.ID)
		if err != nil {
			log.Printf("❌ Details failed: %v", err)
		} else {
			metadata := anilist.MapAniListToMangaMetadata(details.Media)
			fmt.Printf("✅ Título: %s\n", metadata.Title)
			fmt.Printf("   Autor: %s\n", metadata.Author)
			fmt.Printf("   Status: %s\n", metadata.Status)
		}
	}

	// 6. Rate Limit Final
	fmt.Println("\n5. Rate Limit Final...")
	finalStatus := service.GetRateLimitStatus()
	fmt.Printf("📊 Usado: %v/%v requests\n", 
		finalStatus["used"], finalStatus["limit"])

	fmt.Println("\n✅ Demonstração concluída!")
}

func getTitle(title anilist.Title) string {
	if title.English != nil && *title.English != "" {
		return *title.English
	}
	if title.Romaji != nil && *title.Romaji != "" {
		return *title.Romaji
	}
	if title.Native != nil && *title.Native != "" {
		return *title.Native
	}
	return "Unknown Title"
}

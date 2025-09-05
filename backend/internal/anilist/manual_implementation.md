# Implementação Manual das Queries AniList

## Problema Identificado

O `gqlgenc v0.33.0` apresenta um bug com queries complexas que incluem o tipo `Media` da AniList API. O erro manifesta-se como:

```
panic: runtime error: index out of range [0] with length 0
```

## Solução Temporária

Implementar as queries manualmente usando cliente HTTP direto até que o problema seja resolvido.

## Queries Validadas

As queries em `queries/manga.graphql` foram testadas e validadas no GraphiQL da AniList:

### 1. SearchManga
- **Funcional**: ✅ Testada em https://anilist.co/graphiql
- **Retorna**: Lista de mangás com metadados básicos
- **Campos**: id, title, description, status, chapters, volumes, genres, coverImage, staff

### 2. MangaDetails  
- **Funcional**: ✅ Testada em https://anilist.co/graphiql
- **Retorna**: Detalhes completos de um mangá específico
- **Campos**: Todos os metadados necessários para o sistema

## Implementação Manual Sugerida

### Estruturas Go (criar manualmente)

```go
// Estruturas para respostas da AniList
type AniListResponse struct {
    Data   interface{} `json:"data"`
    Errors []GraphQLError `json:"errors,omitempty"`
}

type GraphQLError struct {
    Message   string `json:"message"`
    Locations []struct {
        Line   int `json:"line"`
        Column int `json:"column"`
    } `json:"locations,omitempty"`
}

type SearchMangaResponse struct {
    Page struct {
        PageInfo struct {
            Total       int  `json:"total"`
            CurrentPage int  `json:"currentPage"`
            LastPage    int  `json:"lastPage"`
            HasNextPage bool `json:"hasNextPage"`
        } `json:"pageInfo"`
        Media []MangaBasic `json:"media"`
    } `json:"Page"`
}

type MangaBasic struct {
    ID          int      `json:"id"`
    Title       Title    `json:"title"`
    Description string   `json:"description"`
    Status      string   `json:"status"`
    Chapters    *int     `json:"chapters"`
    Volumes     *int     `json:"volumes"`
    Genres      []string `json:"genres"`
    MeanScore   *int     `json:"meanScore"`
    Popularity  int      `json:"popularity"`
    CoverImage  Image    `json:"coverImage"`
    Staff       Staff    `json:"staff"`
}

type Title struct {
    Romaji  *string `json:"romaji"`
    English *string `json:"english"`
    Native  *string `json:"native"`
}

type Image struct {
    ExtraLarge *string `json:"extraLarge"`
    Large      *string `json:"large"`
    Medium     *string `json:"medium"`
    Color      *string `json:"color"`
}

type Staff struct {
    Edges []StaffEdge `json:"edges"`
}

type StaffEdge struct {
    Role string    `json:"role"`
    Node StaffNode `json:"node"`
}

type StaffNode struct {
    Name struct {
        Full string `json:"full"`
    } `json:"name"`
}
```

### Cliente HTTP Manual

```go
func (s *AniListService) SearchManga(ctx context.Context, search string, page int) (*SearchMangaResponse, error) {
    query := `
    query SearchManga($search: String!, $page: Int) {
      Page(page: $page, perPage: 10) {
        pageInfo {
          total
          currentPage
          lastPage
          hasNextPage
        }
        media(search: $search, type: MANGA) {
          id
          title {
            romaji
            english
            native
          }
          description(asHtml: false)
          status
          chapters
          volumes
          genres
          meanScore
          popularity
          coverImage {
            extraLarge
            large
            medium
            color
          }
          staff(perPage: 5) {
            edges {
              role
              node {
                name {
                  full
                }
              }
            }
          }
        }
      }
    }`
    
    variables := map[string]interface{}{
        "search": search,
        "page":   page,
    }
    
    return s.executeQuery(ctx, query, variables)
}

func (s *AniListService) executeQuery(ctx context.Context, query string, variables map[string]interface{}) (*SearchMangaResponse, error) {
    requestBody := map[string]interface{}{
        "query":     query,
        "variables": variables,
    }
    
    jsonBody, err := json.Marshal(requestBody)
    if err != nil {
        return nil, err
    }
    
    req, err := http.NewRequestWithContext(ctx, "POST", "https://graphql.anilist.co", bytes.NewBuffer(jsonBody))
    if err != nil {
        return nil, err
    }
    
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("Accept", "application/json")
    
    resp, err := s.httpClient.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    var anilistResp AniListResponse
    if err := json.NewDecoder(resp.Body).Decode(&anilistResp); err != nil {
        return nil, err
    }
    
    if len(anilistResp.Errors) > 0 {
        return nil, fmt.Errorf("GraphQL errors: %v", anilistResp.Errors)
    }
    
    // Converter anilistResp.Data para SearchMangaResponse
    jsonData, _ := json.Marshal(anilistResp.Data)
    var result SearchMangaResponse
    json.Unmarshal(jsonData, &result)
    
    return &result, nil
}
```

## Próximos Passos

1. **Fase 1.3**: Implementar mapeamento usando estruturas manuais
2. **Fase 2.1**: Criar AniListService com métodos manuais  
3. **Futuro**: Migrar de volta para gqlgenc quando bug for corrigido

## Alternativas de Ferramentas

Se o problema persistir, considerar:
- `github.com/Khan/genqlient` - Gerador alternativo de clientes GraphQL
- `github.com/shurcooL/graphql` - Cliente GraphQL simples
- Implementação HTTP manual (como sugerido acima)

## Status

- ✅ Queries criadas e documentadas
- ✅ Problema identificado e documentado
- ⏳ Aguardando implementação manual na Fase 2.1
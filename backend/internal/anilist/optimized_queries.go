package anilist

// safeStringValue converte *string para string com valor padrão
func safeStringValue(s *string) string {
	if s != nil {
		return *s
	}
	return ""
}

// safeIntValue converte *int para int com valor padrão
func safeIntValue(i *int) int {
	if i != nil {
		return *i
	}
	return 0
}

// OptimizedQueries contém versões otimizadas das queries GraphQL
// com campos reduzidos para melhorar performance

// SearchMangaOptimized - query otimizada para busca (payload reduzido)
type SearchMangaOptimized struct {
	Page struct {
		PageInfo struct {
			Total       int  `graphql:"total"`
			CurrentPage int  `graphql:"currentPage"`
			LastPage    int  `graphql:"lastPage"`
			HasNextPage bool `graphql:"hasNextPage"`
		} `graphql:"pageInfo"`
		Media []MangaSearchResult `graphql:"media(search: $search, type: MANGA, sort: SEARCH_MATCH)"`
	} `graphql:"Page(page: $page, perPage: $perPage)"`
}

// MangaSearchResult - resultado otimizado para listagem (apenas campos essenciais)
type MangaSearchResult struct {
	ID    int   `graphql:"id"`
	Title Title `graphql:"title"`
	
	// Apenas formato de imagem necessário para preview
	CoverImage struct {
		Large  *string `graphql:"large"`  // Suficiente para preview
		Color  *string `graphql:"color"`  // Para placeholders coloridos
	} `graphql:"coverImage"`
	
	// Informações básicas para identificação
	Status      *string `graphql:"status"`
	Format      *string `graphql:"format"`
	StartDate   Date    `graphql:"startDate"`
	
	// Apenas primeira linha da descrição para preview
	Description *string `graphql:"description(asHtml: false)"`
	
	// Campos essenciais para avaliação
	AverageScore *int `graphql:"averageScore"`
	Popularity   *int `graphql:"popularity"`
	
	// Informações básicas de publicação
	Volumes  *int `graphql:"volumes"`
	Chapters *int `graphql:"chapters"`
	
	// Apenas gêneros principais (sem descrições)
	Genres []string `graphql:"genres"`
	
	// Sinônimos para melhor busca
	Synonyms []string `graphql:"synonyms"`
}

// MangaDetailsOptimized - query otimizada para detalhes completos
type MangaDetailsOptimized struct {
	Media MangaDetailedOptimized `graphql:"Media(id: $id, type: MANGA)"`
}

// MangaDetailedOptimized - versão otimizada dos detalhes completos
type MangaDetailedOptimized struct {
	ID          int     `graphql:"id"`
	Title       Title   `graphql:"title"`
	
	// Imagens otimizadas
	CoverImage struct {
		ExtraLarge *string `graphql:"extraLarge"` // Para exibição completa
		Large      *string `graphql:"large"`      // Fallback
		Color      *string `graphql:"color"`      // Placeholder
	} `graphql:"coverImage"`
	
	// Informações completas necessárias
	Status       *string `graphql:"status"`
	Description  *string `graphql:"description(asHtml: false)"`
	Format       *string `graphql:"format"`
	StartDate    Date    `graphql:"startDate"`
	EndDate      Date    `graphql:"endDate"`
	Volumes      *int    `graphql:"volumes"`
	Chapters     *int    `graphql:"chapters"`
	AverageScore *int    `graphql:"averageScore"`
	Popularity   *int    `graphql:"popularity"`
	Favourites   *int    `graphql:"favourites"`
	
	// Gêneros e tags essenciais
	Genres []string `graphql:"genres"`
	Tags   []TagOptimized `graphql:"tags(sort: RANK)"`
	
	// Staff otimizado (apenas principais)
	Staff struct {
		Edges []StaffEdgeOptimized `graphql:"edges"`
	} `graphql:"staff(perPage: 10, sort: ROLE)"`
	
	// Links externos otimizados
	ExternalLinks []ExternalLinkOptimized `graphql:"externalLinks"`
	
	// Sinônimos para busca
	Synonyms []string `graphql:"synonyms"`
}

// TagOptimized - tag com campos essenciais apenas
type TagOptimized struct {
	Name        string `graphql:"name"`
	Rank        *int   `graphql:"rank"`
	IsMediaSpoiler bool `graphql:"isMediaSpoiler"`
}

// StaffEdgeOptimized - staff com informações essenciais
type StaffEdgeOptimized struct {
	Role string               `graphql:"role"`
	Node StaffNodeOptimized   `graphql:"node"`
}

// StaffNodeOptimized - informações básicas do staff
type StaffNodeOptimized struct {
	Name struct {
		Full string `graphql:"full"`
	} `graphql:"name"`
	PrimaryOccupations []string `graphql:"primaryOccupations"`
}

// ExternalLinkOptimized - links externos essenciais
type ExternalLinkOptimized struct {
	URL  *string `graphql:"url"`
	Site *string `graphql:"site"`
	Type *string `graphql:"type"`
}

// QueryOptimizer gerencia seleção automática de queries baseada no contexto
type QueryOptimizer struct {
	useOptimizedQueries bool
	logger              Logger
}

// NewQueryOptimizer cria um novo otimizador de queries
func NewQueryOptimizer(useOptimized bool, logger Logger) *QueryOptimizer {
	return &QueryOptimizer{
		useOptimizedQueries: useOptimized,
		logger:              logger,
	}
}

// ShouldUseOptimizedSearch determina se deve usar query otimizada para busca
func (qo *QueryOptimizer) ShouldUseOptimizedSearch(resultsCount int) bool {
	// Usar query otimizada quando:
	// 1. Otimização está habilitada
	// 2. Quantidade de resultados é alta (>5)
	return qo.useOptimizedQueries && resultsCount > 5
}

// ShouldUseOptimizedDetails determina se deve usar query otimizada para detalhes
func (qo *QueryOptimizer) ShouldUseOptimizedDetails() bool {
	// Sempre usar query otimizada se habilitada
	return qo.useOptimizedQueries
}

// EstimatePayloadSize estima o tamanho do payload em KB
func (qo *QueryOptimizer) EstimatePayloadSize(queryType string, optimized bool) float64 {
	baseSize := map[string]float64{
		"search":  15.0, // ~15KB para busca normal
		"details": 8.0,  // ~8KB para detalhes normais
	}
	
	optimizedMultiplier := 0.6 // Queries otimizadas são ~40% menores
	
	size := baseSize[queryType]
	if optimized {
		size *= optimizedMultiplier
	}
	
	return size
}

// ConvertOptimizedSearchResult converte resultado otimizado para formato padrão
func ConvertOptimizedSearchResult(optimized []MangaSearchResult) []MangaBasic {
	result := make([]MangaBasic, len(optimized))
	
	for i, opt := range optimized {
		result[i] = MangaBasic{
			ID:          opt.ID,
			Title:       opt.Title,
			CoverImage: Image{
				Large:  opt.CoverImage.Large,
				Color:  opt.CoverImage.Color,
			},
			Status:       safeStringValue(opt.Status),
			Description:  opt.Description,
			MeanScore:    opt.AverageScore,
			Popularity:   safeIntValue(opt.Popularity),
			Volumes:      opt.Volumes,
			Chapters:     opt.Chapters,
			Genres:       opt.Genres,
			Synonyms:     opt.Synonyms, // Incluir sinônimos
		}
	}
	
	return result
}

// ConvertOptimizedDetailsResult converte detalhes otimizados para formato padrão
func ConvertOptimizedDetailsResult(optimized MangaDetailedOptimized) MangaDetailed {
	// Converter tags
	tags := make([]Tag, len(optimized.Tags))
	for i, tag := range optimized.Tags {
		tags[i] = Tag{
			Name:           tag.Name,
			Rank:           tag.Rank,
			IsMediaSpoiler: tag.IsMediaSpoiler,
		}
	}
	
	// Converter staff
	staffEdges := make([]StaffEdge, len(optimized.Staff.Edges))
	for i, edge := range optimized.Staff.Edges {
		staffEdges[i] = StaffEdge{
			Role: edge.Role,
			Node: StaffNode{
				Name: struct {
					Full string `graphql:"full"`
				}{
					Full: edge.Node.Name.Full,
				},
				PrimaryOccupations: edge.Node.PrimaryOccupations,
			},
		}
	}
	
	// Converter links externos
	extLinks := make([]ExternalLink, len(optimized.ExternalLinks))
	for i, link := range optimized.ExternalLinks {
		extLinks[i] = ExternalLink{
			URL:  link.URL,
			Site: link.Site,
			Type: link.Type,
		}
	}
	
	return MangaDetailed{
		ID:          optimized.ID,
		Title:       optimized.Title,
		CoverImage: Image{
			ExtraLarge: optimized.CoverImage.ExtraLarge,
			Large:      optimized.CoverImage.Large,
			Color:      optimized.CoverImage.Color,
		},
		Status:       safeStringValue(optimized.Status),
		Description:  optimized.Description,
		Format:       optimized.Format,
		StartDate:    &optimized.StartDate,
		EndDate:      &optimized.EndDate,
		Volumes:      optimized.Volumes,
		Chapters:     optimized.Chapters,
		MeanScore:    optimized.AverageScore,
		Popularity:   safeIntValue(optimized.Popularity),
		Genres:       optimized.Genres,
		Tags:         tags,
		Staff: Staff{
			Edges: staffEdges,
		},
		ExternalLinks: extLinks,
		Synonyms:      optimized.Synonyms,
	}
}

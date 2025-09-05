// AniList integration types for frontend
export interface AniListManga {
  ID: number;
  Title: {
    Romaji: string | null;
    English: string | null;
    Native: string | null;
  };
  Description: string | null;
  Status: string;
  Chapters: number | null;
  Volumes: number | null;
  Genres: string[];
  MeanScore: number | null;
  Popularity: number;
  StartDate: {
    year: number | null;
    month: number | null;
    day: number | null;
  } | null;
  CoverImage: {
    ExtraLarge: string;
    Large: string;
    Medium: string;
    Color: string | null;
  };
  Staff: {
    Edges: Array<{
      Role: string;
      Node: {
        Name: {
          Full: string;
        };
        PrimaryOccupations: string[];
      };
    }>;
  };
  Synonyms?: string[]; // Sinônimos opcionais (disponíveis apenas em detalhes)
}

export interface AniListSearchResult {
  results: AniListManga[];
  resultCount: number;
  total: number;
  hasNextPage: boolean;
  searchQuery: string;
  duration: string;
}

export interface AniListSearchResponse {
  status: 'search_anilist_complete' | 'search_progress' | 'error';
  requestId: string;
  data?: AniListSearchResult;
  error?: string;
  progress?: {
    current: number;
    total: number;
    percentage: number;
    stage: string;
  };
}

export interface AniListSelectionResponse {
  status: 'anilist_selection_complete' | 'anilist_fetch_progress' | 'error';
  requestId: string;
  data?: {
    anilistData: AniListManga;
    metadata: AniListMetadata;
    mangaTitle: string;
    duration: string;
  };
  metadata?: AniListMetadata;
  error?: string;
  progress?: {
    current: number;
    total: number;
    percentage: number;
    stage: string;
  };
}

// Simplified search result for the UI component
export interface SearchResult {
  id: number;
  uniqueKey?: string; // Key única para evitar duplicatas no React (especialmente com sinônimos)
  title: string;
  author: string | null;
  artist: string | null;
  status: string;
  description: string | null;
  coverImage: string | null;
  genres: string[];
  startDate: {
    year: number | null;
    month: number | null;
    day: number | null;
  } | null;
  meanScore: number | null;
  synonyms?: string[]; // Adicionado para busca por sinônimos
}

// AniList Configuration Types
export interface AniListConfig {
  enabled: boolean;
  language_preference: 'romaji' | 'english' | 'native' | 'synonyms';
  fill_mode: 'manual' | 'auto';
  auto_search: boolean;
  cache_enabled: boolean;
  prefer_anilist: boolean;
  version: string;
  last_updated: string;
}

export interface AniListConfigResponse extends BaseWSResponse {
  status: 'config_retrieved' | 'config_updated' | 'config_reset' | 'error';
  data?: AniListConfig;
}

// Metadata structure that gets filled into the form
export interface AniListMetadata {
  title: string;
  description: string | null;
  author: string | null;
  artist: string | null;
  status: string;
  genres: string[];
  year: number | null;
  coverImage: string | null;
}

export interface AniListSearchHookReturn {
  searchManga: (query: string) => Promise<void>;
  selectResult: (anilistId: number, mangaTitle: string) => Promise<void>;
  results: AniListManga[];
  isSearching: boolean;
  isSelecting: boolean;
  error: string | null;
  selectedMetadata: AniListMetadata | null;
  clearResults: () => void;
  clearError: () => void;
}

// WebSocket request types
export interface AniListWSRequest {
  action: 'search_anilist' | 'select_anilist_result' | 'get_anilist_config' | 'update_anilist_config' | 'reset_anilist_config';
  requestId: string;
  data: Record<string, unknown>;
}

// Common WebSocket response base
export interface BaseWSResponse {
  status: string;
  requestId: string;
  error?: string;
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { debugWebSocket } from '../utils/websocket';
import type { AniListConfig, SearchResult, AniListMetadata } from '../types/anilist';

interface UseAniListAutoModeParams {
  config: AniListConfig | null;
  initialQuery: string;
  results: any[];
  isSearching: boolean;
  isSelecting: boolean;
  isExpanded: boolean;
  onSelectResult: (result: SearchResult) => void;
  onMetadataSelected: (metadata: AniListMetadata, preferredTitle?: string) => void;
  onExpand: () => void;
  onCollapse: () => void;
  searchManga: (query: string) => Promise<void>;
  selectedMetadata: AniListMetadata | null;
  clearResults: () => void;
}

export const useAniListAutoMode = ({
  config,
  initialQuery,
  results,
  isSearching,
  isSelecting,
  isExpanded,
  onSelectResult,
  onMetadataSelected,
  onExpand,
  onCollapse,
  searchManga,
  selectedMetadata,
  clearResults
}: UseAniListAutoModeParams) => {
  const [autoFillTriggered, setAutoFillTriggered] = useState(false);
  const [autoExpansionCompleted, setAutoExpansionCompleted] = useState(false);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  
  const previousInitialQuery = useRef<string>('');
  const sessionCompleted = useRef(new Set<string>());
  // CORREÇÃO: Capturar initialQuery estável apenas uma vez
  const stableInitialQueryRef = useRef<string>('');
  
  // CORREÇÃO: Capturar initialQuery apenas na primeira vez que é recebida
  useEffect(() => {
    if (!stableInitialQueryRef.current && initialQuery.trim()) {
      stableInitialQueryRef.current = initialQuery;
      console.log('📌 useAniListAutoMode: initialQuery estabilizada:', initialQuery);
    }
  }, []); // Executar apenas uma vez

  // Converter manga data para SearchResult
  const convertMangasToResults = useCallback((mangas: any[]): SearchResult[] => {
    const results: SearchResult[] = [];
    const preferredLanguage = config?.language_preference || 'romaji';
    
    for (const manga of mangas) {
      if (preferredLanguage === 'synonyms' && manga.Synonyms && manga.Synonyms.length > 0) {
        // Criar um resultado separado para cada sinônimo
        for (let synonymIndex = 0; synonymIndex < manga.Synonyms.length; synonymIndex++) {
          const synonym = manga.Synonyms[synonymIndex];
          results.push({
            id: manga.ID,
            uniqueKey: `${manga.ID}-synonym-${synonymIndex}`,
            title: synonym,
            author: manga.Staff?.Edges?.find((edge: any) => 
              edge.Role.toLowerCase().includes('story')
            )?.Node.Name.Full || null,
            artist: manga.Staff?.Edges?.find((edge: any) => 
              edge.Role.toLowerCase().includes('art')
            )?.Node.Name.Full || null,
            status: manga.Status,
            description: manga.Description,
            coverImage: manga.CoverImage?.Large || manga.CoverImage?.Medium || manga.CoverImage?.ExtraLarge || null,
            genres: manga.Genres,
            startDate: manga.StartDate,
            meanScore: manga.MeanScore,
            synonyms: manga.Synonyms || [],
          });
        }
      } else {
        // Lógica normal para outros idiomas
        let title: string;
        switch (preferredLanguage) {
          case 'english':
            title = manga.Title.English || manga.Title.Romaji || manga.Title.Native || 'Mangá Desconhecido';
            break;
          case 'native':
            title = manga.Title.Native || manga.Title.Romaji || manga.Title.English || 'Mangá Desconhecido';
            break;
          case 'synonyms':
            title = `${manga.Title.Romaji || manga.Title.English || manga.Title.Native || 'Mangá Desconhecido'} (sem sinônimos)`;
            break;
          case 'romaji':
          default:
            title = manga.Title.Romaji || manga.Title.English || manga.Title.Native || 'Mangá Desconhecido';
            break;
        }

        results.push({
          id: manga.ID,
          uniqueKey: `${manga.ID}-${preferredLanguage}`,
          title,
          author: manga.Staff?.Edges?.find((edge: any) => 
            edge.Role.toLowerCase().includes('story')
          )?.Node.Name.Full || null,
          artist: manga.Staff?.Edges?.find((edge: any) => 
            edge.Role.toLowerCase().includes('art')
          )?.Node.Name.Full || null,
          status: manga.Status,
          description: manga.Description,
          coverImage: manga.CoverImage?.Large || manga.CoverImage?.Medium || manga.CoverImage?.ExtraLarge || null,
          genres: manga.Genres,
          startDate: manga.StartDate,
          meanScore: manga.MeanScore,
          synonyms: manga.Synonyms || [],
        });
      }
    }
    
    return results;
  }, [config?.language_preference]);

  // Usar refs para valores que não devem causar re-renders
  const configFillModeRef = useRef(config?.fill_mode);
  const onExpandRef = useRef(onExpand);
  const searchMangaRef = useRef(searchManga);
  
  // Atualizar refs quando valores mudam
  useEffect(() => {
    configFillModeRef.current = config?.fill_mode;
    onExpandRef.current = onExpand;
    searchMangaRef.current = searchManga;
  }, [config?.fill_mode, onExpand, searchManga]);

  // Auto-expansão e busca quando modo é 'auto' e há initialQuery
  useEffect(() => {
    // CORREÇÃO: Usar a query estável ao invés da que pode mudar
    const queryKey = stableInitialQueryRef.current.trim();
    
    // Verificar se a sessão já foi completada para esta query
    if (sessionCompleted.current.has(queryKey)) {
      return;
    }
    
    if (configFillModeRef.current === 'auto' && queryKey && !isExpanded && !autoExpansionCompleted) {
      console.log('🤖 Auto-modo: Expandindo automaticamente para:', queryKey);
      onExpandRef.current();
      setAutoFillTriggered(false);
      setAutoExpansionCompleted(true);
      
      // Iniciar busca automaticamente após expansão
      setTimeout(() => {
        console.log('🤖 Auto-modo: Iniciando busca automática para:', stableInitialQueryRef.current);
        searchMangaRef.current(stableInitialQueryRef.current);
      }, 200);
    }
  }, [isExpanded, autoExpansionCompleted]); // CORREÇÃO: Remover initialQuery das dependências

  // CORREÇÃO: Simplificar reset - não precisamos mais reagir a mudanças de initialQuery
  // pois ela agora é estável
  useEffect(() => {
    const currentQuery = stableInitialQueryRef.current;
    if (currentQuery && currentQuery !== previousInitialQuery.current) {
      debugWebSocket('Query estável detectada', currentQuery);
      setAutoExpansionCompleted(false);
      
      if (previousInitialQuery.current) {
        sessionCompleted.current.delete(previousInitialQuery.current);
      }
      previousInitialQuery.current = currentQuery;
    }
  }, []); // Executar apenas uma vez quando o hook é inicializado

  // Usar refs para callbacks estáveis
  const onSelectResultRef = useRef(onSelectResult);
  
  useEffect(() => {
    onSelectResultRef.current = onSelectResult;
  }, [onSelectResult]);

  // Auto-preenchimento quando fill_mode é 'auto'
  useEffect(() => {
    if (
      configFillModeRef.current === 'auto' &&
      results.length > 0 &&
      !isSearching &&
      !isSelecting &&
      !selectedResult &&
      isExpanded &&
      !autoFillTriggered
    ) {
      console.log('🤖 Auto-preenchimento: Iniciando seleção automática', {
        resultados: results.length,
        idioma: config?.language_preference,
        primeiroResultado: results[0]?.Title?.Romaji || results[0]?.Title?.English || 'N/A'
      });
      
      setAutoFillTriggered(true);
      
      const convertedResults = convertMangasToResults(results);
      
      if (convertedResults.length > 0) {
        const firstResult = convertedResults[0];
        console.log('🤖 Auto-preenchimento: Selecionando automaticamente:', firstResult.title, 'ID:', firstResult.id);
        setSelectedResult(firstResult);
        // Chamar a função de seleção passada pelo componente pai
        onSelectResultRef.current(firstResult);
      }
    }
  }, [
    results.length, 
    isSearching, 
    isSelecting, 
    selectedResult, 
    isExpanded, 
    autoFillTriggered,
    convertMangasToResults,
    config?.language_preference
  ]); // Dependências estabilizadas

  // Usar ref para valor anterior de idioma para detectar mudanças  
  const previousLanguageRef = useRef<string | undefined>(undefined);
  
  // Auto-busca ao mudar o modo de idioma
  useEffect(() => {
    const currentLanguage = config?.language_preference;
    const queryToUse = stableInitialQueryRef.current;
    
    if (isExpanded && 
        queryToUse.trim() && 
        currentLanguage && 
        currentLanguage !== previousLanguageRef.current &&
        previousLanguageRef.current !== undefined) {
      debugWebSocket('Idioma mudou, refazendo busca', currentLanguage);
      setAutoFillTriggered(false);
      searchMangaRef.current(queryToUse);
    }
    
    previousLanguageRef.current = currentLanguage;
  }, [config?.language_preference, isExpanded]); // CORREÇÃO: Remover initialQuery das dependências

  // Usar refs para callbacks que não devem causar re-renders
  const onMetadataSelectedRef = useRef(onMetadataSelected);
  const onCollapseRef = useRef(onCollapse);
  const clearResultsRef = useRef(clearResults);
  
  useEffect(() => {
    onMetadataSelectedRef.current = onMetadataSelected;
    onCollapseRef.current = onCollapse;
    clearResultsRef.current = clearResults;
  }, [onMetadataSelected, onCollapse, clearResults]);

  // Processar metadata selecionada
  useEffect(() => {
    if (selectedMetadata && selectedResult) {
      
      // CORREÇÃO: Usar query estável para marcar sessão como completa
      const queryKey = stableInitialQueryRef.current.trim();
      if (queryKey) {
        sessionCompleted.current.add(queryKey);
        console.log('✅ Sessão completada para query:', queryKey);
      }
      
      const preferredTitle = selectedResult.title;
      console.log('🎯 Chamando onMetadataSelected com título:', preferredTitle);
      onMetadataSelectedRef.current(selectedMetadata, preferredTitle);
      onCollapseRef.current();
      
      // CORREÇÃO: Só limpar resultados no modo automático
      if (config?.fill_mode === 'auto') {
        clearResultsRef.current();
      }
      
      setSelectedResult(null);
      setAutoExpansionCompleted(false);
      previousInitialQuery.current = '';
    }
  }, [selectedMetadata, selectedResult, config?.fill_mode]); // CORREÇÃO: Remover initialQuery das dependências e adicionar config?.fill_mode

  return {
    convertMangasToResults,
    selectedResult,
    setSelectedResult
  };
};
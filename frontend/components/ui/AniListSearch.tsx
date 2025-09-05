import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAniListSearch } from '../../hooks/useAniListSearch';
import { useAniListConfig } from '../../hooks/useAniListConfig';
import { useAniListAutoMode } from '../../hooks/useAniListAutoMode';
import { useDebounce } from '../../hooks/useDebounce';
import { AniListResults } from './AniListResults';
import { AniListConfigPanel } from './AniListConfigPanel';
import type { AniListConfig, AniListMetadata } from '../../types/anilist';

interface AniListSearchProps {
  onMetadataSelected: (metadata: AniListMetadata, preferredTitle?: string) => void;
  initialQuery?: string;
  className?: string;
}

// Constantes para opções de idioma
const LANGUAGE_OPTIONS = [
  { key: 'romaji' as const, label: 'Romaji', desc: 'Japonês romanizado' },
  { key: 'english' as const, label: 'English', desc: 'Título em inglês' },
  { key: 'native' as const, label: 'Native', desc: 'Título original' },
  { key: 'synonyms' as const, label: 'Sinônimos', desc: 'Títulos alternativos' }
];

export const AniListSearch: React.FC<AniListSearchProps> = ({
  onMetadataSelected,
  initialQuery = '',
  className = ''
}) => {
  const [query, setQuery] = useState(initialQuery);
  // CORREÇÃO: Expandir automaticamente se há initialQuery e config está em modo auto
  const [isExpanded, setIsExpanded] = useState(false);
  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const debouncedQuery = useDebounce(query, 500);
  
  // Hooks principais
  const { config, updateConfig } = useAniListConfig();
  
  // SOLUÇÃO 1: Estado local de idioma por instância (evita conflitos entre modals)
  const [localLanguage, setLocalLanguage] = useState<'romaji' | 'english' | 'native' | 'synonyms'>('romaji');
  const [lastSelectedTitle, setLastSelectedTitle] = useState<string | null>(null);
  
  // Sincronizar estado local com config global na inicialização
  useEffect(() => {
    if (config?.language_preference) {
      setLocalLanguage(config.language_preference);
    }
  }, [config?.language_preference]);
  const {
    searchManga,
    selectResult,
    results,
    isSearching,
    isSelecting,
    error,
    selectedMetadata,
    clearResults,
    clearError
  } = useAniListSearch();

  // Handlers memoizados
  const handleExpand = useCallback(() => {
    setIsExpanded(true);
    clearError();
  }, [clearError]);

  const handleCollapse = useCallback(() => {
    setIsExpanded(false);
    setQuery('');
    clearResults();
    clearError();
    // CORREÇÃO: Reset completo das refs para prevenir re-expansões
    hasAutoExpandedRef.current = false;
    lastProcessedQueryRef.current = '';
    // NÃO resetar initialQueryRef.current - deve permanecer estável
    console.log('🔄 AniListSearch collapsed e refs resetadas');
  }, [clearResults, clearError]);

  const handleResultSelect = useCallback((result: any) => {
    console.log('🎯 [DEBUG] handleResultSelect INICIADO:', result);
    
    if (!result.id || typeof result.id !== 'number') {
      console.error('❌ [DEBUG] Result.id inválido:', {
        valor: result.id,
        tipo: typeof result.id,
        resultado_completo: result
      });
      return;
    }
    
    if (!result.title || typeof result.title !== 'string') {
      console.error('❌ [DEBUG] Result.title inválido:', {
        valor: result.title,
        tipo: typeof result.title,
        resultado_completo: result
      });
      return;
    }
    
    console.log('🚀 [DEBUG] Chamando selectResult:', { id: result.id, title: result.title });
    
    // Salvar título selecionado para reprocessamento
    setLastSelectedTitle(result.title);
    
    selectResult(result.id, result.title);
    console.log('✅ [DEBUG] selectResult chamado');
  }, [selectResult]);

  // Hook para modo automático (usando idioma local ao invés de global)  
  const configWithLocalLanguage = useMemo(() => {
    if (!config) return config; // Preserva null/undefined se config não carregou
    return { ...config, language_preference: localLanguage };
  }, [config, localLanguage]);
  
  const { convertMangasToResults } = useAniListAutoMode({
    config: configWithLocalLanguage, // Override idioma com estado local
    initialQuery,
    results,
    isSearching,
    isSelecting,
    isExpanded,
    onSelectResult: handleResultSelect, // Usar o wrapper que faz a conversão
    onMetadataSelected,
    onExpand: handleExpand,
    onCollapse: handleCollapse,
    searchManga,
    selectedMetadata,
    clearResults
  });

  // CORREÇÃO CRÍTICA: Modo manual - chamar onMetadataSelected quando selectedMetadata chega
  useEffect(() => {
    if (selectedMetadata && config?.fill_mode === 'manual') {
      console.log('📝 Modo manual: Processando metadata selecionado');
      console.log('🔍 [DEBUG] lastSelectedTitle disponível:', lastSelectedTitle);
      
      // CORREÇÃO: Passar preferredTitle no modo manual também
      onMetadataSelected(selectedMetadata, lastSelectedTitle || undefined);
      // CORREÇÃO: NÃO limpar resultados no modo manual - deixar visíveis para o usuário
      // clearResults();
    }
  }, [selectedMetadata, config?.fill_mode, onMetadataSelected, lastSelectedTitle]);

  // Usar refs para funções que não devem causar re-renders
  const searchMangaRef = useRef(searchManga);
  const clearResultsRef = useRef(clearResults);
  
  useEffect(() => {
    searchMangaRef.current = searchManga;
    clearResultsRef.current = clearResults;
  }, [searchManga, clearResults]);

  // Busca com debounce
  useEffect(() => {
    if (debouncedQuery.trim() && isExpanded) {
      searchMangaRef.current(debouncedQuery);
    } else if (!debouncedQuery.trim()) {
      clearResultsRef.current();
    }
  }, [debouncedQuery, isExpanded]); // Dependências reduzidas

  // CORREÇÃO: Refazer busca quando idioma LOCAL muda (modo manual e automático)
  const previousLanguageRef = useRef<string | undefined>(undefined);
  const needsReprocessingRef = useRef<{title: string, language: string} | null>(null);
  
  useEffect(() => {
    const currentLanguage = localLanguage;
    
    if (isExpanded && 
        query.trim() && 
        currentLanguage && 
        currentLanguage !== previousLanguageRef.current &&
        previousLanguageRef.current !== undefined) {
      
      console.log('🌍 Idioma LOCAL mudou, refazendo busca:', { 
        anterior: previousLanguageRef.current, 
        atual: currentLanguage,
        query,
        modoManual: config?.fill_mode === 'manual',
        hasSelectedMetadata: !!selectedMetadata
      });
      
      // Marcar para reprocessamento após novos results chegarem
      if (config?.fill_mode === 'manual' && selectedMetadata && currentLanguage !== 'synonyms') {
        // CORREÇÃO: Usar título do selectedMetadata ou fallback para último título selecionado
        const titleForReprocessing = selectedMetadata.title || lastSelectedTitle;
        
        console.log('🔍 [DEBUG] Determinando título para reprocessamento:', {
          selectedMetadataTitle: selectedMetadata.title,
          lastSelectedTitle: lastSelectedTitle,
          titleForReprocessing: titleForReprocessing
        });
        
        if (titleForReprocessing) {
          needsReprocessingRef.current = {
            title: titleForReprocessing,
            language: currentLanguage
          };
          console.log('📌 Marcado para reprocessamento após novos results:', needsReprocessingRef.current);
        } else {
          console.warn('⚠️ Não foi possível determinar título para reprocessamento');
        }
      }
      
      // Refazer busca com query atual
      searchMangaRef.current(query);
    }
    
    previousLanguageRef.current = currentLanguage;
  }, [localLanguage, isExpanded, query, selectedMetadata, config?.fill_mode, lastSelectedTitle]);

  // NOVO: useEffect separado para reprocessar quando novos results chegam
  useEffect(() => {
    if (needsReprocessingRef.current && results.length > 0) {
      const { title, language } = needsReprocessingRef.current;
      
      console.log('🔄 Tentando reprocessar com novos results:', { 
        title, 
        language, 
        resultsCount: results.length,
        resultTitles: results.map(r => r.Title?.Romaji || r.Title?.English || 'N/A'),
        searchingForTitle: title
      });
      
      // CORREÇÃO: Procurar o manga RAW pelo título
      const originalManga = results.find(manga => 
        manga.Title?.Romaji === title || 
        manga.Title?.English === title || 
        manga.Title?.Native === title ||
        (manga.Synonyms && manga.Synonyms.includes(title))
      );
      
      if (originalManga && selectedMetadata) {
        console.log('✅ Manga RAW encontrado nos novos results:', originalManga.Title?.Romaji || 'Sem título');
        
        // Converter com novo idioma
        const convertedResults = convertMangasToResults([originalManga]);
        if (convertedResults.length > 0) {
          const resultWithNewLanguage = convertedResults[0];
          console.log('📝 Reprocessando com novo título:', resultWithNewLanguage.title);
          onMetadataSelected(selectedMetadata, resultWithNewLanguage.title);
        }
        
        // Limpar flag de reprocessamento
        needsReprocessingRef.current = null;
      } else if (originalManga === undefined) {
        console.log('⏳ Manga RAW ainda não encontrado nos novos results, aguardando...');
        console.log('   🔍 IDs disponíveis nos results:', results.map(r => ({ ID: r.ID, title: r.Title?.Romaji })));
      }
    }
  }, [results, convertMangasToResults, onMetadataSelected, selectedMetadata]);

  // Ref para controlar se já foi expandido para esta query
  const hasAutoExpandedRef = useRef(false);
  const lastProcessedQueryRef = useRef('');
  const initialQueryRef = useRef(initialQuery); // CORREÇÃO: Capturar valor inicial

  // CORREÇÃO CRÍTICA: Capturar initialQuery apenas na primeira renderização
  useEffect(() => {
    if (!initialQueryRef.current && initialQuery.trim()) {
      initialQueryRef.current = initialQuery;
      console.log('📌 initialQuery estabilizada:', initialQuery);
    }
  }, []); // Executar apenas uma vez

  // Auto-expansão imediata para modo automático quando modal abre
  useEffect(() => {
    // CORREÇÃO: Usar initialQueryRef.current (estável) ao invés de initialQuery (instável)
    const stableInitialQuery = initialQueryRef.current;
    
    if (config?.fill_mode === 'auto' && 
        stableInitialQuery.trim() && 
        !isExpanded && 
        !hasAutoExpandedRef.current &&
        lastProcessedQueryRef.current !== stableInitialQuery) {
      
      console.log('🚀 Auto-expansão imediata: Modal aberto com initialQuery:', stableInitialQuery);
      setIsExpanded(true);
      setQuery(stableInitialQuery);
      hasAutoExpandedRef.current = true;
      lastProcessedQueryRef.current = stableInitialQuery;
    }
  }, [config?.fill_mode, isExpanded]); // CORREÇÃO: Remover initialQuery das dependências

  // Estados condicionais memoizados
  const isDisabled = useMemo(() => config && !config.enabled, [config]);

  if (isDisabled) {
    return (
      <div className={`relative overflow-hidden bg-gradient-to-br from-slate-900/95 via-red-900/20 to-orange-900/30 backdrop-blur-sm border border-red-500/20 rounded-2xl p-5 ${className}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-orange-500 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728L18.364 5.636M5.636 18.364l12.728-12.728" />
              </svg>
            </div>
            <div>
              <h4 className="text-base font-semibold text-white">AniList Desabilitado</h4>
              <p className="text-sm text-red-300">A integração com AniList está desativada</p>
            </div>
          </div>
          <button
            onClick={() => setShowConfigPanel(true)}
            className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-300 rounded-xl transition-colors"
          >
            Ativar
          </button>
        </div>
        
        {showConfigPanel && (
          <AniListConfigPanel
            isOpen={showConfigPanel}
            onClose={() => setShowConfigPanel(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-slate-900/95 via-blue-900/20 to-sky-900/30 backdrop-blur-sm border border-blue-500/20 rounded-2xl transition-all duration-500 ${isExpanded ? 'p-6' : 'p-5'} ${className}`}>
      {/* Background decorative elements */}
      <div className="absolute inset-0 bg-gradient-to-r from-blue-600/5 via-transparent to-sky-600/5 opacity-60"></div>
      <div className="absolute -top-32 -right-32 w-64 h-64 bg-gradient-to-br from-blue-500/10 to-sky-500/10 rounded-full blur-3xl"></div>
      
      {!isExpanded ? (
        // Estado colapsado
        <div className="relative flex items-center justify-between group">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 via-sky-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25 group-hover:shadow-blue-500/40 transition-all duration-300 group-hover:scale-105">
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6.361 2.943 0 21.056h4.06l1.077-3.133H9.96l.482 1.386 3.14.01c1.1 0 1.999-.895 1.999-1.999V15.45c0-1.1-.9-1.998-1.999-1.998H11.52V11.46c0-.55.45-1 1-1h3.4c.55 0 1-.45 1-1V7.46c0-.55-.45-1-1-1h-4.4c-1.1 0-1.998.9-1.998 1.999v5.991H7.518l-.457-1.32H5.74l1.621-4.67V2.943ZM24 5.7v12.6c0 2.21-1.79 4-4 4h-4V5.7c0-2.21 1.79-4 4-4h4v4Z"/>
                </svg>
              </div>
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 to-sky-500/20 rounded-xl blur-sm group-hover:blur-md transition-all duration-300"></div>
            </div>
            
            <div className="space-y-1">
              <h4 className="text-base font-semibold text-white group-hover:text-blue-200 transition-colors duration-200">Buscar no AniList</h4>
              <p className="text-sm text-slate-400 group-hover:text-slate-300 transition-colors duration-200">Preencher automaticamente com metadados oficiais</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowConfigPanel(true)}
              className="p-3 bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 hover:text-white rounded-xl transition-all duration-300 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              title="Configurações AniList"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.533 1.533 0 00-2.287-.947c-1.543.94-3.31-.826-2.37-2.37a1.533 1.533 0 00-1.065-2.287c-1.756-.426-1.756-2.924 0-3.35a1.532 1.532 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            
            <button
              onClick={handleExpand}
              className="relative px-6 py-3 bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-500 hover:to-sky-500 text-white font-medium rounded-xl transition-all duration-300 flex items-center gap-2 shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:ring-offset-2 focus:ring-offset-slate-900"
            >
              <svg className="w-4 h-4 transition-transform duration-300 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span>Buscar</span>
              <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 to-sky-600/20 rounded-xl blur-sm"></div>
            </button>
          </div>
        </div>
      ) : (
        // Estado expandido
        <div className="relative space-y-6 animate-in fade-in duration-500">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1 relative group">
                <div className="relative">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Digite o nome do mangá..."
                    className="w-full bg-slate-900/80 backdrop-blur-sm text-white px-5 py-4 pl-12 pr-12 rounded-2xl border border-blue-500/20 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all duration-300 placeholder-slate-400 shadow-inner shadow-blue-500/5 focus:shadow-blue-500/20"
                    autoFocus
                  />
                  
                  <div className="absolute left-4 top-1/2 transform -translate-y-1/2">
                    <svg className="w-5 h-5 text-slate-400 group-focus-within:text-blue-400 transition-colors duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  
                  {isSearching && (
                    <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
                      <div className="relative">
                        <div className="w-5 h-5 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
                        <div className="absolute inset-0 w-5 h-5 border border-blue-500/40 rounded-full animate-pulse"></div>
                      </div>
                    </div>
                  )}
                  
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 to-sky-500/5 rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                </div>
              </div>
              
              {/* Botão de Configurações no estado expandido */}
              <button
                onClick={() => setShowConfigPanel(true)}
                className="p-3 bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 hover:text-white rounded-xl transition-all duration-300 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                title="Configurações AniList"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.533 1.533 0 00-2.287-.947c-1.543.94-3.31-.826-2.37-2.37a1.533 1.533 0 00-1.065-2.287c-1.756-.426-1.756-2.924 0-3.35a1.532 1.532 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>

              <button
                onClick={handleCollapse}
                className="relative p-4 bg-slate-800/50 hover:bg-slate-700/50 text-slate-400 hover:text-white rounded-2xl transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-slate-500/50 group"
                title="Fechar busca"
              >
                <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <div className="absolute inset-0 bg-gradient-to-r from-slate-600/20 to-slate-500/20 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              </button>
            </div>
            
            {/* Seletor de idioma LOCAL (não afeta outras instâncias) */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-400 font-medium">Idioma preferido:</span>
              <div className="flex gap-2">
                {LANGUAGE_OPTIONS.map(option => (
                  <button
                    key={option.key}
                    onClick={() => setLocalLanguage(option.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                      localLanguage === option.key
                        ? 'bg-green-600/20 text-green-300 border border-green-500/40'
                        : 'bg-slate-800/50 text-slate-400 hover:text-slate-300 hover:bg-slate-700/50 border border-slate-700/50'
                    }`}
                    title={option.desc}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              
              {/* Botão para salvar como padrão (opcional) */}
              {localLanguage !== (config?.language_preference || 'romaji') && (
                <button
                  onClick={() => updateConfig({ language_preference: localLanguage })}
                  className="px-2 py-1 text-xs bg-blue-600/20 text-blue-300 rounded border border-blue-500/40 hover:bg-blue-600/30 transition-all duration-200"
                  title="Salvar este idioma como padrão para novas buscas"
                >
                  Salvar como padrão
                </button>
              )}
            </div>
          </div>

          {/* Estado de erro */}
          {error && (
            <div className="bg-gradient-to-r from-red-900/20 via-red-800/20 to-rose-900/20 backdrop-blur-sm border border-red-500/30 rounded-2xl p-4 animate-in fade-in duration-300">
              <div className="flex items-center gap-3 text-red-400">
                <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-red-500/20 to-rose-500/20 rounded-xl flex items-center justify-center">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="space-y-1">
                  <p className="text-red-300 font-medium">Erro na busca</p>
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Resultados */}
          {results.length > 0 && (
            <AniListResults
              results={convertMangasToResults(results)}
              isLoading={isSearching}
              onSelectResult={handleResultSelect}
              selectedMetadata={selectedMetadata}
              preferredLanguage={localLanguage}
            />
          )}

          {/* Estado vazio */}
          {!isSearching && !error && results.length === 0 && query.trim() && (
            <div className="text-center py-12 animate-in fade-in duration-500">
              <div className="relative mb-6">
                <div className="w-20 h-20 mx-auto bg-gradient-to-br from-slate-700/50 to-slate-600/50 rounded-2xl flex items-center justify-center">
                  <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <div className="absolute inset-0 bg-gradient-to-br from-slate-600/20 to-slate-500/20 rounded-2xl blur-sm"></div>
              </div>
              <div className="space-y-2">
                <p className="text-lg font-medium text-slate-300">Nenhum resultado encontrado</p>
                <p className="text-sm text-slate-400">Tente outros termos de busca ou verifique a ortografia</p>
              </div>
              <div className="mt-6 text-xs text-slate-500">
                <p>Dica: Use títulos em inglês ou japonês para melhores resultados</p>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Painel de Configurações */}
      {showConfigPanel && (
        <AniListConfigPanel
          isOpen={showConfigPanel}
          onClose={() => setShowConfigPanel(false)}
        />
      )}
    </div>
  );
};
import { useState, useCallback, useRef, useEffect } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { useWebSocketListener, useWebSocketRequest, generateRequestId, debugWebSocket } from '../utils/websocket';
import type { 
  AniListManga, 
  AniListSearchResponse, 
  AniListSelectionResponse,
  AniListSearchHookReturn,
  AniListMetadata
} from '../types/anilist';

export function useAniListSearch(): AniListSearchHookReturn {
  const { sendWSMessage } = useAppContext();
  const [results, setResults] = useState<AniListManga[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMetadata, setSelectedMetadata] = useState<AniListMetadata | null>(null);
  
  // Refs estáveis para funções
  const markRequestCompleteRef = useRef<((requestId: string) => void) | null>(null);
  const removeListenerRef = useRef<((id: string) => void) | null>(null);
  const addListenerRef = useRef<((id: string, callback: any, timeout?: number) => () => void) | null>(null);
  const sendRequestRef = useRef<((sendWSMessage: any, message: any) => Promise<boolean>) | null>(null);
  
  // Hooks para WebSocket
  const { addListener, removeListener } = useWebSocketListener<AniListSearchResponse | AniListSelectionResponse>(
    ['search_anilist_complete', 'search_progress', 'anilist_selection_complete', 'anilist_fetch_progress', 'error'],
    /^(search|select)-/
  );
  
  const { sendRequest, markRequestComplete } = useWebSocketRequest();
  
  // Atualizar refs quando funções mudam
  useEffect(() => {
    markRequestCompleteRef.current = markRequestComplete;
    removeListenerRef.current = removeListener;
    addListenerRef.current = addListener;
    sendRequestRef.current = sendRequest;
  }, [markRequestComplete, removeListener, addListener, sendRequest]);

  const handleSearchResponse = useCallback((requestId: string) => (response: AniListSearchResponse) => {
    debugWebSocket('Resposta de busca recebida', response.status);

    if (response.status === 'search_progress') {
      // Progresso da busca - manter loading state
      return;
    }

    if (response.status === 'search_anilist_complete') {
      if (response.data && response.data.results) {
        setResults(response.data.results);
        setIsSearching(false);
        setError(null);
      } else {
        setResults([]);
        setIsSearching(false);
        setError(null);
      }
    } else if (response.status === 'error') {
      setError(response.error || 'Erro na busca AniList');
      setIsSearching(false);
    }

    if (markRequestCompleteRef.current) {
      markRequestCompleteRef.current(requestId);
    }
    if (removeListenerRef.current) {
      removeListenerRef.current(requestId);
    }
  }, []); // Sem dependências para evitar re-criação

  const handleSelectionResponse = useCallback((requestId: string) => (response: AniListSelectionResponse) => {
    debugWebSocket('Resposta de seleção recebida', response.status);

    if (response.status === 'anilist_fetch_progress') {
      // Progresso da seleção - manter loading state
      return;
    }

    if (response.status === 'anilist_selection_complete') {
      const metadata = response.metadata || response.data?.metadata;
      if (metadata) {
        setSelectedMetadata(metadata);
        setIsSelecting(false);
        setError(null);
      } else {
        setError('Resposta inválida do servidor');
        setIsSelecting(false);
      }
    } else if (response.status === 'error') {
      setError(response.error || 'Erro ao obter detalhes do AniList');
      setIsSelecting(false);
    }

    if (markRequestCompleteRef.current) {
      markRequestCompleteRef.current(requestId);
    }
    if (removeListenerRef.current) {
      removeListenerRef.current(requestId);
    }
  }, []); // Sem dependências para evitar re-criação

  const searchManga = useCallback(async (query: string) => {
    if (!query.trim()) {
      setError('Query de busca é obrigatória');
      return;
    }

    if (!sendWSMessage) {
      setError('Conexão WebSocket não disponível');
      return;
    }

    setIsSearching(true);
    setError(null);
    setResults([]);
    
    const requestId = generateRequestId('search');
    const cleanup = addListenerRef.current ? addListenerRef.current(requestId, handleSearchResponse(requestId)) : () => {};

    try {
      const message: AniListWSRequest = {
        action: 'search_anilist',
        requestId,
        data: { searchQuery: query }
      };

      const success = sendRequestRef.current ? await sendRequestRef.current(sendWSMessage, message) : false;
      
      if (!success) {
        setIsSearching(false);
        setError('Falha ao enviar mensagem WebSocket');
        cleanup();
      }
    } catch (err) {
      setIsSearching(false);
      setError('Erro ao conectar com o servidor');
      cleanup();
    }
  }, [sendWSMessage]); // Mantendo apenas sendWSMessage como dependência estável

  const selectResult = useCallback(async (anilistId: number, mangaTitle: string) => {
    console.log('🔥 [DEBUG] selectResult INICIADO:', { anilistId, mangaTitle });
    
    if (!sendWSMessage) {
      console.error('❌ [DEBUG] sendWSMessage não disponível');
      setError('Conexão WebSocket não disponível');
      return;
    }
    
    console.log('✅ [DEBUG] sendWSMessage disponível, definindo estados...');
    setIsSelecting(true);
    setError(null);
    setSelectedMetadata(null);
    
    const requestId = generateRequestId('select');
    const cleanup = addListenerRef.current ? addListenerRef.current(requestId, handleSelectionResponse(requestId)) : () => {};

    try {
      // CORREÇÃO: Usar formato compatível com o backend Go
      const message = {
        action: 'select_anilist_result',
        requestId: requestId,
        data: {
          anilistId: Number(anilistId),
          mangaTitle: String(mangaTitle)
        }
      };

      console.log('🔍 DEBUG: Valores antes do envio:', {
        anilistIdOriginal: anilistId,
        anilistIdTipo: typeof anilistId,
        mangaTitleOriginal: mangaTitle,
        mangaTitleTipo: typeof mangaTitle
      });

      debugWebSocket('Enviando seleção AniList', { anilistId, mangaTitle, message });
      console.log('📤 [DEBUG] ESTRUTURA COMPLETA DA MENSAGEM:', JSON.stringify(message, null, 2));
      console.log('📡 [DEBUG] Verificando sendRequestRef...');

      const success = sendRequestRef.current ? await sendRequestRef.current(sendWSMessage, message) : false;
      
      console.log('📨 [DEBUG] Resultado do envio:', { success, requestId });
      
      if (!success) {
        console.error('❌ [DEBUG] Falha ao enviar mensagem WebSocket');
        setIsSelecting(false);
        setError('Falha ao enviar mensagem WebSocket');
        cleanup();
      } else {
        console.log('✅ [DEBUG] Mensagem enviada com sucesso, aguardando resposta...');
      }
    } catch (err) {
      setIsSelecting(false);
      setError('Erro ao conectar com o servidor');
      cleanup();
      debugWebSocket('Erro ao selecionar resultado', err);
    }
  }, [sendWSMessage]); // Mantendo apenas sendWSMessage como dependência estável

  const clearResults = useCallback(() => {
    setResults([]);
    setError(null);
    setSelectedMetadata(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    searchManga,
    selectResult,
    results,
    isSearching,
    isSelecting,
    error,
    selectedMetadata,
    clearResults,
    clearError
  };
}

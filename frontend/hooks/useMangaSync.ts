import { useState, useEffect, useCallback, useRef } from 'react';
import { useMetadataSettings } from './useMetadataSettings';
import { useHydration } from './useHydration';
import type { WSResponse, Manga } from '../types';

// Fila global para rastrear requisições e respostas
let requestQueue: string[] = [];
let responseCount = 0;

interface UseMangaSyncOptions {
  manga: Manga;
  mangaPath?: string;
  onLog?: (log: any) => void;
  sendWSMessage?: (message: any) => boolean;
  isConnected?: boolean;
}

interface SyncedMangaData extends Manga {
  isLoadingJSON: boolean;
  hasJSONData: boolean;
  jsonLoadAttempted?: boolean;
  lastUpdated?: string;
}

export function useMangaSync({ manga, mangaPath, onLog, sendWSMessage, isConnected }: UseMangaSyncOptions) {
  const { metadataOutputWSL } = useMetadataSettings();
  const isHydrated = useHydration(); // Evitar problemas de hidratação
  const [issyncing, setIsSyncing] = useState(false);
  const [syncedManga, setSyncedManga] = useState<SyncedMangaData>(() => ({
    ...manga,
    isLoadingJSON: false,
    hasJSONData: false,
    jsonLoadAttempted: false
  }));

  const lastRequestTimeRef = useRef<number>(0);

  // Função para processar respostas WebSocket (deve ser chamada externamente)
  const handleWebSocketResponse = useCallback((response: WSResponse) => {
    if (process.env.NODE_ENV === 'development') {
      console.log('📨 useMangaSync recebeu resposta:', response);
    }
    
    if (response.status === 'metadata_loaded' || response.status === 'load_metadata') {
      // SOLUÇÃO CORRETA: Filtrar por mangaID se disponível
      const responseMangaID = response.mangaId || response.payload?.mangaID;
      const responseMangaName = response.payload?.mangaName;
      
      if (process.env.NODE_ENV === 'development') {
        console.log('🔍 Verificando identificação na resposta:', {
          responseMangaID,
          responseMangaName,
          thisMangaId: syncedManga.id,
          thisMangaTitle: syncedManga.title
        });
      }
      
      // Se o backend enviou identificação, usar ela para filtrar
      if (responseMangaID || responseMangaName) {
        const isForThisManga = 
          (responseMangaID && syncedManga.id === responseMangaID) ||
          (responseMangaName && syncedManga.title === responseMangaName);
          
        if (!isForThisManga) {
          if (process.env.NODE_ENV === 'development') {
            console.log('🚫 Resposta não é para este manga:', syncedManga.title, {
              responseMangaID,
              responseMangaName,
              thisMangaId: syncedManga.id,
              thisMangaTitle: syncedManga.title
            });
          }
          return;
        }
        
        if (process.env.NODE_ENV === 'development') {
          console.log('✅ Resposta corresponde ao mangaID/Nome!', syncedManga.title);
        }
      } else {
        // SOLUÇÃO PARA BACKEND SEM IDENTIFICAÇÃO: Usar fila de correspondência
        // A primeira resposta vai para a primeira requisição na fila, etc.
        if (requestQueue.length === 0) {
          if (process.env.NODE_ENV === 'development') {
            console.log('🚫 Ignorando - nenhuma requisição na fila:', syncedManga.title);
          }
          return;
        }
        
        const expectedMangaTitle = requestQueue[responseCount % requestQueue.length];
        if (syncedManga.title !== expectedMangaTitle) {
          if (process.env.NODE_ENV === 'development') {
            console.log('🚫 Ignorando - não é sua vez na fila:', {
              mangaTitle: syncedManga.title,
              expectedTitle: expectedMangaTitle,
              responseIndex: responseCount,
              queueSize: requestQueue.length
            });
          }
          return;
        }
        
        // Esta é a resposta correta para este manga
        responseCount++;
        
        // Se completamos um ciclo completo, resetar
        if (responseCount >= requestQueue.length) {
          if (process.env.NODE_ENV === 'development') {
            console.log('🔄 Ciclo completo - resetando fila de correspondência');
          }
          requestQueue = [];
          responseCount = 0;
        }
        
        if (process.env.NODE_ENV === 'development') {
          console.log('🎯 Resposta correspondente da fila:', {
            mangaTitle: syncedManga.title,
            responseIndex: responseCount - 1,
            remainingInQueue: requestQueue.length - responseCount
          });
        }
      }
      
      if (process.env.NODE_ENV === 'development') {
        console.log('✅ Processando resposta para:', syncedManga.title);
      }
      setIsSyncing(false);
      if (response.payload?.metadata) {
        const jsonData = response.payload.metadata as any;
        if (process.env.NODE_ENV === 'development') {
          console.log('📄 Dados do manga carregados do JSON:', jsonData);
        }
        
        // Extrair grupo dos capítulos se não houver na raiz
        let groupName = jsonData.group || '';
        if (!groupName && jsonData.chapters) {
          const chapters = Object.values(jsonData.chapters);
          for (const chapter of chapters) {
            const chapterData = chapter as any;
            if (chapterData.groups && Object.keys(chapterData.groups).length > 0) {
              groupName = Object.keys(chapterData.groups)[0];
              break;
            }
          }
        }
        
        // Contar capítulos
        const chapterCount = jsonData.chapters ? Object.keys(jsonData.chapters).length : 0;
        
        // Atualizar o estado do manga com dados do JSON
        setSyncedManga(prev => ({
          ...prev,
          title: jsonData.title || prev.title,
          description: jsonData.description || prev.description,
          author: jsonData.author || prev.author,
          artist: jsonData.artist || prev.artist,
          status: jsonData.status || prev.status,
          cover: jsonData.cover || prev.cover,
          group: groupName || prev.group,
          // MANTER os chapters originais da descoberta - não sobrescrever
          chapters: prev.chapters,
          isLoadingJSON: false,
          hasJSONData: true,
          jsonLoadAttempted: true,
          lastUpdated: new Date().toISOString(),
          chapterCount: chapterCount
        }));
        
        onLog?.({
          type: 'success',
          message: `Dados do manga "${jsonData.title}" carregados do JSON`,
          category: 'system'
        });
      }
    } else if (response.status === 'error') {
      setIsSyncing(false);
      if (process.env.NODE_ENV === 'development') {
        console.log('❌ Erro ao carregar JSON:', response);
      }
      setSyncedManga(prev => ({
        ...prev,
        isLoadingJSON: false,
        hasJSONData: false,
        jsonLoadAttempted: true // Marcar que já tentamos carregar
      }));
      
      onLog?.({
        type: 'warning',
        message: `JSON não encontrado para "${syncedManga.title}", usando dados da descoberta`,
        category: 'system'
      });
    } else if (response.status === 'metadata_saved') {
      // Manga foi salvo, recarregar dados para sincronizar
      if (response.payload?.metadata) {
        const savedData = response.payload.metadata as any;
        if (process.env.NODE_ENV === 'development') {
          console.log('📄 Metadados salvos, atualizando display:', savedData);
        }
        
        setSyncedManga(prev => ({
          ...prev,
          title: savedData.title || savedData.nome || prev.title,
          description: savedData.description || savedData.descricao || prev.description,
          author: savedData.author || savedData.autor || prev.author,
          artist: savedData.artist || savedData.artista || prev.artist,
          status: savedData.status || prev.status,
          cover: savedData.cover || savedData.capa || prev.cover,
          group: savedData.group || savedData.grupo || prev.group,
          hasJSONData: true,
          lastUpdated: new Date().toISOString()
        }));
        
        onLog?.({
          type: 'success',
          message: `Metadados do manga "${savedData.title || savedData.nome}" salvos e sincronizados`,
          category: 'system'
        });
      }
    }
  }, [syncedManga.id, syncedManga.title, onLog]);

  // Escutar eventos globais de WebSocket para metadados
  useEffect(() => {
    if (!isHydrated) return;

    const handleMetadataLoaded = (event: CustomEvent) => {
      const data = event.detail;
      handleWebSocketResponse(data);
    };

    const handleMetadataError = (event: CustomEvent) => {
      const data = event.detail;
      handleWebSocketResponse(data);
    };

    window.addEventListener('mangaMetadataLoaded', handleMetadataLoaded as EventListener);
    window.addEventListener('mangaMetadataError', handleMetadataError as EventListener);

    return () => {
      window.removeEventListener('mangaMetadataLoaded', handleMetadataLoaded as EventListener);
      window.removeEventListener('mangaMetadataError', handleMetadataError as EventListener);
    };
  }, [isHydrated, handleWebSocketResponse]);

  // Log inicial apenas após hidratação e em desenvolvimento
  useEffect(() => {
    if (isHydrated && process.env.NODE_ENV === 'development') {
      console.log('🚀 Inicializando useMangaSync para manga:', manga.title, 'com', manga.chapters?.length, 'chapters');
    }
  }, [isHydrated, manga.title, manga.chapters?.length]);

  // Função para salvar dados via WebSocket
  const saveToJSON = useCallback((metadata: Record<string, unknown>) => {
    if (!mangaPath || !isConnected || !sendWSMessage) return;
    
    const messagePayload = {
      ...(syncedManga.id && { mangaID: syncedManga.id }), // Include mangaID for consistent filename
      mangaPath: mangaPath,
      metadata: metadata,
      metadataOutput: metadataOutputWSL
    };
    
    if (process.env.NODE_ENV === 'development') {
      console.log('🔍 DEBUG SAVE_METADATA via useMangaSync:', messagePayload);
    }
    
    sendWSMessage({
      action: 'save_metadata',
      payload: messagePayload
    });
    
    onLog?.({
      type: 'info',
      message: `Salvando metadados para: ${mangaPath}`,
      category: 'system'
    });
  }, [mangaPath, syncedManga.id, metadataOutputWSL, isConnected, sendWSMessage, onLog]);

  // Carregar dados do JSON automaticamente quando conectado E após hidratação
  useEffect(() => {
    // Só fazer auto-loading uma vez por manga
    if (isHydrated && isConnected && sendWSMessage && syncedManga.title && !syncedManga.isLoadingJSON && !syncedManga.hasJSONData && !syncedManga.jsonLoadAttempted) {
      // Marcar imediatamente como tentado para evitar duplos requests
      setSyncedManga(prev => ({ ...prev, jsonLoadAttempted: true, isLoadingJSON: true }));
      setIsSyncing(true);
      lastRequestTimeRef.current = Date.now();
      
      // Limpar fila se estiver muito cheia (indica mudança de contexto)
      if (requestQueue.length > 10) {
        if (process.env.NODE_ENV === 'development') {
          console.log('🧹 Limpando fila por excesso de itens:', {
            oldQueueSize: requestQueue.length
          });
        }
        requestQueue = [];
        responseCount = 0;
      }
      
      // Adicionar à fila de requisições
      requestQueue.push(syncedManga.title);
      
        if (process.env.NODE_ENV === 'development') {
          console.log('📝 Adicionado à fila de requisições:', {
            mangaTitle: syncedManga.title,
            queuePosition: requestQueue.length - 1,
            totalQueue: requestQueue.length
          });
        }      // Enviar load_metadata para o backend
      const message = {
        action: 'load_metadata',
        payload: {
          ...(syncedManga.id && { mangaID: syncedManga.id }),
          mangaName: syncedManga.title,
          metadataOutput: metadataOutputWSL || 'json'
        }
      };
      
      if (process.env.NODE_ENV === 'development') {
        console.log('🔍 Enviando load_metadata para manga:', syncedManga.title);
      }
      
      sendWSMessage(message);
      
      // Timeout apenas para evitar loading infinito
      const fallbackTimeout = setTimeout(() => {
        setSyncedManga(prev => ({ 
          ...prev, 
          isLoadingJSON: false,
          jsonLoadAttempted: true
        }));
        setIsSyncing(false);
      }, 10000);
      
      return () => {
        clearTimeout(fallbackTimeout);
      };
    }
  }, [isHydrated, isConnected, syncedManga.title, syncedManga.jsonLoadAttempted]);

  // Sincronizar quando o manga original muda (preservando hasJSONData e chapterCount)
  useEffect(() => {
    setSyncedManga(prev => {
      // Se já carregamos JSON ou já tentamos, não resetar
      if (prev.hasJSONData || prev.jsonLoadAttempted) {
        return {
          ...prev,
          // Atualizar apenas informações básicas
          title: manga.title || prev.title,
          chapters: manga.chapters, // Sempre atualizar capítulos da descoberta
          // Preservar estado de carregamento JSON
          isLoadingJSON: prev.isLoadingJSON,
          hasJSONData: prev.hasJSONData,
          jsonLoadAttempted: prev.jsonLoadAttempted,
          lastUpdated: prev.lastUpdated,
          chapterCount: prev.chapterCount
        };
      }
      
      // Se é primeira vez, usar dados do manga original
      return {
        ...manga,
        isLoadingJSON: false,
        hasJSONData: false,
        jsonLoadAttempted: false,
        lastUpdated: new Date().toISOString(),
        chapterCount: manga.chapters?.length || 0
      };
    });
  }, [manga]);

  // Função para forçar recarregamento com feedback visual
  const forceReload = useCallback(() => {
    if (!syncedManga.title || !isConnected || !sendWSMessage || issyncing || !isHydrated) return;
    
    if (process.env.NODE_ENV === 'development') {
      console.log('🔄 forceReload para:', syncedManga.title);
    }
    
    // Resetar estado e ativar indicador visual
    setSyncedManga(prev => ({
      ...prev,
      jsonLoadAttempted: false,
      hasJSONData: false,
      isLoadingJSON: false
    }));
    
    setIsSyncing(true);
    
    sendWSMessage({
      action: 'load_metadata',
      payload: {
        ...(syncedManga.id && { mangaID: syncedManga.id }), // Include mangaID if available
        mangaName: syncedManga.title,
        metadataOutput: metadataOutputWSL || 'json'
      }
    });
    
    // Timeout para garantir que o indicador não fique preso
    setTimeout(() => setIsSyncing(false), 5000);
  }, [syncedManga.title, syncedManga.id, isConnected, sendWSMessage, metadataOutputWSL, issyncing, isHydrated]);

  return {
    manga: syncedManga,
    isConnected,
    saveToJSON,
    forceReload,
    isSyncing: issyncing,
    handleWebSocketResponse
  };
}

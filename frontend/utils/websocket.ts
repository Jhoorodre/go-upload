import { useEffect, useCallback, useRef } from 'react';
import type { AniListWSRequest, BaseWSResponse } from '../types/anilist';

// Timeout padrão para requisições WebSocket
const DEFAULT_TIMEOUT = 15000;

/**
 * Gera um ID único para requisições
 */
export const generateRequestId = (prefix: string): string => {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Verifica se uma resposta WebSocket é relevante para um listener específico
 */
export const isRelevantResponse = (
  response: BaseWSResponse,
  expectedStatuses: string[],
  requestIdPattern?: RegExp
): boolean => {
  const statusMatch = expectedStatuses.includes(response.status);
  const requestIdMatch = !requestIdPattern || (response.requestId ? requestIdPattern.test(response.requestId) : false);
  
  return statusMatch || requestIdMatch;
};

/**
 * Hook para gerenciar listeners de WebSocket com cleanup automático
 */
export const useWebSocketListener = <T extends BaseWSResponse>(
  eventTypes: string[],
  requestIdPattern?: RegExp
) => {
  const listenersRef = useRef<Map<string, (response: T) => void>>(new Map());
  const timeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const eventTypesRef = useRef(eventTypes);
  const requestIdPatternRef = useRef(requestIdPattern);

  // Atualizar refs quando dependências mudam
  useEffect(() => {
    eventTypesRef.current = eventTypes;
    requestIdPatternRef.current = requestIdPattern;
  }, [eventTypes, requestIdPattern]);

  const addListener = useCallback((id: string, callback: (response: T) => void, timeout = DEFAULT_TIMEOUT) => {
    const listener = (event: CustomEvent) => {
      const response: T = event.detail;
      
      if (isRelevantResponse(response, eventTypesRef.current, requestIdPatternRef.current)) {
        callback(response);
      }
    };

    // Adicionar listener
    listenersRef.current.set(id, callback);
    window.addEventListener('websocket-message', listener as EventListener);

    // Configurar timeout
    const timeoutId = setTimeout(() => {
      const storedCallback = listenersRef.current.get(id);
      if (storedCallback) {
        storedCallback({
          status: 'error',
          requestId: id,
          error: 'Timeout na requisição'
        } as T);
        removeListener(id);
      }
    }, timeout);

    timeoutsRef.current.set(id, timeoutId);

    return () => {
      removeListener(id);
      window.removeEventListener('websocket-message', listener as EventListener);
    };
  }, []); // Removendo dependências instáveis

  const removeListener = useCallback((id: string) => {
    // Limpar listener
    listenersRef.current.delete(id);
    
    // Limpar timeout
    const timeoutId = timeoutsRef.current.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutsRef.current.delete(id);
    }
  }, []);

  // Cleanup automático na desmontagem do componente
  useEffect(() => {
    return () => {
      // Limpar todos os listeners e timeouts
      timeoutsRef.current.forEach(timeout => clearTimeout(timeout));
      timeoutsRef.current.clear();
      listenersRef.current.clear();
    };
  }, []); // Removendo dependencies para evitar re-renderizações

  return { addListener, removeListener };
};

/**
 * Hook para envio de mensagens WebSocket com controle de estado
 */
export const useWebSocketRequest = () => {
  const pendingRequestsRef = useRef<Set<string>>(new Set());

  const sendRequest = useCallback(async (
    sendWSMessage: (message: any) => boolean,
    message: AniListWSRequest
  ): Promise<boolean> => {
    if (pendingRequestsRef.current.has(message.requestId)) {
      console.warn('Requisição já está pendente:', message.requestId);
      return false;
    }

    pendingRequestsRef.current.add(message.requestId);

    try {
      const success = sendWSMessage(message);
      if (!success) {
        pendingRequestsRef.current.delete(message.requestId);
      }
      return success;
    } catch (error) {
      pendingRequestsRef.current.delete(message.requestId);
      throw error;
    }
  }, []);

  const markRequestComplete = useCallback((requestId: string) => {
    pendingRequestsRef.current.delete(requestId);
  }, []);

  const isPending = useCallback((requestId: string) => {
    return pendingRequestsRef.current.has(requestId);
  }, []);

  // Cleanup na desmontagem
  useEffect(() => {
    return () => {
      pendingRequestsRef.current.clear();
    };
  }, []);

  return { sendRequest, markRequestComplete, isPending };
};

/**
 * Utilitário para debug de WebSocket (apenas em desenvolvimento)
 */
export const debugWebSocket = (message: string, data?: unknown) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`🔌 WebSocket: ${message}`, data);
  }
};
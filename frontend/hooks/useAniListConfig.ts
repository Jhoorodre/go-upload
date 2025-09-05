'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { useWebSocketListener, useWebSocketRequest, generateRequestId, debugWebSocket } from '../utils/websocket';
import type { AniListConfig, AniListConfigResponse, AniListWSRequest } from '../types/anilist';

interface UseAniListConfigReturn {
  config: AniListConfig | null;
  isLoading: boolean;
  error: string | null;
  updateConfig: (newConfig: Partial<AniListConfig>) => Promise<void>;
  resetConfig: () => Promise<void>;
  refreshConfig: () => Promise<void>;
}

export function useAniListConfig(): UseAniListConfigReturn {
  const { sendWSMessage } = useAppContext();
  
  const [config, setConfig] = useState<AniListConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Utilizar o hook de WebSocket listener
  const { addListener, removeListener } = useWebSocketListener<AniListConfigResponse>(
    ['config_retrieved', 'config_updated', 'config_reset', 'error'],
    /^config-/
  );
  
  const { sendRequest, markRequestComplete } = useWebSocketRequest();

  const handleConfigResponse = useCallback((response: AniListConfigResponse) => {
    debugWebSocket('Resposta de configuração recebida', response.status);
    
    switch (response.status) {
      case 'config_retrieved':
      case 'config_updated':
      case 'config_reset':
        if (response.data) {
          setConfig(response.data);
          setIsLoading(false);
          setError(null);
        } else {
          setError('Resposta inválida do servidor');
          setIsLoading(false);
        }
        break;
      
      case 'error':
        setError(response.error || 'Erro desconhecido na configuração');
        setIsLoading(false);
        break;
    }
    
    // Marcar requisição como completa
    if (response.requestId) {
      markRequestComplete(response.requestId);
      removeListener(response.requestId);
    }
  }, [markRequestComplete, removeListener]);

  const refreshConfig = useCallback(async () => {
    if (isLoading) {
      debugWebSocket('Carregamento já em andamento');
      return;
    }
    
    if (!sendWSMessage) {
      setError('Conexão WebSocket não disponível');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    const requestId = generateRequestId('config-get');
    
    // Adicionar listener para esta requisição
    const cleanup = addListener(requestId, handleConfigResponse);

    try {
      const message: AniListWSRequest = {
        action: 'get_anilist_config',
        requestId,
        data: {}
      };
      
      const success = await sendRequest(sendWSMessage, message);
      
      if (!success) {
        setIsLoading(false);
        setError('Falha ao enviar mensagem WebSocket');
        cleanup();
      }
    } catch (err) {
      setIsLoading(false);
      setError('Erro ao conectar com o servidor');
      cleanup();
    }
  }, [sendWSMessage, isLoading, addListener, handleConfigResponse, sendRequest]);

  const updateConfig = useCallback(async (newConfig: Partial<AniListConfig>) => {
    if (!config || !sendWSMessage) {
      setError(config ? 'Conexão WebSocket não disponível' : 'Configuração não carregada');
      return;
    }

    setIsLoading(true);
    setError(null);
    
    const requestId = generateRequestId('config-update');
    const cleanup = addListener(requestId, handleConfigResponse);

    try {
      const updatedConfig = { ...config, ...newConfig };
      
      const message: AniListWSRequest = {
        action: 'update_anilist_config',
        requestId,
        data: { config: updatedConfig }
      };

      const success = await sendRequest(sendWSMessage, message);
      
      if (!success) {
        setIsLoading(false);
        setError('Falha ao enviar mensagem WebSocket');
        cleanup();
      }
    } catch (err) {
      setIsLoading(false);
      setError('Erro ao conectar com o servidor');
      cleanup();
    }
  }, [config, sendWSMessage, addListener, handleConfigResponse, sendRequest]);

  const resetConfig = useCallback(async () => {
    if (!sendWSMessage) {
      setError('Conexão WebSocket não disponível');
      return;
    }

    setIsLoading(true);
    setError(null);
    
    const requestId = generateRequestId('config-reset');
    const cleanup = addListener(requestId, handleConfigResponse);

    try {
      const message: AniListWSRequest = {
        action: 'reset_anilist_config',
        requestId,
        data: {}
      };

      const success = await sendRequest(sendWSMessage, message);
      
      if (!success) {
        setIsLoading(false);
        setError('Falha ao enviar mensagem WebSocket');
        cleanup();
      }
    } catch (err) {
      setIsLoading(false);
      setError('Erro ao conectar com o servidor');
      cleanup();
    }
  }, [sendWSMessage, addListener, handleConfigResponse, sendRequest]);

  // Carregar configuração inicial apenas uma vez
  useEffect(() => {
    if (!config && !isLoading && typeof sendWSMessage === 'function') {
      const timeout = setTimeout(() => {
        refreshConfig();
      }, 100);
      
      return () => clearTimeout(timeout);
    }
  }, [sendWSMessage, config, isLoading, refreshConfig]);

  return {
    config,
    isLoading,
    error,
    updateConfig,
    resetConfig,
    refreshConfig
  };
}

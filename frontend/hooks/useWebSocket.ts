import { useRef, useEffect, useCallback, useState } from 'react';
import type { WSMessage, WSResponse, LogEntry } from '../types';

interface UseWebSocketOptions {
  url: string;
  onMessage?: (data: WSResponse) => void;
  onLog?: (log: LogEntry) => void;
  autoReconnect?: boolean;
  reconnectInterval?: number;
}

export function useWebSocket({
  url,
  onMessage,
  onLog,
  autoReconnect = true,
  reconnectInterval = 3000
}: UseWebSocketOptions) {
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const onMessageRef = useRef(onMessage);
  const onLogRef = useRef(onLog);
  const pendingSendRef = useRef<Set<string>>(new Set()); // Para evitar envios duplicados
  const [isConnected, setIsConnected] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  // Update refs when props change
  useEffect(() => {
    onMessageRef.current = onMessage;
    onLogRef.current = onLog;
  }, [onMessage, onLog]);

  const addLog = useCallback((type: LogEntry['type'], message: string, category?: LogEntry['category']) => {
    onLogRef.current?.({
      type,
      message,
      category: category || 'system',
      timestamp: new Date().toISOString()
    });
  }, []);

  const connect = useCallback(() => {
    try {
      ws.current = new WebSocket(url);
      
      ws.current.onopen = () => {
        // Usar setTimeout para garantir que o estado está estável
        setTimeout(() => {
          if (ws.current?.readyState === WebSocket.OPEN) {
            setIsConnected(true);
            setReconnectAttempts(0);
            addLog('success', 'Conectado ao WebSocket', 'system');
          }
        }, 10);
      };

      ws.current.onmessage = (event) => {
        try {
          console.log('📨 Mensagem WebSocket recebida (raw):', event.data);
          console.log('📨 Tipo da mensagem:', typeof event.data);
          console.log('📨 Tamanho da mensagem:', event.data.length);
          
          if (!event.data || event.data.trim() === '') {
            console.warn('⚠️ Mensagem WebSocket vazia recebida');
            return;
          }
          
          const data: WSResponse = JSON.parse(event.data);
          console.log('📨 Mensagem WebSocket parseada:', data);
          console.log('📨 Status da mensagem:', data.status);
          console.log('📨 Chaves do objeto:', Object.keys(data));
          
          
          // Verificar se o objeto está vazio ou não possui status
          if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
            console.warn('⚠️ Mensagem WebSocket parseada está vazia ou inválida:', data);
            return;
          }
          
          // Verificar se tem status válido
          if (!data.status) {
            console.warn('⚠️ Mensagem WebSocket sem status:', data);
            return;
          }
          
          console.log('✅ Passando mensagem para AppContext:', data);
          onMessageRef.current?.(data);
          
          // Handle different response types
          switch (data.status) {
            case 'discover_complete':
              addLog('success', 
                data.metadata 
                  ? `Descoberta completa! Detectado: ${data.metadata.rootLevel} com ${data.metadata.stats.totalChapters} capítulos e ${data.metadata.stats.totalImages} imagens`
                  : "Descoberta da biblioteca completa!",
                'discovery'
              );
              break;
            case 'complete':
              addLog('success', `Upload completo: ${data.file} -> ${data.url}`, 'upload');
              break;
            case 'error':
              addLog('error', `Erro: ${data.error} (Arquivo: ${data.file || 'N/A'})`, 'upload');
              break;
            case 'metadata_saved':
              const filePath = data.payload?.filePath || 'arquivo desconhecido';
              addLog('success', `Metadados salvos com sucesso: ${filePath}`, 'system');
              break;
            case 'metadata_loaded':
              addLog('success', `Metadados carregados com sucesso`, 'system');
              break;
            case 'collection_progress':
            case 'batch_progress':
              // Progress updates don't need individual logs to avoid spam
              break;
            default:
              addLog('info', `Recebido: ${event.data}`, 'system');
          }
        } catch (error) {
          console.error('❌ ERRO PARSING WEBSOCKET - Análise detalhada:', {
            rawData: event.data,
            rawDataType: typeof event.data,
            rawDataLength: event.data?.length,
            isEmptyString: event.data === '',
            isEmptyObject: event.data === '{}',
            firstChars: event.data?.substring(0, 50),
            lastChars: event.data?.substring(event.data.length - 50),
            error: error,
            errorMessage: error instanceof Error ? error.message : 'Erro desconhecido',
            errorStack: error instanceof Error ? error.stack : 'Stack não disponível'
          });
          addLog('error', `Falha ao processar mensagem do servidor: ${error instanceof Error ? error.message : 'JSON inválido'}`, 'system');
        }
      };

      ws.current.onclose = (event) => {
        setIsConnected(false);
        
        if (event.wasClean) {
          addLog('info', 'Desconectado do WebSocket', 'system');
        } else {
          addLog('warning', `Conexão perdida (código: ${event.code})`, 'system');
          
          if (autoReconnect && reconnectAttempts < 10) {
            const attempt = reconnectAttempts + 1;
            setReconnectAttempts(attempt);
            
            reconnectTimeout.current = setTimeout(() => {
              addLog('info', `Tentativa de reconexão ${attempt}/10...`, 'system');
              connect();
            }, reconnectInterval);
          } else if (reconnectAttempts >= 10) {
            addLog('error', 'Limite de reconexões atingido. Servidor pode estar offline.', 'system');
          }
        }
      };

      ws.current.onerror = () => {
        addLog('error', 'Erro na conexão WebSocket', 'system');
      };

    } catch (error) {
      addLog('error', `Falha ao conectar: ${error}`, 'system');
    }
  }, [url, autoReconnect, reconnectInterval, reconnectAttempts, addLog]);

  const disconnect = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }
    
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }
    
    setIsConnected(false);
    setReconnectAttempts(0);
  }, []);

  const send = useCallback((data: any) => {
    console.log('� Tentando enviar via WebSocket:', { 
      isConnected, 
      wsExists: !!ws.current, 
      readyState: ws.current?.readyState,
      CONNECTING: WebSocket.CONNECTING,
      OPEN: WebSocket.OPEN,
      CLOSING: WebSocket.CLOSING,
      CLOSED: WebSocket.CLOSED
    });
    
    if (!ws.current) {
      console.warn('❌ WebSocket não existe');
      return false;
    }
    
    // Verificação rigorosa: só envia quando realmente conectado
    if (ws.current.readyState !== WebSocket.OPEN) {
      console.warn('❌ WebSocket não está pronto para envio. Estado:', {
        readyState: ws.current.readyState,
        isConnected,
        status: ws.current.readyState === WebSocket.CONNECTING ? 'CONNECTING' :
                ws.current.readyState === WebSocket.CLOSING ? 'CLOSING' :
                ws.current.readyState === WebSocket.CLOSED ? 'CLOSED' : 'UNKNOWN'
      });
      return false;
    }
    
    try {
      ws.current.send(JSON.stringify(data));
      // Log simplificado - apenas ação
      console.log('✅ Enviado:', data.action || 'ação desconhecida');
      
      // Log detalhado para load_metadata
      if (data.action === 'load_metadata' && process.env.NODE_ENV === 'development') {
        console.log('🔍 LOAD_METADATA enviado via WebSocket:', {
          mangaName: data.payload?.mangaName,
          mangaID: data.payload?.mangaID,
          metadataOutput: data.payload?.metadataOutput,
          fullPayload: data.payload
        });
      }
      
      return true;
    } catch (error) {
      console.error('❌ Erro ao enviar mensagem:', error);
      onLogRef.current?.({
        type: 'error',
        message: `Falha ao enviar dados: ${error}`,
        category: 'system',
        timestamp: new Date().toISOString()
      });
      return false;
    }
  }, [isConnected, addLog]);

  useEffect(() => {
    connect();
    
    return () => {
      disconnect();
    };
  }, [url]);

  return {
    isConnected,
    reconnectAttempts,
    send,
    connect,
    disconnect
  };
}
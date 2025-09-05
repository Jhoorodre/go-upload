import { useCallback, useEffect, useRef, useState } from 'react';

// Pool global de conexões WebSocket
class WebSocketPool {
  private static instance: WebSocketPool;
  private connections: Map<string, WebSocket> = new Map();
  private subscribers: Map<string, Set<(data: any) => void>> = new Map();
  private connectionStatusCallbacks: Map<string, Set<(connected: boolean) => void>> = new Map();
  private maxConnections = 10; // Limite de conexões simultâneas
  
  static getInstance(): WebSocketPool {
    if (!WebSocketPool.instance) {
      WebSocketPool.instance = new WebSocketPool();
    }
    return WebSocketPool.instance;
  }

  private getConnectionKey(url: string): string {
    return url;
  }

  subscribe(url: string, callback: (data: any) => void): () => void {
    const key = this.getConnectionKey(url);
    
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    
    this.subscribers.get(key)!.add(callback);
    
    // Criar conexão se não existir
    if (!this.connections.has(key)) {
      this.createConnection(key, url);
    }
    
    console.log(`📡 WebSocket Pool: +1 subscriber (${this.subscribers.get(key)!.size} total para ${url})`);
    
    // Retorna função de cleanup
    return () => {
      this.subscribers.get(key)?.delete(callback);
      if (this.subscribers.get(key)?.size === 0) {
        this.closeConnection(key);
      }
      console.log(`📡 WebSocket Pool: -1 subscriber (${this.subscribers.get(key)?.size || 0} restantes para ${url})`);
    };
  }

  subscribeToConnectionStatus(url: string, callback: (connected: boolean) => void): () => void {
    const key = this.getConnectionKey(url);
    
    if (!this.connectionStatusCallbacks.has(key)) {
      this.connectionStatusCallbacks.set(key, new Set());
    }
    
    this.connectionStatusCallbacks.get(key)!.add(callback);
    
    // Enviar status atual imediatamente
    const ws = this.connections.get(key);
    callback(ws?.readyState === WebSocket.OPEN);
    
    return () => {
      this.connectionStatusCallbacks.get(key)?.delete(callback);
      if (this.connectionStatusCallbacks.get(key)?.size === 0) {
        this.connectionStatusCallbacks.delete(key);
      }
    };
  }

  private notifyConnectionStatus(key: string, connected: boolean) {
    this.connectionStatusCallbacks.get(key)?.forEach(callback => {
      try {
        callback(connected);
      } catch (error) {
        console.error('Connection status callback error:', error);
      }
    });
  }

  private createConnection(key: string, url: string) {
    if (this.connections.size >= this.maxConnections) {
      console.warn(`⚠️ Pool limit reached (${this.maxConnections}). Reusing existing connection.`);
      return;
    }

    try {
      console.log(`🔗 Creating new WebSocket connection: ${url}`);
      const ws = new WebSocket(url);
      
      ws.onopen = () => {
        console.log(`✅ WebSocket Pool connected: ${url}`);
        this.notifyConnectionStatus(key, true);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Broadcast para todos os subscribers
          this.subscribers.get(key)?.forEach(callback => {
            try {
              callback(data);
            } catch (error) {
              console.error('Subscriber callback error:', error);
            }
          });
        } catch (error) {
          console.error('WebSocket message parse error:', error);
        }
      };
      
      ws.onclose = (event) => {
        console.log(`❌ WebSocket Pool disconnected: ${url} (code: ${event.code})`);
        this.connections.delete(key);
        this.notifyConnectionStatus(key, false);
        // Tentar reconectar se ainda há subscribers e não foi um fechamento intencional
        if (this.subscribers.get(key)?.size! > 0 && event.code !== 1000) {
          setTimeout(() => {
            if (this.subscribers.get(key)?.size! > 0) {
              this.createConnection(key, url);
            }
          }, 3000);
        }
      };
      
      ws.onerror = (error) => {
        // Log mais detalhado apenas em desenvolvimento
        if (process.env.NODE_ENV === 'development') {
          console.error(`🚨 WebSocket Pool error for ${url}:`, error);
        }
        // Em produção, apenas avisar que a conexão falhou
        console.warn(`WebSocket connection failed: ${url}`);
        this.notifyConnectionStatus(key, false);
      };
      
      this.connections.set(key, ws);
    } catch (error) {
      console.error(`Failed to create WebSocket connection to ${url}:`, error);
    }
  }

  private closeConnection(key: string) {
    const ws = this.connections.get(key);
    if (ws) {
      console.log(`🔌 Closing WebSocket connection: ${key}`);
      this.notifyConnectionStatus(key, false);
      ws.close();
      this.connections.delete(key);
      this.subscribers.delete(key);
      this.connectionStatusCallbacks.delete(key);
    }
  }

  send(url: string, data: any): boolean {
    const key = this.getConnectionKey(url);
    const ws = this.connections.get(key);
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
      return true;
    }
    
    console.warn(`⚠️ Cannot send data, WebSocket not ready for: ${url}`);
    return false;
  }

  getPoolStats() {
    return {
      activeConnections: this.connections.size,
      totalSubscribers: Array.from(this.subscribers.values()).reduce((acc, set) => acc + set.size, 0),
      connectionDetails: Array.from(this.subscribers.entries()).map(([key, subs]) => ({
        url: key,
        subscribers: subs.size,
        connected: this.connections.get(key)?.readyState === WebSocket.OPEN
      }))
    };
  }
}

export interface UseWebSocketPoolOptions {
  url: string;
  onMessage?: (data: any) => void;
  enabled?: boolean;
}

export function useWebSocketPool({ url, onMessage, enabled = true }: UseWebSocketPoolOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const pool = useRef(WebSocketPool.getInstance());
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const unsubscribeStatusRef = useRef<(() => void) | null>(null);
  const onMessageRef = useRef(onMessage);

  // Manter a referência atualizada sem causar re-renders
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!enabled) {
      setIsConnected(false);
      return;
    }

    // Subscribe to messages
    unsubscribeRef.current = pool.current.subscribe(url, (data) => {
      onMessageRef.current?.(data);
    });

    // Subscribe to connection status
    unsubscribeStatusRef.current = pool.current.subscribeToConnectionStatus(url, (connected) => {
      setIsConnected(connected);
    });

    return () => {
      unsubscribeRef.current?.();
      unsubscribeStatusRef.current?.();
      setIsConnected(false);
    };
  }, [url, enabled]); // Remover onMessage das dependências

  const send = useCallback((data: any) => {
    return pool.current.send(url, data);
  }, [url]);

  const getStats = useCallback(() => {
    return pool.current.getPoolStats();
  }, []);

  return {
    isConnected,
    send,
    getStats
  };
}

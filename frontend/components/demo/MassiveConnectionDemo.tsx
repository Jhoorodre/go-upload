import React, { useState, useEffect } from 'react';
import { useWebSocketPool } from '../../hooks/useWebSocketPool';
import { VirtualizedList, useMassiveList } from '../ui/VirtualizedList';

interface MassiveConnectionItem {
  id: string;
  status: 'connecting' | 'connected' | 'error';
  lastMessage?: string;
  messageCount: number;
}

export function MassiveConnectionDemo() {
  const [connectionCount, setConnectionCount] = useState(100);
  const [connections, setConnections] = useState<MassiveConnectionItem[]>([]);
  const [autoSend, setAutoSend] = useState(false);

  // Pool principal
  const mainPool = useWebSocketPool({
    url: 'ws://localhost:8080/ws',
    onMessage: (data) => {
      console.log('📨 Main pool message:', data);
    }
  });

  // Gerar dados massivos
  useEffect(() => {
    const items: MassiveConnectionItem[] = [];
    for (let i = 0; i < connectionCount; i++) {
      items.push({
        id: `conn-${i}`,
        status: Math.random() > 0.1 ? 'connected' : 'connecting',
        messageCount: Math.floor(Math.random() * 1000)
      });
    }
    setConnections(items);
  }, [connectionCount]);

  // Auto-send messages para teste de carga
  useEffect(() => {
    if (!autoSend) return;

    const interval = setInterval(() => {
      if (mainPool.isConnected) {
        mainPool.send({
          type: 'ping',
          timestamp: Date.now()
        });
      }
    }, 100); // 10 mensagens por segundo

    return () => clearInterval(interval);
  }, [autoSend, mainPool]);

  const { VirtualizedList: VList } = useMassiveList(connections, {
    itemHeight: 80,
    containerHeight: 500,
    chunkSize: 50
  });

  const renderConnectionItem = (item: MassiveConnectionItem, index: number) => (
    <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white hover:bg-gray-50">
      <div className="flex items-center space-x-3">
        <div className={`w-3 h-3 rounded-full ${
          item.status === 'connected' ? 'bg-green-500' :
          item.status === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'
        }`} />
        <div>
          <div className="font-medium text-sm">{item.id}</div>
          <div className="text-xs text-gray-500">
            {item.messageCount} mensagens | {item.status}
          </div>
        </div>
      </div>
      
      <div className="text-xs text-gray-400">
        #{index + 1}
      </div>
    </div>
  );

  const stats = mainPool.getStats();

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-4">🚀 Massive Connection Demo</h1>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-blue-100 p-4 rounded-lg">
            <div className="text-2xl font-bold text-blue-600">{connections.length}</div>
            <div className="text-sm text-blue-500">Total Connections</div>
          </div>
          
          <div className="bg-green-100 p-4 rounded-lg">
            <div className="text-2xl font-bold text-green-600">{stats.activeConnections}</div>
            <div className="text-sm text-green-500">Active WebSockets</div>
          </div>
          
          <div className="bg-purple-100 p-4 rounded-lg">
            <div className="text-2xl font-bold text-purple-600">{stats.totalSubscribers}</div>
            <div className="text-sm text-purple-500">Total Subscribers</div>
          </div>
          
          <div className="bg-yellow-100 p-4 rounded-lg">
            <div className={`text-2xl font-bold ${mainPool.isConnected ? 'text-green-600' : 'text-red-600'}`}>
              {mainPool.isConnected ? 'ON' : 'OFF'}
            </div>
            <div className="text-sm text-yellow-500">Main Pool Status</div>
          </div>
        </div>

        <div className="flex items-center space-x-4 mb-4">
          <div className="flex items-center space-x-2">
            <label className="text-sm font-medium">Connections:</label>
            <input
              type="range"
              min="10"
              max="10000"
              step="10"
              value={connectionCount}
              onChange={(e) => setConnectionCount(parseInt(e.target.value))}
              className="w-32"
            />
            <span className="text-sm text-gray-600">{connectionCount}</span>
          </div>

          <button
            onClick={() => setAutoSend(!autoSend)}
            className={`px-4 py-2 rounded text-sm font-medium ${
              autoSend 
                ? 'bg-red-500 text-white hover:bg-red-600' 
                : 'bg-green-500 text-white hover:bg-green-600'
            }`}
          >
            {autoSend ? 'Stop Auto-Send' : 'Start Auto-Send'}
          </button>

          <button
            onClick={() => {
              for (let i = 0; i < 100; i++) {
                setTimeout(() => {
                  if (mainPool.isConnected) {
                    mainPool.send({
                      type: 'stress_test',
                      batch: i,
                      data: Array(100).fill('test').join('')
                    });
                  }
                }, i * 10);
              }
            }}
            className="px-4 py-2 bg-purple-500 text-white rounded text-sm font-medium hover:bg-purple-600"
          >
            Stress Test (1000 msgs)
          </button>
        </div>

        {/* Pool Stats Detail */}
        <div className="bg-gray-50 p-4 rounded-lg mb-4">
          <h3 className="font-medium mb-2">Pool Statistics:</h3>
          <pre className="text-xs text-gray-600 overflow-auto">
            {JSON.stringify(stats, null, 2)}
          </pre>
        </div>
      </div>

      {/* Virtualized List */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-gray-100 px-4 py-2 font-medium text-sm">
          Connection List (Virtualized - showing ~50 of {connections.length})
        </div>
        <VList renderItem={renderConnectionItem} />
      </div>

      {/* Performance Tips */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-800 mb-2">🔧 Performance Features Active:</h3>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>✅ <strong>WebSocket Pooling:</strong> Reutiliza conexões entre componentes</li>
          <li>✅ <strong>Virtualization:</strong> Renderiza apenas itens visíveis</li>
          <li>✅ <strong>Throttling:</strong> Controla taxa de mensagens</li>
          <li>✅ <strong>Debouncing:</strong> Evita spam de discovery requests</li>
          <li>✅ <strong>Memory Management:</strong> Cleanup automático de subscribers</li>
        </ul>
      </div>
    </div>
  );
}

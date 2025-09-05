// Componente client-only para evitar problemas de hidratação
'use client';

import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { Button } from '../ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useAppContext } from '../../contexts/AppContext';
import { VirtualizedList } from '../ui/VirtualizedList';
import { MassiveConnectionDemo } from '../demo/MassiveConnectionDemo';
import type { LogEntry } from '../../types';

interface LogsPageProps {
  // Props are now handled by context
}

interface SystemMetrics {
  activeConnections: number;
  totalMessages: number;
  memoryUsage: string;
  uptime: string;
  errorRate: number;
  throughput: number;
}

interface ConnectionStats {
  activeConnections: number;
  totalSubscribers: number;
  connectionDetails: Array<{
    url: string;
    subscribers: number;
    connected: boolean;
  }>;
}

export const LogsPage: React.FC<LogsPageProps> = () => {
  const { logs, isConnected, clearLogs, wsStats } = useAppContext();
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    system: true,
    discovery: true,
    upload: true,
    batch: true,
    websocket: true,
    performance: true
  });
  
  const [autoScroll, setAutoScroll] = useState(true);
  const [viewMode, setViewMode] = useState<'dashboard' | 'logs' | 'demo'>('dashboard');
  const [connectionStats, setConnectionStats] = useState<ConnectionStats>({
    activeConnections: 0,
    totalSubscribers: 0,
    connectionDetails: []
  });
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics>({
    activeConnections: 0,
    totalMessages: 0,
    memoryUsage: '0 MB',
    uptime: '0s',
    errorRate: 0,
    throughput: 0
  });

  const formatUptime = (milliseconds: number) => {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  // Atualizar estatísticas periodicamente (apenas no cliente)
  useEffect(() => {
    if (wsStats) {
      const stats = wsStats();
      setConnectionStats(stats);
    }
    
    const interval = setInterval(() => {
      if (wsStats) {
        const stats = wsStats();
        setConnectionStats(stats);
        
        // Simular métricas do sistema
        setSystemMetrics(prev => ({
          activeConnections: stats.activeConnections,
          totalMessages: prev.totalMessages + Math.floor(Math.random() * 10),
          memoryUsage: `${(25 + Math.random() * 10).toFixed(1)} MB`,
          uptime: formatUptime(Date.now() - (typeof performance !== 'undefined' ? performance.timeOrigin : Date.now())),
          errorRate: Math.random() * 5,
          throughput: 50 + Math.random() * 100
        }));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [wsStats]);

  const logsByCategory = useMemo(() => {
    const categories = ['system', 'discovery', 'upload', 'batch'] as const;
    return categories.reduce((acc, category) => {
      acc[category] = logs.filter(log => log.category === category);
      return acc;
    }, {} as Record<string, LogEntry[]>);
  }, [logs]);

  const toggleCategory = useCallback((category: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  }, []);

  const getLogIcon = (type: string) => {
    switch (type) {
      case 'success': return '';
      case 'error': return '';
      case 'warning': return '';
      case 'info': return '';
      default: return '';
    }
  };

  const getCategoryIcon = (category: string) => {
    return '';
  };

  const formatMessage = (message: string) => {
    // Parse JSON messages for better display
    if (message.startsWith('Recebido: ')) {
      try {
        const jsonStr = message.replace('Recebido: ', '');
        const parsed = JSON.parse(jsonStr);
        
        if (parsed.status === 'discovery_progress' && parsed.progress) {
          const { current, total, percentage, currentFile } = parsed.progress;
          return `Descobrindo (${percentage}%) - ${currentFile} [${current}/${total}]`;
        }
        
        return `${parsed.status || 'Status desconhecido'}`;
      } catch {
        return message;
      }
    }
    
    return message;
  };

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      console.log('Logs copiados para o clipboard');
    } catch (error) {
      console.error('Erro ao copiar logs:', error);
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
  }, []);

  const copyAllLogs = useCallback(() => {
    const logText = logs.map(log => 
      `[${log.timestamp ? new Date(log.timestamp).toLocaleString('pt-BR') : 'N/A'}] [${log.type.toUpperCase()}] [${log.category?.toUpperCase() || 'SYSTEM'}] ${log.message}`
    ).join('\n');
    copyToClipboard(logText);
  }, [logs, copyToClipboard]);

  const copyCategoryLogs = useCallback((category: string, categoryLogs: LogEntry[]) => {
    const logText = categoryLogs.map(log => 
      `[${log.timestamp ? new Date(log.timestamp).toLocaleString('pt-BR') : 'N/A'}] [${log.type.toUpperCase()}] ${log.message}`
    ).join('\n');
    copyToClipboard(logText);
  }, [copyToClipboard]);

  const renderDashboard = () => (
    <div className="space-y-6">
      {/* Header com Controles */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
            Sistema Massivo Dashboard
          </h2>
          <Badge 
            variant={isConnected ? "success" : "destructive"} 
            className={`text-xs font-semibold px-3 py-1 ${
              isConnected 
                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' 
                : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
            }`}
          >
            <div className={`w-2 h-2 rounded-full mr-2 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            {isConnected ? "ONLINE" : "OFFLINE"}
          </Badge>
        </div>
        
        <div className="flex items-center space-x-2">
          <Button
            onClick={() => setViewMode('dashboard')}
            variant={viewMode === 'dashboard' ? 'default' : 'outline'}
            size="sm"
          >
            Dashboard
          </Button>
          <Button
            onClick={() => setViewMode('demo')}
            variant={viewMode === 'demo' ? 'default' : 'outline'}
            size="sm"
          >
            Demo
          </Button>
          <Button
            onClick={() => setViewMode('logs')}
            variant={viewMode === 'logs' ? 'default' : 'outline'}
            size="sm"
          >
            Logs
          </Button>
        </div>
      </div>

      {/* Métricas Principais */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{systemMetrics.activeConnections}</div>
                <div className="text-sm font-medium text-slate-600 dark:text-slate-400 mt-1">Conexões Ativas</div>
              </div>
              <div className="w-3 h-3 bg-blue-500 rounded-full" />
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{systemMetrics.totalMessages.toLocaleString()}</div>
                <div className="text-sm font-medium text-slate-600 dark:text-slate-400 mt-1">Mensagens Total</div>
              </div>
              <div className="w-3 h-3 bg-green-500 rounded-full" />
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{systemMetrics.throughput.toFixed(0)}</div>
                <div className="text-sm font-medium text-slate-600 dark:text-slate-400 mt-1">Msgs/seg</div>
              </div>
              <div className="w-3 h-3 bg-purple-500 rounded-full" />
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{systemMetrics.memoryUsage}</div>
                <div className="text-sm font-medium text-slate-600 dark:text-slate-400 mt-1">Memória</div>
              </div>
              <div className="w-3 h-3 bg-orange-500 rounded-full" />
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{systemMetrics.errorRate.toFixed(1)}%</div>
                <div className="text-sm font-medium text-slate-600 dark:text-slate-400 mt-1">Taxa de Erro</div>
              </div>
              <div className="w-3 h-3 bg-red-500 rounded-full" />
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{systemMetrics.uptime}</div>
                <div className="text-sm font-medium text-slate-600 dark:text-slate-400 mt-1">Uptime</div>
              </div>
              <div className="w-3 h-3 bg-indigo-500 rounded-full" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pool de Conexões */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <span>Pool de Conexões WebSocket</span>
            <Badge variant="outline">{connectionStats.totalSubscribers} subscribers</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {connectionStats.connectionDetails.map((detail, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 rounded-full ${detail.connected ? 'bg-green-500' : 'bg-red-500'}`} />
                  <div>
                    <div className="font-medium text-sm">{detail.url}</div>
                    <div className="text-xs text-gray-500">{detail.subscribers} subscribers</div>
                  </div>
                </div>
                <Badge variant={detail.connected ? "success" : "destructive"}>
                  {detail.connected ? "Conectado" : "Desconectado"}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Logs Recentes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Logs Recentes</span>
            <Badge variant="outline">{logs.length} entradas</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {logs.slice(-10).reverse().map((log, index) => (
              <div key={index} className="flex items-center space-x-3 p-2 bg-gray-50 dark:bg-gray-800 rounded text-sm">
                <div className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${
                  log.type === 'error' ? 'bg-red-500' :
                  log.type === 'warning' ? 'bg-yellow-500' :
                  log.type === 'success' ? 'bg-green-500' :
                  'bg-blue-500'
                }`} />
                <span className="text-xs text-gray-500 min-w-fit">
                  {log.timestamp ? new Date(log.timestamp).toLocaleTimeString('pt-BR') : '--:--'}
                </span>
                <span className="flex-1 truncate">{formatMessage(log.message)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderDemo = () => <MassiveConnectionDemo />;

  const renderLogs = () => (
    <div className="space-y-6 max-w-full">
      {/* Header Original dos Logs */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
            Logs do Sistema
          </h2>
          <Badge 
            variant={isConnected ? "success" : "destructive"} 
            className={`text-xs font-semibold px-3 py-1 ${
              isConnected 
                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' 
                : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
            }`}
          >
            <div className={`w-2 h-2 rounded-full mr-2 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            {isConnected ? "Conectado" : "Desconectado"}
          </Badge>
        </div>
        
        <div className="flex items-center space-x-2">
          <Badge variant="outline" className="text-xs px-3 py-1 bg-gray-100 dark:bg-gray-800">
            {logs.length} entradas
          </Badge>
          
          <div className="flex items-center space-x-1">
            <input
              type="checkbox"
              id="autoScroll"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
            <label htmlFor="autoScroll" className="text-xs text-gray-300">
              Auto-scroll
            </label>
          </div>
          
          {logs.length > 0 && (
            <>
              <Button 
                onClick={copyAllLogs} 
                variant="outline" 
                size="sm"
                className="text-xs px-2 py-1"
              >
                Copiar Todos
              </Button>
              <Button 
                onClick={clearLogs} 
                variant="outline" 
                size="sm"
                className="text-xs px-2 py-1 text-red-600 hover:text-red-700"
              >
                Limpar
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Logs Content */}
      {logs.length === 0 ? (
        <Card className="bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-600">
          <CardContent className="flex items-center justify-center py-16">
            <div className="text-center text-gray-400">
              <div className="w-16 h-16 bg-slate-200 dark:bg-slate-700 rounded-full flex items-center justify-center mb-4">
                <div className="w-8 h-8 bg-slate-400 dark:bg-slate-500 rounded" />
              </div>
              <p className="text-lg font-medium mb-2">Nenhum log disponível</p>
              <p className="text-sm opacity-70">Os logs aparecerão aqui conforme as operações forem executadas</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(logsByCategory).map(([category, categoryLogs]) => {
            if (categoryLogs.length === 0) return null;
            
            return (
              <Card key={category} className="bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-600">
                <CardHeader 
                  className="cursor-pointer hover:bg-gray-700/50 transition-colors"
                  onClick={() => toggleCategory(category)}
                >
                  <CardTitle className="flex items-center justify-between text-white">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-blue-500 rounded-full" />
                      <span className="capitalize">{category}</span>
                      <Badge variant="outline" className="bg-gray-700 text-gray-300 border-gray-500">
                        {categoryLogs.length}
                      </Badge>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyCategoryLogs(category, categoryLogs);
                        }}
                        variant="ghost"
                        size="sm"
                        className="text-xs px-2 py-1 text-gray-400 hover:text-white"
                      >
                        Copiar
                      </Button>
                      <span className="text-gray-400">
                        {expandedCategories[category] ? (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        )}
                      </span>
                    </div>
                  </CardTitle>
                </CardHeader>
                
                {expandedCategories[category] && (
                  <CardContent className="pt-0">
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {categoryLogs.map((log, index) => (
                        <div 
                          key={index} 
                          className={`flex items-start space-x-3 p-3 rounded-lg border-l-4 ${
                            log.type === 'error' ? 'bg-red-900/20 border-l-red-500' :
                            log.type === 'warning' ? 'bg-yellow-900/20 border-l-yellow-500' :
                            log.type === 'success' ? 'bg-green-900/20 border-l-green-500' :
                            'bg-blue-900/20 border-l-blue-500'
                          }`}
                        >
                          <div className={`w-3 h-3 rounded-full mt-1 flex-shrink-0 ${
                            log.type === 'error' ? 'bg-red-500' :
                            log.type === 'warning' ? 'bg-yellow-500' :
                            log.type === 'success' ? 'bg-green-500' :
                            'bg-blue-500'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2 mb-1">
                              <div className="w-3 h-3 bg-gray-400 rounded-full" />
                              <span className="text-xs text-gray-400">
                                {log.timestamp ? new Date(log.timestamp).toLocaleString('pt-BR') : 'Sem timestamp'}
                              </span>
                            </div>
                            <p className="text-sm text-gray-300 leading-relaxed">
                              {formatMessage(log.message)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div>
      {viewMode === 'dashboard' && renderDashboard()}
      {viewMode === 'demo' && renderDemo()}
      {viewMode === 'logs' && renderLogs()}
    </div>
  );
};

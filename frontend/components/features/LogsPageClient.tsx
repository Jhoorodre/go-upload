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

export const LogsPageClient: React.FC<LogsPageProps> = () => {
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
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto px-4 py-8 space-y-8">
        {/* Header Section */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <h1 className="text-3xl lg:text-4xl font-bold text-slate-900 dark:text-slate-100">
              Sistema Massivo Dashboard
            </h1>
            <div 
              className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                isConnected 
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' 
                  : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
              }`}
              role="status"
              aria-label={isConnected ? "Sistema online" : "Sistema offline"}
            >
              <div className={`w-2 h-2 rounded-full mr-2 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
              {isConnected ? "ONLINE" : "OFFLINE"}
            </div>
          </div>
          
          <nav className="flex items-center space-x-2" role="navigation" aria-label="Navegação do dashboard">
            <Button
              onClick={() => setViewMode('dashboard')}
              variant={viewMode === 'dashboard' ? 'default' : 'outline'}
              size="sm"
              aria-pressed={viewMode === 'dashboard'}
            >
              Dashboard
            </Button>
            <Button
              onClick={() => setViewMode('demo')}
              variant={viewMode === 'demo' ? 'default' : 'outline'}
              size="sm"
              aria-pressed={viewMode === 'demo'}
            >
              Demo
            </Button>
            <Button
              onClick={() => setViewMode('logs')}
              variant={viewMode === 'logs' ? 'default' : 'outline'}
              size="sm"
              aria-pressed={viewMode === 'logs'}
            >
              Logs
            </Button>
          </nav>
        </header>

        {/* System Metrics Grid */}
        <section aria-labelledby="metrics-heading">
          <h2 id="metrics-heading" className="sr-only">Métricas do Sistema</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 lg:gap-6">
            <Card className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl lg:text-3xl font-bold text-slate-900 dark:text-slate-100">
                      {systemMetrics.activeConnections}
                    </p>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mt-1">
                      Conexões Ativas
                    </p>
                  </div>
                  <div className="w-3 h-3 bg-blue-500 rounded-full" />
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl lg:text-3xl font-bold text-slate-900 dark:text-slate-100">
                      {systemMetrics.totalMessages.toLocaleString()}
                    </p>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mt-1">
                      Mensagens Total
                    </p>
                  </div>
                  <div className="w-3 h-3 bg-green-500 rounded-full" />
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl lg:text-3xl font-bold text-slate-900 dark:text-slate-100">
                      {systemMetrics.throughput.toFixed(0)}
                    </p>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mt-1">
                      Msgs/seg
                    </p>
                  </div>
                  <div className="w-3 h-3 bg-purple-500 rounded-full" />
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl lg:text-3xl font-bold text-slate-900 dark:text-slate-100">
                      {systemMetrics.memoryUsage}
                    </p>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mt-1">
                      Memória
                    </p>
                  </div>
                  <div className="w-3 h-3 bg-orange-500 rounded-full" />
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl lg:text-3xl font-bold text-slate-900 dark:text-slate-100">
                      {systemMetrics.errorRate.toFixed(1)}%
                    </p>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mt-1">
                      Taxa de Erro
                    </p>
                  </div>
                  <div className="w-3 h-3 bg-red-500 rounded-full" />
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl lg:text-3xl font-bold text-slate-900 dark:text-slate-100">
                      {systemMetrics.uptime}
                    </p>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mt-1">
                      Uptime
                    </p>
                  </div>
                  <div className="w-3 h-3 bg-indigo-500 rounded-full" />
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* WebSocket Connection Pool */}
        <section aria-labelledby="connections-heading">
          <Card className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <CardHeader className="border-b border-slate-200 dark:border-slate-700">
              <CardTitle className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center space-x-3">
                  <h3 id="connections-heading" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    Pool de Conexões WebSocket
                  </h3>
                  <Badge variant="outline" className="bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                    {connectionStats.totalSubscribers} subscribers
                  </Badge>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {connectionStats.connectionDetails.length === 0 ? (
                <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                  <p>Nenhuma conexão ativa</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {connectionStats.connectionDetails.map((detail, index) => (
                    <div key={index} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600">
                      <div className="flex items-center space-x-4">
                        <div 
                          className={`w-3 h-3 rounded-full flex-shrink-0 ${
                            detail.connected ? 'bg-green-500' : 'bg-red-500'
                          }`} 
                          aria-label={detail.connected ? 'Conectado' : 'Desconectado'}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">
                            {detail.url}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {detail.subscribers} subscribers
                          </p>
                        </div>
                      </div>
                      <Badge 
                        variant={detail.connected ? "success" : "destructive"}
                        className="flex-shrink-0"
                      >
                        {detail.connected ? "Conectado" : "Desconectado"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Recent Activity Log */}
        <section aria-labelledby="recent-logs-heading">
          <Card className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
            <CardHeader className="border-b border-slate-200 dark:border-slate-700">
              <CardTitle className="flex items-center justify-between">
                <h3 id="recent-logs-heading" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Atividade Recente
                </h3>
                <Badge variant="outline" className="bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                  {logs.length} entradas
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {logs.length === 0 ? (
                <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                  <p>Nenhuma atividade recente</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto" role="log" aria-live="polite">
                  {logs.slice(-10).reverse().map((log, index) => (
                    <div key={index} className={`flex items-start space-x-3 p-3 rounded-lg border-l-4 ${
                      log.type === 'error' ? 'bg-red-50 dark:bg-red-900/20 border-l-red-500' :
                      log.type === 'warning' ? 'bg-yellow-50 dark:bg-yellow-900/20 border-l-yellow-500' :
                      log.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 border-l-green-500' :
                      'bg-blue-50 dark:bg-blue-900/20 border-l-blue-500'
                    }`}>
                      <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                        log.type === 'error' ? 'bg-red-500' :
                        log.type === 'warning' ? 'bg-yellow-500' :
                        log.type === 'success' ? 'bg-green-500' :
                        'bg-blue-500'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2 mb-1">
                          <time className="text-xs font-medium text-slate-500 dark:text-slate-400" 
                                dateTime={log.timestamp ? new Date(log.timestamp).toISOString() : ''}>
                            {log.timestamp ? new Date(log.timestamp).toLocaleTimeString('pt-BR') : '--:--'}
                          </time>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            log.type === 'error' ? 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100' :
                            log.type === 'warning' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100' :
                            log.type === 'success' ? 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100' :
                            'bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-100'
                          }`}>
                            {log.type}
                          </span>
                        </div>
                        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                          {formatMessage(log.message)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );

  const renderDemo = () => <MassiveConnectionDemo />;

  const renderLogs = () => (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto px-4 py-8 space-y-8">
        {/* Header Section */}
        <header className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <h1 className="text-3xl lg:text-4xl font-bold text-slate-900 dark:text-slate-100">
              Logs do Sistema
            </h1>
            <div 
              className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                isConnected 
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' 
                  : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
              }`}
              role="status"
              aria-label={isConnected ? "Sistema conectado" : "Sistema desconectado"}
            >
              <div className={`w-2 h-2 rounded-full mr-2 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
              {isConnected ? "Conectado" : "Desconectado"}
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              {logs.length} entradas
            </Badge>
            
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="autoScroll"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="w-4 h-4 text-blue-600 bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded focus:ring-blue-500 focus:ring-2"
              />
              <label htmlFor="autoScroll" className="text-sm text-slate-700 dark:text-slate-300">
                Auto-scroll
              </label>
            </div>
            
            {logs.length > 0 && (
              <div className="flex items-center space-x-2">
                <Button 
                  onClick={copyAllLogs} 
                  variant="outline" 
                  size="sm"
                  className="text-sm"
                >
                  Copiar Todos
                </Button>
                <Button 
                  onClick={clearLogs} 
                  variant="outline" 
                  size="sm"
                  className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                >
                  Limpar
                </Button>
              </div>
            )}
          </div>
        </header>

        {/* Logs Content */}
        <section aria-labelledby="logs-content-heading">
          <h2 id="logs-content-heading" className="sr-only">Conteúdo dos Logs</h2>
          {logs.length === 0 ? (
            <Card className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
              <CardContent className="flex items-center justify-center py-16">
                <div className="text-center text-slate-500 dark:text-slate-400">
                  <p className="text-lg font-medium mb-2">Nenhum log disponível</p>
                  <p className="text-sm">Os logs aparecerão aqui conforme as operações forem executadas</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {Object.entries(logsByCategory).map(([category, categoryLogs]) => {
                if (categoryLogs.length === 0) return null;
                
                return (
                  <Card key={category} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
                    <CardHeader 
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors border-b border-slate-200 dark:border-slate-700"
                      onClick={() => toggleCategory(category)}
                      role="button"
                      tabIndex={0}
                      aria-expanded={expandedCategories[category]}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleCategory(category);
                        }
                      }}
                    >
                      <CardTitle className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 capitalize">
                            {category}
                          </h3>
                          <Badge variant="outline" className="bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
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
                            className="text-sm px-3 py-1 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                            aria-label={`Copiar logs da categoria ${category}`}
                          >
                            Copiar
                          </Button>
                          <div className="text-slate-400 dark:text-slate-500">
                            {expandedCategories[category] ? (
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                              </svg>
                            ) : (
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            )}
                          </div>
                        </div>
                      </CardTitle>
                    </CardHeader>
                    
                    {expandedCategories[category] && (
                      <CardContent className="p-6">
                        <div className="space-y-4 max-h-80 overflow-y-auto" role="log" aria-live="polite">
                          {categoryLogs.map((log, index) => (
                            <div 
                              key={index} 
                              className={`flex items-start space-x-4 p-4 rounded-lg border-l-4 ${
                                log.type === 'error' ? 'bg-red-50 dark:bg-red-900/20 border-l-red-500' :
                                log.type === 'warning' ? 'bg-yellow-50 dark:bg-yellow-900/20 border-l-yellow-500' :
                                log.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 border-l-green-500' :
                                'bg-blue-50 dark:bg-blue-900/20 border-l-blue-500'
                              }`}
                            >
                              <div className={`w-3 h-3 rounded-full mt-1 flex-shrink-0 ${
                                log.type === 'error' ? 'bg-red-500' :
                                log.type === 'warning' ? 'bg-yellow-500' :
                                log.type === 'success' ? 'bg-green-500' :
                                'bg-blue-500'
                              }`} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center space-x-3 mb-2">
                                  <time 
                                    className="text-xs font-medium text-slate-500 dark:text-slate-400"
                                    dateTime={log.timestamp ? new Date(log.timestamp).toISOString() : ''}
                                  >
                                    {log.timestamp ? new Date(log.timestamp).toLocaleString('pt-BR') : 'Sem timestamp'}
                                  </time>
                                  <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                                    log.type === 'error' ? 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100' :
                                    log.type === 'warning' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100' :
                                    log.type === 'success' ? 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100' :
                                    'bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-100'
                                  }`}>
                                    {log.type.toUpperCase()}
                                  </span>
                                </div>
                                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed break-words">
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
        </section>
      </div>
    </main>
  );

  return (
    <div>
      {viewMode === 'dashboard' && renderDashboard()}
      {viewMode === 'demo' && renderDemo()}
      {viewMode === 'logs' && renderLogs()}
    </div>
  );
};

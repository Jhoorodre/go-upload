import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Progress } from '../ui/Progress';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Play, Pause, Square, RotateCcw, Clock, CheckCircle, XCircle } from 'lucide-react';
import { formatFileSize, formatDuration, formatTimestamp } from '../../utils';
import type { BatchOperation } from '../../types';

interface UploadableFile { 
  file: File; 
  id: string; 
  mangaId: string; 
  mangaTitle: string; 
  chapterId: number; 
  progress: number; 
  status: 'pending' | 'uploading' | 'success' | 'error'; 
  url?: string; 
}

interface ProgressDashboardProps {
  operations: BatchOperation[];
  activeOperation: BatchOperation | null;
  onPause?: (operationId: string) => void;
  onResume?: (operationId: string) => void;
  onCancel?: (operationId: string) => void;
  onRetry?: (operationId: string) => void;
  className?: string;
  files?: UploadableFile[];
  onRemoveFile?: (fileId: string) => void;
  onClearFiles?: () => void;
}

interface QueueDashboardProps {
  files: UploadableFile[];
  onRemoveFile: (fileId: string) => void;
  onClearFiles: () => void;
  className?: string;
}

export function ProgressDashboard({
  operations,
  activeOperation,
  onPause,
  onResume,
  onCancel,
  onRetry,
  className,
  files = [],
  onRemoveFile,
  onClearFiles
}: ProgressDashboardProps) {
  
  // Show queue dashboard if files provided and no operations
  if (files.length > 0 && operations.length === 0 && !activeOperation && onRemoveFile && onClearFiles) {
    return <QueueDashboard files={files} onRemoveFile={onRemoveFile} onClearFiles={onClearFiles} className={className} />;
  }
  const getStatusColor = (status: BatchOperation['status']) => {
    switch (status) {
      case 'running':
        return 'info';
      case 'completed':
        return 'success';
      case 'paused':
        return 'warning';
      case 'error':
        return 'destructive';
      default:
        return 'secondary';
    }
  };

  const getStatusText = (status: BatchOperation['status']) => {
    switch (status) {
      case 'pending':
        return 'Pendente';
      case 'running':
        return 'Em Andamento';
      case 'completed':
        return 'Completo';
      case 'paused':
        return 'Pausado';
      case 'error':
        return 'Erro';
      default:
        return 'Desconhecido';
    }
  };

  const getProgressVariant = (status: BatchOperation['status'], percentage: number) => {
    if (status === 'error') return 'error';
    if (status === 'completed') return 'success';
    if (status === 'paused') return 'warning';
    return 'default';
  };

  return (
    <div className={className}>
      {/* Active Operation Card */}
      {activeOperation && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6"
        >
          <Card className="border-blue-200 dark:border-blue-800">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  Operação Ativa
                  <Badge variant={getStatusColor(activeOperation.status)}>
                    {getStatusText(activeOperation.status)}
                  </Badge>
                </CardTitle>
                <div className="flex gap-2">
                  {activeOperation.status === 'running' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onPause?.(activeOperation.id)}
                    >
                      <Pause className="h-4 w-4" />
                      Pausar
                    </Button>
                  )}
                  {activeOperation.status === 'paused' && (
                    <Button
                      size="sm"
                      variant="success"
                      onClick={() => onResume?.(activeOperation.id)}
                    >
                      <Play className="h-4 w-4" />
                      Retomar
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => onCancel?.(activeOperation.id)}
                  >
                    <Square className="h-4 w-4" />
                    Cancelar
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Progresso</span>
                  <span>{activeOperation.progress.percentage}%</span>
                </div>
                <Progress
                  value={activeOperation.progress.percentage}
                  variant={getProgressVariant(activeOperation.status, activeOperation.progress.percentage)}
                  animated={activeOperation.status === 'running'}
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Arquivos</div>
                  <div className="font-medium">
                    {activeOperation.progress.uploadedFiles} / {activeOperation.progress.totalFiles}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Velocidade</div>
                  <div className="font-medium">{activeOperation.progress.currentSpeed}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">ETA</div>
                  <div className="font-medium">{activeOperation.progress.eta}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Paralelo</div>
                  <div className="font-medium">{activeOperation.options.parallelLimit}</div>
                </div>
              </div>

              {activeOperation.progress.errorFiles > 0 && (
                <div className="p-3 bg-red-50 dark:bg-red-950 rounded-md">
                  <div className="text-sm text-red-800 dark:text-red-200">
                    {activeOperation.progress.errorFiles} arquivos falharam
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Operations History */}
      {operations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Histórico de Operações</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {operations.map((operation) => (
                <motion.div
                  key={operation.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="border rounded-lg p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={getStatusColor(operation.status)} size="sm">
                        {getStatusText(operation.status)}
                      </Badge>
                      <span className="text-sm font-medium">
                        {operation.type === 'collection' ? 'Coleção' : 'Lote'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {operation.status === 'error' && (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => onRetry?.(operation.id)}
                        >
                          <RotateCcw className="h-3 w-3" />
                          Tentar Novamente
                        </Button>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {operation.startTime && formatTimestamp(operation.startTime)}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Progress
                      value={operation.progress.percentage}
                      variant={getProgressVariant(operation.status, operation.progress.percentage)}
                      size="sm"
                    />
                    <div className="grid grid-cols-3 gap-4 text-xs text-muted-foreground">
                      <div>
                        {operation.progress.uploadedFiles}/{operation.progress.totalFiles} arquivos
                      </div>
                      <div>
                        {operation.progress.avgSpeed}
                      </div>
                      <div>
                        {operation.endTime && operation.startTime && 
                          formatDuration((operation.endTime - operation.startTime) / 1000)
                        }
                      </div>
                    </div>
                  </div>

                  {operation.status === 'error' && operation.errorMessage && (
                    <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 p-2 rounded">
                      {operation.errorMessage}
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {operations.length === 0 && !activeOperation && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <div className="text-lg mb-2">Nenhuma operação em andamento</div>
              <div className="text-sm">
                Selecione uma pasta e inicie o processamento para ver o progresso aqui
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// === FILE QUEUE COMPONENTS ===

const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const FileStatusIcon = ({ status }: { status: UploadableFile['status'] }) => {
    switch (status) {
        case 'uploading': 
            return <svg className="w-4 h-4 text-indigo-500 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>;
        case 'success': 
            return <CheckCircle className="w-4 h-4 text-green-500" />;
        case 'error': 
            return <XCircle className="w-4 h-4 text-red-500" />;
        default: 
            return <Clock className="w-4 h-4 text-gray-500" />;
    }
};

const FileProgress = React.memo(({ uploadableFile, onRemove }: { uploadableFile: UploadableFile; onRemove: () => void }) => (
    <div className="text-xs bg-gray-800/50 p-2 rounded-md space-y-1">
        <div className="flex justify-between items-start">
            <div className="flex-1 min-w-0 flex items-start space-x-2">
                <div className="pt-0.5"><FileStatusIcon status={uploadableFile.status} /></div>
                <div className="flex-1 min-w-0">
                    <p className="truncate text-gray-300" title={uploadableFile.file.name}>
                        <span className="font-bold text-indigo-400">{`Cap. ${uploadableFile.chapterId}: `}</span>
                        {uploadableFile.file.name}
                    </p>
                </div>
            </div>
            <button onClick={onRemove} className="text-gray-500 hover:text-white transition-colors flex-shrink-0 z-10">
                <XCircle className="w-4 h-4" />
            </button>
        </div>
        <div className="flex items-center space-x-2 pl-6">
            <div className="w-full bg-gray-700 rounded-full h-1.5">
                <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${uploadableFile.progress}%` }}></div>
            </div>
            <p className="text-gray-500 text-nowrap">{formatBytes(uploadableFile.file.size)}</p>
        </div>
    </div>
));

export function QueueDashboard({ files, onRemoveFile, onClearFiles, className }: QueueDashboardProps) {
    const groupedFiles = useMemo(() => {
        return files.reduce((acc: Record<string, UploadableFile[]>, file) => {
            if (!acc[file.mangaTitle]) acc[file.mangaTitle] = [];
            acc[file.mangaTitle].push(file);
            return acc;
        }, {});
    }, [files]);

    const overallProgress = useMemo(() => {
        if (files.length === 0) return 0;
        const totalProgress = files.reduce((sum, file) => sum + file.progress, 0);
        return totalProgress / files.length;
    }, [files]);

    return (
        <div className={className}>
            <div className="flex justify-between items-center text-xs flex-shrink-0 pr-3">
                <h3 className="font-semibold text-gray-400">FILA DE UPLOAD ({files.length})</h3>
                {files.length > 0 && (
                    <button onClick={onClearFiles} className="text-indigo-400 hover:text-indigo-300 font-medium">
                        Limpar Tudo
                    </button>
                )}
            </div>
            
            {files.length > 0 && (
                <div className="mt-2 mb-2 pr-3">
                    <div className="w-full bg-gray-700 rounded-full h-1.5">
                        <div className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${overallProgress}%` }}></div>
                    </div>
                </div>
            )}
            
            <div className="flex-1 overflow-y-auto -mr-3 pr-3 space-y-4">
                {files.length > 0 ? (
                    Object.entries(groupedFiles).map(([mangaTitle, fileList]) => (
                        <div key={mangaTitle}>
                            <h4 className="text-xs font-bold text-gray-400 px-1 mb-1 truncate">{mangaTitle}</h4>
                            <div className="space-y-2">
                                {fileList.map(f => 
                                    <FileProgress 
                                        key={f.id} 
                                        uploadableFile={f} 
                                        onRemove={() => onRemoveFile(f.id)} 
                                    />
                                )}
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="h-full flex items-center justify-center text-center">
                        <p className="text-xs text-gray-500">Nenhum arquivo na fila.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
import { useState, useRef, useCallback } from 'react';
import type { BatchOperation, BatchOptions, BatchProgress } from '../types';
import { generateId, calculateETA, calculateProgress } from '../utils';

interface UseBatchProcessorOptions {
  onProgress?: (operation: BatchOperation) => void;
  onComplete?: (operation: BatchOperation) => void;
  onError?: (operation: BatchOperation, error: string) => void;
}

export function useBatchProcessor({
  onProgress,
  onComplete,
  onError
}: UseBatchProcessorOptions = {}) {
  const [operations, setOperations] = useState<Map<string, BatchOperation>>(new Map());
  const [activeOperation, setActiveOperation] = useState<string | null>(null);
  const progressTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const createOperation = useCallback((
    type: BatchOperation['type'],
    options: BatchOptions,
    totalFiles: number
  ): BatchOperation => {
    return {
      id: generateId(),
      type,
      status: 'pending',
      options,
      progress: {
        totalFiles,
        uploadedFiles: 0,
        errorFiles: 0,
        skippedFiles: 0,
        currentSpeed: '0 files/min',
        avgSpeed: '0 files/min',
        eta: 'Calculando...',
        percentage: 0
      },
      startTime: Date.now()
    };
  }, []);

  const startOperation = useCallback((operation: BatchOperation) => {
    operation.status = 'running';
    operation.startTime = Date.now();
    
    setOperations(prev => new Map(prev.set(operation.id, operation)));
    setActiveOperation(operation.id);
    
    // Set up progress monitoring
    const timer = setInterval(() => {
      const currentOp = operations.get(operation.id);
      if (currentOp && currentOp.status === 'running') {
        onProgress?.(currentOp);
      }
    }, 1000);
    
    progressTimers.current.set(operation.id, timer);
  }, [operations, onProgress]);

  const updateProgress = useCallback((
    operationId: string,
    update: Partial<BatchProgress>
  ) => {
    setOperations(prev => {
      const newMap = new Map(prev);
      const operation = newMap.get(operationId);
      
      if (operation) {
        const newProgress = { ...operation.progress, ...update };
        newProgress.percentage = calculateProgress(
          newProgress.uploadedFiles + newProgress.errorFiles + newProgress.skippedFiles,
          newProgress.totalFiles
        );
        
        if (operation.startTime && newProgress.uploadedFiles > 0) {
          newProgress.eta = calculateETA(
            newProgress.uploadedFiles,
            newProgress.totalFiles,
            operation.startTime
          );
          
          // Calculate speeds
          const elapsedMinutes = (Date.now() - operation.startTime) / 60000;
          newProgress.avgSpeed = `${Math.round(newProgress.uploadedFiles / elapsedMinutes)} files/min`;
        }
        
        const updatedOperation = {
          ...operation,
          progress: newProgress
        };
        
        newMap.set(operationId, updatedOperation);
        onProgress?.(updatedOperation);
      }
      
      return newMap;
    });
  }, [onProgress]);

  const completeOperation = useCallback((operationId: string) => {
    setOperations(prev => {
      const newMap = new Map(prev);
      const operation = newMap.get(operationId);
      
      if (operation) {
        const completedOperation = {
          ...operation,
          status: 'completed' as const,
          endTime: Date.now()
        };
        
        newMap.set(operationId, completedOperation);
        onComplete?.(completedOperation);
        
        // Clean up timer
        const timer = progressTimers.current.get(operationId);
        if (timer) {
          clearInterval(timer);
          progressTimers.current.delete(operationId);
        }
        
        // Clear active operation if this was it
        if (activeOperation === operationId) {
          setActiveOperation(null);
        }
      }
      
      return newMap;
    });
  }, [onComplete, activeOperation]);

  const pauseOperation = useCallback((operationId: string) => {
    setOperations(prev => {
      const newMap = new Map(prev);
      const operation = newMap.get(operationId);
      
      if (operation && operation.status === 'running') {
        newMap.set(operationId, {
          ...operation,
          status: 'paused'
        });
      }
      
      return newMap;
    });
  }, []);

  const resumeOperation = useCallback((operationId: string) => {
    setOperations(prev => {
      const newMap = new Map(prev);
      const operation = newMap.get(operationId);
      
      if (operation && operation.status === 'paused') {
        newMap.set(operationId, {
          ...operation,
          status: 'running'
        });
      }
      
      return newMap;
    });
  }, []);

  const errorOperation = useCallback((operationId: string, error: string) => {
    setOperations(prev => {
      const newMap = new Map(prev);
      const operation = newMap.get(operationId);
      
      if (operation) {
        const errorOperation = {
          ...operation,
          status: 'error' as const,
          errorMessage: error,
          endTime: Date.now()
        };
        
        newMap.set(operationId, errorOperation);
        onError?.(errorOperation, error);
        
        // Clean up timer
        const timer = progressTimers.current.get(operationId);
        if (timer) {
          clearInterval(timer);
          progressTimers.current.delete(operationId);
        }
        
        // Clear active operation if this was it
        if (activeOperation === operationId) {
          setActiveOperation(null);
        }
      }
      
      return newMap;
    });
  }, [onError, activeOperation]);

  const cancelOperation = useCallback((operationId: string) => {
    const timer = progressTimers.current.get(operationId);
    if (timer) {
      clearInterval(timer);
      progressTimers.current.delete(operationId);
    }
    
    setOperations(prev => {
      const newMap = new Map(prev);
      newMap.delete(operationId);
      return newMap;
    });
    
    if (activeOperation === operationId) {
      setActiveOperation(null);
    }
  }, [activeOperation]);

  const getOperation = useCallback((operationId: string) => {
    return operations.get(operationId);
  }, [operations]);

  const getAllOperations = useCallback(() => {
    return Array.from(operations.values());
  }, [operations]);

  const getActiveOperation = useCallback((): BatchOperation | null => {
    return activeOperation ? operations.get(activeOperation) || null : null;
  }, [operations, activeOperation]);

  const clearCompletedOperations = useCallback(() => {
    setOperations(prev => {
      const newMap = new Map();
      for (const [id, operation] of prev.entries()) {
        if (operation.status === 'running' || operation.status === 'paused') {
          newMap.set(id, operation);
        } else {
          // Clean up any remaining timers
          const timer = progressTimers.current.get(id);
          if (timer) {
            clearInterval(timer);
            progressTimers.current.delete(id);
          }
        }
      }
      return newMap;
    });
  }, []);

  return {
    operations: Array.from(operations.values()),
    activeOperation: getActiveOperation(),
    createOperation,
    startOperation,
    updateProgress,
    completeOperation,
    pauseOperation,
    resumeOperation,
    errorOperation,
    cancelOperation,
    getOperation,
    getAllOperations,
    clearCompletedOperations
  };
}
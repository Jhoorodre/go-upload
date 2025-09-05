import { useCallback, useRef } from 'react';

export interface UseThrottleOptions {
  delay: number;
  maxQueueSize?: number;
}

export function useThrottle<T extends (...args: any[]) => any>(
  callback: T,
  { delay, maxQueueSize = 100 }: UseThrottleOptions
): T {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const queueRef = useRef<Array<Parameters<T>>>([]);
  const lastExecutionRef = useRef<number>(0);

  const throttledFunction = useCallback((...args: Parameters<T>) => {
    const now = Date.now();
    
    // Se a queue está cheia, descarte chamadas antigas
    if (queueRef.current.length >= maxQueueSize) {
      queueRef.current = queueRef.current.slice(-Math.floor(maxQueueSize / 2));
      console.warn(`🚦 Throttle queue overflow, keeping only ${queueRef.current.length} items`);
    }
    
    queueRef.current.push(args);
    
    // Se já passou o delay desde a última execução, execute imediatamente
    if (now - lastExecutionRef.current >= delay) {
      executeNext();
    } else if (!timeoutRef.current) {
      // Senão, agende a próxima execução
      const remainingTime = delay - (now - lastExecutionRef.current);
      timeoutRef.current = setTimeout(executeNext, remainingTime);
    }
    
    function executeNext() {
      if (queueRef.current.length === 0) return;
      
      // Pega o último item da queue (mais recente)
      const latestArgs = queueRef.current.pop()!;
      queueRef.current = []; // Limpa a queue
      
      lastExecutionRef.current = Date.now();
      timeoutRef.current = null;
      
      try {
        callback(...latestArgs);
      } catch (error) {
        console.error('Throttled function error:', error);
      }
      
      // Se ainda há itens na queue, agende a próxima execução
      if (queueRef.current.length > 0) {
        timeoutRef.current = setTimeout(executeNext, delay);
      }
    }
    
  }, [callback, delay, maxQueueSize]) as T;

  return throttledFunction;
}

export function useDebounce<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const debouncedFunction = useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    timeoutRef.current = setTimeout(() => {
      try {
        callback(...args);
      } catch (error) {
        console.error('Debounced function error:', error);
      }
    }, delay);
    
  }, [callback, delay]) as T;

  return debouncedFunction;
}

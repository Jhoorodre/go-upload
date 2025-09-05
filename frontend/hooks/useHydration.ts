import { useEffect, useState } from 'react';

/**
 * Hook para evitar erros de hidratação
 * Retorna false no servidor e true após a hidratação no cliente
 */
export function useHydration(): boolean {
  const [isHydrated, setIsHydrated] = useState(false);
  
  useEffect(() => {
    setIsHydrated(true);
  }, []);
  
  return isHydrated;
}

/**
 * Hook para valores que diferem entre servidor e cliente
 * Usa valor padrão no servidor e valor real após hidratação
 */
export function useClientValue<T>(getValue: () => T, defaultValue: T): T {
  const isHydrated = useHydration();
  const [clientValue, setClientValue] = useState(defaultValue);
  
  useEffect(() => {
    if (isHydrated) {
      setClientValue(getValue());
    }
  }, [isHydrated, getValue]);
  
  return isHydrated ? clientValue : defaultValue;
}
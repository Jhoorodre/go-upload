'use client';

import { useHydration } from '../hooks/useHydration';

interface ClientOnlyProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Componente que renderiza filhos apenas após hidratação
 * Previne erros de hidratação para conteúdo específico do cliente
 */
export function ClientOnly({ children, fallback = null }: ClientOnlyProps) {
  const isHydrated = useHydration();
  
  if (!isHydrated) {
    return <>{fallback}</>;
  }
  
  return <>{children}</>;
}
'use client';

import dynamic from 'next/dynamic';
import React from 'react';
import { Card, CardContent } from '../ui/Card';

// Importar o componente client usando dynamic para garantir SSR-safety
const LogsPageClient = dynamic(
  () => import('./LogsPageClient').then(mod => ({ default: mod.LogsPageClient })),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            🚀 Carregando Dashboard...
          </h2>
        </div>
        <Card>
          <CardContent className="flex items-center justify-center py-16">
            <div className="text-center text-gray-400">
              <div className="text-6xl mb-4">⏳</div>
              <p className="text-lg font-medium">Inicializando sistema...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }
);

interface LogsPageProps {
  // Props are now handled by context
}

export const LogsPage: React.FC<LogsPageProps> = () => {
  return <LogsPageClient />;
};

'use client'

import React, { useState } from 'react';
import { AniListSearch } from '../../components/ui/AniListSearch';
import { AppProvider } from '../../contexts/AppContext';

export default function AniListTestPage() {
  const [selectedMetadata, setSelectedMetadata] = useState<any>(null);

  const handleMetadataSelected = (metadata: any) => {
    console.log('✅ Metadata selecionada:', metadata);
    setSelectedMetadata(metadata);
  };

  return (
    <AppProvider>
      <div className="min-h-screen bg-gray-900 p-8">
        <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">🧪 Teste AniList Search - Fase 3.1</h1>
        
        <div className="space-y-6">
          {/* Componente de busca */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Busca AniList</h2>
            <AniListSearch onMetadataSelected={handleMetadataSelected} />
          </div>

          {/* Resultado selecionado */}
          {selectedMetadata && (
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold text-white mb-4">✅ Metadata Selecionada</h2>
              <div className="bg-gray-900 rounded-lg p-4">
                <pre className="text-green-400 text-sm overflow-auto">
                  {JSON.stringify(selectedMetadata, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* Instruções */}
          <div className="bg-indigo-900/20 border border-indigo-600/30 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-indigo-400 mb-3">📋 Como testar</h3>
            <ul className="text-gray-300 space-y-2 text-sm">
              <li>• Clique em "Buscar" para expandir a interface</li>
              <li>• Digite o nome de um mangá (ex: "Naruto", "Tower of God")</li>
              <li>• Aguarde os resultados aparecerem (debounce de 500ms)</li>
              <li>• Clique em um resultado para selecionar</li>
              <li>• Veja a metadata aparecer na seção abaixo</li>
            </ul>
          </div>

          {/* Recursos implementados */}
          <div className="bg-green-900/20 border border-green-600/30 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-green-400 mb-3">✅ Recursos Implementados</h3>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div>
                <h4 className="font-medium text-white mb-2">Interface</h4>
                <ul className="text-gray-300 space-y-1">
                  <li>• Componente expansível/colapsável</li>
                  <li>• Input com debounce de 500ms</li>
                  <li>• Loading states visuais</li>
                  <li>• Tratamento de erros</li>
                  <li>• Design harmonioso com sistema</li>
                </ul>
              </div>
              <div>
                <h4 className="font-medium text-white mb-2">Funcionalidade</h4>
                <ul className="text-gray-300 space-y-1">
                  <li>• Busca automática via WebSocket</li>
                  <li>• Seleção de resultados</li>
                  <li>• Conversão automática de metadata</li>
                  <li>• Cache no backend</li>
                  <li>• Rate limiting respeitado</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </AppProvider>
  );
}

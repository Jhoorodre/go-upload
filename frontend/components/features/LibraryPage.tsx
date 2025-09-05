import React, { useState, useEffect } from 'react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { MangaLibrary } from './LibraryExplorer';
import type { Library, WSMessage, Manga } from '../../types';

interface LibraryPageProps {
  selection: any; // Tipo simplificado temporariamente
  library: Library | null;
  sendWSMessage: (message: WSMessage) => boolean;
  isConnected: boolean;
  onViewManga: (mangaId: string) => void;
  mockMangas: Manga[];
}

export const LibraryPage: React.FC<LibraryPageProps> = ({ 
  selection, 
  library, 
  sendWSMessage, 
  isConnected, 
  onViewManga,
  mockMangas 
}) => {
  const [showSelectionBar, setShowSelectionBar] = useState(false);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc'); // Estado para ordem dos mangás
  
  // Detecta quando o modo de seleção é ativado via evento personalizado
  useEffect(() => {
    const handleSelectionModeToggle = (event: CustomEvent) => {
      console.log('🎯 Modo de seleção toggled:', event.detail.isActive);
      setShowSelectionBar(event.detail.isActive);
    };
    
    // Escuta eventos personalizados de modo de seleção
    window.addEventListener('selectionModeToggle', handleSelectionModeToggle as EventListener);
    
    return () => {
      window.removeEventListener('selectionModeToggle', handleSelectionModeToggle as EventListener);
    };
  }, []);
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <h2 className="text-2xl font-bold text-white">Biblioteca de Mangás</h2>
          <Badge variant={isConnected ? "success" : "destructive"} className="text-xs">
            {isConnected ? "Online" : "Offline"}
          </Badge>
        </div>
      </div>
      
      {/* Barra de seleção que aparece quando há biblioteca E (modo ativo OU há seleções) */}
      {library && (showSelectionBar || (selection?.selection?.selectionCount > 0)) && (
        <div className="sticky top-0 z-10 bg-gray-900/80 backdrop-blur-sm p-3 mb-6 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <p className="font-medium text-white">{selection?.selection?.selectionCount || 0} item(s) selecionado(s)</p>
              <Badge variant="count" size="sm">
                {selection?.selection?.selectedFiles || 0} arquivos
              </Badge>
              <Badge variant="secondary" size="sm">
                {selection?.selection?.selectedSize || '0 B'}
              </Badge>
            </div>
            <div className="flex items-center space-x-2">
              <button 
                onClick={() => {
                  console.log('✅ SELECIONAR TUDO - Marcando todos os checkboxes');
                  setShowSelectionBar(true);
                  
                  if (selection) {
                    // Seleciona todos os mangás disponíveis
                    selection.selectAllWithFiles();
                    console.log('📋 Todos os checkboxes foram marcados');
                  }
                }} 
                className="px-3 py-1.5 text-xs font-semibold text-gray-200 bg-gray-700 rounded-md hover:bg-gray-600"
              >
                Selecionar Tudo
              </button>
              <button 
                onClick={() => {
                  // APENAS inverte ordenação (A-Z ↔ Z-A)
                  const newOrder = sortOrder === 'asc' ? 'desc' : 'asc';
                  setSortOrder(newOrder);
                  console.log(`🔄 INVERTER ORDEM - Mudando de ${sortOrder} para ${newOrder}`);
                  console.log(`📋 Ordem dos mangás: ${newOrder === 'asc' ? 'A-Z (Crescente)' : 'Z-A (Decrescente)'}`);
                }} 
                className="px-3 py-1.5 text-xs font-semibold text-gray-200 bg-gray-700 rounded-md hover:bg-gray-600"
                title={`Ordem atual: ${sortOrder === 'asc' ? 'A-Z' : 'Z-A'} - Clique para inverter`}
              >
                Inverter {sortOrder === 'asc' ? '↓' : '↑'}
              </button>
              <button 
                onClick={() => {
                  console.log('🧹 LIMPAR - Desmarcando todos os checkboxes');
                  
                  if (selection) {
                    // Remove todas as seleções
                    selection.clearSelection();
                    console.log('✅ Todos os checkboxes foram desmarcados');
                  }
                }} 
                className="px-3 py-1.5 text-xs font-semibold text-gray-200 bg-gray-700 rounded-md hover:bg-gray-600"
              >
                Limpar
              </button>
              <button 
                onClick={() => {
                  console.log('📁 Botão Adicionar Arquivos clicado');
                  setShowSelectionBar(true); // Mantém a barra visível
                  
                  if (selection) {
                    const selectedPaths = selection.getSelectedPaths() || [];
                    console.log('Mangás selecionados para adicionar arquivos:', selectedPaths);
                    // TODO: Implementar lógica de adicionar arquivos
                  }
                }} 
                className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 rounded-md hover:bg-indigo-500"
              >
                Adicionar Arquivos
              </button>
            </div>
          </div>
        </div>
      )}
      
      <MangaLibrary 
        library={library}
        mangas={mockMangas} 
        onViewManga={onViewManga}
        sortOrder={sortOrder}
      />
    </div>
  );
};
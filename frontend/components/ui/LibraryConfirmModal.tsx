import React, { useState } from 'react';
import { Button } from './Button';
import { CloseIcon } from './Icons';

interface LibraryConfirmModalProps {
  isOpen: boolean;
  libraryName: string;
  libraryPath: string;
  onConfirm: (customName?: string) => void;
  onDecline: () => void;
}

export const LibraryConfirmModal: React.FC<LibraryConfirmModalProps> = ({
  isOpen,
  libraryName,
  libraryPath,
  onConfirm,
  onDecline
}) => {
  const [customName, setCustomName] = useState(libraryName);

  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm(customName !== libraryName ? customName : undefined);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 border border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">
            🚀 Nova Biblioteca Descoberta!
          </h2>
          <button
            onClick={onDecline}
            className="p-1 hover:bg-gray-700 rounded text-gray-400"
            aria-label="Fechar"
          >
            <CloseIcon />
          </button>
        </div>
        
        <div className="space-y-4">
          <div>
            <p className="text-gray-300 mb-2">
              Deseja salvar esta biblioteca no seu histórico para acesso rápido?
            </p>
            
            <div className="bg-gray-700 rounded p-3 mb-4">
              <div className="text-sm text-gray-400 mb-1">Caminho:</div>
              <div className="text-white text-sm font-mono break-all">
                {libraryPath}
              </div>
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Nome da Biblioteca:
            </label>
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:border-indigo-500"
              placeholder="Digite um nome para a biblioteca..."
            />
          </div>
          
          <div className="flex space-x-3 mt-6">
            <Button
              onClick={handleConfirm}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
              disabled={!customName.trim()}
            >
              ✅ Salvar no Histórico
            </Button>
            
            <Button
              onClick={onDecline}
              variant="ghost"
              className="flex-1 text-gray-300 hover:bg-gray-700"
            >
              ❌ Usar Apenas Agora
            </Button>
          </div>
          
          <div className="text-xs text-gray-500 text-center mt-3">
            💡 Bibliotecas salvas aparecem no dropdown &ldquo;Scan&rdquo; para acesso rápido
          </div>
        </div>
      </div>
    </div>
  );
};

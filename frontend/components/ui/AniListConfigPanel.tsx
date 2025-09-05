'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAniListConfig } from '@/hooks/useAniListConfig';
import type { AniListConfig } from '@/types/anilist';

interface AniListConfigPanelProps {
  onClose?: () => void;
  isOpen?: boolean;
}

// Constantes para evitar recriação
const FILL_MODE_OPTIONS = [
  { key: 'manual' as const, label: 'Manual', description: 'Selecionar resultado manualmente' },
  { key: 'auto' as const, label: 'Automático', description: 'Preenchimento automático' }
];

// Componente Toggle reutilizável
interface ToggleProps {
  checked: boolean;
  onChange: () => void;
  label: string;
  description: string;
  disabled?: boolean;
}

const Toggle: React.FC<ToggleProps> = React.memo(({ checked, onChange, label, description, disabled = false }) => (
  <label className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-600">
    <div>
      <div className="font-medium text-slate-900 dark:text-slate-100">{label}</div>
      <div className="text-sm text-slate-600 dark:text-slate-400">{description}</div>
    </div>
    <div className="relative">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="sr-only"
      />
      <div className={`w-10 h-5 rounded-full transition-colors ${
        checked ? 'bg-blue-500' : 'bg-gray-600'
      } ${disabled ? 'opacity-50' : ''}`}>
        <div className={`w-4 h-4 bg-white rounded-full transition-transform transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        } mt-0.5`} />
      </div>
    </div>
  </label>
));

// Componente reutilizável removido - usando implementação inline para type safety

export const AniListConfigPanel: React.FC<AniListConfigPanelProps> = ({
  onClose,
  isOpen = true
}) => {
  const { config, isLoading, error, updateConfig, resetConfig } = useAniListConfig();
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Memoizar handlers para evitar re-renders desnecessários
  const handlers = useMemo(() => ({
    toggleEnabled: () => config && updateConfig({ enabled: !config.enabled }),
    changeFillMode: (mode: AniListConfig['fill_mode']) => 
      config && updateConfig({ fill_mode: mode }),
    toggleAutoSearch: () => config && updateConfig({ auto_search: !config.auto_search }),
    toggleCache: () => config && updateConfig({ cache_enabled: !config.cache_enabled }),
    togglePreferAniList: () => config && updateConfig({ prefer_anilist: !config.prefer_anilist }),
  }), [config, updateConfig]);

  const handleReset = useCallback(async () => {
    await resetConfig();
    setShowResetConfirm(false);
  }, [resetConfig]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose?.();
    }
  }, [onClose]);

  if (!isOpen) return null;

  const modalContent = (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-[99999]"
      onClick={handleBackdropClick}
    >
      <div 
        className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg w-full max-w-2xl max-h-[80vh] overflow-y-auto relative shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-slate-800 p-6 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Configurações AniList</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">Personalize como a integração funciona</p>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                <svg className="w-6 h-6 text-slate-600 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Loading State */}
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <span className="ml-3 text-slate-600 dark:text-slate-400">Carregando configurações...</span>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-lg p-4">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <span className="font-medium">Erro:</span>
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* Configuration Options */}
          {config && !isLoading && (
            <div className="space-y-8">
              {/* Main Toggle */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Integração Principal
                </h3>
                
                <Toggle
                  checked={config.enabled}
                  onChange={handlers.toggleEnabled}
                  label="Habilitar AniList"
                  description="Ativa ou desativa toda a integração"
                  disabled={isLoading}
                />
              </div>


              {/* Fill Mode */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Modo de Preenchimento
                </h3>
                
                <div className="grid grid-cols-2 gap-3">
                  {FILL_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      onClick={() => handlers.changeFillMode(option.key)}
                      disabled={isLoading}
                      className={`p-3 rounded-lg border transition-all ${
                        config.fill_mode === option.key
                          ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700 text-blue-900 dark:text-blue-300'
                          : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700' + (isLoading ? ' opacity-50 cursor-not-allowed' : '')
                      }`}
                    >
                      <div className="font-medium">{option.label}</div>
                      <div className="text-xs opacity-70">{option.description}</div>
                    </button>
                  ))}
                </div>
              </div>


              {/* Advanced Options */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Opções Avançadas
                </h3>
                
                <div className="space-y-3">
                  <Toggle
                    checked={config.auto_search}
                    onChange={handlers.toggleAutoSearch}
                    label="Busca Automática"
                    description="Buscar enquanto digita"
                    disabled={isLoading}
                  />

                  <Toggle
                    checked={config.cache_enabled}
                    onChange={handlers.toggleCache}
                    label="Cache Local"
                    description="Armazenar resultados em cache"
                    disabled={isLoading}
                  />

                  <Toggle
                    checked={config.prefer_anilist}
                    onChange={handlers.togglePreferAniList}
                    label="Preferir AniList"
                    description="Priorizar dados da AniList"
                    disabled={isLoading}
                  />
                </div>
              </div>

              {/* Reset Section */}
              <div className="pt-6 border-t border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-slate-900 dark:text-slate-100">Restaurar Padrões</h4>
                    <p className="text-sm text-slate-600 dark:text-slate-400">Volta às configurações originais</p>
                  </div>
                  {!showResetConfirm ? (
                    <button
                      onClick={() => setShowResetConfirm(true)}
                      disabled={isLoading}
                      className="px-4 py-2 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Resetar
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowResetConfirm(false)}
                        disabled={isLoading}
                        className="px-3 py-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg text-sm transition-colors disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleReset}
                        disabled={isLoading}
                        className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                      >
                        Confirmar
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Configuration Info */}
              {config.last_updated && (
                <div className="text-xs text-slate-500 dark:text-slate-400 text-center pt-4 border-t border-slate-200 dark:border-slate-700">
                  Última atualização: {new Date(parseInt(config.last_updated) * 1000).toLocaleString('pt-BR')}
                  {' • '}
                  Versão: {config.version}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // Render modal usando portal para evitar conflitos com outros modais
  return typeof document !== 'undefined' 
    ? createPortal(modalContent, document.body)
    : null;
};

import React, { useState, useEffect, useRef, useMemo, useCallback, startTransition } from 'react';
import { Button } from './Button';
import { CloseIcon } from './Icons';
import { AniListSearch } from './AniListSearch';
import { useMetadataSettings } from '../../hooks/useMetadataSettings';
import { useAppContext } from '../../contexts/AppContext';
import { useAniListConfig } from '../../hooks/useAniListConfig';
import type { MetadataEditorModalProps, WSResponse } from '../../types';

interface MangaMetadata {
  nome: string;
  descricao: string;
  autor: string;
  artista: string;
  grupo: string;
  capa: string;
  status: 'Em Andamento' | 'Completo' | 'Cancelado' | 'Pausado' | 'Hiato';
  caminho?: string;
}

const STATUS_OPTIONS = [
  'Em Andamento',
  'Completo', 
  'Cancelado',
  'Pausado',
  'Hiato'
] as const;

export const MetadataEditorModal: React.FC<MetadataEditorModalProps> = ({ 
  metadata, 
  onClose, 
  onSave,
  mangaID 
}) => {
  const { metadataOutputWSL } = useMetadataSettings();
  const [formData, setFormData] = useState<MangaMetadata>({
    nome: '',
    descricao: '',
    autor: '',
    artista: '',
    grupo: '',
    capa: '',
    status: 'Em Andamento'
  });

  const [error, setError] = useState('');
  const [isLoadingExistingData, setIsLoadingExistingData] = useState(false);
  const [hasLoadedFromJSON, setHasLoadedFromJSON] = useState(false);
  const [anilistFilledFields, setAnilistFilledFields] = useState<Set<string>>(new Set());
  const [showAnilistSuccess, setShowAnilistSuccess] = useState(false);
  const isInitializedRef = useRef(false);

  const { sendWSMessage, isConnected: wsConnected } = useAppContext();
  const { config } = useAniListConfig();

  // Computar dados básicos apenas uma vez na inicialização
  const basicData = useMemo(() => {
    return {
      nome: (metadata.nome as string) || (metadata.title as string) || '',
      descricao: (metadata.descricao as string) || (metadata.description as string) || 'Um manga incrível descoberto na sua biblioteca. Explore os capítulos disponíveis e aproveite a leitura!',
      autor: (metadata.autor as string) || (metadata.author as string) || 'Autor Descoberto',
      artista: (metadata.artista as string) || (metadata.artist as string) || 'Artista Descoberto',
      grupo: (metadata.grupo as string) || (metadata.group as string) || '',
      capa: (metadata.capa as string) || (metadata.cover as string) || '',
      status: (metadata.status as any) || 'Em Andamento',
      caminho: (metadata.caminho as string) || (metadata._path as string) || ''
    };
  }, []); // Dependências vazias - calcular apenas uma vez

  // CORREÇÃO CRÍTICA: Estabilizar initialQuery para evitar loop infinito
  // Usar apenas o nome inicial do manga, sem reagir a mudanças do formulário
  const stableInitialQuery = useMemo(() => {
    return basicData.nome;
  }, []); // Dependências vazias - estável durante toda a vida do modal

  // Listener para mensagens do WebSocket (metadata_loaded)
  useEffect(() => {
    const handleWebSocketMessage = (event: CustomEvent) => {
      const response = event.detail;
      
      if (response.status === 'metadata_loaded' && response.payload) {
        // Verificar se a resposta é para este manga específico
        const responseMangaID = response.payload.mangaID;
        const responseMangaName = response.payload.mangaName;
        
        // Comparar com mangaID ou nome do manga atual
        const isForThisManga = 
          (mangaID && responseMangaID === mangaID) ||
          (responseMangaName && (
            responseMangaName === basicData.nome
          ));
        
        if (isForThisManga) {
          console.log('📋 Modal recebeu dados do JSON para:', responseMangaName);
          
          // Atualizar dados do formulário com os dados do JSON carregado
          const jsonData = response.payload.metadata || response.payload;
          startTransition(() => {
            setFormData({
              nome: jsonData.title || jsonData.nome || basicData.nome,
              descricao: jsonData.description || jsonData.descricao || basicData.descricao,
              autor: jsonData.author || jsonData.autor || basicData.autor,
              artista: jsonData.artist || jsonData.artista || basicData.artista,
              grupo: jsonData.group || jsonData.grupo || basicData.grupo,
              capa: jsonData.cover || jsonData.capa || basicData.capa,
              status: jsonData.status || basicData.status,
              caminho: jsonData._path || jsonData.caminho || basicData.caminho
            });
            
            // Marcar como carregado e parar loading
            setHasLoadedFromJSON(true);
            setIsLoadingExistingData(false);
          });
        }
      }
    };

    // Adicionar listener para o evento correto
    window.addEventListener('mangaMetadataLoaded', handleWebSocketMessage as EventListener);
    
    // Cleanup
    return () => {
      window.removeEventListener('mangaMetadataLoaded', handleWebSocketMessage as EventListener);
    };
  }, [mangaID, basicData.nome]);

  // Função para carregar JSON existente via WebSocket
  const loadExistingJSON = useCallback((mangaName: string) => {
    if (!mangaName || hasLoadedFromJSON || !metadataOutputWSL || !wsConnected) return;
    
    startTransition(() => {
      setIsLoadingExistingData(true);
    });
    
    sendWSMessage({
      action: 'load_metadata',
      payload: {
        ...(mangaID && { mangaID: mangaID }), // Include mangaID if available
        mangaName: mangaName,
        metadataOutput: metadataOutputWSL
      }
    });
  }, [hasLoadedFromJSON, metadataOutputWSL, wsConnected, mangaID, sendWSMessage]);

  // Inicializar formulário apenas uma vez por modal
  useEffect(() => {
    if (!isInitializedRef.current) {
      setFormData(basicData);
      isInitializedRef.current = true;
      
      // Tentar carregar dados do JSON existente via WebSocket
      if (basicData.nome && !hasLoadedFromJSON && wsConnected) {
        loadExistingJSON(basicData.nome);
      }
    }
  }, [basicData, hasLoadedFromJSON, wsConnected]);

  const handleInputChange = useCallback((field: keyof MangaMetadata, value: string) => {
    startTransition(() => {
      setFormData(prev => ({
        ...prev,
        [field]: value
      }));
      setError('');
    });
  }, []);

  const handleSave = () => {
    // Validação básica
    if (!formData.nome.trim()) {
      setError('Nome é obrigatório');
      return;
    }

    // Preparar dados para salvar
    const savedData = {
      ...metadata, // Manter outros campos existentes
      nome: formData.nome,
      descricao: formData.descricao,
      autor: formData.autor,
      artista: formData.artista,
      grupo: formData.grupo,
      capa: formData.capa,
      status: formData.status,
      // Manter campos originais para compatibilidade
      title: formData.nome,
      description: formData.descricao,
      author: formData.autor,
      artist: formData.artista,
      group: formData.grupo,
      cover: formData.capa,
      // Manter caminho se existir
      ...(formData.caminho && { _path: formData.caminho, caminho: formData.caminho })
    };

    onSave(savedData);
    onClose();
  };

  // Ref para controlar se metadados já foram aplicados para esta query
  const processedMetadataRef = useRef(new Set<string>());
  
  // CORREÇÃO: Limpar cache de metadados quando idioma muda
  const previousMetadataLanguageRef = useRef(config?.language_preference);
  useEffect(() => {
    const currentLanguage = config?.language_preference;
    
    if (currentLanguage && currentLanguage !== previousMetadataLanguageRef.current) {
      console.log('🌍 MetadataEditor: Idioma mudou, limpando cache de metadados:', { 
        anterior: previousMetadataLanguageRef.current, 
        atual: currentLanguage 
      });
      
      // Limpar cache para permitir reprocessamento com novo idioma
      processedMetadataRef.current.clear();
    }
    
    previousMetadataLanguageRef.current = currentLanguage;
  }, [config?.language_preference]);

  // Função para lidar com metadados vindos do AniList
  const handleAniListMetadata = useCallback((anilistMetadata: any, preferredTitle?: string) => {
    if (!anilistMetadata) {
      console.error('❌ handleAniListMetadata: metadados undefined ou null');
      return;
    }
    
    // CORREÇÃO: Incluir idioma atual na chave para permitir reprocessamento ao trocar idioma
    const currentLanguage = config?.language_preference || 'romaji';
    const metadataKey = `${anilistMetadata.ID || anilistMetadata.id}-${preferredTitle || anilistMetadata.Title || anilistMetadata.title}-${currentLanguage}`;
    
    // Evitar processamento duplicado apenas para a mesma combinação de mangá + idioma
    if (processedMetadataRef.current.has(metadataKey)) {
      console.log('🔄 Metadata já processado para esta combinação:', { id: anilistMetadata.ID, title: preferredTitle, language: currentLanguage });
      return;
    }
    processedMetadataRef.current.add(metadataKey);
    
    const filledFields = new Set<string>();
    const newFormData = { ...formData };

    // Mapear campos e rastrear quais foram preenchidos
    const fieldMappings = [
      { anilist: ['title', 'Title'], form: 'nome', preferredValue: preferredTitle },
      { anilist: ['description', 'Description'], form: 'descricao' },
      { anilist: ['author', 'Author'], form: 'autor' },
      { anilist: ['artist', 'Artist'], form: 'artista' },
      { anilist: ['coverImage', 'Cover'], form: 'capa' },
      { anilist: ['status', 'Status'], form: 'status' }
    ];

    fieldMappings.forEach(mapping => {
      // Se há um valor preferido (como título no idioma escolhido), usar ele
      const preferredValue = (mapping as any).preferredValue;
      
      const anilistValue = preferredValue || 
        (mapping.anilist.find(key => anilistMetadata[key])
          ? anilistMetadata[mapping.anilist.find(key => anilistMetadata[key]) as string]
          : null);
      
      if (anilistValue && anilistValue.toString().trim()) {
        newFormData[mapping.form as keyof MangaMetadata] = anilistValue;
        filledFields.add(mapping.form);
      }
    });

    startTransition(() => {
      setFormData(newFormData);
      setAnilistFilledFields(filledFields);
      setShowAnilistSuccess(true);
      setError('');
    });

    // Remover indicador de sucesso após 3 segundos
    setTimeout(() => setShowAnilistSuccess(false), 3000);
  }, [formData]);

  // Função helper para renderizar labels com indicador AniList
  const renderFieldLabel = useCallback((fieldName: string, label: string, required: boolean = false) => {
    const isFromAniList = anilistFilledFields.has(fieldName);
    
    return (
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
        {label} {required && '*'}
        {isFromAniList && (
          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/20 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-500/30">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            AniList
          </span>
        )}
      </label>
    );
  }, [anilistFilledFields]);

  // Memoizar o caminho do JSON para evitar recálculos
  const jsonPath = useMemo(() => {
    if (!formData.nome) return '';
    const outputPathWSL = metadataOutputWSL || 'json';
    const sanitizedName = formData.nome
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_\-\.]/g, '')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '');
    return outputPathWSL.startsWith('/') 
      ? `${outputPathWSL}/${sanitizedName}.json`
      : `${outputPathWSL}/${sanitizedName}.json`;
  }, [formData.nome, metadataOutputWSL]);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[10000] flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl flex flex-col w-full max-w-2xl max-h-[90vh] overflow-hidden">
        
        <header className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
          <div className="flex flex-col gap-3">
            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Editor de Metadados
            </h3>
            <div className="flex items-center gap-4">
              {isLoadingExistingData && (
                <div className="flex items-center gap-2 text-blue-400 text-sm font-medium">
                  <div className="relative">
                    <div className="w-4 h-4 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
                    <div className="absolute inset-0 w-4 h-4 border border-blue-500/40 rounded-full animate-pulse"></div>
                  </div>
                  Carregando JSON...
                </div>
              )}
              {hasLoadedFromJSON && !isLoadingExistingData && (
                <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
                  <div className="relative">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                    </svg>
                    <div className="absolute inset-0 bg-emerald-400/20 rounded-full blur-sm"></div>
                  </div>
                  Dados carregados do JSON
                </div>
              )}
            </div>
          </div>
          <Button 
            onClick={onClose} 
            variant="ghost" 
            size="icon" 
            className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <CloseIcon className="w-5 h-5" />
          </Button>
        </header>
        
        <div className="p-6 flex-1 overflow-y-auto space-y-6">
          {/* Busca AniList */}
          <AniListSearch 
            onMetadataSelected={(metadata, preferredTitle) => handleAniListMetadata(metadata, preferredTitle)}
            initialQuery={stableInitialQuery}
            className="mb-8"
          />

          {/* Notificação de sucesso do AniList */}
          {showAnilistSuccess && (
            <div className="mb-6 p-4 bg-gradient-to-r from-emerald-900/20 via-emerald-800/10 to-teal-900/20 backdrop-blur-sm rounded-xl border border-emerald-700/30 animate-in fade-in duration-300">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <p className="text-emerald-300 font-medium">Metadados preenchidos com sucesso!</p>
                  <p className="text-sm text-emerald-400">
                    {anilistFilledFields.size} campo{anilistFilledFields.size > 1 ? 's' : ''} preenchido{anilistFilledFields.size > 1 ? 's' : ''} automaticamente pelo AniList.
                  </p>
                </div>
              </div>
            </div>
          )}
          
          {/* Form Fields com estilo premium */}
          <div className="space-y-6">
            {/* Nome */}
            <div className="group">
              {renderFieldLabel('nome', 'Nome', true)}
              <div className="relative">
                <input
                  type="text"
                  value={formData.nome}
                  onChange={(e) => handleInputChange('nome', e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder-slate-500 dark:placeholder-slate-400"
                  placeholder="Nome do mangá"
                />
              </div>
            </div>

            {/* Descrição */}
            <div className="group">
              {renderFieldLabel('descricao', 'Descrição')}
              <div className="relative">
                <textarea
                  value={formData.descricao}
                  onChange={(e) => handleInputChange('descricao', e.target.value)}
                  rows={4}
                  className="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder-slate-500 dark:placeholder-slate-400 resize-none"
                  placeholder="Descrição do mangá..."
                />
              </div>
            </div>

            {/* Grupo de campos - Autor e Artista */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="group">
                {renderFieldLabel('autor', 'Autor')}
                <div className="relative">
                  <input
                    type="text"
                    value={formData.autor}
                    onChange={(e) => handleInputChange('autor', e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder-slate-500 dark:placeholder-slate-400"
                    placeholder="Nome do autor"
                  />
                </div>
              </div>

              <div className="group">
                {renderFieldLabel('artista', 'Artista')}
                <div className="relative">
                  <input
                    type="text"
                    value={formData.artista}
                    onChange={(e) => handleInputChange('artista', e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder-slate-500 dark:placeholder-slate-400"
                    placeholder="Nome do artista"
                  />
                </div>
              </div>
            </div>

            {/* Grupo */}
            <div className="group">
              {renderFieldLabel('grupo', 'Grupo')}
              <div className="relative">
                <input
                  type="text"
                  value={formData.grupo}
                  onChange={(e) => handleInputChange('grupo', e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder-slate-500 dark:placeholder-slate-400"
                  placeholder="Grupo de tradução/scanlation"
                />
              </div>
            </div>

            {/* Capa */}
            <div className="group">
              {renderFieldLabel('capa', 'Capa (URL)')}
              <div className="relative">
                <input
                  type="url"
                  value={formData.capa}
                  onChange={(e) => handleInputChange('capa', e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors placeholder-slate-500 dark:placeholder-slate-400"
                  placeholder="https://exemplo.com/capa.jpg"
                />
              </div>
            </div>

            {/* Status */}
            <div className="group">
              {renderFieldLabel('status', 'Status')}
              <div className="relative">
                <select
                  value={formData.status}
                  onChange={(e) => handleInputChange('status', e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors cursor-pointer"
                >
                  {STATUS_OPTIONS.map(status => (
                    <option key={status} value={status} className="bg-slate-800 text-white">
                      {status}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Campos informativos - somente leitura */}
          <div className="space-y-4 border-t border-slate-200 dark:border-slate-700 pt-6">
            {/* Caminho (somente leitura) */}
            {formData.caminho && (
              <div className="group">
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
                  Pasta do Mangá
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.caminho}
                    readOnly
                    className="w-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 cursor-not-allowed font-mono text-sm"
                    title="Caminho da pasta do mangá na biblioteca"
                  />
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-500">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2V8z" />
                    </svg>
                  </div>
                </div>
              </div>
            )}

            {/* Caminho do JSON que será criado */}
            {formData.nome && (
              <div className="group">
                <label className="block text-sm font-medium text-emerald-600 dark:text-emerald-400 mb-2">
                  Arquivo JSON será salvo em
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={jsonPath}
                    readOnly
                    className="w-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 px-3 py-2 rounded-md border border-emerald-300 dark:border-emerald-500/30 cursor-not-allowed font-mono text-sm"
                    title="Caminho onde o arquivo JSON será criado"
                  />
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-emerald-500">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="relative px-6 pb-4">
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center gap-3">
              <svg className="w-5 h-5 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-red-400 text-sm font-medium">{error}</p>
            </div>
          </div>
        )}

        <footer className="p-6 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <div className="flex items-center">
              <Button 
                onClick={() => {
                  setHasLoadedFromJSON(false);
                  if (formData.nome) {
                    loadExistingJSON(formData.nome);
                  }
                }}
                variant="outline"
                className="px-4 py-2 text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 dark:hover:border-blue-400 rounded-md transition-colors flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isLoadingExistingData}
              >
                {isLoadingExistingData ? (
                  <>
                    <div className="relative">
                      <div className="w-4 h-4 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
                      <div className="absolute inset-0 w-4 h-4 border border-blue-500/40 rounded-full animate-pulse"></div>
                    </div>
                    <span className="font-medium">Carregando...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span className="font-medium">Recarregar do JSON</span>
                  </>
                )}
              </Button>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-3">
              <Button 
                onClick={onClose} 
                variant="ghost" 
                className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors font-medium focus:outline-none focus:ring-2 focus:ring-slate-500"
              >
                Cancelar
              </Button>
              <Button 
                onClick={handleSave} 
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!formData.nome.trim()}
              >
                Salvar JSON
              </Button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Button } from '../ui/Button';
import { ArrowLeftIcon, SortAscIcon, SortDescIcon } from '../ui/Icons';
import { useMetadataSettings } from '../../hooks/useMetadataSettings';
import { useMangaSync } from '../../hooks/useMangaSync';
import { useAppContext } from '../../contexts/AppContext';
import type { MangaDetailPageProps, MangaSelection } from '../../types';

// Função para sanitizar nomes de arquivos (correspondente ao backend)
const sanitizeFilename = (filename: string): string => {
  // Normalizar caracteres Unicode (NFKD decomposição)
  const normalized = filename.normalize('NFKD');
  
  // Remover acentos e caracteres diacríticos
  const withoutAccents = normalized.replace(/[\u0300-\u036f]/g, '');
  
  // Permitir apenas caracteres alfanuméricos, hífen, underscore e espaços
  const cleaned = withoutAccents.replace(/[^a-zA-Z0-9_\-\s]/g, '');
  
  // Substituir múltiplos espaços por underscore único
  return cleaned.replace(/\s+/g, '_').trim();
};


interface MangaDetailPageExtendedProps extends MangaDetailPageProps {
  addFilesToQueue: (selection: MangaSelection, selectedFiles: FileList) => void;
  mangaPath?: string; // Optional path for discovered mangas
  onLog?: (log: any) => void; // Function to log events
}

export const MangaDetailPage: React.FC<MangaDetailPageExtendedProps> = ({ 
  manga, 
  onBack, 
  onEditMetadata,
  addFilesToQueue,
  mangaPath,
  onLog,
  onSyncedDataChange
}) => {
  const { metadataOutputWSL } = useMetadataSettings();
  const { sendWSMessage, isConnected: appIsConnected } = useAppContext();
  
  // Hook para sincronização bidirecional do manga
  const { manga: syncedManga, forceReload, isSyncing } = useMangaSync({
    manga,
    mangaPath,
    onLog,
    sendWSMessage,
    isConnected: appIsConnected
  });
  
  const [selectedChapters, setSelectedChapters] = useState<Set<number>>(new Set());
  const [isAscending, setIsAscending] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onSyncedDataChangeRef = useRef(onSyncedDataChange);
  const lastNotifiedRef = useRef<boolean>(false);

  // Manter referência atualizada
  useEffect(() => {
    onSyncedDataChangeRef.current = onSyncedDataChange;
  }, [onSyncedDataChange]);

  const sortedChapters = useMemo(() => {
    return [...(syncedManga.chapters || [])].sort((a, b) => isAscending ? a.id - b.id : b.id - a.id);
  }, [syncedManga.chapters, isAscending]);

  // Notificar mudanças nos dados sincronizados para o componente pai apenas quando hasJSONData muda
  useEffect(() => {
    if (onSyncedDataChangeRef.current && syncedManga.hasJSONData && !lastNotifiedRef.current) {
      onSyncedDataChangeRef.current(syncedManga);
      lastNotifiedRef.current = true;
    } else if (!syncedManga.hasJSONData) {
      lastNotifiedRef.current = false;
    }
  }, [syncedManga.hasJSONData]);

  const handleChapterSelect = (chapterId: number) => {
    setSelectedChapters(prev => { 
      const newSet = new Set(prev); 
      if (newSet.has(chapterId)) 
        newSet.delete(chapterId); 
      else 
        newSet.add(chapterId); 
      return newSet; 
    });
  };
  
  const handleSelectAll = () => setSelectedChapters(new Set((manga.chapters || []).map(c => c.id)));
  const handleSelectNone = () => setSelectedChapters(new Set());
  
  const handleAddFilesClick = () => fileInputRef.current?.click();
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if(event.target.files && selectedChapters.size > 0){
      const selectionForQueue: MangaSelection = { [manga.id]: selectedChapters };
      addFilesToQueue(selectionForQueue, event.target.files);
      setSelectedChapters(new Set());
    }
  };

  return (
    <div>
      <Button 
        onClick={onBack} 
        variant="ghost" 
        className="flex items-center px-4 py-2 mb-6 bg-gray-700 text-gray-200 font-semibold rounded-md hover:bg-gray-600 transition-colors"
      >
        <ArrowLeftIcon />
        Voltar para a Biblioteca
      </Button>
            <div className="flex flex-col md:flex-row gap-6 items-start">
        <img 
          src={syncedManga.cover || "https://placehold.co/200x300/1f2937/9ca3af?text=" + encodeURIComponent(syncedManga.title.substring(0, 20))} 
          alt={syncedManga.title} 
          className="w-full md:w-48 rounded-lg shadow-lg" 
        />
        <div className="text-gray-300">
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-2xl font-bold text-white">{syncedManga.title}</h2>
            {syncedManga.hasJSONData && (
              <span className="flex items-center gap-1 text-green-400 text-sm">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                </svg>
                JSON
              </span>
            )}
          </div>
          <p className="text-sm mt-2">{syncedManga.description}</p>
          <div className="text-xs mt-4 space-x-4">
            <span><span className="font-bold text-gray-400">ARTISTA:</span> {syncedManga.artist}</span>
            <span><span className="font-bold text-gray-400">AUTOR:</span> {syncedManga.author}</span>
            <span><span className="font-bold text-gray-400">STATUS:</span> {syncedManga.status}</span>
            {syncedManga.group && (
              <span><span className="font-bold text-gray-400">GRUPO:</span> {syncedManga.group}</span>
            )}
          </div>
          {mangaPath && (
            <div className="text-xs mt-2">
              <div className="mb-1">
                <span className="font-bold text-gray-400">CAMINHO:</span> 
                <span className="text-gray-300 ml-1 break-all">{mangaPath}</span>
              </div>
              <div>
                <span className="font-bold text-gray-400">JSON:</span> 
                {syncedManga.hasJSONData ? (
                  <span className="text-green-400 ml-1 break-all">
                    {`${metadataOutputWSL || 'json'}/${sanitizeFilename(syncedManga.title)}.json ✓`}
                  </span>
                ) : (
                  <span className="text-red-400 ml-1 break-all">
                    {`${metadataOutputWSL || 'json'}/${sanitizeFilename(syncedManga.title)}.json ✗`}
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="text-sm mt-4 flex items-center space-x-4">
            <div className="flex items-center gap-2">
              {/* Contador principal (descoberta) */}
              <div className="flex items-center gap-1 px-2 py-1 bg-gray-700/50 rounded-md">
                <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span className="font-bold text-gray-300">
                  {(syncedManga.chapters || []).length}
                </span>
                <span className="text-gray-400 text-xs">DESCOBERTOS</span>
              </div>
              
              {/* Contador JSON (se diferente) */}
              {syncedManga.chapterCount && syncedManga.chapterCount !== (syncedManga.chapters || []).length && (
                <>
                  <span className="text-gray-500">+</span>
                  <div className="flex items-center gap-1 px-2 py-1 bg-green-900/20 border border-green-600/30 rounded-md">
                    <svg className="w-4 h-4 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM3 7a1 1 0 011-1h12a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V7zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/>
                    </svg>
                    <span className="font-bold text-green-400">
                      {syncedManga.chapterCount}
                    </span>
                    <span className="text-green-300 text-xs">NO JSON</span>
                  </div>
                </>
              )}
              
              {/* Total unificado se são iguais */}
              {(!syncedManga.chapterCount || syncedManga.chapterCount === (syncedManga.chapters || []).length) && syncedManga.hasJSONData && (
                <div className="flex items-center gap-1 text-green-400">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                  </svg>
                  <span className="text-xs">SINCRONIZADO</span>
                </div>
              )}
            </div>
            
            <span className="text-gray-500">•</span>
            <div className="flex items-center gap-2">
              <Button 
                onClick={() => onEditMetadata(syncedManga)} 
                variant="ghost" 
                className="px-3 py-1.5 text-sm font-medium text-indigo-400 hover:text-indigo-300 hover:bg-indigo-900/20 border border-indigo-600/30 rounded-md transition-colors"
              >
                Editar Metadados
              </Button>
              <Button 
                onClick={forceReload}
                variant="outline" 
                size="sm"
                disabled={isSyncing}
                className={`text-xs transition-all ${
                  isSyncing 
                    ? 'text-green-400 border-green-600/50 bg-green-900/20' 
                    : 'text-blue-400 hover:text-blue-300 hover:bg-blue-900/20 border-blue-600/30'
                }`}
              >
                <div className="flex items-center gap-1">
                  <svg 
                    className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>{isSyncing ? 'Syncing...' : 'Sync'}</span>
                </div>
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-8">
        <h3 className="text-lg font-semibold text-white mb-4">CAPÍTULOS</h3>
        <div className="flex items-center space-x-3 mb-4">
          <Button 
            onClick={handleSelectAll} 
            variant="ghost" 
            className="px-4 py-2 text-sm font-medium text-white bg-gray-700 rounded-md hover:bg-gray-600"
          >
            Todos
          </Button>
          <Button 
            onClick={handleSelectNone} 
            variant="ghost" 
            className="px-4 py-2 text-sm font-medium text-white bg-gray-700 rounded-md hover:bg-gray-600"
          >
            Nenhum
          </Button>
          <Button 
            onClick={() => setIsAscending(!isAscending)} 
            variant="ghost" 
            className="flex items-center px-4 py-2 text-sm font-medium text-white bg-gray-700 rounded-md hover:bg-gray-600"
          >
            Inverter Ordem {isAscending ? <SortAscIcon/> : <SortDescIcon/>}
          </Button>
          {selectedChapters.size > 0 && (
            <>
              <input type="file" multiple ref={fileInputRef} onChange={handleFileChange} className="hidden" />
              <Button 
                onClick={handleAddFilesClick} 
                variant="ghost" 
                className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-md hover:bg-indigo-500"
              >
                Adicionar Arquivos ({selectedChapters.size})
              </Button>
            </>
          )}
        </div>
        <div className="space-y-2">
          {sortedChapters.map(ch => (
            <div 
              key={ch.id} 
              onClick={() => handleChapterSelect(ch.id)} 
              className={`flex items-center p-3 rounded-md border cursor-pointer ${
                selectedChapters.has(ch.id) ? 
                'bg-gray-700/50 border-indigo-500' : 
                'bg-gray-800 border-gray-700 hover:bg-gray-700'
              }`}
            >
              <input 
                type="checkbox" 
                readOnly 
                checked={selectedChapters.has(ch.id)} 
                className="rounded bg-gray-900 border-gray-600 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="ml-4 flex-1 font-medium text-gray-200">{ch.title}</span>
              <span className="text-gray-400 text-xs">{ch.imagesCount} imagens</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
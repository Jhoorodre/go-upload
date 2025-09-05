'use client';

import React, { useState, useMemo } from 'react';
import { Badge } from '../components/ui/Badge';
import { ClientOnly } from '../components/ClientOnly';
import { ProgressDashboard } from '../components/features/ProgressDashboard';
import { LogsPage } from '../components/features/LogsPage';
import { SettingsPage } from '../components/features/SettingsPage';
import { LibraryPage } from '../components/features/LibraryPage';
import { MangaDetailPage } from '../components/features/MangaDetailPage';
import { ControlSidebar } from '../components/features/ControlSidebar';
import { FloatingActionButtons } from '../components/ui/FloatingActionButtons';
import { MetadataEditorModal } from '../components/ui/MetadataEditorModal';
import { MangaSelectionModal } from '../components/ui/MangaSelectionModal';
import { useMetadataSettings } from '../hooks/useMetadataSettings';
import { AppProvider, useAppContext, MOCK_MANGAS } from '../contexts/AppContext';
import type { Page } from '../types';

// Mock metadata
const MOCK_METADATA = {"title":"placeholder_title","description":"placeholder_description_multiline","artist":"placeholder_artist","author":"placeholder_author","cover":"https://placeholder.url/cover.jpg","status":"placeholder_status","group":"placeholder_group","chapters":{"001":{"title":"placeholder_chapter_title_1","volume":"1","last_updated":"placeholder_timestamp_1","groups":{"placeholder_group_name_1":["https://placeholder.url/page_1.webp","https://placeholder.url/page_2.webp","https://placeholder.url/page_3.webp"]}},"002":{"title":"placeholder_chapter_title_2","volume":"","last_updated":"placeholder_timestamp_2","groups":{"placeholder_group_name_1":["https://placeholder.url/page_1.webp","https://placeholder.url/page_2.webp"]}},"003":{"title":"placeholder_chapter_title_3","volume":"","last_updated":"placeholder_timestamp_3","groups":{"placeholder_group_name_1":["https://placeholder.url/page_1.webp","https://placeholder.url/page_2.webp"]}}}};

function MangaUploaderPro() {
  const [page, setPage] = useState<Page>('library');
  const [selectedMangaId, setSelectedMangaId] = useState<string | null>(null);
  const [isMetadataEditorOpen, setIsMetadataEditorOpen] = useState(false);
  const [isMangaSelectionOpen, setIsMangaSelectionOpen] = useState(false);
  const [githubStatus, setGithubStatus] = useState<string | null>(null);
  const [syncedMangaData, setSyncedMangaData] = useState<any>(null); // Dados sincronizados do useMangaSync
  const { metadataOutputWSL } = useMetadataSettings();
  
  const { 
    files, 
    isUploading,
    host,
    setHost, 
    handleUpload, 
    handleRemoveFile, 
    handleClearFiles,
    operations,
    activeOperation,
    batchProcessor,
    selection,
    isHydrated,
    handleLog,
    isConnected,
    wsReconnectAttempts,
    addFilesToQueue,
    library,
    sendWSMessage
  } = useAppContext();
  
  const selectedMangaData = useMemo(() => {
    // First check discovered mangas if library exists
    if (library && selectedMangaId?.startsWith('auto-')) {
      // Convert library to manga format with enhanced metadata loading
      const discoveredMangas: any[] = [];
      let mangaIndex = 0;
      
      Object.entries(library).forEach(([key, value]) => {
        if (typeof value === 'object' && !Array.isArray(value)) {
          const mangaData = value as any;
          if (mangaData._type === 'manga' && mangaData._path) {
            // Gerar mangaID estável baseado no nome da pasta, não na ordem
            // Manter caracteres acentuados para processamento no backend
            const sanitizedFolderName = key.replace(/[\/\\:*?"<>|]/g, '_');
            const mangaId = `auto-${sanitizedFolderName}`;
            
            // Enhanced manga object with proper metadata structure
            const manga = {
              id: mangaId,
              title: key,
              description: `Um manga incrível descoberto na sua biblioteca. Explore os capítulos disponíveis e aproveite a leitura!`,
              artist: 'Artista Descoberto',
              author: 'Autor Descoberto', 
              cover: `https://placehold.co/200x300/1f2937/9ca3af?text=${encodeURIComponent(key.substring(0, 10))}`,
              status: 'Em Andamento',
              chapters: [
                // TODO: Load real chapters from directory structure
                { id: 1, title: 'Capítulo 1', imagesCount: 20 },
                { id: 2, title: 'Capítulo 2', imagesCount: 18 },
                { id: 3, title: 'Capítulo 3', imagesCount: 22 }
              ],
              _path: mangaData._path // Store the path for reference
            };
            
            discoveredMangas.push(manga);
          }
        }
      });
      
      // Look for the manga in discovered ones
      const discoveredManga = discoveredMangas.find(m => m.id === selectedMangaId);
      if (discoveredManga) {
        return { 
          manga: discoveredManga, 
          mangaPath: discoveredManga._path 
        };
      }
    }
    
    // Fallback to mock mangas
    const mockManga = MOCK_MANGAS.find(m => m.id === selectedMangaId);
    return { 
      manga: mockManga, 
      mangaPath: undefined 
    };
  }, [selectedMangaId, library]);

  const selectedManga = selectedMangaData.manga;
  
  // Função auxiliar para encontrar mangá na biblioteca por caminho
  const findMangaInLibrary = (mangaPath: string, lib: any) => {
    if (!lib) return null;
    
    const mangaKey = mangaPath.split('/')[0]; // Primeiro segmento do caminho
    const mangaData = lib[mangaKey];
    
    if (mangaData && typeof mangaData === 'object') {
      // Gerar mangaID estável baseado no nome da pasta
      const sanitizedMangaKey = mangaKey.replace(/[\/\\:*?"<>|]/g, '_');
      return {
        id: `auto-${sanitizedMangaKey}`,
        title: mangaKey,
        description: mangaData._type === 'manga' && mangaData._path ? `Descoberto em: ${mangaData._path}` : `Descoberto na biblioteca`,
        artist: 'Descoberto',
        author: 'Descoberto',
        status: 'ongoing',
        cover: `https://placehold.co/200x300/1f2937/9ca3af?text=${encodeURIComponent(mangaKey.substring(0, 10))}`,
        chapters: []
      };
    }
    
    return null;
  };

  const handleEditMetadata = (syncedManga?: any) => {
    if (selectedManga) {
      // Usar dados sincronizados se disponíveis (do parâmetro ou do estado), senão usar dados originais
      const dataToUse = syncedManga || syncedMangaData || selectedManga;
      
      // Armazenar dados para uso no modal
      window.syncedMangaForModal = dataToUse;
      
      setIsMetadataEditorOpen(true);
    } else {
      // Editando mangás selecionados da biblioteca
      const selectedPaths = selection.getSelectedPaths();
      
      if (selectedPaths.length === 0) {
        console.warn('Nenhum mangá selecionado para editar');
        return;
      }
      
      if (selectedPaths.length === 1) {
        // Um mangá selecionado - abrir editor diretamente
        const mangaPath = selectedPaths[0];
        const mangaFromLibrary = findMangaInLibrary(mangaPath, library);
        
        if (mangaFromLibrary) {
          // Temporariamente definir como selectedManga para usar modal existente
          setSelectedMangaId(mangaFromLibrary.id || mangaPath);
          setIsMetadataEditorOpen(true);
        }
      } else {
        // Múltiplos mangás - abrir seletor primeiro
        console.log(`📝 ${selectedPaths.length} mangás selecionados. Abrindo seletor.`);
        setIsMangaSelectionOpen(true);
      }
    }
  };
  
  const handleGithubUpload = () => {
    setGithubStatus('Enviando...');
    setTimeout(() => {
      setGithubStatus('Sucesso!');
      console.log("JSON 'enviado' para o GitHub:", MOCK_METADATA);
      setTimeout(() => setGithubStatus(null), 2000);
    }, 1500);
  };
  
  const handleSaveMetadata = (newMetadata: Record<string, unknown>) => {
    console.log("Salvando metadados:", newMetadata);
    
    // Se for um mangá descoberto, enviar para o backend via WebSocket
    if (selectedMangaId?.startsWith('auto-')) {
      const mangaData = selectedMangaData;
      if (mangaData.mangaPath) {
        const messagePayload = {
          mangaID: selectedMangaId,  // Incluir mangaID para filename consistente
          mangaPath: mangaData.mangaPath,
          metadata: newMetadata,
          metadataOutput: metadataOutputWSL // Enviar configuração em formato WSL
        };
        
        console.log('🔍 DEBUG SAVE_METADATA PAYLOAD:', {
          messagePayload,
          metadataOutputWSL,
          mangaPath: mangaData.mangaPath,
          metadataKeys: Object.keys(newMetadata)
        });
        
        sendWSMessage({
          action: 'save_metadata',
          payload: {
            mangaID: selectedMangaId,  // Incluir mangaID para filename consistente
            mangaPath: mangaData.mangaPath,
            metadata: newMetadata,
            metadataOutput: metadataOutputWSL
          }
        });
        
        // Log para o usuário
        handleLog({
          type: 'info',
          message: `Salvando metadados para: ${mangaData.mangaPath}/metadata.json`,
          category: 'system'
        });
      } else {
        handleLog({
          type: 'error',
          message: 'Caminho do mangá não encontrado',
          category: 'system'
        });
      }
    } else {
      // Para mangás mock, apenas log
      handleLog({
        type: 'info',
        message: 'Metadados mock salvos (simulação)',
        category: 'system'
      });
    }
  };

  const handleViewManga = (mangaId: string) => {
    setPage('library');
    setSelectedMangaId(mangaId);
  };
  
  const handleBackToLibrary = () => {
    setSelectedMangaId(null);
    setSyncedMangaData(null); // Limpar dados sincronizados
  };

  const handleMangaSelection = (mangaPath: string) => {
    const mangaFromLibrary = findMangaInLibrary(mangaPath, library);
    
    if (mangaFromLibrary) {
      setSelectedMangaId(mangaFromLibrary.id || mangaPath);
      setIsMangaSelectionOpen(false);
      setIsMetadataEditorOpen(true);
      
      handleLog({
        type: 'info',
        message: `Editando metadados de: ${mangaFromLibrary.title}`,
        category: 'system'
      });
    }
  };

  const renderPageContent = () => {
    if (page === 'settings') {
      return <SettingsPage isHydrated={isHydrated} />;
    }
    
    if (page === 'logs') {
      return <LogsPage />;
    }
    
    if (page === 'progress') {
      return (
        <ProgressDashboard 
          operations={operations}
          activeOperation={activeOperation}
          onPause={batchProcessor.pauseOperation}
          onResume={batchProcessor.resumeOperation}
          onCancel={batchProcessor.cancelOperation}
          onRetry={(id) => console.log('Tentar novamente:', id)}
        />
      );
    }
    
    if (selectedManga) {
      return (
        <MangaDetailPage 
          manga={selectedManga} 
          onBack={handleBackToLibrary} 
          onEditMetadata={handleEditMetadata}
          addFilesToQueue={addFilesToQueue}
          mangaPath={selectedMangaData.mangaPath}
          onLog={handleLog}
          onSyncedDataChange={setSyncedMangaData}
        />
      );
    }
    
    return (
      <LibraryPage 
        selection={selection}
        library={library}
        sendWSMessage={sendWSMessage}
        isConnected={isConnected}
        onViewManga={handleViewManga}
        mockMangas={MOCK_MANGAS}
      />
    );
  };
  
  const getHeaderTitle = () => {
    if(page === 'settings') return 'Configurações';
    if(page === 'logs') return 'Logs do Sistema';
    if(page === 'progress') return 'Progresso das Operações';
    if(selectedManga) return selectedManga.title;
    return 'Biblioteca';
  };

  return (
    <>
      <ControlSidebar 
        host={host} 
        setHost={setHost} 
        files={files} 
        page={page} 
        setPage={setPage} 
        onRemoveFile={handleRemoveFile} 
        onClearFiles={handleClearFiles}
      />
      <main className="manga-uploader-main">
        <header className="manga-uploader-header">
          <div className="flex items-center justify-between w-full">
            <h2 className="text-xl font-semibold text-white truncate">{getHeaderTitle()}</h2>
            <div className="flex items-center space-x-2">
              {!isHydrated && (
                <Badge variant="warning" size="sm">Carregando...</Badge>
              )}
              <Badge 
                variant={isConnected ? "success" : "destructive"} 
                size="sm"
              >
                {isConnected ? "Conectado" : wsReconnectAttempts > 0 ? `Reconectando (${wsReconnectAttempts})` : "Desconectado"}
              </Badge>
              {operations.length > 0 && (
                <Badge variant="info" size="sm">
                  {operations.filter(op => op.status === 'running').length} operações ativas
                </Badge>
              )}
            </div>
          </div>
        </header>
        
        <div className="manga-uploader-content">
          {renderPageContent()}
        </div>
        
        <ClientOnly>
          <FloatingActionButtons 
            onUpload={handleUpload} 
            onEdit={handleEditMetadata} 
            onGithub={handleGithubUpload} 
            uploadDisabled={isUploading || files.length === 0}
            githubStatus={githubStatus}
            isInMangaDetailView={!!selectedMangaId}
          />
        </ClientOnly>

        <ClientOnly>
          {isMetadataEditorOpen && selectedManga && (
            <MetadataEditorModal 
              mangaID={selectedMangaId || undefined} // Pass mangaID for consistent filename
              metadata={(() => {
                // Usar dados sincronizados se disponíveis, senão usar dados originais
                const syncedManga = (window as any).syncedMangaForModal || selectedManga;
                return {
                  nome: syncedManga.title,
                  title: syncedManga.title,
                  descricao: syncedManga.description,
                  description: syncedManga.description,
                  autor: syncedManga.author,
                  author: syncedManga.author,
                  artista: syncedManga.artist,
                  artist: syncedManga.artist,
                  status: syncedManga.status,
                  capa: syncedManga.cover,
                  cover: syncedManga.cover,
                  grupo: syncedManga.group,
                  group: syncedManga.group,
                  ...(selectedMangaData.mangaPath && { 
                    _path: selectedMangaData.mangaPath,
                    caminho: selectedMangaData.mangaPath 
                  })
                };
              })()} 
              onClose={() => {
                setIsMetadataEditorOpen(false);
                // Limpar dados sincronizados temporários
                delete (window as any).syncedMangaForModal;
                // Se estava editando mangá da biblioteca, limpar seleção temporária
                if (!selectedManga && selectedMangaId?.startsWith('auto-')) {
                  setSelectedMangaId(null);
                }
              }} 
              onSave={handleSaveMetadata} 
            />
          )}
        </ClientOnly>

        <ClientOnly>
          {isMangaSelectionOpen && (
            <MangaSelectionModal 
              selectedPaths={selection.getSelectedPaths()}
              onClose={() => setIsMangaSelectionOpen(false)}
              onSelectManga={handleMangaSelection}
            />
          )}
        </ClientOnly>
      </main>
    </>
  );
}

// Componente Raiz
export default function MangaUploaderProWrapper() {
  return (
    <AppProvider>
      <ClientOnly fallback={<div className="flex h-screen bg-gray-900 items-center justify-center"><div className="text-white">Carregando...</div></div>}>
        <MangaUploaderPro />
      </ClientOnly>
    </AppProvider>
  );
}
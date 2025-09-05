import React, { useState, useCallback, createContext, useContext, useEffect } from 'react';
import { useWebSocketPool } from '../hooks/useWebSocketPool';
import { useThrottle, useDebounce } from '../hooks/useThrottle';
import { useBatchProcessor } from '../hooks/useBatchProcessor';
import { useSelection } from '../hooks/useSelection';
import { useHydration } from '../hooks/useHydration';
import { formatDuration } from '../utils/formatters';
import { generateId, isValidImageFile } from '../utils';
import { LibraryConfirmModal } from '../components/ui/LibraryConfirmModal';
import type { 
  AppContextType, 
  UploadableFile, 
  Library, 
  LogEntry, 
  WSResponse, 
  WSMessage, 
  MangaSelection,
  Manga,
  SavedLibrary
} from '../types';
import { UPLOAD_HOSTS } from '../types';

// Mock data com valores fixos para evitar diferenças de hidratação
const MOCK_MANGAS: Manga[] = [
  { id: 'ryouridou', title: 'Isekai Ryouridou', description: 'Um cozinheiro japonês moderno é transportado para um mundo de fantasia e sobrevive usando suas habilidades culinárias.', artist: 'Artista A', author: 'Autor A', status: 'Em Andamento', cover: 'https://placehold.co/200x300/1f2937/9ca3af?text=Isekai+R.', chapters: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, title: `${i + 1}`, imagesCount: 20 })) },
  { id: 'kagurabachi', title: 'Kagurabachi', description: 'Chihiro busca vingança com a ajuda das lâminas encantadas forjadas por seu pai.', artist: 'Takeru Hokazono', author: 'Takeru Hokazono', status: 'Em Andamento', cover: 'https://placehold.co/200x300/1f2937/9ca3af?text=Kagurabachi', chapters: Array.from({ length: 9 }, (_, i) => ({ id: i + 1, title: `Capítulo ${i + 1}`, imagesCount: 22 })) },
  { id: 'gachiakuta', title: 'Gachiakuta', description: 'Um jovem de uma favela luta para sobreviver em um mundo onde o lixo ganha vida.', artist: 'Kei Urana', author: 'Kei Urana', status: 'Em Andamento', cover: 'https://placehold.co/200x300/4f46e5/e0e7ff?text=Gachiakuta', chapters: Array.from({ length: 137 }, (_, i) => ({ id: i + 1, title: `Capítulo ${i + 1}`, imagesCount: 18 })) },
  { id: 'mushoku', title: 'Mushoku Tensei', description: 'Um homem de 34 anos reencarna em um mundo de magia e decide viver sua nova vida ao máximo.', artist: 'Yuka Fujikawa', author: 'Rifujin na Magonote', status: 'Em Andamento', cover: 'https://placehold.co/200x300/1f2937/9ca3af?text=Mushoku+T.', chapters: Array.from({ length: 4 }, (_, i) => ({ id: i + 1, title: `${i + 1}`, imagesCount: 19 })) },
  { id: 'shiori', title: 'Shiori Experience', description: 'Uma professora de inglês se torna a reencarnação de Jimi Hendrix e precisa liderar uma banda de garotas ao estrelato.', artist: 'Yūkō Osada', author: 'Yūkō Osada', status: 'Finalizado', cover: 'https://placehold.co/200x300/1f2937/9ca3af?text=Shiori+Exp.', chapters: Array.from({ length: 2 }, (_, i) => ({ id: i + 1, title: `Volume ${i + 1}`, imagesCount: 21 })) },
];

const AppContext = createContext<AppContextType | undefined>(undefined);

interface AppProviderProps {
  children: React.ReactNode;
}

export const AppProvider: React.FC<AppProviderProps> = ({ children }) => {
  const [files, setFiles] = useState<UploadableFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [library, setLibrary] = useState<Library | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [host, setHost] = useState<string>(UPLOAD_HOSTS[3]);
  
  // Library management states - inicialização segura para hidratação
  const [savedLibraries, setSavedLibraries] = useState<SavedLibrary[]>([]);
  const [currentLibrary, setCurrentLibrary] = useState<SavedLibrary | null>(null);
  
  // States for library discovery confirmation
  const [pendingLibrary, setPendingLibrary] = useState<{
    path: string;
    detectedName: string;
    payload: Library;
  } | null>(null);
  const [showLibraryConfirmModal, setShowLibraryConfirmModal] = useState(false);
  
  // Specialized hooks
  const isHydrated = useHydration();
  
  // Carregar dados do localStorage após hidratação (evita problemas SSR/CSR)
  useEffect(() => {
    if (isHydrated) {
      // Carregar bibliotecas salvas
      const saved = localStorage.getItem('saved-libraries');
      if (saved) {
        const libraries = JSON.parse(saved);
        setSavedLibraries(libraries);
        console.log('💾 Bibliotecas carregadas do localStorage após hidratação:', libraries);
      }
      
      // Carregar biblioteca atual
      const current = localStorage.getItem('current-library');
      if (current) {
        const library = JSON.parse(current);
        setCurrentLibrary(library);
        console.log('📚 Biblioteca atual carregada após hidratação:', library);
      }
    }
  }, [isHydrated]);
  
  const batchProcessor = useBatchProcessor({
    onProgress: (operation) => {
      // Handle batch operation progress
      console.log('Batch progress:', operation);
    },
    onComplete: (operation) => {
      console.log('Batch completed:', operation);
    },
    onError: (operation, error) => {
      console.error('Batch error:', operation, error);
    }
  });
  
  const selection = useSelection({
    library,
    onSelectionChange: (selectionData) => {
      console.log('Selection changed:', selectionData);
    }
  });
  
  const handleLog = useCallback((log: LogEntry) => {
    // Evitar loops ao verificar se é um log duplicado muito rápido
    setLogs(prev => {
      // Se o último log é idêntico e foi há menos de 100ms, ignorar
      const lastLog = prev[prev.length - 1];
      const now = Date.now();
      const lastLogTime = lastLog?.timestamp ? new Date(lastLog.timestamp).getTime() : 0;
      
      if (lastLog && 
          lastLog.message === log.message && 
          lastLog.type === log.type &&
          (now - lastLogTime) < 100) {
        return prev; // Não adicionar log duplicado
      }
      
      // Adicionar timestamp se não existir
      const logWithTimestamp = {
        ...log,
        timestamp: log.timestamp || new Date().toISOString()
      };
      
      return [...prev.slice(-99), logWithTimestamp];
    });
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
    console.log('Logs limpos pelo usuário');
  }, []);
  
  // WebSocket integration
  const handleWebSocketMessage = useCallback((data: WSResponse) => {
    // Verificação inicial de dados válidos
    if (!data || typeof data !== 'object') {
      console.warn('⚠️ Dados WebSocket inválidos recebidos:', data);
      return;
    }
    
    // Debug completo da mensagem recebida
    console.log('🔍 WEBSOCKET MESSAGE RECEIVED:', {
      status: data.status,
      hasPayload: !!data.payload,
      hasError: !!data.error,
      hasFile: !!data.file,
      dataKeys: Object.keys(data),
      dataStringified: JSON.stringify(data, null, 2),
      isEmpty: Object.keys(data).length === 0,
      isOnlyStatus: Object.keys(data).length === 1 && data.status,
      timestamp: new Date().toISOString()
    });
    
    // Se a mensagem só tem status sem outros dados úteis, não processar
    if (Object.keys(data).length === 1 && data.status) {
      console.warn('⚠️ Mensagem WebSocket com apenas status - ignorando:', data);
      return;
    }
    
    // Para mensagens de erro, verificar se pelo menos tem error ou file
    if (data.status === 'error' && !data.error && !data.file) {
      console.warn('⚠️ Mensagem de erro WebSocket sem detalhes - ignorando:', data);
      return;
    }
    
    switch (data.status) {
      case 'discover_complete':
        if (data.payload) {
          // Extract path from stored settings or URL params
          const discoveredPath = localStorage.getItem('last-discovery-path') || '';
          
          if (discoveredPath) {
            // Check if this library is already saved
            const existingLibrary = savedLibraries.find(lib => lib.path === discoveredPath);
            
            if (existingLibrary) {
              // Library already exists, just set it and use it
              setCurrentLibrary(existingLibrary);
              setLibrary(data.payload);
              updateLibraryAccess(existingLibrary.id);
              
              handleLog({
                type: 'success',
                message: `Biblioteca "${existingLibrary.name}" carregada (${Object.keys(data.payload).length} items encontrados)`,
                category: 'discovery'
              });
            } else {
              // New library, ask for confirmation
              const detectedName = extractLibraryName(discoveredPath);
              setPendingLibrary({
                path: discoveredPath,
                detectedName,
                payload: data.payload
              });
              setShowLibraryConfirmModal(true);
              
              handleLog({
                type: 'info',
                message: `Nova biblioteca descoberta: ${Object.keys(data.payload).length} items encontrados`,
                category: 'discovery'
              });
            }
            
            // Clear the stored path after processing
            localStorage.removeItem('last-discovery-path');
          } else {
            // No stored path - this is likely a scan switch, just set the library
            setLibrary(data.payload);
            handleLog({
              type: 'success',
              message: `Biblioteca carregada: ${Object.keys(data.payload).length} items encontrados`,
              category: 'discovery'
            });
          }
          
          // Notify that discovery is complete
          window.dispatchEvent(new CustomEvent('discoveryComplete'));
        }
        break;
      
      case 'complete':
        if (data.file && data.url) {
          console.log(`Upload completo: ${data.file} -> ${data.url}`);
          setFiles(prev => prev.map(f => 
            f.file.name === data.file 
              ? { 
                  ...f, 
                  status: 'success' as const, 
                  progress: 100, 
                  url: data.url,
                  endTime: Date.now(),
                  duration: f.startTime ? formatDuration((Date.now() - f.startTime) / 1000) : undefined
                }
              : f
          ));
          
          handleLog({
            type: 'success',
            message: `Upload concluído: ${data.file}`,
            category: 'upload'
          });
          
          // Check if all uploads are complete
          setTimeout(() => {
            setFiles(prev => {
              const allComplete = prev.every(f => f.status === 'success' || f.status === 'error');
              if (allComplete) {
                setIsUploading(false);
                handleLog({
                  type: 'info',
                  message: 'Todos os uploads foram concluídos!',
                  category: 'upload'
                });
              }
              return prev;
            });
          }, 100);
        }
        break;
        
      case 'error':
        console.log('🔍 DEBUGGING CASE ERROR - DADOS RECEBIDOS:', {
          dataCompleto: JSON.stringify(data),
          hasError: !!data.error,
          hasFile: !!data.file, 
          hasPayload: !!data.payload,
          errorValue: data.error,
          fileValue: data.file,
          payloadValue: data.payload,
          allKeys: Object.keys(data),
          allValues: Object.values(data)
        });
        
        // Se não há dados de erro úteis, ignorar
        if (!data.error && !data.file && !data.payload) {
          console.warn('⚠️ Erro WebSocket sem dados úteis - ignorando:', JSON.stringify(data));
          break;
        }
        
        const errorMsg = data.error || 'Upload failed';
        
        // Tratar "JSON file not found" como aviso em vez de erro
        const isJSONNotFound = data.error && data.error.includes('JSON file not found');
        
        if (isJSONNotFound) {
          // JSON não encontrado é normal - logar como aviso
          if (process.env.NODE_ENV === 'development') {
            console.warn('📄 JSON não encontrado:', data.error);
          }
          // Disparar evento de erro de metadados para os hooks
          window.dispatchEvent(new CustomEvent('mangaMetadataError', { 
            detail: data 
          }));
        } else {
          // Outros erros são realmente problemas
          console.error('🚨 ERRO WEBSOCKET - Status:', data.status, 'Error:', data.error, 'File:', data.file);
        }
        
        if (!isJSONNotFound) {
          // Só processar como erro se não for "JSON not found"
          if (data.file) {
            setFiles(prev => prev.map(f => 
              f.file.name === data.file 
                ? { ...f, status: 'error' as const, error: errorMsg }
                : f
            ));
          } else {
            // Se não tem arquivo específico, pode ser erro geral de conexão
            console.warn('Erro de upload sem arquivo específico - possível problema de conexão');
            setFiles(prev => prev.map(f => 
              f.status === 'uploading' 
                ? { ...f, status: 'error' as const, error: 'Erro de conexão WebSocket' }
                : f
            ));
          }
        }
        
        if (!isJSONNotFound) {
          // Só logar como erro se não for "JSON not found"
          handleLog({
            type: 'error',
            message: `Erro no upload: ${data.file ? `${data.file} - ` : 'Conexão - '}${errorMsg}`,
            timestamp: new Date().toISOString(),
            category: 'upload'
          });
        }
        break;
        
      case 'json_generated':
        if (data.mangaTitle && data.jsonPath) {
          handleLog({
            type: 'info',
            message: `JSON gerado: ${data.mangaTitle} → ${data.jsonPath}`,
            category: 'batch'
          });
        }
        break;
        
      case 'json_complete':
        if (data.mangaTitle) {
          handleLog({
            type: 'success',
            message: `JSON concluído: ${data.mangaTitle} - metadados atualizados`,
            category: 'batch'
          });
        }
        break;
      
      case 'metadata_saved':
        const metadataFilePath = data.payload?.filePath || 'JSON não especificado';
        const savedMetadata = data.payload?.metadata;
        
        handleLog({
          type: 'success',
          message: `✅ Metadados salvos: ${metadataFilePath}`,
          timestamp: new Date().toISOString(),
          category: 'system'
        });
        
        // If this was from editing in detail view, could potentially refresh the manga data
        if (savedMetadata) {
          console.log('📝 Metadados salvos:', savedMetadata);
        }
        
        break;

      case 'load_metadata':
      case 'metadata_loaded':
        if (data.payload?.metadata) {
          handleLog({
            type: 'success',
            message: `📋 Metadados carregados: ${data.payload.mangaName || 'Manga'}`,
            timestamp: new Date().toISOString(),
            category: 'system'
          });
          
          // Broadcast the loaded metadata to any listeners via custom event
          if (process.env.NODE_ENV === 'development') {
            console.log('📋 Metadados carregados via WebSocket:', data.payload.metadata);
          }
          
          // Dispatch custom event para notificar hooks useMangaSync
          window.dispatchEvent(new CustomEvent('mangaMetadataLoaded', { 
            detail: data 
          }));
        } else if (data.error) {
          handleLog({
            type: 'error',
            message: `❌ Erro ao carregar metadados: ${data.error}`,
            timestamp: new Date().toISOString(),
            category: 'system'
          });
          
          // Dispatch error event também
          window.dispatchEvent(new CustomEvent('mangaMetadataError', { 
            detail: data 
          }));
        }
        break;

      case 'discovery_progress':
        if (data.progress) {
          const { current, total, percentage, currentFile } = data.progress;
          handleLog({
            type: 'info',
            message: `🔍 Descobrindo (${percentage}%) - ${currentFile} [${current}/${total}]`,
            timestamp: new Date().toISOString(),
            category: 'discovery'
          });
        }
        break;
      
      // AniList integration handlers (Phase 3.1)
      case 'search_anilist_complete':
      case 'search_progress':
      case 'anilist_selection_complete':
      case 'anilist_fetch_progress':
      case 'anilist_error':
        // Emit generic websocket-message event for AniList hooks to catch
        console.log(`📡 AniList: Emitting websocket-message event for ${data.status}`);
        window.dispatchEvent(new CustomEvent('websocket-message', { 
          detail: data 
        }));
        break;
        
      // GitHub integration handlers
      case 'github_folders_complete':
        console.log('📁 GitHub: Pastas listadas com sucesso', data.data);
        console.log('📁 GitHub: Folders array:', data.data?.folders);
        // Emit event for Settings page to catch
        window.dispatchEvent(new CustomEvent('github-folders', { 
          detail: data 
        }));
        console.log('📁 GitHub: Event dispatched');
        
        handleLog({
          type: 'success',
          message: `GitHub: ${data.data?.folderCount || 0} pastas encontradas no repositório`,
          category: 'system'
        });
        break;
        
      case 'github_folders_progress':
        console.log('📁 GitHub: Listando pastas...', data.progress);
        // Emit progress event
        window.dispatchEvent(new CustomEvent('github-folders-progress', { 
          detail: data 
        }));
        break;
        
      case 'github_upload_complete':
        console.log('📤 GitHub: Upload concluído com sucesso', data.data);
        // Emit event for Settings page to catch
        window.dispatchEvent(new CustomEvent('github-upload', { 
          detail: data 
        }));
        
        handleLog({
          type: 'success',
          message: `GitHub: ${data.data?.uploadedCount || 0} arquivos JSON enviados com sucesso`,
          category: 'upload'
        });
        break;
        
      case 'github_upload_progress':
        console.log('📤 GitHub: Upload em progresso...', data.progress);
        // Emit progress event
        window.dispatchEvent(new CustomEvent('github-upload-progress', { 
          detail: data 
        }));
        break;
        
      case 'github_error':
        console.error('🚨 GitHub: Erro na integração', data.error);
        // Emit error event
        window.dispatchEvent(new CustomEvent('github-error', { 
          detail: data 
        }));
        
        handleLog({
          type: 'error',
          message: `GitHub: ${data.error || 'Erro desconhecido'}`,
          category: 'system'
        });
        break;

      // AniList Configuration handlers (Phase 4.3)
      case 'config_retrieved':
      case 'config_updated':
      case 'config_reset':
        console.log('🔧 AniList Config: Resposta recebida', data.status);
        window.dispatchEvent(new CustomEvent('websocket-message', { 
          detail: data 
        }));
        break;
        
      default:
        console.log('Status WebSocket não tratado:', data.status);
        break;
    }
  }, [handleLog]);
  
  // WebSocket Pool otimizado para milhares de conexões
  const { isConnected, send: sendWSMessage, getStats } = useWebSocketPool({
    url: 'ws://localhost:8080/ws',
    onMessage: handleWebSocketMessage,
    enabled: true
  });

  // Função de upload em lote para performance otimizada
  // (throttling removido para permitir resposta imediata do load_metadata)

  // Debounce para discovery requests
  const debouncedDiscovery = useDebounce((libraryPath: string) => {
    sendWSMessage({
      type: 'library_discovery',
      payload: { libraryPath }
    });
  }, 500);
  
  const addFilesToQueue = useCallback((selection: MangaSelection, selectedFiles: FileList) => {
    const newUploads: UploadableFile[] = [];
    for (const mangaId in selection) {
      const manga = MOCK_MANGAS.find(m => m.id === mangaId);
      if (!manga) continue;

      for (const chapterId of selection[mangaId]) {
        for (const file of Array.from(selectedFiles)) {
          // Validate file extension
          if (!isValidImageFile(file.name)) {
            console.warn(`Arquivo ignorado (extensão inválida): ${file.name}`);
            continue;
          }
          newUploads.push({ 
            file, 
            id: generateId(), // Use proper ID generation
            mangaId: manga.id, 
            mangaTitle: manga.title, 
            chapterId, 
            progress: 0, 
            status: 'pending' as const 
          });
        }
      }
    }
    setFiles(prev => {
      const existingIds = new Set(prev.map(f => f.id));
      const uniqueNewUploads = newUploads.filter(nu => !existingIds.has(nu.id));
      return [...prev, ...uniqueNewUploads];
    });
  }, []);

  const handleRemoveFile = useCallback((fileIdToRemove: string) => 
    setFiles(prev => prev.filter(f => f.id !== fileIdToRemove)), []);
  
  const handleClearFiles = useCallback(() => setFiles([]), []);

  const handleUpload = useCallback(() => {
    if (isUploading || files.length === 0 || !isConnected) {
      console.log('Upload bloqueado:', { isUploading, filesLength: files.length, isConnected });
      return;
    }
    
    setIsUploading(true);
    console.log(`Iniciando upload de ${files.length} arquivos via WebSocket`);
    
    // Real upload process using WebSocket
    files.forEach(async (file, index) => {
      try {
        // Convert file to Base64 - using utility from utils
        const reader = new FileReader();
        reader.onload = () => {
          const base64Content = (reader.result as string).split(',')[1];
          
          // Update status to uploading
          setFiles(prev => prev.map(f => 
            f.id === file.id 
              ? { ...f, status: 'uploading' as const, progress: 0, startTime: Date.now() }
              : f
          ));
          
          // Send upload message to backend
          const uploadMessage: WSMessage = {
            action: 'upload',
            host: host,
            manga: file.mangaTitle,
            chapter: file.chapterId.toString(),
            fileName: file.file.name,
            fileContent: base64Content
          };
          
          console.log(`Enviando upload: ${file.file.name} para ${host}`);
          const success = sendWSMessage(uploadMessage);
          
          if (!success) {
            console.error(`Falha ao enviar WebSocket para ${file.file.name}`);
            setFiles(prev => prev.map(f => 
              f.id === file.id 
                ? { ...f, status: 'error' as const, error: 'WebSocket desconectado' }
                : f
            ));
          }
        };
        
        reader.onerror = () => {
          console.error(`Erro ao ler arquivo: ${file.file.name}`);
          setFiles(prev => prev.map(f => 
            f.id === file.id 
              ? { ...f, status: 'error' as const, error: 'Falha na leitura do arquivo' }
              : f
          ));
        };
        
        reader.readAsDataURL(file.file);
        
      } catch (error) {
        console.error(`Erro no processamento de ${file.file.name}:`, error);
        setFiles(prev => prev.map(f => 
          f.id === file.id 
            ? { ...f, status: 'error' as const, error: `Erro: ${error}` }
            : f
        ));
      }
    });
  }, [files, isUploading, isConnected, host, sendWSMessage]);
  
  // Library management functions
  const addSavedLibrary = useCallback((libraryData: Omit<SavedLibrary, 'id' | 'lastAccessed'>) => {
    // Usar um ID baseado no path para consistência entre servidor e cliente
    const pathHash = libraryData.path.replace(/[^a-zA-Z0-9]/g, '').slice(-8);
    const newLibrary: SavedLibrary = {
      ...libraryData,
      id: `lib-${Date.now()}-${pathHash}`,
      lastAccessed: Date.now()
    };
    
    setSavedLibraries(prev => {
      const updated = [newLibrary, ...prev.filter(lib => lib.path !== libraryData.path)];
      localStorage.setItem('saved-libraries', JSON.stringify(updated));
      console.log('💾 Biblioteca adicionada e salva:', newLibrary, 'Total:', updated.length);
      return updated;
    });
    
    setCurrentLibrary(newLibrary);
    localStorage.setItem('current-library', JSON.stringify(newLibrary));
  }, []);
  
  const removeSavedLibrary = useCallback((libraryId: string) => {
    setSavedLibraries(prev => {
      const updated = prev.filter(lib => lib.id !== libraryId);
      localStorage.setItem('saved-libraries', JSON.stringify(updated));
      return updated;
    });
    
    if (currentLibrary?.id === libraryId) {
      setCurrentLibrary(null);
      localStorage.removeItem('current-library');
    }
  }, [currentLibrary]);
  
  const updateLibraryAccess = useCallback((libraryId: string) => {
    setSavedLibraries(prev => {
      const updated = prev.map(lib => 
        lib.id === libraryId 
          ? { ...lib, lastAccessed: Date.now() }
          : lib
      );
      localStorage.setItem('saved-libraries', JSON.stringify(updated));
      return updated;
    });
  }, []);
  
  // Function to extract library name from path
  const extractLibraryName = useCallback((path: string): string => {
    const pathSegments = path.split(/[\/\\]/).filter(Boolean);
    const lastSegment = pathSegments[pathSegments.length - 1];
    
    // Clean up common naming patterns
    return lastSegment
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
      .replace(/\s+/g, ' ')
      .trim();
  }, []);
  
  // Function to confirm and save discovered library
  const confirmLibrary = useCallback((customName?: string) => {
    if (!pendingLibrary) return;
    
    const libraryName = customName || pendingLibrary.detectedName;
    
    // Usar um ID baseado no path para consistência
    const pathHash = pendingLibrary.path.replace(/[^a-zA-Z0-9]/g, '').slice(-8);
    const newLibrary: SavedLibrary = {
      id: `lib-${Date.now()}-${pathHash}`,
      name: libraryName,
      path: pendingLibrary.path,
      lastAccessed: Date.now(),
      description: `Biblioteca descoberta em ${new Date().toLocaleDateString()}`
    };
    
    // Add to saved libraries
    setSavedLibraries(prev => {
      const updated = [newLibrary, ...prev.filter(lib => lib.path !== pendingLibrary.path)];
      localStorage.setItem('saved-libraries', JSON.stringify(updated));
      console.log('💾 Nova biblioteca confirmada e salva:', newLibrary);
      console.log('📋 Total de bibliotecas salvas:', updated.length);
      return updated;
    });
    
    // Set as current library
    setCurrentLibrary(newLibrary);
    localStorage.setItem('current-library', JSON.stringify(newLibrary));
    
    // Set the library data
    setLibrary(pendingLibrary.payload);
    
    // Close modal
    setShowLibraryConfirmModal(false);
    setPendingLibrary(null);
    
    handleLog({
      type: 'success',
      message: `Biblioteca "${libraryName}" salva no histórico`,
      category: 'discovery'
    });
  }, [pendingLibrary, handleLog]);
  
  // Function to decline saving library
  const declineLibrary = useCallback(() => {
    if (pendingLibrary) {
      setLibrary(pendingLibrary.payload);
    }
    setShowLibraryConfirmModal(false);
    setPendingLibrary(null);
  }, [pendingLibrary]);
  
  // Debug function to check localStorage persistence
  const debugLibraries = useCallback(() => {
    const stored = localStorage.getItem('saved-libraries');
    const current = localStorage.getItem('current-library');
    console.log('🔍 DEBUG - Bibliotecas no localStorage:', stored ? JSON.parse(stored) : 'Nenhuma');
    console.log('🔍 DEBUG - Biblioteca atual no localStorage:', current ? JSON.parse(current) : 'Nenhuma');
    console.log('🔍 DEBUG - Estado atual savedLibraries:', savedLibraries);
    console.log('🔍 DEBUG - Estado atual currentLibrary:', currentLibrary);
    return { stored: stored ? JSON.parse(stored) : [], current: current ? JSON.parse(current) : null };
  }, [savedLibraries, currentLibrary]);

  // Add debugLibraries to window for manual debugging (development only)
  useEffect(() => {
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
      (window as any).debugLibraries = debugLibraries;
      (window as any).savedLibraries = savedLibraries;
      (window as any).currentLibrary = currentLibrary;
    }
  }, [debugLibraries, savedLibraries, currentLibrary]);
  
  const handleSetCurrentLibrary = useCallback((library: SavedLibrary | null) => {
    console.log('🔄 AppContext: handleSetCurrentLibrary chamado com:', library);
    setCurrentLibrary(library);
    if (library) {
      localStorage.setItem('current-library', JSON.stringify(library));
      updateLibraryAccess(library.id);
      console.log('💾 Biblioteca salva no localStorage:', library.name);
    } else {
      localStorage.removeItem('current-library');
      console.log('🗑️ Biblioteca removida do localStorage');
    }
  }, [updateLibraryAccess]);
  
  // Auto-load current library on initialization
  useEffect(() => {
    if (isHydrated && currentLibrary && isConnected) {
      // Auto-discover the current library when the app loads
      const success = sendWSMessage({
        action: 'discover_library',
        data: {
          fullPath: currentLibrary.path,
        },
        requestId: `auto_load_${Date.now()}`
      });
      
      if (success) {
        handleLog({
          type: 'info',
          message: `Carregando biblioteca: ${currentLibrary.name}`,
          category: 'discovery'
        });
      }
    }
  }, [isHydrated, isConnected, currentLibrary, sendWSMessage, handleLog]);
  
  const value: AppContextType = { 
    files, 
    isUploading,
    host,
    setHost, 
    addFilesToQueue, 
    handleRemoveFile, 
    handleClearFiles, 
    handleUpload,
    handleLog,
    clearLogs,
    operations: batchProcessor.operations,
    activeOperation: batchProcessor.activeOperation || null,
    library,
    setLibrary,
    logs,
    isConnected,
    sendWSMessage: sendWSMessage,
    wsStats: getStats,
    triggerDiscovery: debouncedDiscovery,
    // Library management
    savedLibraries,
    currentLibrary,
    setCurrentLibrary: handleSetCurrentLibrary,
    addSavedLibrary,
    removeSavedLibrary,
    updateLibraryAccess,
    // Library confirmation modal
    showLibraryConfirmModal,
    pendingLibrary: pendingLibrary ? { path: pendingLibrary.path, detectedName: pendingLibrary.detectedName } : null,
    confirmLibrary,
    declineLibrary,
    batchProcessor,
    selection,
    isHydrated
  };

  return (
    <AppContext.Provider value={value}>
      {children}
      
      {/* Library confirmation modal */}
      <LibraryConfirmModal
        isOpen={showLibraryConfirmModal}
        libraryName={pendingLibrary?.detectedName || ''}
        libraryPath={pendingLibrary?.path || ''}
        onConfirm={confirmLibrary}
        onDecline={declineLibrary}
      />
    </AppContext.Provider>
  );
};

export const useAppContext = (): AppContextType => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};

// Export mock data for use in components
export { MOCK_MANGAS };
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '../ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { NumericStepper } from '../ui/NumericStepper';
import { debounce, storage } from '../../utils';
import { useAppContext } from '../../contexts/AppContext';
import { UPLOAD_HOSTS, HOST_CONFIGS, type UploadHost } from '../../types';

interface SettingsPageProps {
  isHydrated: boolean;
}

// Tipagem para configs específicas por host
type HostConfigMap = Partial<Record<UploadHost, {
  sessionCookie: string;
  workers: number;
  rateLimit: number;
}>>;

export const SettingsPage: React.FC<SettingsPageProps> = ({ isHydrated }) => {
  const { sendWSMessage, isConnected, host, setHost } = useAppContext();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [pathType, setPathType] = useState<'windows' | 'linux'>(() => {
    if (!isHydrated) return 'linux';
    return storage.get('path-type', 'linux') as 'windows' | 'linux';
  });
  const [settings, setSettings] = useState(() => {
    if (!isHydrated) {
      const currentHostConfig = HOST_CONFIGS[host as UploadHost] || HOST_CONFIGS['catbox'];
      return {
        mangaRoot: '',
        metadataOutput: '',
        sessionCookie: '',
        workers: currentHostConfig.defaultWorkers,
        rateLimit: currentHostConfig.defaultRateLimit,
        githubToken: '',
        githubRepo: '',
        githubBranch: 'main',
        repoFolder: '',
        updateMode: 'smart'
      };
    }
    
    const savedSettings = storage.get('manga-uploader-settings', {});
    const currentHostConfig = HOST_CONFIGS[host as UploadHost] || HOST_CONFIGS['catbox'];
    
    return {
      mangaRoot: '',
      metadataOutput: '',
      sessionCookie: '',
      workers: currentHostConfig.defaultWorkers,
      rateLimit: currentHostConfig.defaultRateLimit,
      githubToken: '',
      githubRepo: '',
      githubBranch: 'main',
      repoFolder: '',
      updateMode: 'smart',
      ...savedSettings
    };
  });

  const [hostConfigs, setHostConfigs] = useState<HostConfigMap>(() => {
    if (!isHydrated) return {};
    return storage.get('host-configs', {} as HostConfigMap);
  });

  const [testingCookie, setTestingCookie] = useState(false);
  const [cookieTestResult, setCookieTestResult] = useState<string | null>(null);
  const [refreshingFolders, setRefreshingFolders] = useState(false);
  const [githubFolders, setGithubFolders] = useState<string[]>([]);
  const [githubRootFolders, setGithubRootFolders] = useState<string[]>([]);
  const [githubSubFolders, setGithubSubFolders] = useState<{[key: string]: string[]}>({});
  const [allGithubSubFolders, setAllGithubSubFolders] = useState<string[]>([]);
  const [selectedRootFolder, setSelectedRootFolder] = useState<string>('');
  const [selectedSubFolder, setSelectedSubFolder] = useState<string>('');
  const [discovering, setDiscovering] = useState(false);
  
  // Get current host configuration
  const currentHostConfig = HOST_CONFIGS[host as UploadHost] || HOST_CONFIGS['catbox'];

  // Update workers and rate limit when host changes
  const handleHostChange = useCallback((newHost: UploadHost) => {
    const hostConfig = HOST_CONFIGS[newHost];
    
    // Save current host configuration
    const currentHostConfig = { 
      sessionCookie: settings.sessionCookie,
      workers: settings.workers,
      rateLimit: settings.rateLimit
    };
    
    const newHostConfigs = {
      ...hostConfigs,
      [host]: currentHostConfig
    };
    
    setHostConfigs(newHostConfigs);
    storage.set('host-configs', newHostConfigs);
    setHost(newHost);
    
    // Load saved config for new host or use defaults
  const savedConfig = hostConfigs[newHost];
    setSettings(prev => ({
      ...prev,
      sessionCookie: savedConfig?.sessionCookie || '',
      workers: savedConfig?.workers || hostConfig.defaultWorkers,
      rateLimit: savedConfig?.rateLimit || hostConfig.defaultRateLimit
    }));
  }, [setHost, host, hostConfigs, settings.sessionCookie, settings.workers, settings.rateLimit]);

  const handleInputChange = useCallback((field: string, value: unknown) => {
    setSettings(prev => {
      const newSettings = { ...prev, [field]: value };
      
      // Save host-specific configs separately
      if (['sessionCookie', 'workers', 'rateLimit'].includes(field)) {
        const newHostConfigs = {
          ...hostConfigs,
          [host]: {
            sessionCookie: field === 'sessionCookie' ? value : prev.sessionCookie,
            workers: field === 'workers' ? value : prev.workers,
            rateLimit: field === 'rateLimit' ? value : prev.rateLimit
          }
        };
        setHostConfigs(newHostConfigs);
        storage.set('host-configs', newHostConfigs);
      }
      
      // Persist general settings to localStorage with debounce
      const debouncedSave = debounce(() => {
        storage.set('manga-uploader-settings', newSettings);
      }, 500);
      debouncedSave();
      
      return newSettings;
    });
  }, [host, hostConfigs, settings.sessionCookie, settings.workers, settings.rateLimit]);

  // Function to convert Windows path to Linux/WSL path
  const convertPath = useCallback((path: string, fromType: 'windows' | 'linux', toType: 'windows' | 'linux') => {
    if (fromType === toType) return path;
    
    // Auto-detect path type based on format
    const isWindowsPath = path.length >= 3 && path[1] === ':' && (path[2] === '\\' || path[2] === '/');
    const isLinuxPath = path.startsWith('/mnt/') || path.startsWith('/');
    
    if (toType === 'linux') {
      // Convert to Linux/WSL path
      if (isWindowsPath) {
        const drive = path[0].toLowerCase();
        const linuxPath = path.replace(`${path[0]}:`, `/mnt/${drive}`).replaceAll('\\', '/');
        return linuxPath;
      }
    } else if (toType === 'windows') {
      // Convert to Windows path
      if (path.startsWith('/mnt/')) {
        const pathParts = path.split('/');
        if (pathParts.length >= 3) {
          const drive = pathParts[2].toUpperCase();
          const windowsPath = `${drive}:\\${pathParts.slice(3).join('\\')}`;
          return windowsPath;
        }
      }
    }
    
    return path;
  }, []);

  const handlePathTypeChange = useCallback((type: 'windows' | 'linux') => {
    setPathType(type);
    storage.set('path-type', type);
  }, []);

  const handleSelectFolder = useCallback(() => {
    folderInputRef.current?.click();
  }, []);
  
  const handleFolderChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      // Get the full path from the first file
      const firstFile = files[0];
      const pathParts = firstFile.webkitRelativePath.split('/');
      const basePath = pathParts[0];
      
      // Try to reconstruct the full path by looking at the file's path
      const fullPath = firstFile.webkitRelativePath.replace(`/${pathParts.slice(1).join('/')}`, '').replace(basePath, '');
      const parentPath = (firstFile as any).path || firstFile.webkitRelativePath;
      let selectedPath = basePath;
      
      // If we can determine the parent directory, use it
      if (parentPath && parentPath.includes('/')) {
        const pathSegments = parentPath.split('/');
        pathSegments.pop(); // Remove filename
        selectedPath = pathSegments.join('/');
        
        // Remove the basePath from the end to get parent directory
        if (selectedPath.endsWith(basePath)) {
          selectedPath = selectedPath.substring(0, selectedPath.length - basePath.length - 1);
          selectedPath = selectedPath + '/' + basePath;
        }
      }
      
      // Update the mangaRoot setting with the selected path
      handleInputChange('mangaRoot', selectedPath || basePath);
      
      // Auto-detect source path type and convert to target type
      const sourcePath = selectedPath || basePath;
      const convertedPath = convertPath(sourcePath, 'windows', pathType);
      
      console.log(`Descobrindo estrutura para pasta:`);
      console.log(`  Original: ${sourcePath}`);
      console.log(`  Convertido (${pathType}): ${convertedPath}`);
      
      // Save the path for library confirmation later
      localStorage.setItem('last-discovery-path', convertedPath);
      
      // Send discovery request to backend with converted path
      const success = sendWSMessage({
        action: 'discover_library',
        data: {
          basePath: basePath,
          fullPath: convertedPath,
        },
        requestId: `discover_${Date.now()}`
      });
      
      if (success) {
        console.log(`Enviada mensagem de descoberta para: ${convertedPath}`);
      } else {
        console.error('Falha ao enviar mensagem de descoberta - WebSocket desconectado');
        const status = isConnected ? 'conectado mas não responsivo' : 'desconectado';
        alert(`WebSocket ${status}! Não foi possível iniciar a descoberta.`);
      }
    }
  }, [sendWSMessage, handleInputChange]);
  
  const handleSaveSettings = useCallback(() => {
    storage.set('manga-uploader-settings', settings);
    console.log('Configurações salvas com sucesso!');
  }, [settings]);

  const handleSelectDirectory = useCallback(async (field: 'mangaRoot' | 'metadataOutput') => {
    try {
      // Show informative message about browser limitations
      const shouldContinue = confirm(
        `🚨 Limitação do Navegador\n\n` +
        `O navegador não pode acessar caminhos absolutos por segurança.\n\n` +
        `RECOMENDAÇÃO:\n` +
        `1. Digite o caminho completo MANUALMENTE no campo acima\n` +
        `2. Exemplo: D:\\MOE\\Obras\\Gikamura\\ManhAstro\n` +
        `3. Clique em "Descobrir"\n\n` +
        `Continuar com seletor limitado?`
      );
      
      if (!shouldContinue) return;
      
      const dirHandle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
      
      // Get limited directory name (only the selected folder name)
      const folderName = dirHandle.name;
      
      handleInputChange(field, folderName);
      console.log(`Selected ${field} (nome da pasta apenas):`, folderName);
      
      // Show additional warning
      alert(
        `⚠️ Caminho Limitado Detectado\n\n` +
        `Pasta selecionada: "${folderName}"\n\n` +
        `IMPORTANTE: Este é apenas o nome da pasta, não o caminho completo!\n\n` +
        `Para usar a descoberta:\n` +
        `1. Substitua pelo caminho completo: D:\\MOE\\Obras\\Gikamura\\ManhAstro\n` +
        `2. Escolha o tipo correto: Windows/Linux\n` +
        `3. Clique em "Descobrir"`
      );
      
    } catch (error) {
      console.log('Seleção de diretório cancelada:', error);
    }
  }, [handleInputChange]);

  const handleDirectDiscovery = useCallback(() => {
    if (discovering) {
      console.log('Descoberta já em andamento, ignorando clique...');
      return;
    }

    const path = settings.mangaRoot.trim();
    
    if (!path) {
      alert('Digite o caminho da pasta antes de descobrir!');
      return;
    }
    
    setDiscovering(true);
    
    // Convert path to target type
    const convertedPath = convertPath(path, 'windows', pathType);
    
    console.log(`Descobrindo estrutura para pasta:`);
    console.log(`  Original: ${path}`);
    console.log(`  Convertido (${pathType}): ${convertedPath}`);
    
    // Save the path for library confirmation later
    localStorage.setItem('last-discovery-path', convertedPath);
    
    // Send discovery request to backend with converted path
    const success = sendWSMessage({
      action: 'discover_library',
      data: {
        basePath: path.split(/[\\\/]/).pop() || path,
        fullPath: convertedPath,
      },
      requestId: `discover_${Date.now()}`
    });
    
    if (success) {
      console.log(`Enviada mensagem de descoberta para: ${convertedPath}`);
      // Reset discovering state after a timeout in case we don't get a response
      setTimeout(() => setDiscovering(false), 10000);
    } else {
      console.error('Falha ao enviar mensagem de descoberta - WebSocket desconectado');
      const status = isConnected ? 'conectado mas não responsivo' : 'desconectado';
      alert(`WebSocket ${status}! Verifique se o backend está rodando e tente novamente.`);
      setDiscovering(false);
    }
  }, [discovering, settings.mangaRoot, convertPath, pathType, sendWSMessage]);

  // Listen for discovery completion
  useEffect(() => {
    const handleDiscoveryComplete = () => {
      setDiscovering(false);
    };

    window.addEventListener('discoveryComplete', handleDiscoveryComplete);
    return () => window.removeEventListener('discoveryComplete', handleDiscoveryComplete);
  }, []);

  // GitHub event listeners
  useEffect(() => {
    const handleGitHubFolders = (event: CustomEvent) => {
      console.log('🎯 SettingsPage: GitHub folders event received!', event.detail);
      const data = event.detail?.data;
      console.log('🎯 SettingsPage: Event data:', data);
      
      if (data?.folders) {
        console.log('🎯 SettingsPage: Processing folders:', data.folders);
        
        // Separate root folders and subfolders
        const rootFolders = new Set<string>();
        const subFolderMap: {[key: string]: string[]} = {};
        const allSubFolders = new Set<string>(); // All unique subfolders regardless of parent
        
        data.folders.forEach((folder: any) => {
          const path = folder.path || folder.name;
          const pathParts = path.split('/');
          
          if (pathParts.length === 1) {
            // Root folder
            rootFolders.add(pathParts[0]);
          } else {
            // Subfolder
            const root = pathParts[0];
            const subPath = pathParts.slice(1).join('/');
            
            rootFolders.add(root);
            allSubFolders.add(subPath); // Add to global subfolder list
            
            if (!subFolderMap[root]) {
              subFolderMap[root] = [];
            }
            subFolderMap[root].push(subPath);
          }
        });
        
        // Update states
        const rootArray = Array.from(rootFolders).sort();
        const allSubArray = Array.from(allSubFolders).sort();
        setGithubRootFolders(rootArray);
        setGithubSubFolders(subFolderMap);
        setAllGithubSubFolders(allSubArray);
        
        // Keep original for backward compatibility
        const folderOptions = data.folders.map((folder: any) => folder.path || folder.name);
        setGithubFolders(folderOptions);
        
        console.log(`✅ GitHub: ${rootArray.length} pastas raiz e subpastas carregadas`);
        console.log('📁 Root folders:', rootArray);
        console.log('📁 Sub folders:', subFolderMap);
      } else {
        console.warn('⚠️ SettingsPage: No folders found in event data');
      }
      setRefreshingFolders(false); // Stop loading animation
    };

    const handleGitHubFoldersProgress = (event: CustomEvent) => {
      console.log('📁 GitHub folders progress:', event.detail?.progress);
      // Could show progress indicator here if needed
    };

    const handleGitHubUpload = (event: CustomEvent) => {
      console.log('📤 GitHub upload completed:', event.detail);
      const data = event.detail?.data;
      
      if (data?.commit) {
        alert(`✅ GitHub Upload Concluído!\n\n${data.uploadedCount} arquivos enviados\nCommit: ${data.commit.SHA?.slice(0, 7)}\nURL: ${data.commit.URL}`);
      }
    };

    const handleGitHubUploadProgress = (event: CustomEvent) => {
      console.log('📤 GitHub upload progress:', event.detail?.progress);
      // Could show progress indicator here if needed
    };

    const handleGitHubError = (event: CustomEvent) => {
      console.error('🚨 GitHub error:', event.detail);
      const error = event.detail?.error || 'Erro desconhecido no GitHub';
      alert(`❌ Erro GitHub:\n\n${error}`);
      setRefreshingFolders(false); // Stop loading state
    };

    // Add event listeners
    window.addEventListener('github-folders', handleGitHubFolders as EventListener);
    window.addEventListener('github-folders-progress', handleGitHubFoldersProgress as EventListener);
    window.addEventListener('github-upload', handleGitHubUpload as EventListener);
    window.addEventListener('github-upload-progress', handleGitHubUploadProgress as EventListener);
    window.addEventListener('github-error', handleGitHubError as EventListener);

    // Cleanup
    return () => {
      window.removeEventListener('github-folders', handleGitHubFolders as EventListener);
      window.removeEventListener('github-folders-progress', handleGitHubFoldersProgress as EventListener);
      window.removeEventListener('github-upload', handleGitHubUpload as EventListener);
      window.removeEventListener('github-upload-progress', handleGitHubUploadProgress as EventListener);
      window.removeEventListener('github-error', handleGitHubError as EventListener);
    };
  }, []);

  const handleTestCookie = useCallback(async () => {
    if (!settings.sessionCookie.trim()) {
      setCookieTestResult('Cookie vazio');
      return;
    }

    setTestingCookie(true);
    setCookieTestResult(null);

    try {
      await new Promise(resolve => setTimeout(resolve, 1500));
      setCookieTestResult('Cookie válido ✓');
      setTimeout(() => setCookieTestResult(null), 3000);
    } catch (error) {
      setCookieTestResult('Cookie inválido ✗');
      setTimeout(() => setCookieTestResult(null), 3000);
    } finally {
      setTestingCookie(false);
    }
  }, [settings.sessionCookie]);

  const handleRefreshFolders = useCallback(async () => {
    if (!settings.githubToken || !settings.githubRepo) {
      return;
    }

    setRefreshingFolders(true);
    
    try {
      if (isConnected) {
        const success = sendWSMessage({
          action: 'github_folders',
          data: {
            token: settings.githubToken,
            repo: settings.githubRepo,
            branch: settings.githubBranch || 'main',
            maxDepth: 3 // List folders up to 3 levels deep
          }
        });
        
        if (!success) {
          console.error('Falha ao enviar comando WebSocket - Conexão não está pronta');
          alert('WebSocket não está respondendo. Verifique se o backend está funcionando.');
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('Pastas do repositório atualizadas');
    } catch {
      console.error('Erro ao atualizar pastas do repositório');
    } finally {
      setRefreshingFolders(false);
    }
  }, [settings.githubToken, settings.githubRepo, isConnected, sendWSMessage]);

  // Handle root folder selection
  const handleRootFolderChange = useCallback((rootFolder: string) => {
    setSelectedRootFolder(rootFolder);
    updateRepoPath(rootFolder, selectedSubFolder);
  }, [selectedSubFolder]);

  // Handle subfolder selection  
  const handleSubFolderChange = useCallback((subFolder: string) => {
    setSelectedSubFolder(subFolder);
    updateRepoPath(selectedRootFolder, subFolder);
  }, [selectedRootFolder]);

  // Update the combined path
  const updateRepoPath = useCallback((rootFolder: string, subFolder: string) => {
    let finalPath = '';
    
    if (rootFolder && subFolder) {
      finalPath = `${rootFolder}/${subFolder}`;
    } else if (rootFolder) {
      finalPath = rootFolder;
    } else if (subFolder) {
      finalPath = subFolder;
    }
    
    handleInputChange('repoFolder', finalPath);
  }, [handleInputChange]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-gray-300">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 lg:gap-8">

        {/* --- COLUNA ESQUERDA (DIRETÓRIOS E HOST) --- */}
        <div className="xl:col-span-2 space-y-8">
          {/* Card Diretórios */}
          <Card className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl border border-gray-600 shadow-xl hover:shadow-2xl transition-all duration-300 h-fit">
            <CardHeader className="p-6 pb-4">
              <CardTitle className="text-xl font-bold text-white mb-3 border-b border-gray-600 pb-3 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                📁 Configuração de Diretórios
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-2">
            <div className="space-y-5">
              <div>
                <label className="text-sm font-semibold text-gray-200 mb-2 block">Pasta raiz dos mangás</label>
                <div className="flex mt-2">
                  <input 
                    type="text" 
                    value={settings.mangaRoot} 
                    onChange={e => handleInputChange('mangaRoot', e.target.value)} 
                    className="w-full bg-gray-700 border-gray-500 rounded-l-lg shadow-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 px-4 py-3 text-white placeholder-gray-400" 
                    placeholder="Digite o caminho completo (ex: D:\MOE\Obras\Gikamura\ManhAstro)"
                  />
                  <div className="flex">
                    <button 
                      onClick={() => handleSelectDirectory('mangaRoot')}
                      className="px-4 bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-500 hover:to-gray-600 transition-all duration-200 font-medium text-sm border-r border-gray-500"
                      title="Selecionar pasta manualmente"
                    >
                      Procurar
                    </button>
                    <button 
                      onClick={handleDirectDiscovery}
                      disabled={!isConnected || discovering}
                      className={`px-4 py-3 bg-gradient-to-r rounded-r-lg text-sm font-medium transition-all duration-200 ${
                        discovering 
                          ? 'from-yellow-600 to-orange-600 cursor-not-allowed' 
                          : 'from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600'
                      } disabled:from-gray-600 disabled:to-gray-700`}
                      title={discovering ? "Descoberta em andamento..." : "Descobrir estrutura hierárquica da pasta digitada"}
                    >
                      {discovering ? '🔍 Descobrindo...' : 'Descobrir'}
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="bg-gradient-to-r from-gray-900/50 to-gray-800/50 p-3 rounded-lg border border-gray-600/30">
                    <p className="text-gray-300 font-medium">🔍 Procurar</p>
                    <p className="text-gray-400 mt-1">Seleção simples de pasta</p>
                  </div>
                  <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 p-3 rounded-lg border border-blue-500/20">
                    <p className="text-blue-200 font-medium">🧠 Descobrir</p>
                    <p className="text-blue-300 mt-1">Descoberta direta do caminho digitado</p>
                  </div>
                </div>
                
                {/* Important Note */}
                <div className="mt-3 p-3 bg-gradient-to-r from-yellow-900/30 to-orange-900/30 rounded-lg border border-yellow-500/20">
                  <p className="text-yellow-200 font-medium text-sm">⚠️ Importante</p>
                  <p className="text-yellow-300/90 text-xs mt-1">
                    Por limitações de segurança do navegador, digite o <strong>caminho completo</strong> manualmente.
                  </p>
                  <p className="text-yellow-400/80 text-xs mt-1">
                    Exemplo: <code className="bg-gray-800 px-1 rounded">D:\MOE\Obras\Gikamura\ManhAstro</code>
                  </p>
                </div>
                
                {/* Path Type Selector */}
                <div className="mt-4 p-3 bg-gradient-to-r from-amber-900/20 to-orange-900/20 rounded-lg border border-amber-500/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-amber-200 font-medium text-sm">🔧 Tipo de Sistema</p>
                      <p className="text-amber-300/80 text-xs mt-1">Conversão automática de caminhos</p>
                    </div>
                    <div className="flex bg-gray-800 rounded-lg overflow-hidden border border-gray-600">
                      <button
                        onClick={() => handlePathTypeChange('linux')}
                        className={`px-3 py-2 text-xs font-medium transition-colors ${
                          pathType === 'linux' 
                            ? 'bg-blue-600 text-white' 
                            : 'text-gray-300 hover:text-white hover:bg-gray-700'
                        }`}
                      >
                        🐧 Linux/WSL
                      </button>
                      <button
                        onClick={() => handlePathTypeChange('windows')}
                        className={`px-3 py-2 text-xs font-medium transition-colors ${
                          pathType === 'windows' 
                            ? 'bg-blue-600 text-white' 
                            : 'text-gray-300 hover:text-white hover:bg-gray-700'
                        }`}
                      >
                        🪟 Windows
                      </button>
                    </div>
                  </div>
                  {pathType === 'linux' && (
                    <div className="mt-2 text-xs text-amber-300/70">
                      Caminhos serão convertidos para: <code className="bg-gray-800 px-1 rounded">/mnt/d/pasta</code>
                    </div>
                  )}
                  {pathType === 'windows' && (
                    <div className="mt-2 text-xs text-amber-300/70">
                      Caminhos serão mantidos como: <code className="bg-gray-800 px-1 rounded">D:\pasta</code>
                    </div>
                  )}
                </div>
                
                {/* Path Preview */}
                {settings.mangaRoot && (
                  <div className="mt-3 p-3 bg-gradient-to-r from-green-900/20 to-emerald-900/20 rounded-lg border border-green-500/20">
                    <p className="text-green-200 font-medium text-sm mb-2">📍 Preview do Caminho</p>
                    <div className="space-y-2">
                      <div>
                        <span className="text-xs text-gray-400">Original:</span>
                        <code className="block mt-1 bg-gray-800 px-2 py-1 rounded text-xs text-gray-300">{settings.mangaRoot}</code>
                      </div>
                      <div>
                        <span className="text-xs text-gray-400">Para o backend ({pathType}):</span>
                        <code className="block mt-1 bg-gray-800 px-2 py-1 rounded text-xs text-green-400">
                          {convertPath(settings.mangaRoot, 'windows', pathType)}
                        </code>
                      </div>
                    </div>
                  </div>
                )}
                
                <input
                  type="file"
                  ref={folderInputRef}
                  onChange={handleFolderChange}
                  {...({ webkitdirectory: '' } as any)}
                  style={{ display: 'none' }}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-200 mb-2 block">Pasta de saída dos metadados</label>
                <div className="flex mt-2">
                  <input 
                    type="text" 
                    value={settings.metadataOutput} 
                    onChange={e => handleInputChange('metadataOutput', e.target.value)} 
                    placeholder="Digite o caminho ou nome da pasta (ex: json, metadados)"
                    className="w-full bg-gray-700 border-gray-500 rounded-lg shadow-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 px-4 py-3 text-white placeholder-gray-400" 
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Pasta onde os arquivos JSON de metadados serão salvos
                </p>
              </div>
            </div>
            </CardContent>
          </Card>

          {/* Card Host de Upload */}
          <Card className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl border border-gray-600 shadow-xl hover:shadow-2xl transition-all duration-300">
            <CardHeader className="p-6 pb-4">
              <CardTitle className="text-xl font-bold text-white mb-3 border-b border-gray-600 pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 bg-gradient-to-br from-orange-500 to-red-500 rounded-full"></div>
                  🚀 Configuração de Upload
                </div>
              </CardTitle>
              <p className="text-gray-400 text-sm mt-2">Configure o serviço de hospedagem para upload das imagens</p>
            </CardHeader>
            <CardContent className="p-6 pt-2 space-y-6">
              {/* Host Selector */}
              <div>
                <label className="block text-sm font-semibold text-gray-200 mb-2">Serviço de Upload</label>
                <select
                  value={host}
                  onChange={e => handleHostChange(e.target.value as UploadHost)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                >
                  {UPLOAD_HOSTS.map(hostOption => (
                    <option key={hostOption} value={hostOption}>
                      {HOST_CONFIGS[hostOption].name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Dynamic Cookie/Auth Field */}
              <div>
                <label className="block text-sm font-semibold text-gray-200 mb-2">
                  {currentHostConfig.cookieLabel}
                  {currentHostConfig.requiresCookie && <span className="text-red-400 ml-1 text-xs">(obrigatório)</span>}
                </label>
                <div className="flex gap-2">
                  <input 
                    type="password" 
                    value={settings.sessionCookie} 
                    onChange={e => handleInputChange('sessionCookie', e.target.value)} 
                    placeholder={currentHostConfig.requiresCookie ? "Campo obrigatório..." : "Opcional..."} 
                    className={`flex-1 bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all ${
                      currentHostConfig.requiresCookie && !settings.sessionCookie ? 'border-red-500 focus:ring-red-500' : ''
                    }`}
                    required={currentHostConfig.requiresCookie}
                  />
                  <button 
                    onClick={handleTestCookie}
                    disabled={testingCookie || !settings.sessionCookie.trim()}
                    className="px-6 py-3 text-sm font-semibold bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
                  >
                    {testingCookie ? 'Testando...' : 'Validar'}
                  </button>
                </div>
                {cookieTestResult && (
                  <div className={`mt-3 p-3 rounded-lg border ${
                    cookieTestResult.includes('✓') 
                      ? 'bg-green-950/30 border-green-900/50 text-green-200' 
                      : 'bg-red-950/30 border-red-900/50 text-red-200'
                  }`}>
                    <p className="text-sm font-medium">{cookieTestResult}</p>
                  </div>
                )}
                <div className="mt-3 p-3 bg-orange-950/30 border border-orange-900/50 rounded-lg">
                  <p className="text-xs text-orange-200">
                    <span className="font-semibold">ℹ️ Dica:</span> {currentHostConfig.cookieHint}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <NumericStepper 
                  label="Workers simultâneos" 
                  value={settings.workers} 
                  onValueChange={val => handleInputChange('workers', val)}
                  min={1}
                  max={currentHostConfig.maxWorkers}
                />
                {currentHostConfig.supportsRateLimit ? (
                  <NumericStepper 
                    label="Rate limit (segundos)" 
                    value={settings.rateLimit} 
                    onValueChange={val => handleInputChange('rateLimit', val)}
                    min={currentHostConfig.minRateLimit}
                    max={currentHostConfig.maxRateLimit}
                  />
                ) : (
                  <div>
                    <label className="block text-sm font-semibold text-gray-400 mb-2">Rate limit</label>
                    <div className="p-3 bg-gray-900 border border-gray-600 rounded-lg text-center text-gray-500 text-sm">
                      Não suportado
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* --- COLUNA DIREITA (GITHUB E MODO DE ATUALIZAÇÃO) --- */}
        <div className="xl:col-span-1 space-y-8">
          {/* Card GitHub */}
          <Card className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl border border-gray-600 shadow-xl hover:shadow-2xl transition-all duration-300 h-fit">
            <CardHeader className="p-6 pb-4">
              <CardTitle className="text-xl font-bold text-white mb-3 border-b border-gray-600 pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full"></div>
                  🔗 GitHub Integration
                </div>
              </CardTitle>
              <p className="text-gray-400 text-sm mt-2">Configuração opcional para sincronização automática</p>
            </CardHeader>
            <CardContent className="p-6 pt-2 space-y-6">
              <div>
                <label className="block text-sm font-semibold text-gray-200 mb-2">Token de Acesso Pessoal</label>
                <input 
                  type="password" 
                  value={settings.githubToken} 
                  onChange={e => handleInputChange('githubToken', e.target.value)} 
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" 
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-200 mb-2">Repositório</label>
                <input 
                  type="text" 
                  value={settings.githubRepo} 
                  onChange={e => handleInputChange('githubRepo', e.target.value)} 
                  placeholder="usuario/repositorio" 
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-200 mb-2">Branch</label>
                <input 
                  type="text" 
                  value={settings.githubBranch} 
                  onChange={e => handleInputChange('githubBranch', e.target.value)} 
                  placeholder="main" 
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                />
              </div>
              <div className="space-y-4">
                <label className="block text-sm font-semibold text-gray-200 mb-2">Seleção de Pasta</label>
                
                {/* Root Folder Dropdown */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Pasta principal</label>
                  <div className="flex gap-2">
                    <select 
                      value={selectedRootFolder} 
                      onChange={e => handleRootFolderChange(e.target.value)} 
                      className="flex-1 bg-gray-700 border border-gray-600 rounded-l-lg px-4 py-3 text-white focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                    >
                      <option value="">Selecione uma pasta principal...</option>
                      {githubRootFolders.length > 0 ? (
                        githubRootFolders.map(folder => (
                          <option key={folder} value={folder}>{folder}</option>
                        ))
                      ) : (
                        <option value="hub" disabled>hub (exemplo)</option>
                      )}
                    </select>
                    <button 
                      onClick={handleRefreshFolders}
                      disabled={refreshingFolders}
                      className="px-4 py-3 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 disabled:from-gray-600 disabled:to-gray-700 text-sm font-medium transition-all duration-200 rounded-r-lg border-l border-green-500"
                      title="Atualizar lista de pastas do repositório"
                    >
                      {refreshingFolders ? '🔄' : '⟳'}
                    </button>
                  </div>
                </div>

                {/* Subfolder Dropdown (always available if subfolders exist) */}
                {allGithubSubFolders.length > 0 && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Subpasta (opcional)</label>
                    <select 
                      value={selectedSubFolder}
                      onChange={e => handleSubFolderChange(e.target.value)} 
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                    >
                      <option value="">Nenhuma subpasta</option>
                      {allGithubSubFolders.map(subFolder => (
                        <option key={subFolder} value={subFolder}>{subFolder}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Selected Path Display */}
                <div className="p-3 bg-gray-800/50 border border-gray-600 rounded-lg">
                  <p className="text-xs text-gray-400 mb-1">Caminho selecionado:</p>
                  <p className="text-sm text-green-400 font-mono">
                    {settings.repoFolder || 'Nenhuma pasta selecionada'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card Modo de Atualização */}
          <Card className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl border border-gray-600 shadow-xl hover:shadow-2xl transition-all duration-300">
            <CardHeader className="p-6 pb-4">
              <CardTitle className="text-xl font-bold text-white mb-3 border-b border-gray-600 pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full"></div>
                  ⚙️ Modo de Atualização
                </div>
              </CardTitle>
              <p className="text-gray-400 text-sm mt-2">Defina como os capítulos serão processados durante atualizações</p>
            </CardHeader>
            <CardContent className="p-6 pt-2">
              <div>
                <label className="block text-sm font-semibold text-gray-200 mb-2">Estratégia de atualização</label>
                <select 
                  value={settings.updateMode} 
                  onChange={e => handleInputChange('updateMode', e.target.value)} 
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                >
                  <option value="smart">🧠 Inteligente (recomendado)</option>
                  <option value="add">➕ Adicionar Novos</option>
                  <option value="replace">🔄 Substituir Todos</option>
                </select>
                <div className="mt-4 space-y-2">
                  <div className="p-3 bg-purple-950/30 border border-purple-900/50 rounded-lg">
                    <p className="text-sm text-purple-200 font-medium">🧠 Inteligente:</p>
                    <p className="text-xs text-purple-300 mt-1">Preserva ordem e índices, evita duplicados automaticamente</p>
                  </div>
                  <div className="p-3 bg-blue-950/30 border border-blue-900/50 rounded-lg">
                    <p className="text-sm text-blue-200 font-medium">➕ Adicionar:</p>
                    <p className="text-xs text-blue-300 mt-1">Mantém capítulos existentes, adiciona novos ao final</p>
                  </div>
                  <div className="p-3 bg-red-950/30 border border-red-900/50 rounded-lg">
                    <p className="text-sm text-red-200 font-medium">🔄 Substituir:</p>
                    <p className="text-xs text-red-300 mt-1">Remove todos os capítulos antigos, usa apenas os novos</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* --- BOTÃO SALVAR (FULL WIDTH) --- */}
        <div className="xl:col-span-3 flex justify-center pt-12">
          <Button 
            onClick={handleSaveSettings}
            variant="ghost" 
            className="px-16 py-5 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:via-purple-500 hover:to-pink-500 text-white font-bold text-xl rounded-2xl transition-all duration-300 shadow-2xl hover:shadow-purple-500/25 transform hover:-translate-y-2 hover:scale-105"
          >
            💾 Salvar Todas as Configurações
          </Button>
        </div>
      </div>
    </div>
  );
};
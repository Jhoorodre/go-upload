import React, { useMemo, useState, useEffect } from 'react';
import { Button } from '../ui/Button';
import { Progress } from '../ui/Progress';
import { LibraryIcon, SettingsIcon, ClockIcon, HostIcon, LogIcon, CloseIcon } from '../ui/Icons';
import { QueueDashboard } from './ProgressDashboard';
import { LibrarySelect } from '../ui/LibrarySelect';
import { UPLOAD_HOSTS } from '../../types';
import { useAppContext } from '../../contexts/AppContext';
import type { ControlSidebarProps, Page, UploadableFile } from '../../types';

export const ControlSidebar: React.FC<ControlSidebarProps> = ({ 
  host, 
  setHost, 
  files, 
  page, 
  setPage, 
  onRemoveFile, 
  onClearFiles 
}) => {
  const { savedLibraries, currentLibrary, setCurrentLibrary, sendWSMessage } = useAppContext();
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Debug: verificar mudanças na biblioteca atual
  useEffect(() => {
    console.log('📚 ControlSidebar: currentLibrary mudou para:', currentLibrary);
  }, [currentLibrary]);

  // Handle library change with auto-discovery
  const handleLibraryChange = (libraryId: string) => {
    console.log('🔄 ControlSidebar: handleLibraryChange chamado com:', libraryId);
    const selectedLibrary = savedLibraries.find(lib => lib.id === libraryId);
    console.log('📚 Biblioteca encontrada:', selectedLibrary);
    setCurrentLibrary(selectedLibrary || null);
    
    // If a library is selected, trigger discovery for that path
    if (selectedLibrary) {
      console.log('🔍 Iniciando descoberta para:', selectedLibrary.path);
      // Clear localStorage discovery path to prevent auto-save modal
      localStorage.removeItem('last-discovery-path');
      
      sendWSMessage({
        action: 'discover_library',
        data: {
          fullPath: selectedLibrary.path,
        },
        requestId: `scan_switch_${Date.now()}`
      });
    }
  };

  const overallProgress = useMemo(() => {
    if (files.length === 0) return 0;
    const totalProgress = files.reduce((sum: number, file: UploadableFile) => sum + file.progress, 0);
    return totalProgress / files.length;
  }, [files]);

  // Handle mobile detection
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (!mobile) {
        setIsOpen(false);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const getPageIcon = (pageName: Page) => {
    switch (pageName) {
      case 'library': return <LibraryIcon />;
      case 'settings': return <SettingsIcon />;
      case 'progress': return <ClockIcon />;
      case 'logs': return <LogIcon />;
      default: return <LibraryIcon />;
    }
  };

  const handleNavClick = (targetPage: Page) => {
    setPage(targetPage);
  };

  return (
    <>
      {/* Mobile Toggle Button */}
      {isMobile && (
        <button
          onClick={() => setIsOpen(true)}
          className="sidebar-toggle"
          aria-label="Abrir menu"
        >
          <LibraryIcon />
        </button>
      )}

      {/* Sidebar */}
      <aside className={`manga-uploader-sidebar ${isOpen ? 'open' : ''}`}>
        <header className="sidebar-header">
          <div className="flex items-center justify-between">
            <h1>Manga Uploader Pro</h1>
            {isMobile && (
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-gray-700 rounded"
                aria-label="Fechar menu"
              >
                <CloseIcon />
              </button>
            )}
          </div>
          <span className="sidebar-subtitle">Sistema de Upload</span>
        </header>
        
        <nav className="sidebar-nav" role="menu">
          <button
            onClick={() => handleNavClick('library')}
            className={`nav-item ${page === 'library' ? 'nav-item--active' : ''}`}
            role="menuitem"
            tabIndex={0}
            aria-current={page === 'library' ? 'page' : undefined}
          >
            <LibraryIcon />
            <span>Biblioteca</span>
          </button>
          
          <div className="nav-item nav-item--host" role="menuitem">
            <LibraryIcon />
            <span className="flex-1">Scan:</span>
            <LibrarySelect
              value={currentLibrary?.id || ''}
              onChange={handleLibraryChange}
              options={savedLibraries.map(lib => ({ id: lib.id, name: lib.name }))}
              placeholder="Biblioteca Padrão"
            />
          </div>
          
          <button
            onClick={() => handleNavClick('settings')}
            className={`nav-item ${page === 'settings' ? 'nav-item--active' : ''}`}
            role="menuitem"
            tabIndex={0}
            aria-current={page === 'settings' ? 'page' : undefined}
          >
            <SettingsIcon />
            <span>Configurações</span>
          </button>
          
          <button
            onClick={() => handleNavClick('progress')}
            className={`nav-item ${page === 'progress' ? 'nav-item--active' : ''}`}
            role="menuitem"
            tabIndex={0}
            aria-current={page === 'progress' ? 'page' : undefined}
          >
            <ClockIcon />
            <span>Progresso</span>
          </button>
          
          <button
            onClick={() => handleNavClick('logs')}
            className={`nav-item ${page === 'logs' ? 'nav-item--active' : ''}`}
            role="menuitem"
            tabIndex={0}
            aria-current={page === 'logs' ? 'page' : undefined}
          >
            <LogIcon />
            <span>Logs</span>
          </button>
          
          <div className="nav-item nav-item--host" role="menuitem">
            <HostIcon />
            <span className="flex-1">Host:</span>
            <select 
              value={host} 
              onChange={(e) => setHost(e.target.value)}
              aria-label="Selecionar serviço de hospedagem"
              className="bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600 focus:border-indigo-500 focus:outline-none"
              tabIndex={0}
            >
              {UPLOAD_HOSTS.map(hostOption => (
                <option key={hostOption} value={hostOption} className="bg-gray-800">
                  {hostOption}
                </option>
              ))}
            </select>
          </div>
      </nav>
      
        <div className="sidebar-section">
          <div className="section-header">
            <h3>Fila de Upload ({files.length})</h3>
            {files.length > 0 && (
              <Button 
                onClick={onClearFiles}
                variant="ghost" 
                className="text-xs text-gray-500 hover:text-red-400 px-2 py-1"
              >
                Limpar Tudo
              </Button>
            )}
          </div>
          
          <div className="section-content">
            <div className="queue-container">
              {files.length === 0 ? (
                <div className="empty-state">
                  <p>Nenhum arquivo na fila de upload.</p>
                </div>
              ) : (
                <div className="space-y-2 mt-2">
                  {overallProgress > 0 && (
                    <div className="mb-4">
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>Progresso Geral</span>
                        <span>{Math.round(overallProgress)}%</span>
                      </div>
                      <Progress value={overallProgress} className="h-2" />
                    </div>
                  )}
                  
                  <QueueDashboard 
                    files={files} 
                    onRemoveFile={onRemoveFile} 
                    onClearFiles={onClearFiles}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Overlay */}
      {isMobile && isOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}
    </>
  );
};
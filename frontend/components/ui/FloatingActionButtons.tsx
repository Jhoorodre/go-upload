import React, { useState } from 'react';
import { Button } from './Button';
import { ActionUploadIcon, ActionEditIcon, ActionGithubIcon } from './Icons';
import { useAppContext } from '../../contexts/AppContext';
import { useGitHubSettings } from '../../hooks/useGitHubSettings';
import { getUniqueMangaIds, groupFilesByManga } from '../../utils/mangaJSON';
import type { FloatingActionButtonProps, FloatingActionButtonsProps } from '../../types';

const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({ 
  onClick, 
  disabled, 
  icon, 
  text, 
  colorClass, 
  statusText,
  isLoading = false
}) => (
  <Button
    onClick={onClick}
    disabled={disabled || isLoading}
    variant="ghost"
    className={`floating-action-btn ${disabled ? 'floating-action-btn--disabled' : ''} ${isLoading ? 'floating-action-btn--loading' : ''}`}
  >
    <div className={`floating-action-btn__icon ${colorClass}`}>
      {isLoading ? (
        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
      ) : (
        icon
      )}
    </div>
    <span className="floating-action-btn__text">{statusText || text}</span>
  </Button>
);

export const FloatingActionButtons: React.FC<FloatingActionButtonsProps> = ({ 
  onUpload, 
  onEdit, 
  onGithub, 
  uploadDisabled, 
  githubStatus,
  isInMangaDetailView = false
}) => {
  const { files, selection, sendWSMessage, isConnected, handleLog } = useAppContext();
  const { settings: githubSettings, isConfigured: isGithubConfigured } = useGitHubSettings();
  const [isUploading, setIsUploading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isGithubbing, setIsGithubbing] = useState(false);

  // Handle batch upload with progress tracking
  const handleBatchUpload = async () => {
    if (!isConnected || files.length === 0) return;
    
    setIsUploading(true);
    
    // Group files by manga to track unique works and their details
    const uniqueMangaIds = getUniqueMangaIds(files);
    const filesByManga = groupFilesByManga(files);
    
    handleLog({
      type: 'info',
      message: `Iniciando upload em lote: ${files.length} arquivos de ${uniqueMangaIds.length} obra(s)`,
      category: 'batch'
    });
    
    // Log detailed breakdown per manga
    for (const mangaId of uniqueMangaIds) {
      const mangaFiles = filesByManga[mangaId];
      const chaptersSet = new Set(mangaFiles.map(f => f.chapterId));
      const mangaTitle = mangaFiles[0]?.mangaTitle || mangaId;
      
      handleLog({
        type: 'info',
        message: `📚 ${mangaTitle}: ${mangaFiles.length} arquivos, ${chaptersSet.size} capítulo(s) → JSON individual será gerado`,
        category: 'batch'
      });
    }
    
    try {
      // Send batch upload command via WebSocket (includes images + individual JSON generation)
      const success = sendWSMessage({
        action: 'batch_upload',
        includeJSON: true, // Flag to indicate individual JSONs should be generated per manga
        generateIndividualJSONs: true, // New flag for individual JSON generation
        mangaList: uniqueMangaIds, // List of unique manga IDs for JSON generation
        updateMode: githubSettings.updateMode, // Use update mode from settings
        files: files.map(f => ({
          manga: f.mangaTitle,
          mangaId: f.mangaId,
          chapter: f.chapterId,
          fileName: f.file.name,
          fileSize: f.file.size
        }))
      });
      
      if (!success) {
        handleLog({
          type: 'error',
          message: 'Falha ao iniciar upload batch - WebSocket desconectado',
          category: 'batch'
        });
        return;
      }
      
      handleLog({
        type: 'info',
        message: `🚀 Upload iniciado: cada obra terá seu JSON individual em manga_library/{mangaId}/metadata.json`,
        category: 'batch'
      });
      
      // onUpload will be called by WebSocket response
      await onUpload();
      
    } catch (error) {
      handleLog({
        type: 'error',
        message: `Erro no batch upload: ${error}`,
        category: 'batch'
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Handle metadata editing for selected works
  const handleEdit = async () => {
    const selectedPaths = selection.getSelectedPaths();
    const selectedCount = selectedPaths.length;
    
    setIsEditing(true);
    
    handleLog({
      type: 'info',
      message: `Iniciando edição de metadados: ${selectedCount} obras selecionadas`,
      category: 'system'
    });
    
    try {
      await onEdit();
      
      handleLog({
        type: 'success',
        message: `Edição de metadados concluída para ${selectedCount} obras`,
        category: 'system'
      });
    } catch (error) {
      handleLog({
        type: 'error',
        message: `Erro na edição de metadados: ${error}`,
        category: 'system'
      });
    } finally {
      setIsEditing(false);
    }
  };

  // Handle GitHub upload of selected works' JSON files
  const handleGithubUpload = async () => {
    if (!isConnected || !hasSelectedWorks || !isGithubConfigured) return;
    
    const selectedWorks = selection.getSelectedPaths();
    
    setIsGithubbing(true);
    
    handleLog({
      type: 'info',
      message: `Iniciando upload GitHub: ${selectedWorks.length} JSONs para ${githubSettings.githubRepo} (modo: ${githubSettings.updateMode})`,
      category: 'system'
    });
    
    // Log detalhado das obras selecionadas e modo de atualização
    const modeDescriptions = {
      'smart': 'Inteligente - preserva ordem e índices, evita duplicados',
      'add': 'Adicionar - mantém capítulos existentes, adiciona novos ao final',
      'replace': 'Substituir - remove capítulos antigos, usa apenas os novos'
    };
    
    handleLog({
      type: 'info',
      message: `Modo de atualização: ${modeDescriptions[githubSettings.updateMode as keyof typeof modeDescriptions] || githubSettings.updateMode}`,
      category: 'system'
    });
    
    selectedWorks.forEach((work, index) => {
      handleLog({
        type: 'info',
        message: `[${index + 1}/${selectedWorks.length}] Preparando JSON: ${work}`,
        category: 'system'
      });
    });
    
    try {
      // Send GitHub upload command via WebSocket with selected works and settings
      const success = sendWSMessage({
        action: 'github_upload',
        selectedWorks: selectedWorks,
        uploadType: 'selected_metadata', // Upload JSON files of selected works only
        githubSettings: {
          token: githubSettings.githubToken,
          repo: githubSettings.githubRepo,
          branch: githubSettings.githubBranch,
          folder: githubSettings.repoFolder,
          updateMode: githubSettings.updateMode
        }
      });
      
      if (success) {
        await onGithub();
        
        handleLog({
          type: 'success',
          message: `Upload GitHub concluído: ${selectedWorks.length} JSONs enviados para ${githubSettings.githubRepo}/${githubSettings.repoFolder} (modo: ${githubSettings.updateMode})`,
          category: 'system'
        });
      } else {
        handleLog({
          type: 'error',
          message: 'Falha ao enviar JSONs para GitHub - WebSocket desconectado',
          category: 'system'
        });
      }
      
    } catch (error) {
      handleLog({
        type: 'error',
        message: `Erro no upload GitHub: ${error}`,
        category: 'system'
      });
    } finally {
      setIsGithubbing(false);
    }
  };

  const selectedPaths = selection.getSelectedPaths();
  const hasSelectedWorks = selectedPaths.length > 0 || isInMangaDetailView;
  const uploadCount = files.length;
  const canUpload = isConnected && uploadCount > 0 && !uploadDisabled;

  return (
    <div className="floating-actions">
      <FloatingActionButton 
        onClick={handleBatchUpload}
        disabled={!canUpload}
        isLoading={isUploading}
        icon={<ActionUploadIcon />} 
        text={uploadCount > 1 ? `UPLOAD (${uploadCount})` : "UPLOAD"}
        colorClass="bg-blue-600 hover:bg-blue-700" 
        statusText={isUploading ? 'Enviando...' : undefined}
      />
      
      <FloatingActionButton 
        onClick={handleEdit}
        disabled={!hasSelectedWorks}
        isLoading={isEditing}
        icon={<ActionEditIcon />} 
        text={isInMangaDetailView ? "EDITAR" : (hasSelectedWorks ? `EDITAR (${selectedPaths.length})` : "EDITAR")}
        colorClass="bg-orange-600 hover:bg-orange-700" 
        statusText={isEditing ? 'Carregando...' : undefined}
      />
      
      <FloatingActionButton 
        onClick={handleGithubUpload}
        disabled={!isConnected || !hasSelectedWorks || !isGithubConfigured || !!githubStatus}
        isLoading={isGithubbing}
        icon={<ActionGithubIcon />} 
        text={hasSelectedWorks ? `GITHUB (${selectedPaths.length})` : "GITHUB"} 
        colorClass="bg-green-600 hover:bg-green-700" 
        statusText={isGithubbing ? 'Enviando JSONs...' : githubStatus || undefined}
      />
    </div>
  );
};
import React, { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Progress } from '../ui/Progress';
import { useAppContext } from '../../contexts/AppContext';
import { useMangaSync } from '../../hooks/useMangaSync';
import { 
  FolderOpen, 
  Folder, 
  Image, 
  ChevronRight, 
  ChevronDown,
  Play,
  CheckSquare,
  Square,
  Grid3X3,
  List,
  Upload,
  Search
} from 'lucide-react';
import { cn } from '../../utils';
import type { Library, HierarchyMetadata, ViewMode, FilterMode } from '../../types';

interface LibraryNode {
  key: string;
  name: string;
  path: string[];
  type: 'folder' | 'chapter';
  level: number;
  fileCount: number;
  isExpanded?: boolean;
  isSelected?: boolean;
  hasFiles: boolean;
  children?: LibraryNode[];
}

interface Chapter { 
  id: number; 
  title: string; 
  imagesCount: number; 
}

interface Manga { 
  id: string; 
  title: string; 
  description: string; 
  artist: string; 
  author: string; 
  status: string; 
  cover: string; 
  chapters: Chapter[]; 
}

type Selection = Record<string, Set<number>>;

interface LibraryExplorerProps {
  library: Library | null;
  metadata?: HierarchyMetadata | null;
  selectedPaths: Set<string>;
  onSelectionChange: (paths: Set<string>) => void;
  onUpload: (path: string[], files: string[]) => void;
  onBatchUpload?: (paths: string[]) => void;
  className?: string;
  mangas?: Manga[];
  onViewManga?: (mangaId: string) => void;
  mode?: 'hierarchy' | 'library';
}

interface MangaLibraryProps {
  mangas: Manga[];
  onViewManga: (mangaId: string) => void;
  onAddFiles?: (selection: Selection, files: FileList) => void;
  library?: Library | null;
  sortOrder?: 'asc' | 'desc';
}

export function LibraryExplorer({
  library,
  metadata,
  selectedPaths,
  onSelectionChange,
  onUpload,
  onBatchUpload,
  className,
  mangas,
  onViewManga,
  mode = 'hierarchy'
}: LibraryExplorerProps) {
  
  // If in library mode, render MangaLibrary instead
  if (mode === 'library' && mangas && onViewManga) {
    return <MangaLibrary mangas={mangas} onViewManga={onViewManga} library={library} />;
  }
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');

  const hasSelectedChildren = useCallback((path: string): boolean => {
    return Array.from(selectedPaths).some(selected => 
      selected.startsWith(path + '/') && selected !== path
    );
  }, [selectedPaths]);

  // Convert library to flat node structure
  const nodes = useMemo(() => {
    if (!library) return [];

    const result: LibraryNode[] = [];
    
    const processNode = (
      obj: Library,
      parentPath: string[] = [],
      level: number = 0
    ) => {
      Object.entries(obj).forEach(([key, value]) => {
        if (key === '_files') return;

        const currentPath = [...parentPath, key];
        const pathStr = currentPath.join('/');
        const isExpanded = expandedNodes.has(pathStr);
        const isSelected = selectedPaths.has(pathStr);
        
        // Count files recursively
        let fileCount = 0;
        const countFiles = (node: Library): number => {
          let count = 0;
          Object.entries(node).forEach(([k, v]) => {
            if (k === '_files' && Array.isArray(v)) {
              count += v.length;
            } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
              count += countFiles(v as Library);
            }
          });
          return count;
        };
        
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          fileCount = countFiles(value as Library);
          const hasFiles = (value as Library)['_files'] !== undefined;
          const nodeType = hasFiles ? 'chapter' : 'folder';
          
          // Apply filters
          if (filterMode === 'with-files' && fileCount === 0) return;
          if (filterMode === 'selected' && !isSelected && !hasSelectedChildren(pathStr)) return;
          
          const node: LibraryNode = {
            key: pathStr,
            name: key,
            path: currentPath,
            type: nodeType,
            level,
            fileCount,
            isExpanded,
            isSelected,
            hasFiles
          };
          
          result.push(node);
          
          // Recursively process children if expanded or in grid mode (show all)
          if (isExpanded || viewMode === 'grid') {
            processNode(value as Library, currentPath, level + 1);
          }
        }
      });
    };

    processNode(library);
    return result;
  }, [library, expandedNodes, selectedPaths, filterMode, viewMode, hasSelectedChildren]);

  const toggleExpansion = useCallback((path: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const toggleSelection = useCallback((path: string) => {
    const newSelection = new Set(selectedPaths);
    if (newSelection.has(path)) {
      newSelection.delete(path);
    } else {
      newSelection.add(path);
    }
    onSelectionChange(newSelection);
  }, [selectedPaths, onSelectionChange]);

  const handleUpload = useCallback((node: LibraryNode) => {
    if (!library) return;
    
    // Navigate to the node and get files
    let current: Library = library;
    for (const part of node.path) {
      current = current[part] as Library;
    }
    
    const files = (current['_files'] as string[]) || [];
    onUpload(node.path, files);
  }, [library, onUpload]);

  const handleBatchUpload = useCallback(() => {
    const selectedArray = Array.from(selectedPaths);
    if (selectedArray.length > 0) {
      onBatchUpload?.(selectedArray);
    }
  }, [selectedPaths, onBatchUpload]);

  const getLevelInfo = (level: number) => {
    if (!metadata) return `Nível ${level}`;
    return metadata.levelMap[level.toString()] || `Nível ${level}`;
  };

  const selectAll = useCallback(() => {
    const chaptersWithFiles = nodes
      .filter(node => node.type === 'chapter' && node.fileCount > 0)
      .map(node => node.key);
    onSelectionChange(new Set(chaptersWithFiles));
  }, [nodes, onSelectionChange]);

  const clearSelection = useCallback(() => {
    onSelectionChange(new Set());
  }, [onSelectionChange]);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Toolbar */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Stats */}
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {metadata && (
                <>
                  <span>{metadata.stats.totalChapters} capítulos</span>
                  <span>{metadata.stats.totalImages} imagens</span>
                  <span>{selectedPaths.size} selecionados</span>
                </>
              )}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2">
              {/* View Mode */}
              <div className="flex rounded-md border">
                <Button
                  size="sm"
                  variant={viewMode === 'tree' ? 'default' : 'ghost'}
                  onClick={() => setViewMode('tree')}
                  className="rounded-r-none"
                >
                  <List className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === 'grid' ? 'default' : 'ghost'}
                  onClick={() => setViewMode('grid')}
                  className="rounded-l-none"
                >
                  <Grid3X3 className="h-4 w-4" />
                </Button>
              </div>

              {/* Filter */}
              <select
                value={filterMode}
                onChange={(e) => setFilterMode(e.target.value as FilterMode)}
                className="px-3 py-1.5 text-sm border rounded-md bg-background"
              >
                <option value="all">Todos</option>
                <option value="with-files">Com Arquivos</option>
                <option value="selected">Selecionados</option>
              </select>

              {/* Selection Controls */}
              <Button size="sm" variant="outline" onClick={selectAll}>
                Selecionar Todos
              </Button>
              <Button size="sm" variant="outline" onClick={clearSelection}>
                Limpar
              </Button>

              {/* Batch Upload */}
              {selectedPaths.size > 0 && (
                <Button size="sm" variant="success" onClick={handleBatchUpload}>
                  <Upload className="h-4 w-4" />
                  Upload {selectedPaths.size}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Library Content */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            Explorador da Biblioteca
            {metadata && (
              <Badge variant="secondary">
                {metadata.rootLevel}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className={cn(
            "h-96 overflow-auto",
            viewMode === 'tree' ? "space-y-1" : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-2"
          )}>
            <AnimatePresence>
              {nodes.map((node, index) => (
                <motion.div
                  key={node.key}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ delay: index * 0.02 }}
                  className={cn(
                    viewMode === 'tree' 
                      ? "flex items-center gap-2 p-2 rounded-md hover:bg-accent transition-colors"
                      : "flex flex-col p-3 rounded-lg border hover:bg-accent transition-colors min-h-[120px]",
                    node.isSelected && "bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800"
                  )}
                  style={viewMode === 'tree' ? { marginLeft: `${node.level * 16}px` } : {}}
                >
                  {viewMode === 'tree' ? (
                    // Tree Layout (Horizontal)
                    <>
                      {/* Expand/Collapse Button */}
                      {node.type === 'folder' && (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => toggleExpansion(node.key)}
                          className="h-6 w-6 p-0"
                        >
                          {node.isExpanded ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                        </Button>
                      )}

                      {/* Selection Checkbox */}
                      {node.type === 'chapter' && node.hasFiles && (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => toggleSelection(node.key)}
                          className="h-6 w-6 p-0"
                        >
                          {node.isSelected ? (
                            <CheckSquare className="h-3 w-3" />
                          ) : (
                            <Square className="h-3 w-3" />
                          )}
                        </Button>
                      )}

                      {/* Icon */}
                      <div className="flex-shrink-0">
                        {node.type === 'chapter' ? (
                          <Image className="h-4 w-4 text-green-600" />
                        ) : node.isExpanded ? (
                          <FolderOpen className="h-4 w-4 text-blue-600" />
                        ) : (
                          <Folder className="h-4 w-4 text-gray-600" />
                        )}
                      </div>

                      {/* Name and Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{node.name}</span>
                          {node.fileCount > 0 && (
                            <Badge variant="count" size="sm">
                              {node.fileCount}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {getLevelInfo(node.level)}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-1">
                        {node.type === 'chapter' && node.hasFiles && (
                          <Button
                            size="xs"
                            variant="success"
                            onClick={() => handleUpload(node)}
                          >
                            <Play className="h-3 w-3" />
                            Upload
                          </Button>
                        )}
                      </div>
                    </>
                  ) : (
                    // Grid Layout (Card - Vertical)
                    <>
                      {/* Header with Icon and Level Badge */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {node.type === 'chapter' ? (
                            <Image className="h-5 w-5 text-green-600" />
                          ) : (
                            <Folder className="h-5 w-5 text-blue-600" />
                          )}
                          <Badge variant="outline" size="sm">
                            {getLevelInfo(node.level)}
                          </Badge>
                        </div>
                        
                        {/* Selection indicator */}
                        {node.type === 'chapter' && node.hasFiles && (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => toggleSelection(node.key)}
                            className="h-6 w-6 p-0"
                          >
                            {node.isSelected ? (
                              <CheckSquare className="h-3 w-3" />
                            ) : (
                              <Square className="h-3 w-3" />
                            )}
                          </Button>
                        )}
                      </div>

                      {/* Name */}
                      <div className="flex-1">
                        <div className="font-medium text-sm truncate mb-1">
                          {node.name}
                        </div>
                        {node.fileCount > 0 && (
                          <div className="text-xs text-muted-foreground">
                            {node.fileCount} arquivos
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex gap-1 mt-2">
                        {node.type === 'chapter' && node.hasFiles && (
                          <Button
                            size="xs"
                            variant="success"
                            onClick={() => handleUpload(node)}
                            className="w-full"
                          >
                            <Play className="h-3 w-3" />
                            Upload
                          </Button>
                        )}
                      </div>
                    </>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      {selectedPaths.size > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                {selectedPaths.size} item(s) selecionado(s) para upload
              </div>
              <Progress 
                value={0} 
                className="w-32"
                size="sm"
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// === MANGA LIBRARY COMPONENTS ===

const Checkbox = ({ checked, onChange, title, className = "" }: { checked: boolean; onChange: () => void; title: string; className?: string }) => (
    <input type="checkbox" checked={checked} onChange={onChange} title={title} className={`w-5 h-5 rounded bg-gray-900/70 border-gray-500 text-indigo-600 focus:ring-indigo-500 cursor-pointer ${className}`} />
);

// Wrapper component that loads real cover from JSON
const MangaCoverCard = React.memo(({ manga, onView }: { manga: Manga; onView: () => void }) => {
    const { sendWSMessage, isConnected, handleLog } = useAppContext();
    const { manga: syncedManga } = useMangaSync({ 
        manga, 
        mangaPath: (manga as any)._path,
        onLog: handleLog,
        sendWSMessage,
        isConnected
    });
    
    // Use cover from JSON if available, fallback to original cover
    const coverUrl = syncedManga.cover || manga.cover || '/placeholder-cover.jpg';
    
    return (
        <div onClick={onView} className="bg-gray-800 rounded-xl shadow-md flex flex-col overflow-hidden border border-transparent hover:border-indigo-500 cursor-pointer group transform hover:-translate-y-1 transition-all duration-300">
            <img 
                src={coverUrl} 
                alt={manga.title} 
                className="w-full h-auto object-cover aspect-[2/3]"
                onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.src = '/placeholder-cover.jpg';
                }}
            />
            <div className="p-2">
                <h3 className="font-medium text-white text-sm truncate group-hover:text-indigo-400">{manga.title}</h3>
                <p className="text-xs text-gray-400">{manga.chapters.length} cap.</p>
            </div>
        </div>
    );
});

const SelectableChapterItem = React.memo(({ chapter, isSelected, onChapterSelect }: { chapter: Chapter; isSelected: boolean; onChapterSelect: () => void }) => (
    <div onClick={onChapterSelect} className={`flex items-center p-2 rounded-md cursor-pointer transition-colors ${isSelected ? 'bg-indigo-900/50' : 'hover:bg-gray-700/50'}`}>
        <Checkbox checked={isSelected} onChange={onChapterSelect} title={`Selecionar Capítulo ${chapter.title}`} />
        <span className="ml-3 flex-1 font-medium text-gray-300">Capítulo {chapter.title}</span>
    </div>
));

const SelectableMangaCard = React.memo(({ manga, isSelected, onMangaSelect, onChapterSelect, onViewManga }: { manga: Manga; isSelected: boolean; onMangaSelect: (shouldSelect: boolean) => void; onChapterSelect: (chapterId: number, shouldSelect: boolean) => void; onViewManga: () => void }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    
    return (
        <div className={`bg-gray-800 rounded-xl shadow-md flex flex-col overflow-hidden border ${isSelected ? 'border-indigo-500' : 'border-gray-700'}`}>
            <div className="p-3 flex items-center space-x-3">
                <Checkbox checked={isSelected} onChange={() => onMangaSelect(!isSelected)} title={`Selecionar mangá ${manga.title}`} />
                <div className="flex-1 min-w-0 cursor-pointer" onClick={onViewManga}><h3 className="font-semibold text-white truncate hover:text-indigo-400">{manga.title}</h3><p className="text-xs text-gray-400">{isSelected ? 'Selecionado' : 'Não selecionado'} - {manga.chapters.length} cap.</p></div>
                <button onClick={() => setIsExpanded(!isExpanded)} className={`p-1 rounded-full hover:bg-gray-700 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}><ChevronDown className="w-4 h-4" /></button>
            </div>
            {isExpanded && (<div className="border-t border-gray-700 p-2 space-y-1 max-h-48 overflow-y-auto">{manga.chapters.map(ch => (<SelectableChapterItem key={ch.id} chapter={ch} isSelected={isSelected} onChapterSelect={() => onChapterSelect(ch.id, !isSelected)} />))}</div>)}
        </div>
    );
});

export function MangaLibrary({ mangas, onViewManga, library, sortOrder = 'asc' }: Omit<MangaLibraryProps, 'onAddFiles'>): React.ReactElement {
    const { selection: globalSelection } = useAppContext();
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Convert library structure to manga format if available
    const actualMangas = useMemo(() => {
        if (library) {
            console.log('DEBUG: Estrutura da biblioteca:', library);
            const convertedMangas: Manga[] = [];
            let mangaIndex = 0;
            
            // Traverse the library structure to find manga titles
            Object.entries(library).forEach(([key, value]) => {
                if (typeof value === 'object' && !Array.isArray(value)) {
                    // Check if this is a manga metadata object
                    const mangaData = value as any;
                    console.log(`DEBUG: Processando manga "${key}":`, mangaData);
                    if (mangaData._type === 'manga' && mangaData._path) {
                        // This is a manga with metadata - extract chapters from the structure
                        const chapters: Chapter[] = [];
                        let chapterIndex = 1;
                        
                        // Look for chapters in the manga structure
                        Object.entries(mangaData).forEach(([chapterKey, chapterValue]) => {
                            console.log(`DEBUG: Verificando chave "${chapterKey}":`, chapterValue);
                            if (Array.isArray(chapterValue) && chapterKey !== '_path' && chapterKey !== '_type') {
                                // This is a chapter with pages
                                chapters.push({
                                    id: chapterIndex++,
                                    title: chapterKey,
                                    imagesCount: chapterValue.length
                                });
                            }
                        });
                        
                        // Gerar mangaID estável baseado no nome da pasta
                        // Manter caracteres acentuados para processamento no backend
                        const sanitizedFolderName = key.replace(/[\/\\:*?"<>|]/g, '_');
                        const mangaId = `auto-${sanitizedFolderName}`;
                        
                        const manga = {
                            id: mangaId,
                            title: key,
                            description: `Descoberto em: ${mangaData._path}`,
                            artist: 'Descoberto',
                            author: 'Descoberto',
                            cover: `https://placehold.co/200x300/1f2937/9ca3af?text=${encodeURIComponent(key.substring(0, 10))}`,
                            status: 'ongoing',
                            chapters: chapters
                        };
                        convertedMangas.push(manga);
                    } else {
                        // Try the old structure (chapters nested)
                        const chapters: Chapter[] = [];
                        let chapterIndex = 1;
                        
                        // Look for chapters in this manga
                        Object.entries(value).forEach(([chapterKey, chapterValue]) => {
                            if (Array.isArray(chapterValue)) {
                                // This is a chapter with pages
                                chapters.push({
                                    id: chapterIndex++,
                                    title: chapterKey,
                                    imagesCount: chapterValue.length
                                });
                            }
                        });
                        
                        if (chapters.length > 0) {
                            // Gerar mangaID estável baseado no nome da pasta
                            // Manter caracteres acentuados para processamento no backend
                            const sanitizedFolderName = key.replace(/[\/\\:*?"<>|]/g, '_');
                            const mangaId = `auto-${sanitizedFolderName}`;
                            
                            const manga = {
                                id: mangaId,
                                title: key,
                                description: `Descoberto com ${chapters.length} capítulos`,
                                artist: 'Descoberto',
                                author: 'Descoberto',
                                cover: `https://placehold.co/200x300/1f2937/9ca3af?text=${encodeURIComponent(key.substring(0, 10))}`,
                                status: 'ongoing',
                                chapters
                            };
                            convertedMangas.push(manga);
                        }
                    }
                }
            });
            
            return convertedMangas.length > 0 ? convertedMangas : mangas;
        }
        return mangas;
    }, [library, mangas]);

    const handleMangaSelect = (mangaId: string, shouldSelect: boolean) => {
        if (library) {
            const manga = actualMangas.find(m => m.id === mangaId);
            if (manga) {
                const mangaPath = findMangaPath(manga.title, library);
                if (mangaPath) {
                    if (shouldSelect && !globalSelection.isSelected(mangaPath)) {
                        // Selecionar o mangá no sistema global
                        console.log('✅ Selecionando mangá:', manga.title, 'path:', mangaPath);
                        globalSelection.togglePath(mangaPath);
                    } else if (!shouldSelect && globalSelection.isSelected(mangaPath)) {
                        // Desselecionar o mangá no sistema global
                        console.log('❌ Desselecionando mangá:', manga.title, 'path:', mangaPath);
                        globalSelection.togglePath(mangaPath);
                    }
                }
            }
        }
    };
    
    // Função auxiliar para encontrar o caminho de um mangá na biblioteca
    const findMangaPath = (mangaTitle: string, lib: Library): string | null => {
        for (const [key, value] of Object.entries(lib)) {
            if (key === mangaTitle && typeof value === 'object') {
                return key;
            }
        }
        return null;
    };
    
    const handleChapterSelect = (mangaId: string, _chapterId: number, shouldSelect: boolean) => {
        // Para a nova arquitetura, tratamos capítulos como parte do mangá
        // Então selecionar um capítulo = selecionar o mangá todo
        handleMangaSelect(mangaId, shouldSelect);
    };

    // Filter and sort mangas based on search query and sort order
    const filteredMangas = useMemo(() => {
        let filtered = actualMangas;
        
        // Apply search filter
        if (searchQuery.trim()) {
            filtered = actualMangas.filter(manga => 
                manga.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                manga.artist.toLowerCase().includes(searchQuery.toLowerCase()) ||
                manga.author.toLowerCase().includes(searchQuery.toLowerCase())
            );
        }
        
        // Apply sorting
        const sorted = [...filtered].sort((a, b) => {
            if (sortOrder === 'asc') {
                return a.title.localeCompare(b.title);
            } else {
                return b.title.localeCompare(a.title);
            }
        });
        
        return sorted;
    }, [searchQuery, actualMangas, sortOrder]);


    return (
        <div>
            {/* Header with search and mode toggle */}
            <div className="flex flex-col sm:flex-row gap-4 mb-4">
                {/* Search bar */}
                <div className="flex-1 relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Search className="w-4 h-4" />
                    </div>
                    <input
                        type="text"
                        placeholder="Buscar por título, artista ou autor..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                    />
                </div>
                
                {/* Mode toggle button */}
                <button 
                    onClick={() => {
                        const newMode = !isSelectionMode;
                        setIsSelectionMode(newMode);
                        
                        // Dispara evento personalizado para comunicar mudança de modo
                        const event = new CustomEvent('selectionModeToggle', {
                            detail: { isActive: newMode }
                        });
                        window.dispatchEvent(event);
                        console.log('🎯 Evento selectionModeToggle disparado:', newMode);
                    }} 
                    className="px-4 py-2 text-sm font-medium text-white bg-gray-700 rounded-lg hover:bg-gray-600 whitespace-nowrap transition-colors"
                >
                    {isSelectionMode ? 'Sair do Modo de Seleção' : 'Ativar Modo de Seleção'}
                </button>
            </div>
            
            {isSelectionMode ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredMangas.map((manga) => 
                            <SelectableMangaCard 
                                key={manga.id} 
                                manga={manga} 
                                isSelected={library ? (() => {
                                    const mangaPath = findMangaPath(manga.title, library);
                                    return mangaPath ? globalSelection.isSelected(mangaPath) : false;
                                })() : false} 
                                onMangaSelect={(shouldSelect) => handleMangaSelect(manga.id, shouldSelect)} 
                                onChapterSelect={(chapterId, shouldSelect) => handleChapterSelect(manga.id, chapterId, shouldSelect)} 
                                onViewManga={() => onViewManga(manga.id)} 
                            />
                        )}
                    </div>
            ) : (
                <>
                    {filteredMangas.length > 0 ? (
                        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-4">
                            {filteredMangas.map((manga) => 
                                <MangaCoverCard 
                                    key={manga.id} 
                                    manga={manga} 
                                    onView={() => onViewManga(manga.id)} 
                                />
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                            <Search className="w-12 h-12 mb-4" />
                            <h3 className="text-lg font-medium mb-2">Nenhum mangá encontrado</h3>
                            <p className="text-sm text-center max-w-md">
                                {searchQuery.trim() ? 
                                    `Não encontramos resultados para "${searchQuery.trim()}". Tente outro termo de busca.` : 
                                    'Nenhum mangá disponível na biblioteca.'
                                }
                            </p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
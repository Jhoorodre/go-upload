import React, { useState, useCallback, useMemo, useEffect } from 'react';
import type { Library, Selection } from '../types';

interface UseSelectionOptions {
  library?: Library | null;
  onSelectionChange?: (selection: Selection) => void;
}

export function useSelection({ library, onSelectionChange }: UseSelectionOptions = {}) {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);

  // Calculate file count and size for a given path (including discovered mangas)
  const getPathStats = useCallback((path: string, lib: Library): { files: number; size: number } => {
    const pathParts = path.split('/').filter(Boolean);
    let current = lib;
    
    // Navigate to the path
    for (const part of pathParts) {
      if (current[part] && typeof current[part] === 'object') {
        current = current[part] as Library;
      } else {
        return { files: 0, size: 0 };
      }
    }
    
    // Check if this is a discovered manga
    const currentValue = current as any;
    if (currentValue._type === 'manga' && currentValue._path) {
      // For discovered mangas, estimate some files
      return { files: 1, size: 1000000 }; // 1 manga = 1 "file" of 1MB
    }
    
    // Count files recursively for traditional structure
    let files = 0;
    let size = 0; // We don't have actual file sizes, so this is a placeholder
    
    const countFiles = (node: Library) => {
      Object.entries(node).forEach(([key, value]) => {
        if (key === '_files' && Array.isArray(value)) {
          files += value.length;
          size += value.length * 1000000; // Assume average 1MB per image
        } else if (typeof value === 'object') {
          countFiles(value as Library);
        }
      });
    };
    
    countFiles(current);
    return { files, size };
  }, []);

  // Calculate selection statistics
  const selectionStats = useMemo(() => {
    if (!library) {
      return {
        selectedPaths,
        selectAll,
        selectionCount: 0,
        selectedFiles: 0,
        selectedSize: '0 B'
      };
    }
    
    let totalFiles = 0;
    let totalSize = 0;
    
    selectedPaths.forEach(path => {
      const stats = getPathStats(path, library);
      totalFiles += stats.files;
      totalSize += stats.size;
    });
    
    // Format size
    const formatSize = (bytes: number): string => {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };
    
    return {
      selectedPaths,
      selectAll,
      selectionCount: selectedPaths.size,
      selectedFiles: totalFiles,
      selectedSize: formatSize(totalSize)
    };
  }, [selectedPaths, selectAll, library, getPathStats]);

  // Toggle path selection
  const togglePath = useCallback((path: string) => {
    setSelectedPaths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  }, []);

  // Select multiple paths
  const selectPaths = useCallback((paths: string[]) => {
    setSelectedPaths(prev => {
      const newSet = new Set(prev);
      paths.forEach(path => newSet.add(path));
      return newSet;
    });
  }, []);

  // Set paths directly (replaces current selection)
  const setPaths = useCallback((paths: string[] | Set<string>) => {
    const pathsArray = Array.isArray(paths) ? paths : Array.from(paths);
    setSelectedPaths(new Set(pathsArray));
  }, []);

  // Deselect multiple paths
  const deselectPaths = useCallback((paths: string[]) => {
    setSelectedPaths(prev => {
      const newSet = new Set(prev);
      paths.forEach(path => newSet.delete(path));
      return newSet;
    });
  }, []);

  // Clear all selections
  const clearSelection = useCallback(() => {
    setSelectedPaths(new Set());
    setSelectAll(false);
  }, []);

  // Select all items with files (chapters) OR discovered mangas
  const selectAllWithFiles = useCallback(() => {
    if (!library) return;
    
    const pathsWithFiles: string[] = [];
    
    const findPathsWithFiles = (node: Library, currentPath: string[] = []) => {
      Object.entries(node).forEach(([key, value]) => {
        if (key === '_files' && Array.isArray(value) && value.length > 0) {
          // Traditional path with files
          pathsWithFiles.push(currentPath.join('/'));
        } else if (key !== '_files' && typeof value === 'object') {
          const nodeValue = value as any;
          // Check if this is a discovered manga (has _type and _path but no _files)
          if (nodeValue._type === 'manga' && nodeValue._path && !nodeValue._files) {
            // This is a discovered manga - add it directly
            pathsWithFiles.push([...currentPath, key].join('/') || key);
          } else {
            // Continue searching in subdirectories
            findPathsWithFiles(value as Library, [...currentPath, key]);
          }
        }
      });
    };
    
    findPathsWithFiles(library);
    console.log('🎯 selectAllWithFiles encontrou paths:', pathsWithFiles);
    setSelectedPaths(new Set(pathsWithFiles));
    setSelectAll(true);
  }, [library]);

  // Check if a path is selected
  const isSelected = useCallback((path: string): boolean => {
    return selectedPaths.has(path);
  }, [selectedPaths]);

  // Check if any child paths are selected
  const hasSelectedChildren = useCallback((path: string): boolean => {
    for (const selectedPath of selectedPaths) {
      if (selectedPath.startsWith(path + '/')) {
        return true;
      }
    }
    return false;
  }, [selectedPaths]);

  // Check if all child paths are selected
  const areAllChildrenSelected = useCallback((path: string, lib: Library): boolean => {
    if (!library) return false;
    
    const childPaths: string[] = [];
    const pathParts = path.split('/').filter(Boolean);
    let current = lib;
    
    // Navigate to the path
    for (const part of pathParts) {
      if (current[part] && typeof current[part] === 'object') {
        current = current[part] as Library;
      } else {
        return false;
      }
    }
    
    // Find all child paths with files
    const findChildPaths = (node: Library, currentPath: string[] = pathParts) => {
      Object.entries(node).forEach(([key, value]) => {
        if (key === '_files' && Array.isArray(value) && value.length > 0) {
          childPaths.push(currentPath.join('/'));
        } else if (key !== '_files' && typeof value === 'object') {
          findChildPaths(value as Library, [...currentPath, key]);
        }
      });
    };
    
    findChildPaths(current);
    
    // Check if all child paths are selected
    return childPaths.every(childPath => selectedPaths.has(childPath));
  }, [selectedPaths, library]);

  // Get selected paths as array
  const getSelectedPaths = useCallback((): string[] => {
    return Array.from(selectedPaths);
  }, [selectedPaths]);

  // Get paths that have files (chapters) OR are discovered mangas
  const getPathsWithFiles = useCallback((): string[] => {
    if (!library) return [];
    
    const pathsWithFiles: string[] = [];
    
    const findPathsWithFiles = (node: Library, currentPath: string[] = []) => {
      Object.entries(node).forEach(([key, value]) => {
        if (key === '_files' && Array.isArray(value) && value.length > 0) {
          // Traditional path with files
          pathsWithFiles.push(currentPath.join('/'));
        } else if (key !== '_files' && typeof value === 'object') {
          const nodeValue = value as any;
          // Check if this is a discovered manga (has _type and _path but no _files)
          if (nodeValue._type === 'manga' && nodeValue._path && !nodeValue._files) {
            // This is a discovered manga - add it directly
            pathsWithFiles.push([...currentPath, key].join('/') || key);
          } else {
            // Continue searching in subdirectories
            findPathsWithFiles(value as Library, [...currentPath, key]);
          }
        }
      });
    };
    
    findPathsWithFiles(library);
    console.log('🎯 getPathsWithFiles retornando:', pathsWithFiles);
    return pathsWithFiles;
  }, [library]);

  // Invert selection (select all unselected items with files, deselect all selected items)
  const invertSelection = useCallback(() => {
    if (!library) return;
    
    const allPathsWithFiles = getPathsWithFiles();
    const currentlySelected = Array.from(selectedPaths);
    
    // Find paths that are NOT currently selected
    const unselectedPaths = allPathsWithFiles.filter(path => !selectedPaths.has(path));
    
    // Set selection to the unselected paths (inverting the selection)
    console.log('🔄 Invertendo seleção:');
    console.log('  - Anteriormente selecionados:', currentlySelected);
    console.log('  - Agora selecionados:', unselectedPaths);
    
    setSelectedPaths(new Set(unselectedPaths));
    setSelectAll(unselectedPaths.length === allPathsWithFiles.length);
  }, [library, selectedPaths, getPathsWithFiles]);

  // Notify selection changes
  useEffect(() => {
    onSelectionChange?.(selectionStats);
  }, [selectionStats, onSelectionChange]);

  return {
    selection: selectionStats,
    togglePath,
    selectPaths,
    setPaths,
    deselectPaths,
    clearSelection,
    selectAllWithFiles,
    invertSelection,
    isSelected,
    hasSelectedChildren,
    areAllChildrenSelected,
    getSelectedPaths,
    getPathsWithFiles,
    selectionStats
  };
}


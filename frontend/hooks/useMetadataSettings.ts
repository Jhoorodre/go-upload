import { useState, useEffect } from 'react';
import { storage } from '../utils';

interface MetadataSettings {
  metadataOutput: string;
  metadataOutputWSL: string;
}

// Converter caminho Windows para WSL
const convertWindowsToWSL = (windowsPath: string): string => {
  if (!windowsPath) return windowsPath;
  
  // Converter D:\ para /mnt/d/ (case-insensitive)
  return windowsPath
    .replace(/^([A-Z]):\\/i, (_, drive) => `/mnt/${drive.toLowerCase()}/`)
    .replace(/\\/g, '/');
};

// Converter caminho WSL para Windows  
const convertWSLToWindows = (wslPath: string): string => {
  if (!wslPath) return wslPath;
  
  // Converter /mnt/d/ para D:\
  return wslPath
    .replace(/^\/mnt\/([a-z])\//i, (_, drive) => `${drive.toUpperCase()}:\\`)
    .replace(/\//g, '\\');
};

export const useMetadataSettings = () => {
  const [metadataOutput, setMetadataOutput] = useState<string>('');
  const [metadataOutputWSL, setMetadataOutputWSL] = useState<string>('');

  useEffect(() => {
    const savedSettings = storage.get('manga-uploader-settings', {});
    const originalPath = savedSettings.metadataOutput || 'json';
    
    setMetadataOutput(originalPath);
    
    // Se parece ser um caminho Windows, converter para WSL
    if (originalPath.match(/^[A-Z]:\\/i)) {
      setMetadataOutputWSL(convertWindowsToWSL(originalPath));
    } else if (originalPath.match(/^\/mnt\/[a-z]\//i)) {
      // Já é WSL, manter como está
      setMetadataOutputWSL(originalPath);
    } else {
      // Caminho relativo, manter como está
      setMetadataOutputWSL(originalPath);
    }
  }, []);

  return {
    metadataOutput,        // Para mostrar no frontend (formato original)
    metadataOutputWSL,     // Para enviar ao backend (formato WSL)
    convertWindowsToWSL,
    convertWSLToWindows
  };
};
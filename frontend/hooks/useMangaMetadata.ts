import { useState, useEffect, useCallback } from 'react';

interface MangaJSON {
  title: string;
  description: string;
  artist: string;
  author: string;
  cover: string;
  status: string;
  chapters: Record<string, any>;
}

interface MangaMetadata {
  [mangaId: string]: MangaJSON;
}

export function useMangaMetadata() {
  const [metadata, setMetadata] = useState<MangaMetadata>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Função para carregar um JSON específico
  const loadMangaJSON = useCallback(async (mangaId: string): Promise<MangaJSON | null> => {
    try {
      // Tenta buscar diretamente do backend usando o mangaId
      const response = await fetch(`http://localhost:8080/api/manga/${mangaId}/metadata`);
      if (response.ok) {
        return await response.json();
      }

      return null;
    } catch (err) {
      console.error(`Erro ao carregar metadata para ${mangaId}:`, err);
      return null;
    }
  }, []);

  // Função para carregar todos os JSONs disponíveis
  const loadAllMetadata = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Busca lista de JSONs disponíveis do backend
      const response = await fetch('http://localhost:8080/api/json/list');
      if (!response.ok) {
        throw new Error('Falha ao buscar lista de JSONs');
      }

      const jsonFiles: string[] = await response.json();
      const newMetadata: MangaMetadata = {};

      // Carrega cada JSON
      for (const filename of jsonFiles) {
        try {
          const jsonResponse = await fetch(`http://localhost:8080/api/json/${filename}`);
          if (jsonResponse.ok) {
            const data = await jsonResponse.json();
            
            // Gera mangaId a partir do nome do arquivo
            const baseName = filename.replace(/\.json$/, '');
            const sanitizedName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
            const mangaId = `auto-${sanitizedName}`;
            
            newMetadata[mangaId] = data;
          }
        } catch (err) {
          console.error(`Erro ao carregar ${filename}:`, err);
        }
      }

      setMetadata(newMetadata);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
      console.error('Erro ao carregar metadados:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Função para sincronizar metadata de um mangá específico
  const syncMangaMetadata = useCallback(async (mangaId: string) => {
    const data = await loadMangaJSON(mangaId);
    if (data) {
      setMetadata(prev => ({
        ...prev,
        [mangaId]: data
      }));
    }
  }, [loadMangaJSON]);

  // Auto-carregar na inicialização
  useEffect(() => {
    loadAllMetadata();
  }, [loadAllMetadata]);

  // Função para verificar se um mangá tem metadados
  const hasMangaMetadata = useCallback((mangaId: string): boolean => {
    return mangaId in metadata;
  }, [metadata]);

  // Função para obter metadados de um mangá
  const getMangaMetadata = useCallback((mangaId: string): MangaJSON | null => {
    return metadata[mangaId] || null;
  }, [metadata]);

  return {
    metadata,
    loading,
    error,
    loadAllMetadata,
    syncMangaMetadata,
    hasMangaMetadata,
    getMangaMetadata
  };
}

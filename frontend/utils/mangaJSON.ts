import type { Manga, MangaJSON, UploadableFile } from '../types';

/**
 * Generates individual JSON for a manga based on its data and uploaded files
 */
export const generateMangaJSON = (
  manga: Manga, 
  uploadedFiles: UploadableFile[],
  groupName: string = 'scan_group'
): MangaJSON => {
  // Filter files for this specific manga
  const mangaFiles = uploadedFiles.filter(file => file.mangaId === manga.id);
  
  // Group files by chapter
  const chapterFiles = mangaFiles.reduce((acc, file) => {
    const chapterKey = file.chapterId.toString().padStart(3, '0'); // Format as "001", "002", etc.
    
    if (!acc[chapterKey]) {
      acc[chapterKey] = [];
    }
    
    if (file.url) { // Only include files that have been successfully uploaded
      acc[chapterKey].push(file.url);
    }
    
    return acc;
  }, {} as { [key: string]: string[] });

  // Build chapters object in the expected format
  const chapters: MangaJSON['chapters'] = {};
  
  for (const [chapterIndex, urls] of Object.entries(chapterFiles)) {
    const chapterData = manga.chapters.find(ch => ch.id.toString().padStart(3, '0') === chapterIndex);
    
    chapters[chapterIndex] = {
      title: chapterData?.title || `Chapter ${parseInt(chapterIndex)}`,
      volume: Math.ceil(parseInt(chapterIndex) / 10).toString(), // Estimate volume based on chapter
      last_updated: new Date().toISOString(),
      groups: {
        [groupName]: urls.sort() // Sort URLs to maintain order
      }
    };
  }

  return {
    title: manga.title,
    description: manga.description || '',
    artist: manga.artist || '',
    author: manga.author || '',
    cover: manga.cover || '',
    status: manga.status || '',
    group: manga.group || '',
    chapters: chapters
  };
};

/**
 * Gets the file path where the JSON should be stored for a manga
 */
export const getMangaJSONPath = (mangaId: string): string => {
  return `manga_library/${mangaId}/metadata.json`;
};

/**
 * Validates that a manga JSON has all required fields
 */
export const validateMangaJSON = (json: any): json is MangaJSON => {
  return (
    typeof json === 'object' &&
    typeof json.title === 'string' &&
    typeof json.description === 'string' &&
    typeof json.artist === 'string' &&
    typeof json.author === 'string' &&
    typeof json.cover === 'string' &&
    typeof json.status === 'string' &&
    typeof json.group === 'string' &&
    typeof json.chapters === 'object'
  );
};

/**
 * Groups uploadable files by manga ID
 */
export const groupFilesByManga = (files: UploadableFile[]): { [mangaId: string]: UploadableFile[] } => {
  return files.reduce((acc, file) => {
    if (!acc[file.mangaId]) {
      acc[file.mangaId] = [];
    }
    acc[file.mangaId].push(file);
    return acc;
  }, {} as { [mangaId: string]: UploadableFile[] });
};

/**
 * Gets unique manga IDs from a list of uploadable files
 */
export const getUniqueMangaIds = (files: UploadableFile[]): string[] => {
  return [...new Set(files.map(file => file.mangaId))];
};
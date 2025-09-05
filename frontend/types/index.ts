// Core types
export type Library = { [key: string]: Library | string[] };

export type SavedLibrary = {
  id: string;
  name: string;
  path: string;
  lastAccessed: number;
  description?: string;
};

export type LogEntry = { 
  type: 'info' | 'success' | 'error' | 'warning'; 
  message: string;
  timestamp?: string;
  category?: 'upload' | 'discovery' | 'system' | 'batch';
};

export type HierarchyMetadata = {
  rootLevel: string;
  maxDepth: number;
  totalLevels: number;
  levelMap: { [key: string]: string };
  stats: {
    totalDirectories: number;
    totalImages: number;
    totalChapters: number;
  };
  levelMultiplicity?: { [key: string]: number };
  chapterPaths?: string[];
  detectionMethod?: string;
};

// Batch processing types
export type BatchOperation = {
  id: string;
  type: 'collection' | 'partial' | 'selective';
  status: 'pending' | 'running' | 'completed' | 'paused' | 'error';
  progress: BatchProgress;
  options: BatchOptions;
  startTime?: number;
  endTime?: number;
  errorMessage?: string;
};

export type BatchProgress = {
  totalFiles: number;
  uploadedFiles: number;
  errorFiles: number;
  skippedFiles: number;
  currentSpeed: string;
  avgSpeed: string;
  eta: string;
  percentage: number;
};

export type BatchOptions = {
  skipExisting: boolean;
  enablePersistence: boolean;
  parallelLimit: number;
  retryAttempts: number;
  chunkSize: number;
};

// Collection processing
export type CollectionInfo = {
  name: string;
  basePath: string;
  totalObras: number;
  totalChapters: number;
  totalFiles: number;
  estimatedSize: string;
};

// WebSocket message types
export type WSMessage = {
  action: 'discover' | 'discover_library' | 'upload' | 'process_collection' | 'batch_upload' | 'pause' | 'resume' | 'cancel' | 'github_folders' | 'github_upload' | 'edit_metadata' | 'save_metadata' | 'load_metadata' | 'search_anilist' | 'select_anilist_result' | 'get_anilist_config' | 'update_anilist_config' | 'reset_anilist_config';
  selectedWorks?: string[];
  uploadType?: string;
  includeJSON?: boolean;
  generateIndividualJSONs?: boolean;
  mangaList?: string[];
  githubSettings?: {
    token: string;
    repo: string;
    branch: string;
    folder: string;
    updateMode: string;
  };
  [key: string]: any;
};

export type WSResponse = {
  status: 'discover_complete' | 'complete' | 'error' | 'collection_progress' | 'batch_progress' | 'paused' | 'resumed' | 'json_generated' | 'json_complete' | 'metadata_saved' | 'metadata_loaded' | 'load_metadata' | 'discovery_progress' | 'search_anilist_complete' | 'search_progress' | 'anilist_selection_complete' | 'anilist_fetch_progress' | 'anilist_error' | 'config_retrieved' | 'config_updated' | 'config_reset';
  payload?: any;
  data?: any;
  file?: string;
  url?: string;
  error?: string;
  metadata?: HierarchyMetadata;
  mangaId?: string;
  mangaTitle?: string;
  jsonPath?: string;
  progress?: {
    current: number;
    total: number;
    percentage: string;
    currentFile: string;
  };
};

// UI State types
export type ViewMode = 'tree' | 'grid' | 'list';
export type SortMode = 'name' | 'size' | 'modified' | 'type';
export type FilterMode = 'all' | 'with-files' | 'empty' | 'selected';

export type UIState = {
  viewMode: ViewMode;
  sortMode: SortMode;
  filterMode: FilterMode;
  showDetails: boolean;
  compactMode: boolean;
  darkMode: boolean;
};

// Selection types
export type Selection = {
  selectedPaths: Set<string>;
  selectAll: boolean;
  selectionCount: number;
  selectedFiles: number;
  selectedSize: string;
};

// Upload hosts
export const UPLOAD_HOSTS = [
  'catbox', 'gofile', 'imagechest', 'imgbb', 'imgbox', 'imghippo',
  'imgpile', 'imgur', 'lensdump', 'pixeldrain', 'dropbox',
] as const;

export type UploadHost = typeof UPLOAD_HOSTS[number];

// Host-specific configurations
export type HostConfig = {
  name: string;
  requiresCookie: boolean;
  cookieLabel: string;
  cookieHint: string;
  supportsRateLimit: boolean;
  defaultWorkers: number;
  defaultRateLimit: number;
  maxWorkers: number;
  minRateLimit: number;
  maxRateLimit: number;
};

export const HOST_CONFIGS: Record<UploadHost, HostConfig> = {
  'catbox': {
    name: 'Catbox',
    requiresCookie: false,
    cookieLabel: 'User Hash (Opcional)',
    cookieHint: 'Para uploads permanentes: Copie o user hash do site catbox.moe',
    supportsRateLimit: true,
    defaultWorkers: 3,
    defaultRateLimit: 1,
    maxWorkers: 999,
    minRateLimit: 0,
    maxRateLimit: 999
  },
  'imgbox': {
    name: 'ImgBox',
    requiresCookie: true,
    cookieLabel: 'Session Cookie',
    cookieHint: 'Login no imgbox.com → Dev Tools (F12) → Application → Cookies → `_imgbox_session`',
    supportsRateLimit: true,
    defaultWorkers: 2,
    defaultRateLimit: 2,
    maxWorkers: 999,
    minRateLimit: 0,
    maxRateLimit: 999
  },
  'imgur': {
    name: 'Imgur',
    requiresCookie: false,
    cookieLabel: 'Client ID (Opcional)',
    cookieHint: 'Para mais uploads: Registre app em imgur.com/register/api',
    supportsRateLimit: true,
    defaultWorkers: 5,
    defaultRateLimit: 1,
    maxWorkers: 999,
    minRateLimit: 0,
    maxRateLimit: 999
  },
  'gofile': {
    name: 'GoFile',
    requiresCookie: false,
    cookieLabel: 'API Token (Opcional)',
    cookieHint: 'Para gerenciar uploads: Obtenha token em gofile.io',
    supportsRateLimit: false,
    defaultWorkers: 1,
    defaultRateLimit: 3,
    maxWorkers: 999,
    minRateLimit: 0,
    maxRateLimit: 999
  },
  'imagechest': {
    name: 'ImageChest',
    requiresCookie: false,
    cookieLabel: 'Auth Token (Opcional)',
    cookieHint: 'Para uploads privados: Token de imagechest.com',
    supportsRateLimit: true,
    defaultWorkers: 3,
    defaultRateLimit: 2,
    maxWorkers: 999,
    minRateLimit: 0,
    maxRateLimit: 999
  },
  'imgbb': {
    name: 'ImgBB',
    requiresCookie: true,
    cookieLabel: 'API Key',
    cookieHint: 'Obrigatório: Registre em api.imgbb.com para obter chave API',
    supportsRateLimit: true,
    defaultWorkers: 2,
    defaultRateLimit: 1,
    maxWorkers: 999,
    minRateLimit: 0,
    maxRateLimit: 999
  },
  'imghippo': {
    name: 'ImgHippo',
    requiresCookie: false,
    cookieLabel: 'Session (Opcional)',
    cookieHint: 'Para uploads sem limite: Login em imghippo.com',
    supportsRateLimit: true,
    defaultWorkers: 4,
    defaultRateLimit: 1,
    maxWorkers: 999,
    minRateLimit: 0,
    maxRateLimit: 999
  },
  'imgpile': {
    name: 'ImgPile',
    requiresCookie: false,
    cookieLabel: 'User Token (Opcional)',
    cookieHint: 'Para organizar uploads: Token de imgpile.com',
    supportsRateLimit: true,
    defaultWorkers: 3,
    defaultRateLimit: 2,
    maxWorkers: 999,
    minRateLimit: 0,
    maxRateLimit: 999
  },
  'lensdump': {
    name: 'LensDump',
    requiresCookie: false,
    cookieLabel: 'Session (Opcional)',
    cookieHint: 'Para histórico de uploads: Login em lensdump.com',
    supportsRateLimit: true,
    defaultWorkers: 2,
    defaultRateLimit: 3,
    maxWorkers: 999,
    minRateLimit: 0,
    maxRateLimit: 999
  },
  'pixeldrain': {
    name: 'PixelDrain',
    requiresCookie: false,
    cookieLabel: 'API Key (Opcional)',
    cookieHint: 'Para uploads maiores: Obtenha chave em pixeldrain.com',
    supportsRateLimit: true,
    defaultWorkers: 4,
    defaultRateLimit: 1,
    maxWorkers: 999,
    minRateLimit: 0,
    maxRateLimit: 999
  },
  'dropbox': {
    name: 'Dropbox',
    requiresCookie: true,
    cookieLabel: 'Access Token',
    cookieHint: 'Obrigatório: Token OAuth2 de dropbox.com/developers',
    supportsRateLimit: false,
    defaultWorkers: 1,
    defaultRateLimit: 5,
    maxWorkers: 999,
    minRateLimit: 0,
    maxRateLimit: 999
  }
};

// Additional types from page.tsx
export interface Chapter { 
  id: number; 
  title: string; 
  imagesCount: number; 
}

export interface Manga {
  id: string;
  title: string;
  description?: string;
  artist?: string;
  author?: string;
  group?: string;
  status?: string;
  cover?: string;
  chapters?: Chapter[];
  chapterCount?: number;
}

// JSON format for each individual manga
export interface MangaJSON {
  title: string;
  description: string;
  artist: string;
  author: string;
  cover: string;
  status: string;
  group: string;
  chapters: {
    [chapterIndex: string]: {
      title: string;
      volume: string;
      last_updated: string;
      groups: {
        [groupName: string]: string[]; // Array of image URLs
      };
    };
  };
}

export interface UploadableFile { 
  file: File; 
  id: string; 
  mangaId: string; 
  mangaTitle: string; 
  chapterId: number; 
  progress: number; 
  status: 'pending' | 'uploading' | 'success' | 'error'; 
  url?: string;
  startTime?: number;
  endTime?: number;
  duration?: string;
  error?: string;
}

export type Page = 'library' | 'settings' | 'progress' | 'logs';
export type MangaSelection = Record<string, Set<number>>;

// Component prop types
export interface FileProgressProps {
  uploadableFile: UploadableFile;
  onRemove: () => void;
}

export interface FloatingActionButtonProps {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  text: string;
  colorClass: string;
  statusText?: string;
  isLoading?: boolean;
}

export interface FloatingActionButtonsProps {
  onUpload: () => void;
  onEdit: () => void;
  onGithub: () => void;
  uploadDisabled: boolean;
  githubStatus?: string | null;
  isInMangaDetailView?: boolean;
}

export interface MetadataEditorModalProps {
  metadata: Record<string, unknown>;
  onClose: () => void;
  onSave: (metadata: Record<string, unknown>) => void;
  mangaID?: string; // Optional mangaID for consistent filename generation
}

export interface NumericStepperProps {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
}

export interface CheckboxProps {
  checked: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  title?: string;
  className?: string;
}

export interface MangaDetailPageProps {
  manga: Manga;
  onBack: () => void;
  onEditMetadata: (syncedManga?: Manga) => void;
  onSyncedDataChange?: (syncedData: Manga) => void;
}

export interface ControlSidebarProps {
  host: string;
  setHost: (host: string) => void;
  files: UploadableFile[];
  page: Page;
  setPage: (page: Page) => void;
  onRemoveFile: (fileId: string) => void;
  onClearFiles: () => void;
}

export interface AppContextType {
  files: UploadableFile[];
  isUploading: boolean;
  host: string;
  setHost: (host: string) => void;
  addFilesToQueue: (selection: MangaSelection, selectedFiles: FileList) => void;
  handleRemoveFile: (fileId: string) => void;
  handleClearFiles: () => void;
  handleUpload: () => void;
  handleLog: (log: LogEntry) => void;
  clearLogs: () => void;
  operations: BatchOperation[];
  activeOperation: BatchOperation | null;
  library: Library | null;
  setLibrary: React.Dispatch<React.SetStateAction<Library | null>>;
  logs: LogEntry[];
  isConnected: boolean;
  sendWSMessage: (message: WSMessage) => boolean;
  wsStats: () => any;
  triggerDiscovery: (libraryPath: string) => void;
  // Library management
  savedLibraries: SavedLibrary[];
  currentLibrary: SavedLibrary | null;
  setCurrentLibrary: (library: SavedLibrary | null) => void;
  addSavedLibrary: (library: Omit<SavedLibrary, 'id' | 'lastAccessed'>) => void;
  removeSavedLibrary: (libraryId: string) => void;
  updateLibraryAccess: (libraryId: string) => void;
  // Library confirmation modal
  showLibraryConfirmModal: boolean;
  pendingLibrary: { path: string; detectedName: string } | null;
  confirmLibrary: (customName?: string) => void;
  declineLibrary: () => void;
  batchProcessor: {
    createOperation: (type: BatchOperation['type'], options: BatchOptions, totalFiles: number) => BatchOperation;
    startOperation: (operation: BatchOperation) => void;
    updateProgress: (operationId: string, update: Partial<BatchProgress>) => void;
    completeOperation: (operationId: string) => void;
    pauseOperation: (operationId: string) => void;
    resumeOperation: (operationId: string) => void;
    cancelOperation: (operationId: string) => void;
    clearCompletedOperations: () => void;
    operations: BatchOperation[];
    activeOperation: BatchOperation | null;
  };
  selection: {
    togglePath: (path: string) => void;
    selectPaths: (paths: string[]) => void;
    clearSelection: () => void;
    selectAllWithFiles: () => void;
    invertSelection: () => void;
    isSelected: (path: string) => boolean;
    getSelectedPaths: () => string[];
    selectionStats: Record<string, unknown>;
  };
  isHydrated: boolean;
}
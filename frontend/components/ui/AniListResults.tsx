'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { SearchResult, AniListMetadata } from '@/types/anilist';
import { LazyImage } from './LazyImage';

interface AniListResultsProps {
  results: SearchResult[];
  isLoading: boolean;
  onSelectResult: (result: SearchResult) => void;
  selectedMetadata: AniListMetadata | null;
  preferredLanguage?: 'romaji' | 'english' | 'native' | 'synonyms';
}

// Constantes para status mapping para evitar recriação
const STATUS_COLORS = {
  'FINISHED': 'bg-emerald-500/20 text-emerald-400 border-emerald-400/30',
  'RELEASING': 'bg-blue-500/20 text-blue-400 border-blue-400/30',
  'NOT_YET_RELEASED': 'bg-amber-500/20 text-amber-400 border-amber-400/30',
  'CANCELLED': 'bg-red-500/20 text-red-400 border-red-400/30',
  'HIATUS': 'bg-orange-500/20 text-orange-400 border-orange-400/30'
} as const;

const STATUS_MAP = {
  'FINISHED': 'Finalizado',
  'RELEASING': 'Em Lançamento',
  'NOT_YET_RELEASED': 'Não Lançado',
  'CANCELLED': 'Cancelado',
  'HIATUS': 'Pausado'
} as const;

// Componente memoizado para Loading Skeleton
const LoadingSkeleton = React.memo(() => (
  <div className="space-y-3">
    {[...Array(3)].map((_, index) => (
      <div key={index} className="animate-pulse">
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-gray-700/50">
          <div className="flex gap-4">
            <div className="w-16 h-20 bg-gray-700/50 rounded-lg"></div>
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-700/50 rounded w-3/4"></div>
              <div className="h-3 bg-gray-700/50 rounded w-1/2"></div>
              <div className="h-3 bg-gray-700/50 rounded w-full"></div>
              <div className="h-3 bg-gray-700/50 rounded w-5/6"></div>
            </div>
          </div>
        </div>
      </div>
    ))}
  </div>
));

// Componente memoizado para Empty State
const EmptyState = React.memo(() => (
  <div className="text-center py-8">
    <div className="text-gray-400 mb-2">Nenhum resultado encontrado</div>
    <div className="text-sm text-gray-500">Tente uma busca diferente</div>
  </div>
));

// Componente memoizado para cada resultado
interface ResultItemProps {
  result: SearchResult;
  index: number;
  isHovered: boolean;
  isSelected: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
}

const ResultItem = React.memo<ResultItemProps>(({
  result,
  index,
  isHovered,
  isSelected,
  onMouseEnter,
  onMouseLeave,
  onClick
}) => {
  const getStatusBadgeStyle = useCallback((status: string) => {
    return STATUS_COLORS[status as keyof typeof STATUS_COLORS] || 'bg-gray-500/20 text-gray-400 border-gray-400/30';
  }, []);

  const formatStatus = useCallback((status: string) => {
    return STATUS_MAP[status as keyof typeof STATUS_MAP] || status;
  }, []);

  const truncateDescription = useCallback((description: string | null, maxLength: number = 150) => {
    if (!description) return 'Sem descrição disponível';
    const cleanDescription = description.replace(/<[^>]*>/g, '').replace(/\n/g, ' ');
    return cleanDescription.length > maxLength 
      ? cleanDescription.substring(0, maxLength) + '...'
      : cleanDescription;
  }, []);

  return (
    <div
      className={`group relative cursor-pointer transition-all duration-300 ${
        isHovered ? 'transform scale-[1.02]' : ''
      }`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      <div className={`
        bg-gradient-to-br from-gray-800/40 via-gray-800/30 to-gray-900/40
        backdrop-blur-sm rounded-xl p-4 border transition-all duration-300
        ${isHovered 
          ? 'border-blue-400/50 shadow-lg shadow-blue-400/20 bg-gradient-to-br from-gray-800/60 via-gray-800/40 to-gray-900/50' 
          : 'border-gray-700/50 hover:border-gray-600/50'
        }
        ${isSelected
          ? 'ring-2 ring-blue-400/50 border-blue-400/50' 
          : ''
        }
      `}>
        <div className="flex gap-4">
          {/* Cover Image */}
          <div className="flex-shrink-0">
            <div className="w-16 h-20 rounded-lg overflow-hidden bg-gray-700/50 border border-gray-600/30">
              {result.coverImage ? (
                <LazyImage
                  src={result.coverImage}
                  alt={result.title}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs">
                  Sem Capa
                </div>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Title */}
            <h3 className="font-semibold text-white text-sm mb-1 line-clamp-1 group-hover:text-blue-300 transition-colors">
              {result.title}
            </h3>

            {/* Author & Status */}
            <div className="flex items-center gap-2 mb-2">
              {result.author && (
                <span className="text-xs text-gray-400">
                  por <span className="text-gray-300">{result.author}</span>
                </span>
              )}
              {result.status && (
                <span className={`
                  px-2 py-0.5 rounded-full text-xs border font-medium
                  ${getStatusBadgeStyle(result.status)}
                `}>
                  {formatStatus(result.status)}
                </span>
              )}
            </div>

            {/* Description */}
            <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed">
              {truncateDescription(result.description)}
            </p>

            {/* Metadata Preview */}
            {result.startDate && (
              <div className="mt-2 text-xs text-gray-500">
                Início: {result.startDate.year || 'N/A'}
              </div>
            )}
          </div>

          {/* Selection Indicator */}
          {isSelected && (
            <div className="flex-shrink-0 flex items-start pt-1">
              <div className="w-6 h-6 rounded-full bg-blue-500/20 border border-blue-400/50 flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-blue-400"></div>
              </div>
            </div>
          )}
        </div>

        {/* Hover Overlay */}
        <div className={`
          absolute inset-0 rounded-xl transition-opacity duration-300 pointer-events-none
          ${isHovered 
            ? 'bg-gradient-to-r from-blue-500/5 to-sky-500/5 opacity-100' 
            : 'opacity-0'
          }
        `} />
      </div>
    </div>
  );
});

// Componente memoizado para Preview
interface MetadataPreviewProps {
  selectedResult: SearchResult;
  selectedMetadata: AniListMetadata;
}

const MetadataPreview = React.memo<MetadataPreviewProps>(({ selectedResult, selectedMetadata }) => {
  const getStatusBadgeStyle = useCallback((status: string) => {
    return STATUS_COLORS[status as keyof typeof STATUS_COLORS] || 'bg-gray-500/20 text-gray-400 border-gray-400/30';
  }, []);

  const formatStatus = useCallback((status: string) => {
    return STATUS_MAP[status as keyof typeof STATUS_MAP] || status;
  }, []);

  return (
    <div className="mt-6 p-4 bg-gradient-to-br from-green-900/20 via-green-800/10 to-emerald-900/20 backdrop-blur-sm rounded-xl border border-green-700/30">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-green-400"></div>
        <h4 className="text-sm font-semibold text-green-300">Preview dos Dados</h4>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-400">Título:</span>
            <span className="text-white font-medium">{selectedMetadata.title}</span>
          </div>
          {selectedMetadata.author && (
            <div className="flex justify-between">
              <span className="text-gray-400">Autor:</span>
              <span className="text-white">{selectedMetadata.author}</span>
            </div>
          )}
          {selectedMetadata.artist && (
            <div className="flex justify-between">
              <span className="text-gray-400">Artista:</span>
              <span className="text-white">{selectedMetadata.artist}</span>
            </div>
          )}
        </div>
        
        <div className="space-y-2">
          {selectedMetadata.status && (
            <div className="flex justify-between">
              <span className="text-gray-400">Status:</span>
              <span className={`font-medium ${getStatusBadgeStyle(selectedMetadata.status).split(' ')[1]}`}>
                {formatStatus(selectedMetadata.status)}
              </span>
            </div>
          )}
          {selectedMetadata.genres && selectedMetadata.genres.length > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-400">Gêneros:</span>
              <span className="text-white text-right">{selectedMetadata.genres.slice(0, 3).join(', ')}</span>
            </div>
          )}
          {selectedMetadata.year && (
            <div className="flex justify-between">
              <span className="text-gray-400">Ano:</span>
              <span className="text-white">{selectedMetadata.year}</span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-green-700/30 text-center">
        <p className="text-xs text-green-400">
          Estes dados serão preenchidos automaticamente no formulário
        </p>
      </div>
    </div>
  );
});

export const AniListResults: React.FC<AniListResultsProps> = ({
  results,
  isLoading,
  onSelectResult,
  selectedMetadata
}) => {
  const [hoveredResult, setHoveredResult] = useState<number | null>(null);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // Memoizar handlers para evitar re-renders
  const handleResultClick = useCallback((result: SearchResult) => {
    setSelectedResult(result);
    setShowPreview(true);
    onSelectResult(result);
  }, [onSelectResult]);

  const handleMouseEnter = useCallback((index: number) => {
    setHoveredResult(index);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredResult(null);
  }, []);

  // Memoizar o conteúdo principal para otimizar renders
  const resultsContent = useMemo(() => {
    if (isLoading) {
      return <LoadingSkeleton />;
    }

    if (results.length === 0) {
      return <EmptyState />;
    }

    return (
      <div className="space-y-3">
        {results.map((result, index) => (
          <ResultItem
            key={result.uniqueKey || `${result.id}-${result.title}`}
            result={result}
            index={index}
            isHovered={hoveredResult === index}
            isSelected={
              selectedResult?.uniqueKey 
                ? selectedResult.uniqueKey === result.uniqueKey
                : selectedResult?.id === result.id
            }
            onMouseEnter={() => handleMouseEnter(index)}
            onMouseLeave={handleMouseLeave}
            onClick={() => handleResultClick(result)}
          />
        ))}
      </div>
    );
  }, [results, isLoading, hoveredResult, selectedResult?.id, handleMouseEnter, handleMouseLeave, handleResultClick]);

  return (
    <div className="space-y-3">
      {resultsContent}
      
      {/* Preview Section */}
      {showPreview && selectedResult && selectedMetadata && (
        <MetadataPreview
          selectedResult={selectedResult}
          selectedMetadata={selectedMetadata}
        />
      )}
    </div>
  );
};
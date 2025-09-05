'use client'

import React, { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'

interface LazyImageProps {
  src: string
  alt: string
  className?: string
  placeholderColor?: string
  fallbackSrc?: string
  priority?: 'high' | 'medium' | 'low'
  onLoad?: () => void
  onError?: (error: Error) => void
}

export const LazyImage: React.FC<LazyImageProps> = ({
  src,
  alt,
  className = '',
  placeholderColor = '#374151',
  fallbackSrc = '/api/placeholder/300/400',
  priority = 'medium',
  onLoad,
  onError
}) => {
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  // Removido completamente o useEffect do Intersection Observer

  const handleLoad = () => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ LazyImage: Carregada - ${alt}`)
    }
    setIsLoaded(true)
    onLoad?.()
  }

  const handleError = () => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`❌ LazyImage: Erro - ${alt}`)
    }
    setHasError(true)
    onError?.(new Error(`Failed to load image: ${src}`))
  }

  // Placeholder enquanto não carregou
  const Placeholder = () => (
    <div 
      className={cn(
        "flex items-center justify-center bg-gray-700 animate-pulse",
        className
      )}
      style={{ backgroundColor: placeholderColor }}
      ref={imgRef}
    >
      <div className="text-gray-400 text-center p-4">
        <div className="w-8 h-8 mx-auto mb-2 opacity-50">
          <svg fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="text-xs opacity-75">Carregando...</div>
      </div>
    </div>
  )

  // Imagem de erro/fallback
  const ErrorImage = () => (
    <div 
      className={cn(
        "flex items-center justify-center bg-gray-800 border-2 border-dashed border-gray-600",
        className
      )}
      ref={imgRef}
    >
      <div className="text-gray-500 text-center p-4">
        <div className="w-8 h-8 mx-auto mb-2">
          <svg fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="text-xs">Erro ao carregar</div>
      </div>
    </div>
  )

  // Se houve erro e não há fallback, mostrar erro
  if (hasError && !fallbackSrc) {
    return <ErrorImage />
  }

  // Renderizar imagem
  return (
    <div className="relative w-full h-full">
      {/* Placeholder somente enquanto não carregou */}
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 z-10">
          <Placeholder />
        </div>
      )}
      
      {/* Imagem real */}
      <img
        ref={imgRef}
        src={hasError ? fallbackSrc : src}
        alt={alt}
        className={cn(
          "w-full h-full object-cover transition-opacity duration-300",
          isLoaded ? "opacity-100" : "opacity-0",
          className
        )}
        onLoad={handleLoad}
        onError={handleError}
        loading="eager"
        decoding="async"
        style={{ display: 'block' }} // Garantir que está sempre visível
      />
      
      {/* Indicador de prioridade (dev mode) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="absolute top-1 right-1 bg-black bg-opacity-50 text-white text-xs px-1 rounded z-20">
          {priority[0].toUpperCase()}
        </div>
      )}
    </div>
  )
}

// Hook para pré-carregar imagens
export const useImagePreloader = () => {
  const preloadedImages = useRef<Set<string>>(new Set())

  const preloadImage = (src: string, priority: 'high' | 'medium' | 'low' = 'medium') => {
    if (preloadedImages.current.has(src)) {
      return Promise.resolve() // Já foi pré-carregada
    }

    return new Promise<void>((resolve, reject) => {
      const img = new Image()
      
      img.onload = () => {
        preloadedImages.current.add(src)
        resolve()
      }
      
      img.onerror = () => {
        reject(new Error(`Failed to preload image: ${src}`))
      }

      // Definir prioridade via atributos
      if (priority === 'high') {
        img.loading = 'eager'
      } else {
        img.loading = 'lazy'
      }
      
      img.src = src
    })
  }

  const preloadImages = async (urls: string[], priority: 'high' | 'medium' | 'low' = 'medium') => {
    const promises = urls.map(url => preloadImage(url, priority))
    return Promise.allSettled(promises)
  }

  const isPreloaded = (src: string) => preloadedImages.current.has(src)

  return {
    preloadImage,
    preloadImages,
    isPreloaded,
    preloadedCount: preloadedImages.current.size
  }
}

// Componente especializado para capas de mangá
interface MangaCoverProps {
  manga: {
    id: number
    title: string
    coverImage?: {
      large?: string
      medium?: string
      color?: string
    }
  }
  size?: 'small' | 'medium' | 'large'
  priority?: 'high' | 'medium' | 'low'
  className?: string
  onClick?: () => void
}

export const MangaCover: React.FC<MangaCoverProps> = ({
  manga,
  size = 'medium',
  priority = 'medium',
  className = '',
  onClick
}) => {
  const sizeClasses = {
    small: 'w-16 h-20',
    medium: 'w-24 h-32',
    large: 'w-32 h-40'
  }

  // Determinar melhor URL de imagem disponível
  const imageUrl = manga.coverImage?.large || manga.coverImage?.medium || ''
  const placeholderColor = manga.coverImage?.color || '#374151'
  const title = typeof manga.title === 'string' ? manga.title : 
               manga.title?.romaji || manga.title?.english || manga.title?.native || 'Manga'

  return (
    <div 
      className={cn(
        "rounded-lg overflow-hidden shadow-lg cursor-pointer transform transition-transform hover:scale-105",
        sizeClasses[size],
        className
      )}
      onClick={onClick}
    >
      <LazyImage
        src={imageUrl}
        alt={`Capa de ${title}`}
        className="w-full h-full object-cover"
        placeholderColor={placeholderColor}
        priority={priority}
        fallbackSrc="/api/placeholder/200/300"
      />
    </div>
  )
}

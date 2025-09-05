import React, { useState, useEffect, useRef, useCallback } from 'react';

export interface VirtualizedListProps<T> {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  overscan?: number; // Quantidade extra de itens para renderizar fora da view
  onScroll?: (scrollTop: number) => void;
  className?: string;
}

export function VirtualizedList<T>({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  overscan = 5,
  onScroll,
  className = ''
}: VirtualizedListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const totalHeight = items.length * itemHeight;
  const visibleStart = Math.floor(scrollTop / itemHeight);
  const visibleEnd = Math.min(
    visibleStart + Math.ceil(containerHeight / itemHeight),
    items.length - 1
  );

  // Adiciona overscan
  const startIndex = Math.max(0, visibleStart - overscan);
  const endIndex = Math.min(items.length - 1, visibleEnd + overscan);

  const visibleItems = [];
  for (let i = startIndex; i <= endIndex; i++) {
    visibleItems.push({
      index: i,
      item: items[i],
      style: {
        position: 'absolute' as const,
        top: i * itemHeight,
        left: 0,
        right: 0,
        height: itemHeight,
      }
    });
  }

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const newScrollTop = e.currentTarget.scrollTop;
    setScrollTop(newScrollTop);
    onScroll?.(newScrollTop);
  }, [onScroll]);

  useEffect(() => {
    console.log(`📋 VirtualizedList: Rendering ${visibleItems.length}/${items.length} items (${startIndex}-${endIndex})`);
  }, [startIndex, endIndex, items.length, visibleItems.length]);

  return (
    <div
      ref={containerRef}
      className={`overflow-auto ${className}`}
      style={{ height: containerHeight }}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleItems.map(({ index, item, style }) => (
          <div key={index} style={style}>
            {renderItem(item, index)}
          </div>
        ))}
      </div>
      
      {/* Debug info */}
      <div className="fixed bottom-4 right-4 bg-black bg-opacity-75 text-white p-2 rounded text-xs">
        <div>Total: {items.length}</div>
        <div>Visible: {visibleItems.length}</div>
        <div>Range: {startIndex}-{endIndex}</div>
        <div>Scroll: {Math.round(scrollTop)}px</div>
      </div>
    </div>
  );
}

// Hook para criar listas massivas virtualizadas
export function useMassiveList<T>(
  items: T[],
  {
    itemHeight = 50,
    containerHeight = 400,
    chunkSize = 1000,
    loadMore
  }: {
    itemHeight?: number;
    containerHeight?: number;
    chunkSize?: number;
    loadMore?: () => Promise<T[]>;
  } = {}
) {
  const [visibleItems, setVisibleItems] = useState<T[]>(items.slice(0, chunkSize));
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(items.length > chunkSize);

  const loadMoreItems = useCallback(async () => {
    if (isLoading || !hasMore) return;

    setIsLoading(true);
    try {
      if (loadMore) {
        const newItems = await loadMore();
        setVisibleItems(prev => [...prev, ...newItems]);
        setHasMore(newItems.length === chunkSize);
      } else {
        const nextChunk = items.slice(visibleItems.length, visibleItems.length + chunkSize);
        setVisibleItems(prev => [...prev, ...nextChunk]);
        setHasMore(visibleItems.length + chunkSize < items.length);
      }
    } catch (error) {
      console.error('Error loading more items:', error);
    } finally {
      setIsLoading(false);
    }
  }, [items, visibleItems.length, chunkSize, loadMore, isLoading, hasMore]);

  const handleScroll = useCallback((scrollTop: number) => {
    const threshold = (visibleItems.length - 10) * itemHeight;
    if (scrollTop > threshold && hasMore && !isLoading) {
      loadMoreItems();
    }
  }, [visibleItems.length, itemHeight, hasMore, isLoading, loadMoreItems]);

  return {
    visibleItems,
    isLoading,
    hasMore,
    loadMoreItems,
    handleScroll,
    VirtualizedList: (props: Omit<VirtualizedListProps<T>, 'items' | 'itemHeight' | 'containerHeight' | 'onScroll'>) => (
      <VirtualizedList
        {...props}
        items={visibleItems}
        itemHeight={itemHeight}
        containerHeight={containerHeight}
        onScroll={handleScroll}
      />
    )
  };
}

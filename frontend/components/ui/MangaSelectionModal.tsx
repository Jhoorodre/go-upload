import React, { useState } from 'react';
import { Badge } from './Badge';
import { Button } from './Button';
import { Card, CardContent, CardHeader, CardTitle } from './Card';

interface MangaSelectionModalProps {
  selectedPaths: string[];
  onClose: () => void;
  onSelectManga: (mangaPath: string) => void;
}

export const MangaSelectionModal: React.FC<MangaSelectionModalProps> = ({
  selectedPaths,
  onClose,
  onSelectManga
}) => {
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  const getMangaName = (path: string) => {
    const segments = path.split('/');
    return segments[segments.length - 1] || path;
  };

  const getMangaInfo = (path: string) => {
    const segments = path.split('/');
    if (segments.length > 1) {
      return segments.slice(0, -1).join(' → ');
    }
    return 'Raiz da biblioteca';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <Card className="w-full max-w-2xl max-h-[80vh] overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Selecionar Manga para Editar</span>
            <Badge variant="info" size="sm">
              {selectedPaths.length} manga(s) disponível(veis)
            </Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Escolha qual manga você deseja editar os metadados JSON:
          </p>
        </CardHeader>
        <CardContent className="overflow-y-auto max-h-[50vh]">
          <div className="space-y-2">
            {selectedPaths.map((path, index) => (
              <div
                key={path}
                className={`p-3 border rounded-lg cursor-pointer transition-all duration-200 ${
                  hoveredPath === path 
                    ? 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800' 
                    : 'hover:bg-accent'
                }`}
                onMouseEnter={() => setHoveredPath(path)}
                onMouseLeave={() => setHoveredPath(null)}
                onClick={() => onSelectManga(path)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {getMangaName(path)}
                    </div>
                    <div className="text-sm text-muted-foreground truncate">
                      {getMangaInfo(path)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <Badge variant="outline" size="xs">
                      #{index + 1}
                    </Badge>
                    {hoveredPath === path && (
                      <Badge variant="default" size="xs">
                        Clique para editar
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          
          <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
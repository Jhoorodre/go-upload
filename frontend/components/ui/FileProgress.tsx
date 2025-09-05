import React from 'react';
import { Button } from './Button';
import { Progress } from './Progress';
import { CloseIcon, CheckCircleIcon, ExclamationCircleIcon, ClockIcon, UploadingIcon } from './Icons';
import { formatBytes } from '../../utils/formatters';
import type { FileProgressProps, UploadableFile } from '../../types';

const FileStatusIcon: React.FC<{ status: UploadableFile['status'] }> = ({ status }) => {
  switch (status) {
    case 'uploading': return <UploadingIcon />;
    case 'success': return <CheckCircleIcon />;
    case 'error': return <ExclamationCircleIcon />;
    default: return <ClockIcon />;
  }
};

export const FileProgress = React.memo<FileProgressProps>(function FileProgress({ uploadableFile, onRemove }) {
  return (
    <div className="text-xs bg-gray-800/50 p-2 rounded-md space-y-1">
      <div className="flex justify-between items-start">
        <div className="flex-1 min-w-0 flex items-start space-x-2">
          <div className="pt-0.5">
            <FileStatusIcon status={uploadableFile.status} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate text-gray-300" title={uploadableFile.file.name}>
              <span className="font-bold text-indigo-400">{`Cap. ${uploadableFile.chapterId}: `}</span>
              {uploadableFile.file.name}
            </p>
          </div>
        </div>
        <Button 
          onClick={onRemove} 
          variant="ghost" 
          size="icon" 
          className="text-gray-500 hover:text-white transition-colors flex-shrink-0 z-10 h-auto w-auto p-0"
        >
          <CloseIcon />
        </Button>
      </div>
      <div className="flex items-center space-x-2 pl-6">
        <Progress value={uploadableFile.progress} className="w-full bg-gray-700 h-1.5" />
        <p className="text-gray-500 text-nowrap">{formatBytes(uploadableFile.file.size)}</p>
      </div>
    </div>
  );
});
import { useState, useEffect } from 'react';
import { storage } from '../utils';

export interface GitHubSettings {
  githubToken: string;
  githubRepo: string;
  githubBranch: string;
  repoFolder: string;
  updateMode: string;
}

export const useGitHubSettings = () => {
  const [settings, setSettings] = useState<GitHubSettings>({
    githubToken: '',
    githubRepo: '',
    githubBranch: 'main',
    repoFolder: '',
    updateMode: 'smart'
  });

  useEffect(() => {
    const savedSettings = storage.get('manga-uploader-settings', {});
    setSettings({
      githubToken: savedSettings.githubToken || '',
      githubRepo: savedSettings.githubRepo || '',
      githubBranch: savedSettings.githubBranch || 'main',
      repoFolder: savedSettings.repoFolder || '',
      updateMode: savedSettings.updateMode || 'smart'
    });
  }, []);

  const isConfigured = Boolean(
    settings.githubToken && 
    settings.githubRepo && 
    settings.githubBranch && 
    settings.repoFolder
  );

  return {
    settings,
    isConfigured
  };
};
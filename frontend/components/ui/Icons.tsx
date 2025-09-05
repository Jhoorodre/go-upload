import React from 'react';

// Base Icon component
const Icon: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
    {children}
  </svg>
);

// Navigation Icons
export const LibraryIcon = () => (
  <Icon>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
  </Icon>
);

export const SettingsIcon = () => (
  <Icon>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924-1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </Icon>
);

export const HostIcon = () => (
  <Icon>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
  </Icon>
);

// Status Icons
export const ClockIcon = () => (
  <Icon className="w-4 h-4 text-gray-500">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </Icon>
);

export const CheckCircleIcon = () => (
  <Icon className="w-4 h-4 text-green-500">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </Icon>
);

export const ExclamationCircleIcon = () => (
  <Icon className="w-4 h-4 text-red-500">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </Icon>
);

export const UploadingIcon = () => (
  <svg className="w-4 h-4 text-indigo-500 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);

// Control Icons
export const CloseIcon = ({ className = "w-4 h-4" }) => (
  <Icon className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </Icon>
);

export const ArrowLeftIcon = () => (
  <Icon>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
  </Icon>
);

export const RefreshIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <Icon className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 4l1.5 1.5A9 9 0 0120 12M20 20l-1.5-1.5A9 9 0 004 12" />
  </Icon>
);

// Sort Icons
export const SortAscIcon = () => (
  <Icon className="w-4 h-4 ml-1">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9M3 12h9m1.5 5.5l2.5-2.5m0 0l2.5 2.5m-2.5-2.5v6" />
  </Icon>
);

export const SortDescIcon = () => (
  <Icon className="w-4 h-4 ml-1">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9M3 12h9m1.5-2.5l2.5 2.5m0 0l2.5-2.5m-2.5 2.5v-6" />
  </Icon>
);

// Action Icons
export const ActionUploadIcon = () => (
  <Icon className="w-6 h-6 text-white">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
  </Icon>
);

export const ActionEditIcon = () => (
  <Icon className="w-6 h-6 text-white">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
  </Icon>
);

export const ActionGithubIcon = () => (
  <Icon className="w-6 h-6 text-white">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
  </Icon>
);

// Log Icon
export const LogIcon = () => (
  <Icon>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </Icon>
);

export { Icon };
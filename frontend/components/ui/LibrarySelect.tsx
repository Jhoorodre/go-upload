import React, { useState, useRef, useEffect } from 'react';
import { useHydration } from '../../hooks/useHydration';

interface LibraryOption {
  id: string;
  name: string;
}

interface LibrarySelectProps {
  value: string;
  onChange: (value: string) => void;
  options: LibraryOption[];
  placeholder?: string;
}

// Simple SVG chevron icon
const ChevronDownIcon = ({ className }: { className?: string }) => (
  <svg 
    className={className} 
    fill="none" 
    stroke="currentColor" 
    viewBox="0 0 24 24"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

export const LibrarySelect: React.FC<LibrarySelectProps> = ({
  value,
  onChange,
  options,
  placeholder = "Biblioteca Padrão"
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectRef = useRef<HTMLDivElement>(null);
  const isHydrated = useHydration(); // Previne problemas de hidratação

  // Debug logs reduzidos - apenas quando mudança significativa
  const prevValueRef = useRef(value);
  useEffect(() => {
    if (isHydrated && process.env.NODE_ENV === 'development' && prevValueRef.current !== value) {
      console.log('🎯 LibrarySelect: value mudou de', prevValueRef.current, 'para', value);
      prevValueRef.current = value;
    }
  }, [value, isHydrated]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen && isHydrated) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, isHydrated]);

  // Não renderizar dropdown durante hidratação
  if (!isHydrated) {
    const selectedOption = options.find(opt => opt.id === value);
    const displayText = selectedOption ? selectedOption.name : placeholder;
    
    return (
      <div className="relative inline-block w-full max-w-[140px]">
        <div className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600 flex items-center justify-between">
          <span className="truncate">{displayText}</span>
          <ChevronDownIcon className="w-4 h-4 ml-1" />
        </div>
      </div>
    );
  }

  const selectedOption = options.find(opt => opt.id === value);
  const displayText = selectedOption ? selectedOption.name : placeholder;

  // Remover log de render frequente

  const handleOptionClick = (optionValue: string) => {
    if (process.env.NODE_ENV === 'development') {
      console.log('🔄 LibrarySelect: Mudando para biblioteca:', optionValue);
    }
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <div ref={selectRef} className="relative inline-block w-full max-w-[140px]">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600 focus:border-indigo-500 focus:outline-none flex items-center justify-between"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="truncate">{displayText}</span>
        <ChevronDownIcon 
          className={`w-4 h-4 ml-1 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
        />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-600 rounded shadow-lg z-[10000] max-h-60 overflow-y-auto">
          <div
            onClick={() => handleOptionClick('')}
            className={`px-3 py-2 text-sm cursor-pointer hover:bg-gray-700 ${
              !value ? 'bg-indigo-600 text-white' : 'text-gray-300'
            }`}
          >
            {placeholder}
          </div>
          {options.map((option) => (
            <div
              key={option.id}
              onClick={() => handleOptionClick(option.id)}
              className={`px-3 py-2 text-sm cursor-pointer hover:bg-gray-700 ${
                value === option.id ? 'bg-indigo-600 text-white' : 'text-gray-300'
              }`}
            >
              {option.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

import React from 'react';
import type { CheckboxProps } from '../../types';

export const Checkbox: React.FC<CheckboxProps> = ({ 
  checked, 
  onChange, 
  title, 
  className = "" 
}) => (
  <input 
    type="checkbox" 
    checked={checked} 
    onChange={onChange} 
    title={title} 
    className={`w-5 h-5 rounded bg-gray-900/70 border-gray-500 text-indigo-600 focus:ring-indigo-500 cursor-pointer ${className}`} 
  />
);
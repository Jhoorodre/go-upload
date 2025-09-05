import React, { useCallback } from 'react';
import { Button } from './Button';
import type { NumericStepperProps } from '../../types';

export const NumericStepper: React.FC<NumericStepperProps> = ({ 
  label, 
  value, 
  onValueChange, 
  min = 1, 
  max = 10 
}) => {
  const increment = useCallback(() => onValueChange(Math.min(max, value + 1)), [max, value, onValueChange]);
  const decrement = useCallback(() => onValueChange(Math.max(min, value - 1)), [min, value, onValueChange]);
  
  return (
    <div>
      <label className="text-sm font-medium text-gray-300">{label}</label>
      <div className="flex items-center mt-1">
        <Button 
          onClick={decrement} 
          variant="ghost" 
          className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-l-md hover:bg-gray-600"
        >
          -
        </Button>
        <input 
          type="number" 
          readOnly 
          value={value} 
          className="w-12 text-center bg-gray-800 border-y border-gray-600 py-1.5" 
        />
        <Button 
          onClick={increment} 
          variant="ghost" 
          className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-r-md hover:bg-gray-600"
        >
          +
        </Button>
      </div>
    </div>
  );
};
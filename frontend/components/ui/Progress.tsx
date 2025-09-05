import React from 'react';
import { cn } from '../../utils';

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
  showValue?: boolean;
  variant?: 'default' | 'success' | 'warning' | 'error';
  size?: 'sm' | 'default' | 'lg';
  animated?: boolean;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ 
    className, 
    value = 0, 
    max = 100, 
    showValue = false,
    variant = 'default',
    size = 'default',
    animated = false,
    ...props 
  }, ref) => {
    const percentage = Math.min(100, Math.max(0, (value / max) * 100));
    
    const variantClasses = {
      default: 'bg-blue-600',
      success: 'bg-green-600',
      warning: 'bg-yellow-600',
      error: 'bg-red-600'
    };
    
    const sizeClasses = {
      sm: 'h-1',
      default: 'h-2',
      lg: 'h-3'
    };

    return (
      <div 
        ref={ref} 
        className={cn(
          'relative w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden',
          sizeClasses[size],
          className
        )} 
        {...props}
      >
        <div
          className={cn(
            'h-full transition-all duration-300 ease-out rounded-full',
            variantClasses[variant],
            animated && 'animate-pulse'
          )}
          style={{ width: `${percentage}%` }}
        />
        {showValue && (
          <div className="absolute inset-0 flex items-center justify-center text-xs font-medium text-white">
            {Math.round(percentage)}%
          </div>
        )}
      </div>
    );
  }
);

Progress.displayName = "Progress";

export { Progress };
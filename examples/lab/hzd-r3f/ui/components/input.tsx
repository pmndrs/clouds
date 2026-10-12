import * as React from 'react';
import { cn } from '../lib/utils';

// shadcn Input, compact.
export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn('h-6 w-full min-w-0 rounded-sm border border-input bg-black/60 px-1.5 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none', className)}
      {...props}
    />
  );
}

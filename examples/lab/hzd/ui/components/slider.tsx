import * as React from 'react';
import { Slider as SliderPrimitive } from 'radix-ui';
import { cn } from '../lib/utils';

// shadcn Slider (single thumb), thin track for dense rows.
export function Slider({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn('relative flex h-4 w-full min-w-0 touch-none items-center select-none data-[disabled]:opacity-50', className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range className="absolute h-full bg-primary/80" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block size-3 shrink-0 rounded-full border border-primary bg-background shadow-sm transition-[color,box-shadow] hover:ring-2 hover:ring-ring/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" />
    </SliderPrimitive.Root>
  );
}

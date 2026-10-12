import * as React from 'react';
import { Label as LabelPrimitive, ScrollArea as ScrollAreaPrimitive, Separator as SeparatorPrimitive } from 'radix-ui';
import { cn } from '../lib/utils';

// Small shadcn pieces: Label, Separator, ScrollArea, Kbd.

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root data-slot="label" className={cn('flex cursor-pointer items-center gap-1.5 text-xs select-none', className)} {...props} />;
}

export function Separator({ className, orientation = 'horizontal', ...props }: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      orientation={orientation}
      className={cn('shrink-0 bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
      {...props}
    />
  );
}

export function ScrollArea({ className, children, ...props }: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn('relative overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport className="size-full rounded-[inherit] [&>div]:!block">{children}</ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar orientation="vertical" className="flex w-2 touch-none p-px select-none">
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return <kbd className={cn('inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] border border-input bg-secondary px-1 font-mono text-[10.5px] text-value', className)} {...props} />;
}

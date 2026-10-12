import * as React from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { cn } from '../lib/utils';

// shadcn Tooltip. `Tip` wraps one control with a hover note: the bench's controls carry long explanations that used to be `title` attributes.
export const TooltipProvider = ({ delayDuration = 400, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) =>
  <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;

export function TooltipContent({ className, sideOffset = 4, children, ...props }: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn('z-50 max-w-72 rounded-sm border border-border bg-popover px-2 py-1 text-[11px] leading-snug text-popover-foreground shadow-md animate-in fade-in-0', className)}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export function Tip({ text, children, side }: { text?: React.ReactNode; children: React.ReactElement; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  if (!text) return children;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipContent side={side}>{text}</TooltipContent>
    </TooltipPrimitive.Root>
  );
}

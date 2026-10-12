import * as React from 'react';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { cn } from '../lib/utils';

// shadcn ToggleGroup: a row of buttons where one (type="single") or several are on.
export function ToggleGroup({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return <ToggleGroupPrimitive.Root data-slot="toggle-group" className={cn('flex flex-wrap items-center gap-1', className)} {...props} />;
}

export function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn('inline-flex h-6 cursor-pointer items-center justify-center rounded-sm border border-input bg-secondary px-2 text-xs whitespace-nowrap outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45 data-[state=on]:border-primary/70 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground', className)}
      {...props}
    />
  );
}

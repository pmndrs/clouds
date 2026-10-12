import * as React from 'react';
import { Select as SelectPrimitive } from 'radix-ui';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { cn } from '../lib/utils';

// shadcn Select, compact.
export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn('flex h-6 w-full min-w-0 items-center justify-between gap-1 rounded-sm border border-input bg-secondary px-2 text-xs whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 cursor-pointer data-[placeholder]:text-muted-foreground [&>span]:truncate', className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild><ChevronDownIcon className="size-3.5 shrink-0 opacity-60" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({ className, children, position = 'popper', ...props }: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        className={cn('relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-sm border border-border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          position === 'popper' && 'w-full min-w-(--radix-select-trigger-width) data-[side=bottom]:translate-y-1', className)}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return <SelectPrimitive.Label className={cn('px-2 py-1 text-[10.5px] uppercase tracking-wider text-label', className)} {...props} />;
}

export function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn('relative flex w-full cursor-pointer items-center rounded-sm py-1 pr-6 pl-2 text-xs outline-none select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50', className)}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator><CheckIcon className="size-3.5" /></SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

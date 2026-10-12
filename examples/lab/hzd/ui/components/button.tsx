import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

// shadcn Button, sized for the bench's dense panels.
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm font-sans text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45 cursor-pointer [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border border-input bg-secondary text-secondary-foreground hover:bg-accent',
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        outline: 'border border-input bg-transparent hover:bg-accent',
        destructive: 'border border-destructive/60 text-destructive hover:bg-destructive/15',
      },
      size: {
        default: 'h-6 px-2',
        sm: 'h-5 px-1.5 text-[11px]',
        icon: 'size-6',
      },
      active: { true: 'bg-accent border-primary/70 text-accent-foreground', false: '' },
    },
    defaultVariants: { variant: 'default', size: 'default', active: false },
  },
);

export interface ButtonProps extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, active, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, active, className }))} {...props} />;
}

export { buttonVariants };

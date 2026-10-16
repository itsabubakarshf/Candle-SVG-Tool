'use client';

import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '@/lib/utils';

type SliderProps = React.ComponentProps<typeof SliderPrimitive.Root> & {
  'aria-label'?: string;
  'aria-labelledby'?: string;
};

/** The accessible name belongs on the thumb (the element with role="slider"). */
export function Slider({
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ...props
}: SliderProps) {
  return (
    <SliderPrimitive.Root
      className={cn('relative flex h-5 w-full touch-none select-none items-center', className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow rounded-full bg-muted">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className="block h-4 w-4 rounded-full border border-primary bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </SliderPrimitive.Root>
  );
}

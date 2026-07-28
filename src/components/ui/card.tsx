import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-lg border border-brand-100 bg-white p-6 shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

type Tone = 'neutral' | 'success' | 'info' | 'warning' | 'danger' | 'brand';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-brand-100 text-brand-600',
  success: 'bg-emerald-100 text-emerald-800',
  info: 'bg-sky-100 text-sky-800',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
  brand: 'bg-brand-700 text-canvas',
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-tight',
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    />
  );
}

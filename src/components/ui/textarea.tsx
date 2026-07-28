import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const taId = id ?? props.name;
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={taId} className="text-xs font-medium text-brand-600">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={taId}
          className={cn(
            'focus-ring min-h-[80px] rounded-md border border-brand-200 bg-white px-3 py-2 text-sm text-brand-700 placeholder:text-brand-300',
            error && 'border-red-500',
            className,
          )}
          {...props}
        />
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';

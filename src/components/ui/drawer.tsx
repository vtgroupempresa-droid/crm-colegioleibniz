'use client';

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils/cn';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  widthClassName?: string;
}

export function Drawer({ open, onClose, title, children, widthClassName }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (typeof window === 'undefined') return null;
  if (!open) return null;

  return createPortal(
    // Mobile: bottom sheet (flex-col, painel embaixo). sm+: drawer lateral (flex-row).
    <div className="fixed inset-0 z-50 flex flex-col sm:flex-row">
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="flex-1 bg-brand-900/40"
      />
      <aside
        role="dialog"
        aria-modal="true"
        className={cn(
          'flex max-h-[88vh] flex-col rounded-t-2xl border-t border-brand-100 bg-canvas shadow-xl',
          'sm:h-full sm:max-h-none sm:rounded-none sm:border-l sm:border-t-0',
          widthClassName ?? 'w-full sm:max-w-2xl',
        )}
      >
        <header className="flex items-center justify-between border-b border-brand-100 px-4 py-4 sm:px-6">
          <div className="min-w-0">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring rounded-md p-1 text-brand-500 hover:bg-brand-100"
            aria-label="Fechar"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

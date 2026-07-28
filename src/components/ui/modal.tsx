'use client';

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils/cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  maxWidthClassName?: string;
  /** Tooltip (title) do botão de fechar — ex.: avisar que nada será salvo. */
  closeHint?: string;
  /** No mobile, um painel inferior deixa escolhas operacionais mais fáceis de alcançar. */
  placement?: 'center' | 'bottom';
}

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidthClassName,
  closeHint,
  placement = 'center',
}: ModalProps) {
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
    <div
      className={cn(
        'fixed inset-0 z-50 flex',
        placement === 'bottom' ? 'items-end justify-center sm:items-center sm:px-4' : 'items-center justify-center px-4',
      )}
    >
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-brand-900/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg bg-canvas shadow-xl',
          placement === 'bottom' && 'max-h-[85vh] rounded-b-none rounded-t-xl sm:max-h-[90vh] sm:rounded-lg',
          maxWidthClassName ?? 'max-w-xl',
        )}
      >
        <header className="flex items-center justify-between border-b border-brand-100 px-5 py-3">
          <div className="min-w-0 font-semibold text-brand-700">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring rounded-md p-1 text-brand-500 hover:bg-brand-100"
            aria-label="Fechar"
            title={closeHint}
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

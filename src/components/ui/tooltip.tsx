'use client';

import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils/cn';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  className?: string;
}

interface TooltipPos {
  top: number;
  left: number;
  below: boolean;
}

/**
 * Tooltip renderizado em portal com posição `fixed` calculada a partir do
 * trigger. Vivendo no `document.body`, ele não é cortado por ancestrais com
 * `overflow` (ex.: a lista rolável das colunas do Kanban). Inverte para baixo
 * quando não há espaço suficiente acima (cards no topo da coluna).
 */
export function Tooltip({ content, children, className }: TooltipProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<TooltipPos | null>(null);

  function show() {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const below = rect.top < 160; // pouco espaço acima → mostra abaixo
    setPos({
      top: below ? rect.bottom + 6 : rect.top - 6,
      left: rect.left + rect.width / 2,
      below,
    });
  }

  function hide() {
    setPos(null);
  }

  return (
    <span
      ref={ref}
      className={cn('relative inline-flex', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {pos !== null &&
        typeof document !== 'undefined' &&
        createPortal(
          <span
            role="tooltip"
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              transform: `translate(-50%, ${pos.below ? '0' : '-100%'})`,
            }}
            className="pointer-events-none z-[60] max-w-[18rem] whitespace-pre rounded-md bg-brand-800 px-2 py-1.5 text-[11px] leading-snug text-canvas shadow-lg"
          >
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}

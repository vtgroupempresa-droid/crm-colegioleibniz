'use client';

import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils/cn';
import type { ReactNode } from 'react';

interface KanbanColumnProps {
  id: string;
  title: string;
  count: number;
  /** Quantos leads carregados desta coluna estão com SLA vencido (destaque vermelho). */
  breachedCount?: number;
  accentColor: string;
  itemIds: readonly string[];
  children: ReactNode;
  /** Tooltip exibido ao passar o mouse no header (ex.: SLA da coluna). */
  headerHint?: string;
  /** Banner fixo no topo do corpo da coluna (ex.: aviso da coluna agendado). */
  banner?: ReactNode;
}

export function KanbanColumn({
  id,
  title,
  count,
  breachedCount = 0,
  accentColor,
  itemIds,
  children,
  headerHint,
  banner,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { type: 'stage', stage: id } });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        // Mobile: largura total, empilhado (altura por conteúdo).
        // sm+: coluna de 18rem ocupando a altura do board.
        'flex w-full shrink-0 flex-col rounded-lg border border-brand-100 bg-brand-50/60 transition-colors sm:h-full sm:w-72',
        isOver && 'border-brand-500 bg-brand-100 ring-2 ring-brand-300 ring-inset',
      )}
    >
      <header
        className="flex items-center justify-between border-b border-brand-100 px-3 py-2"
        title={headerHint}
      >
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: accentColor }}
            aria-hidden
          />
          <h3 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-brand-600">
            {title}
            {headerHint && (
              <span className="cursor-help text-brand-300" aria-hidden>
                ⓘ
              </span>
            )}
          </h3>
        </div>
        <span className="shrink-0 text-xs font-medium text-brand-400">
          {count}
          {breachedCount > 0 && (
            <span
              className="ml-1 font-semibold text-red-600"
              title="Leads com SLA vencido (entre os carregados na coluna)"
            >
              ({breachedCount} {breachedCount === 1 ? 'atrasado' : 'atrasados'})
            </span>
          )}
        </span>
      </header>
      {isOver && (
        <p className="mx-2 mt-2 rounded-md bg-brand-700 px-2 py-1.5 text-center text-xs font-semibold text-canvas">
          Solte aqui para mover
        </p>
      )}
      <SortableContext items={itemIds as string[]} strategy={verticalListSortingStrategy}>
        <div
          data-kanban-column-scroll
          className="flex flex-1 flex-col gap-2 p-2 sm:overflow-y-auto"
        >
          {banner}
          {children}
        </div>
      </SortableContext>
    </section>
  );
}

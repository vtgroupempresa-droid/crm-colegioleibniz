'use client';

import { useEffect, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils/cn';
import { formatBRL } from '@/lib/utils/format';
import type { Lead } from '@/types/lead';

interface KanbanCardStandardProps {
  lead: Lead;
  selected: boolean;
  onToggleSelect: (leadId: string) => void;
  groupDragging?: boolean;
  onOpen: (leadId: string) => void;
  onMove?: (leadId: string) => void;
}

/**
 * Único padrão visual dos cards do funil.
 *
 * O estado fechado serve apenas para localizar a família: nome e orçamento.
 * Todo o contexto operacional continua disponível na ficha aberta ao clicar.
 */
export function KanbanCardStandard({
  lead,
  selected,
  onToggleSelect,
  groupDragging = false,
  onOpen,
  onMove,
}: KanbanCardStandardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
    data: { type: 'lead', leadId: lead.id },
  });
  const draggedRef = useRef(false);

  useEffect(() => {
    if (isDragging) {
      draggedRef.current = true;
      return;
    }

    const timeout = setTimeout(() => {
      draggedRef.current = false;
    }, 0);
    return () => clearTimeout(timeout);
  }, [isDragging]);

  function openLead() {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    onOpen(lead.id);
  }

  function handleCardClick(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button, input, a, label')) return;
    openLead();
  }

  function handleCardKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openLead();
  }

  const budget = lead.monthly_budget == null ? 'Não informado' : formatBRL(lead.monthly_budget);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Abrir ficha de ${lead.name}`}
      className={cn(
        'focus-ring group relative min-w-0 cursor-pointer rounded-xl border border-brand-100 bg-white p-3.5 text-left shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-brand-300 hover:shadow-md',
        selected && 'border-brand-400 ring-2 ring-brand-500/30',
        isDragging && 'pointer-events-none opacity-0',
        groupDragging && selected && !isDragging && 'opacity-40',
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(lead.id)}
          aria-label={`Selecionar ${lead.name}`}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand-600"
        />

        <div className="min-w-0 flex-1">
          <p className="whitespace-normal break-words text-[15px] font-semibold leading-5 text-brand-800 [overflow-wrap:anywhere]">
            {lead.name}
          </p>
          <div className="mt-3 border-t border-brand-100 pt-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-400">
              Orçamento mensal
            </p>
            <p
              className={cn(
                'mt-0.5 break-words text-sm font-semibold [overflow-wrap:anywhere]',
                lead.monthly_budget == null ? 'text-brand-400' : 'text-brand-700',
              )}
            >
              {budget}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {onMove && (
            <button
              type="button"
              aria-label={`Mover ${lead.name} para outra etapa`}
              title="Mover para outra etapa"
              onClick={() => onMove(lead.id)}
              className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-brand-400 transition-colors hover:bg-brand-50 hover:text-brand-700"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="m9 18 6-6-6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          <button
            type="button"
            aria-label={`Arrastar ${lead.name} para outra etapa`}
            title="Arrastar para outra etapa"
            className="focus-ring flex h-9 w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-brand-400 transition-colors hover:bg-brand-50 hover:text-brand-700 active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="8" cy="6" r="1.5" />
              <circle cx="16" cy="6" r="1.5" />
              <circle cx="8" cy="12" r="1.5" />
              <circle cx="16" cy="12" r="1.5" />
              <circle cx="8" cy="18" r="1.5" />
              <circle cx="16" cy="18" r="1.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

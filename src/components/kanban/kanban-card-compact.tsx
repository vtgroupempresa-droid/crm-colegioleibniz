'use client';

import { useEffect, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AssigneeAvatar } from '@/components/ui/assignee-avatar';
import { InterestBadge } from '@/components/leads/interest-badge';
import { cn } from '@/lib/utils/cn';
import { formatDateTime, formatRelative } from '@/lib/utils/format';
import { MAX_ATTEMPTS, formatSlaCountdown, slaStatusFor, type SlaStatus } from '@/lib/sla/rules';
import { labelForField } from '@/lib/leads/validators';
import { appointmentBadge } from './kanban-card';
import { ChildProfileSummary } from './child-profile-summary';
import {
  type Lead,
  type LEAD_SOURCES,
} from '@/types/lead';
import type { PipelineKind } from '@/types/pipeline';

const SOURCE_LABELS: Partial<Record<(typeof LEAD_SOURCES)[number], string>> = {
  meta_ads: 'Meta Ads',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  telefone: 'Ligação',
  presencial: 'Presencial',
  site: 'Site',
  indicacao: 'Indicação',
  organico: 'Orgânico',
  evento: 'Evento',
  reentrada: 'Reentrada',
  outro: 'Outro',
};

/** Cor do dot de SLA (mesma semântica da borda esquerda do card confortável). */
export const SLA_DOT_CLASSES: Record<SlaStatus['status'], string> = {
  breached: 'bg-red-500',
  warning: 'bg-amber-400',
  ok: 'bg-emerald-500',
  none: 'bg-brand-200',
};

export const SLA_DOT_LABELS: Record<SlaStatus['status'], string> = {
  breached: 'SLA vencido',
  warning: 'SLA vencendo (menos de 2h)',
  ok: 'SLA no prazo',
  none: 'Sem SLA definido',
};

const APT_BADGE_TEXT: Record<'success' | 'warning' | 'danger', string> = {
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-red-600 font-semibold',
};

interface KanbanCardCompactProps {
  lead: Lead;
  pipeline: PipelineKind;
  stageEnteredAt: string;
  /** Chegou na coluna por reativação (reentrada) — mostra "voltou" no lugar de "na etapa". */
  reentered?: boolean;
  nextSlaAt: string | null;
  attemptsCount: number;
  missingFieldsToAdvance: readonly string[];
  nextAppointmentAt: string | null;
  nextAppointmentId?: string | null;
  appointmentConfirmed: boolean;
  assigneeName?: string | null;
  assigneeRole?: string | null;
  selected: boolean;
  onToggleSelect: (leadId: string) => void;
  groupDragging?: boolean;
  onOpen: (leadId: string) => void;
  /** Abre o seletor de etapa; evita arrasto longo no celular. */
  onMove?: (leadId: string) => void;
  onOpenChat?: (leadId: string) => void;
  onQuickAttempt?: (leadId: string) => void;
  onRegisterContact?: (leadId: string) => void;
  /** Atalhos essenciais do closer — sem eles a venda só fechava na visão confortável. */
  onCloseDeal?: (leadId: string) => void;
  onMarkLost?: (leadId: string) => void;
  onRegisterCall?: (leadId: string, appointmentId: string) => void;
}

/**
 * Card do Kanban em modo COMPACTO: uma linha escaneável por lead.
 *   [dot SLA] [avatar] Nome + (origem · tempo no stage)  [score] [ações no hover]
 *
 * Interações:
 *  - A alça ⋮⋮ é a ÚNICA forma de iniciar um arrasto, igual ao card confortável.
 *    No celular, o botão "Mover etapa" é o caminho principal e não disputa o scroll.
 *  - Clique fora de botões abre o LeadDrawer; guard descarta o clique fantasma
 *    disparado logo após um drag.
 *  - Ações (tentativa/contato/chat) aparecem no hover; em telas sem hover ficam
 *    sempre visíveis, junto do checkbox de seleção.
 *  - Desktop: o checkbox de seleção surge no lugar do dot ao passar o mouse.
 */
export function KanbanCardCompact({
  lead,
  pipeline,
  stageEnteredAt,
  reentered = false,
  nextSlaAt,
  attemptsCount,
  missingFieldsToAdvance,
  nextAppointmentAt,
  nextAppointmentId = null,
  appointmentConfirmed,
  assigneeName = null,
  assigneeRole = null,
  selected,
  onToggleSelect,
  groupDragging = false,
  onOpen,
  onMove,
  onOpenChat,
  onQuickAttempt,
  onRegisterContact,
  onCloseDeal,
  onMarkLost,
  onRegisterCall,
}: KanbanCardCompactProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
    data: { type: 'lead', leadId: lead.id },
  });

  // Depois de um drag, o navegador ainda dispara um click no card — sem o guard,
  // soltar o card abriria o drawer sem querer.
  const draggedRef = useRef(false);
  useEffect(() => {
    if (isDragging) {
      draggedRef.current = true;
      return;
    }
    const t = setTimeout(() => {
      draggedRef.current = false;
    }, 0);
    return () => clearTimeout(t);
  }, [isDragging]);

  const sla = slaStatusFor(nextSlaAt);
  const isClosers = pipeline === 'comercial';
  const aptBadge =
    isClosers && nextAppointmentAt
      ? appointmentBadge(nextAppointmentAt, appointmentConfirmed)
      : null;

  const sourceLabel = lead.source ? (SOURCE_LABELS[lead.source] ?? lead.source) : null;
  const isNewLead = lead.stage === 'novo_lead';
  const primaryDetail = nextAppointmentAt
    ? `Reunião ${new Date(nextAppointmentAt).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : (sourceLabel ?? 'Dados em atualização');

  function handleCardClick(e: React.MouseEvent<HTMLDivElement>) {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    // Botões internos (ações, checkbox) cuidam do próprio clique.
    if ((e.target as HTMLElement).closest('button, input, a')) return;
    onOpen(lead.id);
  }

  function handleCardKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onOpen(lead.id);
  }

  const dotTitle = SLA_DOT_LABELS[sla.status];
  const hasQuickActions = Boolean(
    (onQuickAttempt && attemptsCount < MAX_ATTEMPTS) ||
      onRegisterContact ||
      (isClosers && lead.stage === 'agendamentos' && nextAppointmentId && onRegisterCall) ||
      (isClosers && lead.stage !== 'agendamentos' && (onCloseDeal || onMarkLost)),
  );

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Abrir informações de ${lead.name}`}
      className={cn(
        'focus-ring group relative min-w-0 cursor-pointer touch-pan-y overflow-hidden rounded-xl border border-brand-100 bg-white p-3 text-left shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-brand-300 hover:shadow-md',
        isNewLead &&
          'border-brand-200 bg-gradient-to-br from-white via-white to-brand-50/80 shadow-[0_8px_24px_-18px_rgba(115,35,51,0.75)]',
        selected && 'ring-2 ring-brand-500',
        // Original invisível durante o drag — o DragOverlay pinta a cópia.
        isDragging && 'pointer-events-none opacity-0',
        groupDragging && selected && !isDragging && 'opacity-40',
      )}
    >
      {isNewLead && (
        <div className="mb-2.5 flex min-w-0 items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-brand-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-brand-700">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" aria-hidden />
            Novo contato
          </span>
          <span className="shrink-0 text-[10px] font-medium text-brand-400">
            Abrir ficha →
          </span>
        </div>
      )}

      <div className="flex min-w-0 items-start gap-2.5">
        <div className="flex shrink-0 flex-col items-center gap-1.5 pt-0.5">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(lead.id)}
            aria-label={`Selecionar ${lead.name}`}
            className="h-4 w-4 cursor-pointer accent-brand-600"
          />
          <span
            className={cn('h-2 w-2 rounded-full', SLA_DOT_CLASSES[sla.status])}
            title={dotTitle}
            aria-hidden
          />
        </div>

        <AssigneeAvatar name={assigneeName} role={assigneeRole} size="xs" />

        <div className="min-w-0 flex-1">
          <p className="break-words text-[15px] font-semibold leading-5 text-brand-800 [overflow-wrap:anywhere]">
            {lead.name}
            {missingFieldsToAdvance.length > 0 && (
              <span
                className="ml-1 font-semibold text-amber-600"
                title={`Cadastro incompleto: ${missingFieldsToAdvance.map(labelForField).join(', ')}`}
              >
                !
              </span>
            )}
          </p>
          <p
            className="mt-0.5 truncate text-[11px] leading-4 text-brand-400"
            title={
              reentered
                ? `Voltou (reentrada) em ${formatDateTime(stageEnteredAt)} · Primeira entrada no CRM: ${formatDateTime(lead.created_at)}`
                : `Na etapa desde ${formatDateTime(stageEnteredAt)} · Entrou no CRM em ${formatDateTime(lead.created_at)}`
            }
          >
            {primaryDetail} · {reentered ? 'voltou' : 'na etapa'} {formatRelative(stageEnteredAt)}
          </p>
        </div>

      </div>

      {(lead.interest_level ||
        sla.status === 'breached' ||
        sla.status === 'warning' ||
        lead.is_no_show ||
        aptBadge) && (
        <div className="mt-2 flex min-w-0 flex-wrap gap-1.5 text-[10px]">
          <InterestBadge lead={lead} size="xs" className="max-w-full" />
          {(sla.status === 'breached' || sla.status === 'warning') && (
            <span
              className={cn(
                'max-w-full truncate rounded-full px-2 py-1 font-semibold',
                sla.status === 'breached'
                  ? 'bg-red-50 text-red-700'
                  : 'bg-amber-50 text-amber-800',
              )}
            >
              {formatSlaCountdown(nextSlaAt)}
            </span>
          )}
          {lead.is_no_show && (
            <span className="rounded-full bg-red-50 px-2 py-1 font-semibold text-red-700">
              NO-SHOW
            </span>
          )}
          {aptBadge && (
            <span
              className={cn(
                'max-w-full truncate rounded-full bg-brand-50 px-2 py-1',
                APT_BADGE_TEXT[aptBadge.tone],
              )}
            >
              {aptBadge.label}
            </span>
          )}
        </div>
      )}

      <ChildProfileSummary lead={lead} compact />

      <div className="mt-2.5 flex min-w-0 items-stretch gap-1.5 border-t border-brand-100 pt-2.5">
        <button
          type="button"
          onClick={() => onOpen(lead.id)}
          className="focus-ring flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg bg-brand-700 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand-800"
        >
          Ver detalhes <span aria-hidden>→</span>
        </button>
        {onMove && (
          <button
            type="button"
            aria-label="Mover para outra etapa"
            title="Mover para outra etapa"
            onClick={() => onMove(lead.id)}
            className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-brand-200 bg-white text-brand-600 hover:bg-brand-50"
          >
            →
          </button>
        )}
        {onOpenChat && (
          <button
            type="button"
            aria-label="Abrir conversa"
            title="Abrir conversa"
            onClick={() => onOpenChat(lead.id)}
            className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-brand-200 bg-white text-brand-600 hover:bg-brand-50"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        )}
        <button
          type="button"
          aria-label="Arrastar para outra etapa"
          title="Arrastar para outra etapa"
          className="focus-ring flex h-10 w-10 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg border border-brand-200 bg-white text-brand-500 hover:bg-brand-50 hover:text-brand-700 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          ⋮⋮
        </button>
      </div>

      {hasQuickActions && (
        <div className="mt-1.5 grid min-w-0 grid-cols-2 gap-1.5">
          {onQuickAttempt && attemptsCount < MAX_ATTEMPTS && (
            <button
              type="button"
              title={`Registrar tentativa (${Math.min(attemptsCount, MAX_ATTEMPTS)}/${MAX_ATTEMPTS})`}
              onClick={() => onQuickAttempt(lead.id)}
              className="focus-ring min-h-9 min-w-0 truncate rounded-lg border border-brand-200 bg-brand-50 px-2 text-[11px] font-semibold text-brand-700 hover:bg-brand-100"
            >
              Tentativa {Math.min(attemptsCount, MAX_ATTEMPTS)}/{MAX_ATTEMPTS}
            </button>
          )}
          {onRegisterContact && (
            <button
              type="button"
              title="Registrar contato"
              onClick={() => onRegisterContact(lead.id)}
              className="focus-ring min-h-9 min-w-0 truncate rounded-lg border border-brand-200 bg-brand-50 px-2 text-[11px] font-semibold text-brand-700 hover:bg-brand-100"
            >
              Contato
            </button>
          )}
          {isClosers && lead.stage === 'agendamentos' && nextAppointmentId && onRegisterCall && (
            <button
              type="button"
              title="Registrar resultado da visita"
              onClick={() => onRegisterCall(lead.id, nextAppointmentId)}
              className="focus-ring col-span-2 min-h-9 min-w-0 truncate rounded-lg border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100"
            >
              Registrar resultado da visita
            </button>
          )}
          {isClosers && lead.stage !== 'agendamentos' && onCloseDeal && (
            <button
              type="button"
              aria-label="Fechar venda"
              title="Fechar venda"
              onClick={() => onCloseDeal(lead.id)}
              className="focus-ring min-h-9 min-w-0 truncate rounded-lg border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100"
            >
              Fechar matrícula
            </button>
          )}
          {isClosers && lead.stage !== 'agendamentos' && onMarkLost && (
            <button
              type="button"
              aria-label="Marcar perdido"
              title="Marcar perdido"
              onClick={() => onMarkLost(lead.id)}
              className="focus-ring min-h-9 min-w-0 truncate rounded-lg border border-brand-200 bg-white px-2 text-[11px] font-semibold text-brand-600 hover:bg-red-50 hover:text-red-700"
            >
              Marcar perdido
            </button>
          )}
        </div>
      )}
    </div>
  );
}

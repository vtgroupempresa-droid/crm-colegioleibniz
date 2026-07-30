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

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
      e.preventDefault();
      onOpen(lead.id);
    }
  }

  const dotTitle = SLA_DOT_LABELS[sla.status];

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      aria-label={lead.name}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'group relative flex min-h-14 cursor-grab touch-pan-y select-none items-center gap-2.5 rounded-lg border border-brand-100 bg-white px-2.5 py-2 text-left shadow-sm transition-all hover:-translate-y-px hover:border-brand-200 hover:shadow-md active:cursor-grabbing',
        selected && 'ring-2 ring-brand-500',
        // Original invisível durante o drag — o DragOverlay pinta a cópia.
        isDragging && 'pointer-events-none opacity-0',
        groupDragging && selected && !isDragging && 'opacity-40',
      )}
    >
      {/* Slot esquerdo (desktop): dot de SLA que vira checkbox no hover/seleção. */}
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center [@media(hover:none)]:hidden">
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            SLA_DOT_CLASSES[sla.status],
            selected && 'hidden',
            'group-hover:hidden',
          )}
          title={dotTitle}
          aria-hidden
        />
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(lead.id)}
          aria-label={`Selecionar ${lead.name}`}
          className={cn(
            'absolute h-4 w-4 cursor-pointer accent-brand-600',
            selected ? 'block' : 'hidden group-hover:block',
          )}
        />
      </span>
      {/* Touch: dot sempre visível (o checkbox fica no cluster de ações). */}
      <span
        className={cn(
          'hidden h-2 w-2 shrink-0 rounded-full [@media(hover:none)]:block',
          SLA_DOT_CLASSES[sla.status],
        )}
        title={dotTitle}
        aria-hidden
      />

      <AssigneeAvatar name={assigneeName} role={assigneeRole} size="xs" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-tight text-brand-700">
          {lead.name}
          {missingFieldsToAdvance.length > 0 && (
            <span
              className="ml-1 font-semibold text-amber-600"
              title={`ICP incompleto: ${missingFieldsToAdvance.map(labelForField).join(', ')}`}
            >
              !
            </span>
          )}
        </p>
        <ChildProfileSummary lead={lead} compact />
        {/* "na etapa há X" (tempo na coluna) ≠ data de criação do lead — o rótulo
            evita ler um lead antigo reativado como se fosse recém-criado. */}
        <p
          className="truncate text-[11px] leading-tight text-brand-400"
          title={
            reentered
              ? `Voltou (reentrada) em ${formatDateTime(stageEnteredAt)} · Primeira entrada no CRM: ${formatDateTime(lead.created_at)}`
              : `Na etapa desde ${formatDateTime(stageEnteredAt)} · Entrou no CRM em ${formatDateTime(lead.created_at)}`
          }
        >
          {primaryDetail} · {reentered ? 'voltou' : 'na etapa'} {formatRelative(stageEnteredAt)}
          {(sla.status === 'breached' || sla.status === 'warning') && (
            <span className={sla.status === 'breached' ? 'font-semibold text-red-600' : 'text-amber-700'}>
              {' · '}{formatSlaCountdown(nextSlaAt)}
            </span>
          )}
          {lead.is_no_show && <span className="font-semibold text-red-600"> · NO-SHOW</span>}
          {aptBadge && <span className={APT_BADGE_TEXT[aptBadge.tone]}> · {aptBadge.label}</span>}
        </p>
      </div>

      <InterestBadge lead={lead} size="xs" />

      {/* Ações rápidas: overlay no hover (desktop) / inline sempre visível (touch). */}
      <div
        className={cn(
          'absolute inset-y-0 right-1 z-10 flex items-center gap-0.5 rounded-md bg-white/95 pl-1',
          'pointer-events-none opacity-0 transition-opacity',
          'group-hover:pointer-events-auto group-hover:opacity-100',
          'group-focus-within:pointer-events-auto group-focus-within:opacity-100',
          '[@media(hover:none)]:static [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:bg-transparent [@media(hover:none)]:pl-0 [@media(hover:none)]:opacity-100',
        )}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(lead.id)}
          aria-label={`Selecionar ${lead.name}`}
          className="hidden h-4 w-4 cursor-pointer accent-brand-600 [@media(hover:none)]:block"
        />
        {onMove && (
          <button
            type="button"
            aria-label="Mover para outra etapa"
            title="Mover para outra etapa"
            onClick={() => onMove(lead.id)}
            className="focus-ring rounded p-1 text-brand-400 hover:bg-brand-100 hover:text-brand-700"
          >
            →
          </button>
        )}
        <button
          type="button"
          aria-label="Arrastar para outra etapa"
          title="Arrastar para outra etapa"
          className="focus-ring cursor-grab rounded px-1 text-brand-400 hover:bg-brand-100 hover:text-brand-700 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          ⋮⋮
        </button>
        {onQuickAttempt && attemptsCount < MAX_ATTEMPTS && (
          <button
            type="button"
            aria-label="Registrar tentativa"
            title={`Registrar tentativa (${Math.min(attemptsCount, MAX_ATTEMPTS)}/${MAX_ATTEMPTS})`}
            onClick={() => onQuickAttempt(lead.id)}
            className="focus-ring rounded p-1 text-brand-400 hover:bg-brand-100 hover:text-brand-700"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </button>
        )}
        {onRegisterContact && (
          <button
            type="button"
            aria-label="Registrar contato"
            title="Registrar contato"
            onClick={() => onRegisterContact(lead.id)}
            className="focus-ring rounded p-1 text-brand-400 hover:bg-brand-100 hover:text-brand-700"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </button>
        )}
        {onOpenChat && (
          <button
            type="button"
            aria-label="Abrir chat"
            title="Abrir chat"
            onClick={() => onOpenChat(lead.id)}
            className="focus-ring rounded p-1 text-brand-400 hover:bg-brand-100 hover:text-brand-700"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
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
        {/* Ações essenciais do CLOSER (mesma regra do card confortável): registrar
            call na coluna de agendamentos; fechar venda/perdido nas demais. */}
        {isClosers && lead.stage === 'agendamentos' && nextAppointmentId && onRegisterCall && (
          <button
            type="button"
            aria-label="Registrar call"
            title="Registrar call"
            onClick={() => onRegisterCall(lead.id, nextAppointmentId)}
            className="focus-ring rounded p-1 text-brand-400 hover:bg-brand-100 hover:text-brand-700"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 5h6" />
              <path d="M18 2v6" />
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </button>
        )}
        {isClosers && lead.stage !== 'agendamentos' && onCloseDeal && (
          <button
            type="button"
            aria-label="Fechar venda"
            title="Fechar venda"
            onClick={() => onCloseDeal(lead.id)}
            className="focus-ring rounded p-1 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="12" x2="12" y1="2" y2="22" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </button>
        )}
        {isClosers && lead.stage !== 'agendamentos' && onMarkLost && (
          <button
            type="button"
            aria-label="Marcar perdido"
            title="Marcar perdido"
            onClick={() => onMarkLost(lead.id)}
            className="focus-ring rounded p-1 text-brand-400 hover:bg-red-50 hover:text-red-600"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="m15 9-6 6" />
              <path d="m9 9 6 6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

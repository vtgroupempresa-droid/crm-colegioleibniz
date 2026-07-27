'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AssigneeAvatar } from '@/components/ui/assignee-avatar';
import { EducationTag, InterestBadge } from '@/components/leads/interest-badge';
import { TemperatureBadge } from '@/components/leads/temperature-badge';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import { formatDateTime, formatRelative } from '@/lib/utils/format';
import { MAX_ATTEMPTS, formatSlaCountdown, slaStatusFor } from '@/lib/sla/rules';
import { IcpWarningBadge } from './icp-warning-badge';
import {
  isLeadQualificationStatus,
  LEAD_QUALIFICATION_LABELS,
  LOST_REASON_LABELS,
  PAID_LEAD_SOURCES,
} from '@/types/lead';
import type { Lead, LEAD_SOURCES } from '@/types/lead';
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

interface KanbanCardProps {
  lead: Lead;
  pipeline: PipelineKind;
  stageEnteredAt: string;
  /** Chegou na coluna por reativação (reentrada) — rodapé mostra "Voltou há X". */
  reentered?: boolean;
  /** SLA mais próximo (ISO) ainda não cumprido; null se nenhum pendente. */
  nextSlaAt: string | null;
  /** Lista de campos faltantes que bloqueiam (soft) o avanço. */
  missingFieldsToAdvance: readonly string[];
  /** Quantas tentativas já registradas (0..8). Usado pelo card SDR. */
  attemptsCount: number;
  /** Próxima visita presencial marcada — driver dos badges D-1/D-0. */
  nextAppointmentAt: string | null;
  appointmentConfirmed: boolean;
  /** Quem agendou a visita. */
  appointmentCreatorName?: string | null;
  /** Quem vai atender a visita. */
  appointmentAssigneeName?: string | null;
  /** Responsável do lead (avatar no rodapé do card). */
  assigneeName?: string | null;
  assigneeRole?: string | null;
  /** Seleção múltipla: card marcado e callback de toggle. */
  selected: boolean;
  onToggleSelect: (leadId: string) => void;
  /** True enquanto um arrasto EM GRUPO acontece — esmaece os outros selecionados. */
  groupDragging?: boolean;
  onOpen: (leadId: string) => void;
  onOpenChat?: (leadId: string) => void;
  onQuickAttempt?: (leadId: string) => void;
  /** Ação rápida "Registrar contato" (cards de captação e SDR). */
  onRegisterContact?: (leadId: string) => void;
  onConfirmAppointment?: (appointmentId: string) => void;
  /** Disparado pelo card do closer em stage=agendamentos. */
  onRegisterCall?: (leadId: string, appointmentId: string) => void;
  /** Abre o modal de edição do agendamento (board do closer). */
  onEditAppointment?: (appointmentId: string) => void;
  /** Disparado pelos atalhos do closer ("Fechar matrícula" / "Marcar perdido"). */
  onCloseDeal?: (leadId: string) => void;
  onMarkLost?: (leadId: string) => void;
  nextAppointmentId?: string | null;
}

const HOUR_MS = 60 * 60 * 1000;

/** Badge D-1/D-0 do agendamento — compartilhado com o card compacto. */
export function appointmentBadge(
  scheduledAt: string,
  confirmed: boolean,
): { label: string; tone: 'success' | 'warning' | 'danger' } | null {
  if (confirmed) return { label: '✓ Confirmado', tone: 'success' };
  const diff = new Date(scheduledAt).getTime() - Date.now();
  // Reunião já passou e segue sem confirmação de presença → alerta vermelho.
  if (diff < 0) return { label: '⚠ Reunião passou', tone: 'danger' };
  if (diff <= 4 * HOUR_MS) {
    return { label: 'Confirmar D-0', tone: 'danger' };
  }
  if (diff > 20 * HOUR_MS && diff <= 28 * HOUR_MS) {
    return { label: 'Confirmar D-1', tone: 'warning' };
  }
  return null;
}

export function KanbanCard({
  lead,
  pipeline,
  stageEnteredAt,
  reentered = false,
  nextSlaAt,
  missingFieldsToAdvance,
  attemptsCount,
  nextAppointmentAt,
  appointmentConfirmed,
  appointmentCreatorName = null,
  appointmentAssigneeName = null,
  nextAppointmentId,
  assigneeName = null,
  assigneeRole = null,
  selected,
  onToggleSelect,
  groupDragging = false,
  onOpen,
  onOpenChat,
  onQuickAttempt,
  onRegisterContact,
  onConfirmAppointment,
  onRegisterCall,
  onEditAppointment,
  onCloseDeal,
  onMarkLost,
}: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
    data: { type: 'lead', leadId: lead.id },
  });

  const sla = slaStatusFor(nextSlaAt);
  // Funil único: a cadência de contato e a visita convivem no mesmo card — o
  // bloco de tentativas aparece antes da visita ser marcada, e o da visita
  // assim que existe agendamento.
  const showCadence = pipeline === 'comercial' && !nextAppointmentAt;
  const showVisit = pipeline === 'comercial' && Boolean(nextAppointmentAt);

  const borderClass =
    sla.status === 'breached'
      ? 'border-l-4 border-l-red-500'
      : sla.status === 'warning'
        ? 'border-l-4 border-l-amber-500'
        : sla.status === 'ok'
          ? 'border-l-4 border-l-emerald-500'
          : '';

  const aptBadge = nextAppointmentAt
    ? appointmentBadge(nextAppointmentAt, appointmentConfirmed)
    : null;
  const qualificationStatus = isLeadQualificationStatus(lead.qualification_status)
    ? lead.qualification_status
    : null;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group flex flex-col gap-2 rounded-md border border-brand-100 bg-white p-3 text-left shadow-sm transition-shadow hover:shadow-md',
        borderClass,
        selected && 'ring-2 ring-brand-500',
        // Esconde o card original enquanto está sendo arrastado — o DragOverlay
        // pinta a cópia visual seguindo o cursor.
        isDragging && 'pointer-events-none opacity-0',
        // Em arrasto de grupo, os demais selecionados ficam esmaecidos (vão junto).
        groupDragging && selected && !isDragging && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(lead.id)}
          aria-label={`Selecionar ${lead.name}`}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-brand-600"
        />
        <button
          type="button"
          onClick={() => onOpen(lead.id)}
          className="focus-ring -m-1 min-w-0 flex-1 cursor-pointer rounded p-1 text-left"
        >
          <p className="truncate text-sm font-semibold text-brand-700">{lead.name}</p>
          <p className="truncate text-xs text-brand-400">
            {lead.child_name ?? 'aluno não informado'}
            {lead.child_age ? ` · ${lead.child_age} anos` : ''}
          </p>
          <EducationTag lead={lead} />
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {onOpenChat && (
            <button
              type="button"
              aria-label="Abrir chat"
              title="Abrir chat"
              onClick={() => onOpenChat(lead.id)}
              className="focus-ring rounded p-1 text-brand-300 hover:bg-brand-100 hover:text-brand-600"
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
          {lead.phone && (
            <a
              href={`tel:${lead.phone}`}
              aria-label="Ligar"
              title="Ligar"
              onClick={(e) => e.stopPropagation()}
              className="focus-ring rounded p-1 text-brand-300 hover:bg-brand-100 hover:text-brand-600"
            >
              📞
            </a>
          )}
          <button
            type="button"
            aria-label="Arrastar"
            className="focus-ring cursor-grab rounded p-1 text-brand-300 hover:bg-brand-100 active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            ⋮⋮
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <InterestBadge lead={lead} />
        <TemperatureBadge tags={lead.tags} />
        {qualificationStatus && (
          <Badge tone="info" title={lead.qualification_note ?? LEAD_QUALIFICATION_LABELS[qualificationStatus]}>
            ✨ {LEAD_QUALIFICATION_LABELS[qualificationStatus]}
          </Badge>
        )}
        {lead.source && (
          // Fonte paga ganha o tom da marca para diferenciar de orgânica no board.
          <Badge tone={PAID_LEAD_SOURCES.includes(lead.source) ? 'brand' : 'neutral'}>
            {SOURCE_LABELS[lead.source] ?? lead.source}
          </Badge>
        )}
        {lead.is_no_show && <Badge tone="danger">NO-SHOW</Badge>}
        {lead.stage === 'perdido' && lead.lost_reason && (
          <Badge tone="danger">Lost: {LOST_REASON_LABELS[lead.lost_reason]}</Badge>
        )}
        <IcpWarningBadge missingFields={missingFieldsToAdvance} />
      </div>

      {showCadence && (
        <div className="flex flex-col gap-1 rounded-md bg-brand-50 px-2 py-1.5 text-xs">
          <div className="flex items-center justify-between text-brand-600">
            <span className="font-medium">
              Tentativa {Math.min(attemptsCount, MAX_ATTEMPTS)}/{MAX_ATTEMPTS}
            </span>
            <span
              className={cn(
                'font-medium',
                sla.status === 'breached' && 'text-red-600',
                sla.status === 'warning' && 'text-amber-700',
                sla.status === 'ok' && 'text-emerald-700',
                sla.status === 'none' && 'text-brand-400',
              )}
            >
              {formatSlaCountdown(nextSlaAt)}
            </span>
          </div>
          {onQuickAttempt && attemptsCount < MAX_ATTEMPTS && (
            <button
              type="button"
              onClick={() => onQuickAttempt(lead.id)}
              className="focus-ring mt-1 w-full rounded-md border border-brand-200 bg-white px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100"
            >
              + Registrar tentativa
            </button>
          )}
          {onRegisterContact && (
            <button
              type="button"
              onClick={() => onRegisterContact(lead.id)}
              className="focus-ring w-full rounded-md border border-brand-200 bg-white px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100"
            >
              Registrar contato
            </button>
          )}
        </div>
      )}

      {showVisit && nextAppointmentAt && (
        <div className="flex flex-col gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-800">
          <span className="font-medium">
            Visita{' '}
            {new Date(nextAppointmentAt).toLocaleString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          {appointmentAssigneeName && (
            <span className="text-[11px] text-emerald-700">
              Atende: {appointmentAssigneeName}
            </span>
          )}
          {appointmentCreatorName && appointmentCreatorName !== appointmentAssigneeName && (
            <span className="text-[11px] text-emerald-700/80">
              Agendou: {appointmentCreatorName}
            </span>
          )}
          {aptBadge && (
            <div className="flex items-center gap-2">
              <Badge tone={aptBadge.tone}>{aptBadge.label}</Badge>
              {!appointmentConfirmed && onConfirmAppointment && nextAppointmentId && (
                <button
                  type="button"
                  onClick={() => onConfirmAppointment(nextAppointmentId)}
                  className="focus-ring rounded-md border border-brand-200 bg-white px-2 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-100"
                >
                  Confirmar
                </button>
              )}
            </div>
          )}
          {lead.stage === 'visita_presencial' && nextAppointmentId && onRegisterCall && (
            <button
              type="button"
              onClick={() => onRegisterCall(lead.id, nextAppointmentId)}
              className="focus-ring mt-1 w-full rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
            >
              Registrar resultado da visita
            </button>
          )}
          {nextAppointmentId && onEditAppointment && (
            <button
              type="button"
              onClick={() => onEditAppointment(nextAppointmentId)}
              className="focus-ring mt-1 w-full rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
            >
              Editar visita
            </button>
          )}
        </div>
      )}

      {(onCloseDeal || onMarkLost) && lead.stage !== 'visita_presencial' && (
        <div className="flex gap-1">
          {onCloseDeal && (
            <button
              type="button"
              onClick={() => onCloseDeal(lead.id)}
              className="focus-ring flex-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
            >
              Fechar matrícula
            </button>
          )}
          {onMarkLost && (
            <button
              type="button"
              onClick={() => onMarkLost(lead.id)}
              className="focus-ring flex-1 rounded-md border border-brand-200 bg-white px-2 py-1 text-[11px] font-medium text-brand-500 hover:bg-brand-100"
            >
              Marcar perdido
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        {/* Tempo NA COLUNA (última movimentação), não a data de criação do lead. */}
        <p
          className="text-[11px] text-brand-300"
          title={
            reentered
              ? `Voltou (reentrada) em ${formatDateTime(stageEnteredAt)} · Primeira entrada no CRM: ${formatDateTime(lead.created_at)}`
              : `Na etapa desde ${formatDateTime(stageEnteredAt)} · Entrou no CRM em ${formatDateTime(lead.created_at)}`
          }
        >
          {reentered ? 'Voltou' : 'Na etapa'} {formatRelative(stageEnteredAt)}
        </p>
        <AssigneeAvatar name={assigneeName} role={assigneeRole} />
      </div>
    </div>
  );
}

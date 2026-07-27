'use client';

import { AssigneeAvatar } from '@/components/ui/assignee-avatar';
import { InterestBadge } from '@/components/leads/interest-badge';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import { formatRelative } from '@/lib/utils/format';
import { slaStatusFor } from '@/lib/sla/rules';
import { SLA_DOT_CLASSES } from './kanban-card-compact';
import type { BoardDensity } from './use-board-density';
import { LOST_REASON_LABELS } from '@/types/lead';
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

interface KanbanCardOverlayProps {
  lead: Lead;
  pipeline: PipelineKind;
  nextSlaAt: string | null;
  /** Densidade ativa do board — o overlay imita o card correspondente. */
  density?: BoardDensity;
  /** Usados pela variante compacta (dot + avatar + meta). */
  stageEnteredAt?: string | null;
  assigneeName?: string | null;
  assigneeRole?: string | null;
}

/**
 * Versão visual (não-sortable) do card usada dentro do DragOverlay do dnd-kit.
 * Tem uma variante por densidade: compacta (linha única, espelha o
 * KanbanCardCompact) e confortável (nome, especialidade, score e badges).
 * Não há botões interativos — a versão "real" volta a ser renderizada quando
 * o drag termina.
 */
export function KanbanCardOverlay({
  lead,
  pipeline,
  nextSlaAt,
  density = 'comfortable',
  stageEnteredAt = null,
  assigneeName = null,
  assigneeRole = null,
}: KanbanCardOverlayProps) {
  const sla = slaStatusFor(nextSlaAt);
  const isSdr = pipeline === 'comercial';

  if (density === 'compact') {
    const sourceLabel = lead.source ? (SOURCE_LABELS[lead.source] ?? lead.source) : null;
    return (
      <div className="flex w-72 rotate-1 cursor-grabbing items-center gap-2 rounded-md border border-brand-200 bg-white px-2 py-1.5 shadow-2xl ring-2 ring-brand-300">
        <span
          className={cn('h-2 w-2 shrink-0 rounded-full', SLA_DOT_CLASSES[sla.status])}
          aria-hidden
        />
        <AssigneeAvatar name={assigneeName} role={assigneeRole} size="xs" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight text-brand-700">{lead.name}</p>
          <p className="truncate text-[11px] leading-tight text-brand-400">
            {sourceLabel ?? lead.child_name ?? 'sem origem'}
            {stageEnteredAt ? ` · na etapa ${formatRelative(stageEnteredAt)}` : ''}
          </p>
        </div>
        <InterestBadge lead={lead} size="xs" />
      </div>
    );
  }

  const borderClass =
    isSdr && sla.status === 'breached'
      ? 'border-l-4 border-l-red-500'
      : isSdr && sla.status === 'warning'
      ? 'border-l-4 border-l-amber-500'
      : isSdr && sla.status === 'ok'
      ? 'border-l-4 border-l-emerald-500'
      : '';

  return (
    <div
      className={cn(
        'w-72 rotate-2 cursor-grabbing rounded-md border border-brand-200 bg-white p-3 shadow-2xl ring-2 ring-brand-300',
        borderClass,
      )}
    >
      <div className="flex flex-col gap-2">
        <div>
          <p className="truncate text-sm font-semibold text-brand-700">{lead.name}</p>
          <p className="truncate text-xs text-brand-400">
            {lead.child_name ?? 'aluno não informado'}
            {lead.city ? ` · ${lead.city}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <InterestBadge lead={lead} size="xs" />
          {lead.source && (
            <Badge tone="neutral">{SOURCE_LABELS[lead.source] ?? lead.source}</Badge>
          )}
          {lead.is_no_show && <Badge tone="danger">NO-SHOW</Badge>}
          {lead.stage === 'perdido' && lead.lost_reason && (
            <Badge tone="danger">Lost: {LOST_REASON_LABELS[lead.lost_reason]}</Badge>
          )}
        </div>
      </div>
    </div>
  );
}

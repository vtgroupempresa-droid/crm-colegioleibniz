'use client';

import { KanbanCardStandard } from './kanban-card-standard';
import type { SlaStatus } from '@/lib/sla/rules';
import type { Lead } from '@/types/lead';
import type { PipelineKind } from '@/types/pipeline';

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

interface KanbanCardCompactProps {
  lead: Lead;
  pipeline: PipelineKind;
  stageEnteredAt: string;
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
  onMove?: (leadId: string) => void;
  onOpenChat?: (leadId: string) => void;
  onQuickAttempt?: (leadId: string) => void;
  onRegisterContact?: (leadId: string) => void;
  onCloseDeal?: (leadId: string) => void;
  onMarkLost?: (leadId: string) => void;
  onRegisterCall?: (leadId: string, appointmentId: string) => void;
}

/** O modo compacto usa exatamente o mesmo card para manter consistência visual. */
export function KanbanCardCompact({
  lead,
  selected,
  onToggleSelect,
  groupDragging,
  onOpen,
  onMove,
}: KanbanCardCompactProps) {
  return (
    <KanbanCardStandard
      lead={lead}
      selected={selected}
      onToggleSelect={onToggleSelect}
      groupDragging={groupDragging}
      onOpen={onOpen}
      onMove={onMove}
    />
  );
}

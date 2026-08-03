'use client';

import { KanbanCardStandard } from './kanban-card-standard';
import type { Lead } from '@/types/lead';
import type { PipelineKind } from '@/types/pipeline';

interface KanbanCardProps {
  lead: Lead;
  pipeline: PipelineKind;
  stageEnteredAt: string;
  reentered?: boolean;
  nextSlaAt: string | null;
  missingFieldsToAdvance: readonly string[];
  attemptsCount: number;
  nextAppointmentAt: string | null;
  appointmentConfirmed: boolean;
  appointmentCreatorName?: string | null;
  appointmentAssigneeName?: string | null;
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
  onConfirmAppointment?: (appointmentId: string) => void;
  onRegisterCall?: (leadId: string, appointmentId: string) => void;
  onEditAppointment?: (appointmentId: string) => void;
  onCloseDeal?: (leadId: string) => void;
  onMarkLost?: (leadId: string) => void;
  nextAppointmentId?: string | null;
}

/**
 * Compatibilidade do modo confortável com o padrão único do funil.
 * Os dados operacionais permanecem no drawer e não disputam espaço no card.
 */
export function KanbanCard({
  lead,
  selected,
  onToggleSelect,
  groupDragging,
  onOpen,
  onMove,
}: KanbanCardProps) {
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

'use client';

import { useMemo } from 'react';
import type { KanbanLeadEntry } from './kanban-board';

interface CloserSummaryBarProps {
  entries: readonly KanbanLeadEntry[];
}

/**
 * Barra de resumo do painel /closers (Fase 4).
 *  - Calls hoje: appointments com scheduled_at = hoje.
 *  - Aguardando follow-up: leads em `follow_up_vendas` que entraram no stage
 *    há mais de 24h sem activity nova (heurística: stageEnteredAt > 24h).
 *  - Propostas abertas: leads em `desqualificado_momento` (nome enganoso por
 *    decisão do produto — manter slug).
 */
export function CloserSummaryBar({ entries }: CloserSummaryBarProps) {
  const stats = useMemo(() => {
    const day24hMs = 24 * 60 * 60 * 1000;
    const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const todayKey = dayKey(new Date());
    const tomorrowKey = dayKey(new Date(Date.now() + day24hMs));

    let callsToday = 0;
    let callsTomorrow = 0;
    let waitingFollowUp = 0;
    let openProposals = 0;

    for (const entry of entries) {
      if (entry.nextAppointmentAt) {
        const aptKey = dayKey(new Date(entry.nextAppointmentAt));
        if (aptKey === todayKey) callsToday += 1;
        else if (aptKey === tomorrowKey) callsTomorrow += 1;
      }
      if (entry.lead.stage === 'follow_up_vendas') {
        const stageEntered = new Date(entry.stageEnteredAt).getTime();
        if (Date.now() - stageEntered > day24hMs) waitingFollowUp += 1;
      }
      if (entry.lead.stage === 'desqualificado_momento') {
        openProposals += 1;
      }
    }

    return { callsToday, callsTomorrow, waitingFollowUp, openProposals };
  }, [entries]);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-brand-100 bg-white p-2 shadow-sm">
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">
        <span className="text-sm font-semibold">{stats.callsToday}</span>
        <span>{stats.callsToday === 1 ? 'call hoje' : 'calls hoje'}</span>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-700">
        <span className="text-sm font-semibold">{stats.callsTomorrow}</span>
        <span>{stats.callsTomorrow === 1 ? 'call amanhã' : 'calls amanhã'}</span>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
        <span className="text-sm font-semibold">{stats.waitingFollowUp}</span>
        <span>{stats.waitingFollowUp === 1 ? 'aguardando follow-up' : 'aguardando follow-up'}</span>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-700">
        <span className="text-sm font-semibold">{stats.openProposals}</span>
        <span>{stats.openProposals === 1 ? 'proposta aberta' : 'propostas abertas'}</span>
      </div>
    </div>
  );
}

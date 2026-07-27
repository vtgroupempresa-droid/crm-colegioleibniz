'use client';

import { GaugeCard, type GaugeColor, type GaugePillTone } from '@/components/leads/gauge-card';
import type { PipelineBoardStats } from '@/actions/leads-queries';
import { PIPELINE_LABELS, type PipelineKind } from '@/types/pipeline';

interface GaugeDef {
  value: number;
  max: number;
  color: GaugeColor;
  label: string;
  description: string;
  pill: { text: string; tone: GaugePillTone };
}

interface PipelineGaugesProps {
  pipeline: PipelineKind;
  stats: PipelineBoardStats;
  /** Quantos outros pipelines existem além do ativo (pill de "Leads ativos"). */
  siblingCount: number;
}

/**
 * Dashboard de 6 gauges de /oportunidades — mesmas GaugeCards de /leads, mas
 * contextual ao pipeline da aba ativa: cada pipeline tem seu conjunto de
 * métricas (SDR foca SLA, Closers foca agenda/vendas). Pipelines com pouca
 * telemetria própria caem no conjunto genérico (ativos/novos/sem responsável/
 * quentes), válido para qualquer board.
 */
export function PipelineGauges({ pipeline, stats, siblingCount }: PipelineGaugesProps) {
  const gauges = buildGauges(pipeline, stats, siblingCount);
  return (
    <div className="grid grid-flow-col auto-cols-[minmax(150px,1fr)] gap-3 overflow-x-auto pb-1 sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-3 sm:overflow-visible sm:pb-0 xl:grid-cols-6">
      {gauges.map((g) => (
        <GaugeCard key={g.label} {...g} />
      ))}
    </div>
  );
}

function buildGauges(
  pipeline: PipelineKind,
  stats: PipelineBoardStats,
  siblingCount: number,
): GaugeDef[] {
  const base = Math.max(1, stats.activeLeads);
  const newDelta = stats.newToday - stats.newPrevDay;

  const ativos: GaugeDef = {
    value: stats.activeLeads,
    max: base,
    color: 'blue',
    label: 'Leads ativos',
    description: `no pipeline ${PIPELINE_LABELS[pipeline]}`,
    pill: { text: `${siblingCount} pipelines ao lado`, tone: 'neutral' },
  };
  const novosHoje: GaugeDef = {
    value: stats.newToday,
    max: Math.max(10, stats.newToday, stats.newPrevDay),
    color: 'green',
    label: 'Novos hoje',
    description: 'entraram nas últimas 24h',
    pill:
      newDelta > 0
        ? { text: `↑ ${newDelta} vs ontem`, tone: 'up' }
        : newDelta < 0
          ? { text: `↓ ${Math.abs(newDelta)} vs ontem`, tone: 'down' }
          : { text: 'no ritmo de ontem', tone: 'neutral' },
  };
  const semResponsavel: GaugeDef = {
    value: stats.unassigned,
    max: base,
    color: 'purple',
    label: 'Sem responsável',
    description: 'aguardando atribuição',
    pill:
      stats.unassigned > 0
        ? { text: 'distribuir agora', tone: 'neutral' }
        : { text: 'tudo atribuído', tone: 'up' },
  };
  const tentativasHoje: GaugeDef = {
    value: stats.attemptsToday,
    max: Math.max(50, stats.attemptsToday),
    color: 'blue',
    label: 'Tentativas hoje',
    description: 'registradas pela equipe',
    pill:
      stats.attemptsToday > 0
        ? { text: '↑ ritmo bom', tone: 'up' }
        : { text: 'nenhuma ainda', tone: 'neutral' },
  };
  const quentes: GaugeDef = {
    value: stats.hotLeads,
    max: base,
    color: 'red',
    label: 'Leads quentes',
    description: 'score acima de 70',
    pill: { text: `${Math.round((100 * stats.hotLeads) / base)}% do pipeline`, tone: 'neutral' },
  };
  const responderam: GaugeDef = {
    value: stats.respondedThisWeek,
    max: base,
    color: 'amber',
    label: 'Responderam na semana',
    description: 'contato respondido esta semana',
    pill:
      stats.respondedThisWeek > 0
        ? { text: 'engajamento vivo', tone: 'up' }
        : { text: 'sem respostas ainda', tone: 'neutral' },
  };

  if (pipeline === 'comercial') {
    const slaVencido: GaugeDef = {
      value: stats.slaBreached,
      max: Math.max(25, stats.slaBreached),
      color: 'red',
      label: 'SLA vencido',
      description: 'sem tentativa recente',
      pill:
        stats.slaBreached > 0
          ? { text: '⚠ agir agora', tone: 'alert' }
          : { text: 'tudo em dia', tone: 'up' },
    };
    const visitasHoje: GaugeDef = {
      value: stats.appointmentsToday,
      max: Math.max(8, stats.appointmentsToday),
      color: 'green',
      label: 'Visitas hoje',
      description: 'visitas marcadas para hoje',
      pill:
        stats.appointmentsToday > 0
          ? { text: 'agenda do dia', tone: 'up' }
          : { text: 'nenhuma hoje', tone: 'neutral' },
    };
    const matriculasMes: GaugeDef = {
      value: stats.salesThisMonth,
      max: Math.max(10, stats.salesThisMonth),
      color: 'purple',
      label: 'Matrículas no mês',
      description: 'matrículas fechadas no mês corrente',
      pill:
        stats.salesThisMonth > 0
          ? { text: '↑ fechando matrículas', tone: 'up' }
          : { text: 'sem matrículas ainda', tone: 'neutral' },
    };
    const confirmacoes: GaugeDef = {
      value: stats.pendingConfirmations,
      max: Math.max(10, stats.pendingConfirmations),
      color: 'amber',
      label: 'Visitas a confirmar',
      description: 'visitas futuras sem confirmação da família',
      pill:
        stats.pendingConfirmations > 0
          ? { text: '⚠ confirmar agenda', tone: 'alert' }
          : { text: 'tudo confirmado', tone: 'up' },
    };
    return [ativos, slaVencido, visitasHoje, confirmacoes, matriculasMes, quentes];
  }

  // Pós-Matrícula (e fallback): conjunto genérico universal.
  return [ativos, novosHoje, semResponsavel, quentes, tentativasHoje, responderam];
}

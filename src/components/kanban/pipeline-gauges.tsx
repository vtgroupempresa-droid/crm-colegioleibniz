'use client';

import { cn } from '@/lib/utils/cn';
import type { GaugeColor, GaugePillTone } from '@/components/leads/gauge-card';
import type { PipelineBoardStats } from '@/actions/leads-queries';
import { PIPELINE_LABELS, type PipelineKind } from '@/types/pipeline';

interface GaugeDef {
  value: number;
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
 * Resumo operacional do /oportunidades: quatro indicadores realmente acionáveis
 * para que o board continue sendo o foco da tela.
 */
export function PipelineGauges({ pipeline, stats, siblingCount }: PipelineGaugesProps) {
  const gauges = buildGauges(pipeline, stats, siblingCount);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {gauges.map((g) => (
        <article
          key={g.label}
          className="rounded-xl border border-brand-100 bg-white px-3 py-2.5 shadow-sm"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-brand-500">{g.label}</p>
              <p className={cn('mt-1 text-2xl font-semibold leading-none tabular-nums', VALUE_COLORS[g.color])}>
                {g.value.toLocaleString('pt-BR')}
              </p>
            </div>
            <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', DOT_COLORS[g.color])} aria-hidden />
          </div>
          <p className="mt-2 truncate text-[11px] text-brand-400">{g.description}</p>
          {g.pill && (
            <p className={cn('mt-1.5 truncate text-[11px] font-medium', PILL_TEXT_COLORS[g.pill.tone])}>
              {g.pill.text}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}

const VALUE_COLORS: Record<GaugeColor, string> = {
  blue: 'text-sky-700',
  red: 'text-red-600',
  amber: 'text-amber-600',
  green: 'text-emerald-600',
  purple: 'text-violet-600',
};

const DOT_COLORS: Record<GaugeColor, string> = {
  blue: 'bg-sky-500',
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  green: 'bg-emerald-500',
  purple: 'bg-violet-500',
};

const PILL_TEXT_COLORS: Record<GaugePillTone, string> = {
  up: 'text-emerald-700',
  down: 'text-red-600',
  alert: 'text-red-600',
  warn: 'text-amber-700',
  neutral: 'text-brand-400',
};

function buildGauges(
  pipeline: PipelineKind,
  stats: PipelineBoardStats,
  siblingCount: number,
): GaugeDef[] {
  const base = Math.max(1, stats.activeLeads);
  const newDelta = stats.newToday - stats.newPrevDay;

  const ativos: GaugeDef = {
    value: stats.activeLeads,
    color: 'blue',
    label: 'Leads ativos',
    description: `no pipeline ${PIPELINE_LABELS[pipeline]}`,
    pill: { text: `${siblingCount} pipelines ao lado`, tone: 'neutral' },
  };
  const novosHoje: GaugeDef = {
    value: stats.newToday,
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
    color: 'purple',
    label: 'Sem responsável',
    description: 'aguardando atribuição',
    pill:
      stats.unassigned > 0
        ? { text: 'distribuir agora', tone: 'neutral' }
        : { text: 'tudo atribuído', tone: 'up' },
  };
  const quentes: GaugeDef = {
    value: stats.hotLeads,
    color: 'red',
    label: 'Leads quentes',
    description: 'score acima de 70',
    pill: { text: `${Math.round((100 * stats.hotLeads) / base)}% do pipeline`, tone: 'neutral' },
  };
  if (pipeline === 'comercial') {
    const slaVencido: GaugeDef = {
      value: stats.slaBreached,
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
      color: 'purple',
      label: 'Matrículas no mês',
      description: 'matrículas fechadas no mês corrente',
      pill:
        stats.salesThisMonth > 0
          ? { text: '↑ fechando matrículas', tone: 'up' }
          : { text: 'sem matrículas ainda', tone: 'neutral' },
    };
    return [ativos, slaVencido, visitasHoje, matriculasMes];
  }

  // Pós-Matrícula (e fallback): conjunto genérico universal.
  return [ativos, novosHoje, semResponsavel, quentes];
}

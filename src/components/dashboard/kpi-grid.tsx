import { CircleGaugeCard } from '@/components/dashboard/circle-gauge-card';
import { ExportButton } from '@/components/dashboard/export-button';
import { SOURCE_DOT_CLASSES, SOURCE_DOT_DEFAULT } from '@/components/dashboard/source-colors';
import type { GaugeColor } from '@/components/leads/gauge-card';
import type { CsvCell } from '@/lib/dashboard/csv';
import {
  formatDelta,
  formatInt,
  formatPercent,
  formatRatio,
  type DeltaTone,
} from '@/lib/dashboard/format';
import { formatBRL } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import { LEAD_SOURCE_LABELS } from '@/types/lead';
import type { KpiValue, MacroKpis } from '@/types/dashboard';

function renderValue(k: KpiValue): string {
  if (!k.available) return '—';
  switch (k.format) {
    case 'currency':
      return formatBRL(k.value);
    case 'percent':
      return formatPercent(k.value);
    case 'ratio':
      return formatRatio(k.value);
    default:
      return formatInt(k.value);
  }
}

function renderTarget(k: KpiValue): string {
  if (k.target === null) return '';
  return k.format === 'currency' ? formatBRL(k.target) : formatInt(k.target);
}

const DELTA_CLASSES: Record<DeltaTone, string> = {
  up: 'text-emerald-700 bg-emerald-50',
  down: 'text-red-700 bg-red-50',
  flat: 'text-brand-500 bg-brand-50',
};

const DELTA_ARROW: Record<DeltaTone, string> = { up: '↑', down: '↓', flat: '→' };

export function KpiCard({ kpi }: { kpi: KpiValue }) {
  const delta = formatDelta(kpi.deltaPct);
  const progress = kpi.targetProgress;
  const progressPct = progress === null ? null : Math.min(100, Math.round(progress * 100));

  return (
    <div className="flex flex-col rounded-lg border border-brand-100 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-brand-400">{kpi.label}</p>
        {kpi.deltaPct !== null && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
              DELTA_CLASSES[delta.tone],
            )}
            title="vs período anterior"
          >
            {DELTA_ARROW[delta.tone]} {delta.text}
          </span>
        )}
      </div>

      <p className="mt-1 text-2xl font-semibold text-brand-700">{renderValue(kpi)}</p>

      {progressPct !== null ? (
        <div className="mt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-100">
            <div
              className={cn(
                'h-full rounded-full',
                progressPct >= 100 ? 'bg-emerald-500' : 'bg-brand-500',
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-brand-400">
            {progressPct}% da meta · {renderTarget(kpi)}
          </p>
        </div>
      ) : (
        kpi.hint && <p className="mt-2 text-[10px] text-brand-400">{kpi.hint}</p>
      )}
    </div>
  );
}

/**
 * Cor por KPI, mantendo a associação semântica do sistema: azul para
 * volume/contagem, roxo para valores agregados, vermelho para taxas que
 * indicam alerta quando baixas, verde para resultado financeiro.
 */
const KPI_COLORS: Record<string, GaugeColor> = {
  leads_captados: 'blue',
  visitas: 'purple',
  show_rate: 'red',
  matriculas: 'green',
  faturamento: 'green',
  conversao: 'red',
};

/** Valor compacto para caber no centro do círculo (71.530 → "71,5k"). */
function compactNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`;
  }
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`;
  }
  return formatInt(value);
}

function renderCircleValue(k: KpiValue): string {
  if (!k.available) return '—';
  switch (k.format) {
    case 'currency':
      return compactNumber(k.value);
    case 'percent':
      return formatPercent(k.value);
    case 'ratio':
      return formatRatio(k.value);
    default:
      return k.value >= 100_000 ? compactNumber(k.value) : formatInt(k.value);
  }
}

/**
 * Preenchimento relativo do anel: progresso da meta quando cadastrada; senão a
 * própria taxa (KPIs percentuais); senão a participação do período atual vs o
 * anterior (0,5 = estável). Sem nenhuma referência, anel cheio se há valor.
 */
function fillFraction(k: KpiValue): number {
  if (!k.available) return 0;
  if (k.targetProgress !== null) return Math.min(1, k.targetProgress);
  if (k.format === 'percent') return Math.min(1, k.value);
  if (k.deltaPct !== null && k.deltaPct > -1) {
    const prev = k.value / (1 + k.deltaPct);
    const total = k.value + prev;
    if (total > 0) return Math.min(1, k.value / total);
  }
  return k.value > 0 ? 1 : 0;
}

function kpiDescription(k: KpiValue): string {
  if (k.targetProgress !== null) {
    return `${Math.round(k.targetProgress * 100)}% da meta · ${renderTarget(k)}`;
  }
  return k.hint ?? '';
}

export function KpiGrid({ macro }: { macro: MacroKpis }) {
  const csvHeaders = ['KPI', 'Valor', 'Δ vs anterior', 'Meta', '% da meta'];
  const csvRows: CsvCell[][] = macro.kpis.map((k) => [
    k.label,
    k.available ? renderValue(k) : 'n/d',
    k.deltaPct === null ? '' : formatDelta(k.deltaPct).text,
    renderTarget(k),
    k.targetProgress === null ? '' : `${Math.round(k.targetProgress * 100)}%`,
  ]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
          KPIs macro
        </h3>
        <ExportButton filename="kpis" headers={csvHeaders} rows={csvRows} />
      </div>

      {!macro.hasConfig && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Sem metas/investimento cadastrados para o período. Defina em{' '}
          <span className="font-medium">Admin → Metas e Investimentos</span> para habilitar
          barras de meta, CAC e ROAS.
        </p>
      )}

      {/* 8 KPIs em 4 colunas × 2 linhas — nunca uma linha única de 8. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {macro.kpis.map((kpi) => {
          const delta = kpi.deltaPct === null ? undefined : formatDelta(kpi.deltaPct);
          return (
            <CircleGaugeCard
              key={kpi.key}
              display={renderCircleValue(kpi)}
              fraction={fillFraction(kpi)}
              color={KPI_COLORS[kpi.key] ?? 'blue'}
              label={kpi.label}
              description={kpiDescription(kpi)}
              delta={
                delta && {
                  // O badge já tem a seta — sem o "+" do formatDelta.
                  text: delta.text.replace(/^\+/, ''),
                  tone: delta.tone,
                }
              }
            />
          );
        })}
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="mt-2 text-sm font-semibold uppercase tracking-wide text-brand-600">
          Leads captados por origem
        </h3>
        {macro.leadsBySource.length === 0 ? (
          <p className="rounded-lg border border-brand-100 bg-white px-4 py-3 text-sm text-brand-400">
            Nenhum lead captado no período.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {macro.leadsBySource.map(({ source, count }) => (
              <li
                key={source ?? 'sem-origem'}
                className="flex flex-col items-center gap-1 rounded-lg border border-brand-100 bg-white px-3 py-3"
              >
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    (source && SOURCE_DOT_CLASSES[source]) ?? SOURCE_DOT_DEFAULT,
                  )}
                  aria-hidden="true"
                />
                <span className="text-xl font-semibold tabular-nums text-brand-700">
                  {formatInt(count)}
                </span>
                <span className="text-center text-[10px] font-semibold uppercase tracking-wide text-brand-400">
                  {source ? LEAD_SOURCE_LABELS[source] : 'Sem origem'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

import {
  formatDelta,
  formatInt,
  formatPercent,
  formatRatio,
  type DeltaTone,
} from '@/lib/dashboard/format';
import { formatBRL } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
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
    <div className="flex min-h-32 flex-col rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-brand-500">{kpi.label}</p>
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

      <p className="mt-2 text-3xl font-semibold tracking-tight text-brand-700">{renderValue(kpi)}</p>

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
        kpi.hint && <p className="mt-auto pt-3 text-[11px] text-brand-400">{kpi.hint}</p>
      )}
    </div>
  );
}

const PRIORITY_KPI_KEYS = new Set(['leads_captados', 'visitas', 'matriculas', 'conversao']);

export function KpiGrid({ macro }: { macro: MacroKpis }) {
  const priorityKpis = macro.kpis.filter((kpi) => PRIORITY_KPI_KEYS.has(kpi.key));

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-base font-semibold text-brand-700">Resultado do período</h3>
        <p className="mt-0.5 text-xs text-brand-400">Os quatro indicadores para orientar a operação comercial.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {priorityKpis.map((kpi) => (
          <KpiCard key={kpi.key} kpi={kpi} />
        ))}
      </div>
    </section>
  );
}

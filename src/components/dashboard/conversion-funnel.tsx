import { ExportButton } from '@/components/dashboard/export-button';
import type { CsvCell } from '@/lib/dashboard/csv';
import { formatInt, formatPercent } from '@/lib/dashboard/format';
import { cn } from '@/lib/utils/cn';
import type { FunnelStage } from '@/types/dashboard';

/**
 * Funil de conversão visual. Cada etapa é uma barra com largura proporcional
 * ao topo do funil, número absoluto e % de conversão vs a etapa anterior.
 * Reutilizado pela aba Tráfego como funil de mídia (título/subtítulo próprios).
 */
export function ConversionFunnel({
  stages,
  title = 'Funil de conversão',
  subtitle = 'Volume e conversão por etapa, no período.',
  filename = 'funil',
}: {
  stages: FunnelStage[];
  title?: string;
  subtitle?: string;
  filename?: string;
}) {
  const csvRows: CsvCell[][] = stages.map((s) => [
    s.label,
    s.count,
    s.pctOfPrev === null ? '' : formatPercent(s.pctOfPrev),
    s.pctOfTop === null ? '' : formatPercent(s.pctOfTop),
  ]);

  return (
    <section className="rounded-xl border border-brand-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-brand-700">{title}</h3>
          <p className="mt-0.5 text-xs text-brand-400">{subtitle}</p>
        </div>
        <ExportButton
          filename={filename}
          headers={['Etapa', 'Volume', '% da etapa anterior', '% do topo']}
          rows={csvRows}
        />
      </div>

      <ul className="mt-4 flex flex-col gap-3">
        {stages.map((stage, i) => {
          // Etapa zerada mostra só o track vazio; com volume, mínimo de 4% p/ ser visível.
          const widthPct =
            stage.pctOfTop === null
              ? 100
              : stage.count === 0
                ? 0
                : Math.max(4, Math.round(stage.pctOfTop * 100));
          // Azul nas etapas intermediárias, verde na etapa final (matrícula).
          const isFinal = i === stages.length - 1;
          return (
            <li key={stage.key} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-brand-700">{stage.label}</span>
                <span className="flex items-baseline gap-2 text-brand-500">
                  <span className="font-semibold text-brand-700">{formatInt(stage.count)}</span>
                  {stage.pctOfPrev !== null && (
                    <span className="text-xs text-brand-400">
                      {formatPercent(stage.pctOfPrev)} da etapa anterior
                    </span>
                  )}
                </span>
              </div>
              <div className="h-7 w-full overflow-hidden rounded-lg bg-brand-50">
                <div
                  className={cn(
                    'flex h-full items-center rounded-lg bg-gradient-to-r px-2.5 text-[11px] font-medium text-white',
                    isFinal ? 'from-emerald-700 to-emerald-500' : 'from-sky-700 to-sky-500',
                  )}
                  style={{ width: `${widthPct}%` }}
                >
                  {stage.pctOfTop !== null && widthPct > 12 ? formatPercent(stage.pctOfTop) : ''}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

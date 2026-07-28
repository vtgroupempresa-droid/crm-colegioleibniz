'use client';

import { useMemo, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ExportButton } from '@/components/dashboard/export-button';
import type { CsvCell } from '@/lib/dashboard/csv';
import { formatInt, formatPercent } from '@/lib/dashboard/format';
import { CHART_CHROME, SERIES_COLORS, TOOLTIP_STYLE } from '@/components/dashboard/chart-theme';
import { LEAD_SOURCE_LABELS } from '@/types/lead';
import type { ChannelBucket, ChannelTotal, TimeGranularity } from '@/types/dashboard';
import { cn } from '@/lib/utils/cn';

const GRANULARITIES: { value: TimeGranularity; label: string }[] = [
  { value: 'day', label: 'Dia' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
];

function channelLabel(key: string): string {
  if (key === 'sem_canal') return 'Sem canal';
  return LEAD_SOURCE_LABELS[key as keyof typeof LEAD_SOURCE_LABELS] ?? key;
}

/**
 * Leads gerados por canal ao longo do tempo (barras empilhadas) + tabela de
 * totais por canal. Toggle Dia|Semana|Mês via searchParam `gran` — a página é
 * Server Component e rebucketiza no servidor.
 */
export function LeadsByChannel({
  buckets,
  channelTotals,
  granularity,
}: {
  buckets: ChannelBucket[];
  channelTotals: ChannelTotal[];
  granularity: TimeGranularity;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Séries na ordem de volume total; 9+ agregadas em "Outros" (paleta tem 8 cores).
  const seriesKeys = useMemo(() => {
    const keys = channelTotals.map((c) => c.source ?? 'sem_canal');
    return keys.length > 8 ? [...keys.slice(0, 7), 'outros'] : keys;
  }, [channelTotals]);

  const chartData = useMemo(() => {
    const main = new Set(seriesKeys.filter((k) => k !== 'outros'));
    return buckets.map((b) => {
      const row: Record<string, string | number> = { label: b.label };
      let outros = 0;
      for (const [key, count] of Object.entries(b.counts)) {
        if (main.has(key)) row[key] = count;
        else outros += count;
      }
      if (seriesKeys.includes('outros')) row.outros = outros;
      return row;
    });
  }, [buckets, seriesKeys]);

  function setGranularity(value: TimeGranularity) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('gran', value);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  const csvRows: CsvCell[][] = channelTotals.map((c) => [
    channelLabel(c.source ?? 'sem_canal'),
    c.count,
    formatPercent(c.share),
  ]);

  return (
    <section className="rounded-lg border border-brand-100 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
            Leads gerados por canal
          </h3>
          <p className="mt-0.5 text-xs text-brand-400">
            Evolução no período por origem do lead.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-brand-200 p-0.5">
            {GRANULARITIES.map((g) => (
              <button
                key={g.value}
                type="button"
                disabled={isPending}
                onClick={() => setGranularity(g.value)}
                className={cn(
                  'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                  granularity === g.value
                    ? 'bg-brand-700 text-canvas'
                    : 'text-brand-500 hover:text-brand-700',
                )}
              >
                {g.label}
              </button>
            ))}
          </div>
          <ExportButton
            filename="leads-por-canal"
            headers={['Canal', 'Leads', '% do total']}
            rows={csvRows}
          />
        </div>
      </div>

      {channelTotals.length === 0 ? (
        <p className="mt-3 text-sm text-brand-400">Sem leads no período.</p>
      ) : (
        <>
          <div className="mt-4">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={CHART_CHROME.grid} strokeWidth={1} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={CHART_CHROME.tick}
                  axisLine={{ stroke: CHART_CHROME.axisLine }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis tick={CHART_CHROME.tick} axisLine={false} tickLine={false} width={40} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 12 }} formatter={channelLabel} />
                {seriesKeys.map((key, i) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    name={key === 'outros' ? 'Outros' : channelLabel(key)}
                    stackId="canais"
                    fill={SERIES_COLORS[i] ?? '#898781'}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-brand-500">
                <tr>
                  <th className="pb-2 pr-3">Canal</th>
                  <th className="pb-2 pr-3 text-right">Leads</th>
                  <th className="pb-2 text-right">% do total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-100">
                {channelTotals.map((c) => (
                  <tr key={c.source ?? 'sem_canal'}>
                    <td className="py-2 pr-3 text-brand-700">
                      {channelLabel(c.source ?? 'sem_canal')}
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold text-brand-700">
                      {formatInt(c.count)}
                    </td>
                    <td className="py-2 text-right text-brand-600">{formatPercent(c.share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

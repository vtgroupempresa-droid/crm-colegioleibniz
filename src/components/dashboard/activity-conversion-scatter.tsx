'use client';

import {
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART_CHROME, SERIES_COLORS, TOOLTIP_STYLE } from '@/components/dashboard/chart-theme';
import { formatPercent } from '@/lib/dashboard/format';
import { USER_ROLE_LABELS } from '@/types/user';
import type { IndividualPerformanceRow } from '@/types/dashboard';

interface ScatterPoint {
  name: string;
  role: string;
  activity: number;
  ratePct: number;
}

/**
 * Matriz de dispersão atividade × taxa de conversão — um ponto por pessoa da equipe.
 * Quadrante "muita atividade, baixa conversão" = problema de script/skill;
 * "pouca atividade, alta conversão" = capacidade ociosa. As linhas de
 * referência marcam as medianas do grupo.
 */
export function ActivityConversionScatter({ rows }: { rows: IndividualPerformanceRow[] }) {
  const points: ScatterPoint[] = rows
    .filter((r) => r.conversionRate !== null && r.activity > 0)
    .map((r) => ({
      name: r.name,
      role: USER_ROLE_LABELS[r.role],
      activity: r.activity,
      ratePct: (r.conversionRate ?? 0) * 100,
    }));

  const median = (values: number[]): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : sorted[mid] ?? 0;
  };
  const medActivity = median(points.map((p) => p.activity));
  const medRate = median(points.map((p) => p.ratePct));

  return (
    <section className="rounded-lg border border-brand-100 bg-white p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
        Atividade × conversão
      </h3>
      <p className="mt-0.5 text-xs text-brand-400">
        Um ponto por pessoa da equipe; linhas tracejadas = medianas. Canto inferior direito (muita
        atividade, baixa taxa) sugere script/skill; canto superior esquerdo sugere capacidade
        ociosa.
      </p>

      {points.length === 0 ? (
        <p className="mt-3 text-sm text-brand-400">Sem atividade no período.</p>
      ) : (
        <div className="mt-4">
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 12, right: 24, left: 0, bottom: 8 }}>
              <CartesianGrid stroke={CHART_CHROME.grid} strokeWidth={1} />
              <XAxis
                type="number"
                dataKey="activity"
                name="Atividade"
                tick={CHART_CHROME.tick}
                axisLine={{ stroke: CHART_CHROME.axisLine }}
                tickLine={false}
                label={{
                  value: 'Atividade (tentativas/calls)',
                  position: 'insideBottom',
                  offset: -4,
                  fill: '#898781',
                  fontSize: 11,
                }}
              />
              <YAxis
                type="number"
                dataKey="ratePct"
                name="Taxa de conversão"
                unit="%"
                tick={CHART_CHROME.tick}
                axisLine={false}
                tickLine={false}
                width={44}
              />
              <ReferenceLine x={medActivity} stroke={CHART_CHROME.axisLine} strokeDasharray="4 4" />
              <ReferenceLine y={medRate} stroke={CHART_CHROME.axisLine} strokeDasharray="4 4" />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                cursor={{ strokeDasharray: '3 3' }}
                formatter={(value: number, name: string) =>
                  name === 'Taxa de conversão' ? formatPercent(value / 100) : value
                }
                labelFormatter={() => ''}
                content={({ payload }) => {
                  const p = payload?.[0]?.payload as ScatterPoint | undefined;
                  if (!p) return null;
                  return (
                    <div style={TOOLTIP_STYLE} className="px-3 py-2">
                      <p className="font-semibold text-brand-700">
                        {p.name} <span className="font-normal text-brand-400">({p.role})</span>
                      </p>
                      <p className="text-brand-600">
                        {p.activity} atividades · {formatPercent(p.ratePct / 100)} de conversão
                      </p>
                    </div>
                  );
                }}
              />
              <Scatter data={points}>
                {points.map((p) => (
                  <Cell
                    key={p.name}
                    fill={p.role === USER_ROLE_LABELS.admin ? SERIES_COLORS[0] : SERIES_COLORS[4]}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <div className="mt-2 flex gap-4 text-xs text-brand-500">
            <span className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: SERIES_COLORS[0] }}
              />
              {USER_ROLE_LABELS.admin}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: SERIES_COLORS[4] }}
              />
              {USER_ROLE_LABELS.comercial}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

'use client';

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
import { CHART_CHROME, SERIES_COLORS, STATUS_COLORS, TOOLTIP_STYLE } from '@/components/dashboard/chart-theme';
import type { VelocityWeek } from '@/types/dashboard';

/**
 * Velocity do pipeline: quanto entra (agendamentos — handoff para closers) vs
 * quanto sai (matrículas + perdas) por semana, últimas 8 semanas.
 */
export function VelocityChart({ weeks }: { weeks: VelocityWeek[] }) {
  const csvRows: CsvCell[][] = weeks.map((w) => [w.label, w.entered, w.won, w.lost]);

  return (
    <section className="rounded-lg border border-brand-100 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
            Velocity do pipeline
          </h3>
          <p className="mt-0.5 text-xs text-brand-400">
            Entradas (visitas agendadas) vs saídas (matrículas + perdas) por semana.
          </p>
        </div>
        <ExportButton
          filename="velocity-pipeline"
          headers={['Semana', 'Entradas', 'Matrículas', 'Perdas']}
          rows={csvRows}
        />
      </div>
      <div className="mt-4">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={weeks} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART_CHROME.grid} strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="label"
              tick={CHART_CHROME.tick}
              axisLine={{ stroke: CHART_CHROME.axisLine }}
              tickLine={false}
            />
            <YAxis
              tick={CHART_CHROME.tick}
              axisLine={false}
              tickLine={false}
              width={32}
              allowDecimals={false}
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="entered" name="Entradas" fill={SERIES_COLORS[0]} />
            <Bar dataKey="won" name="Vendas" stackId="saidas" fill={STATUS_COLORS.pago} />
            <Bar dataKey="lost" name="Perdas" stackId="saidas" fill={STATUS_COLORS.atrasado} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

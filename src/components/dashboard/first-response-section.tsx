import { AgentCell } from '@/components/dashboard/agent-cell';
import { ExportButton } from '@/components/dashboard/export-button';
import { GaugeCard } from '@/components/leads/gauge-card';
import type { CsvCell } from '@/lib/dashboard/csv';
import { formatInt, formatMinutes, formatPercent } from '@/lib/dashboard/format';
import type { FirstResponseRow } from '@/types/dashboard';

/**
 * Tempo médio de resposta ao lead (SLA de 1º contato): leads.created_at até a
 * primeira contact_attempt. Destaque para a janela ideal de 5 minutos.
 */
export function FirstResponseSection({
  avgMinutes,
  under5MinRate,
  rows,
}: {
  avgMinutes: number | null;
  under5MinRate: number | null;
  rows: FirstResponseRow[];
}) {
  const withinIdeal = avgMinutes !== null && avgMinutes <= 5;
  const csvRows: CsvCell[][] = rows.map((r) => [
    r.name,
    r.leads,
    formatMinutes(r.avgMinutes),
    formatPercent(r.under5MinRate),
  ]);

  return (
    <section className="rounded-lg border border-brand-100 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
            Tempo de resposta ao lead
          </h3>
          <p className="mt-0.5 text-xs text-brand-400">
            Da criação do lead até a 1ª tentativa de contato. Janela ideal: 5 minutos.
          </p>
        </div>
        <ExportButton
          filename="sla-primeiro-contato"
          headers={['Atendente', 'Leads contatados', 'Tempo médio', '% em até 5min']}
          rows={csvRows}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <GaugeCard
          // Arco na régua de 1 hora — quanto MENOS preenchido, melhor.
          value={avgMinutes !== null ? Math.min(avgMinutes, 60) : 0}
          max={60}
          color={withinIdeal ? 'green' : 'amber'}
          label="Tempo médio"
          description="Criação do lead → 1ª tentativa"
          display={formatMinutes(avgMinutes)}
          pill={
            avgMinutes === null
              ? { text: 'sem contatos', tone: 'neutral' }
              : withinIdeal
                ? { text: '✓ dentro da janela ideal (≤ 5min)', tone: 'up' }
                : { text: '⚠ acima da janela de 5min', tone: 'warn' }
          }
        />
        <GaugeCard
          value={under5MinRate !== null ? Math.round(under5MinRate * 100) : 0}
          max={100}
          color="blue"
          label="Em até 5min"
          description="Leads contatados na janela ideal"
          display={formatPercent(under5MinRate)}
        />
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-brand-400">Sem primeiros contatos no período.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-brand-500">
              <tr>
                <th className="pb-2 pr-3">Atendente</th>
                <th className="pb-2 pr-3 text-right">Leads contatados</th>
                <th className="pb-2 pr-3 text-right">Tempo médio</th>
                <th className="pb-2 text-right">Em até 5min</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-100">
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td className="py-2 pr-3">
                    <AgentCell name={r.name} avatarUrl={r.avatarUrl} />
                  </td>
                  <td className="py-2 pr-3 text-right text-brand-600">{formatInt(r.leads)}</td>
                  <td className="py-2 pr-3 text-right font-semibold text-brand-700">
                    {formatMinutes(r.avgMinutes)}
                  </td>
                  <td className="py-2 text-right text-brand-600">
                    {formatPercent(r.under5MinRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

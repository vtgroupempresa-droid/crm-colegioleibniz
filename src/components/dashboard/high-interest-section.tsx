'use client';

import Link from 'next/link';
import { ExportButton } from '@/components/dashboard/export-button';
import type { CsvCell } from '@/lib/dashboard/csv';
import { formatInt } from '@/lib/dashboard/format';
import type { HighInterestData } from '@/types/dashboard';

/**
 * Requisito da reunião: cruzamento "nível de interesse ALTO × não fechou
 * matrícula". Mostra o retrato atual (não filtra por período): quantos leads
 * quentes seguem abertos, onde estão parados e a lista priorizada por tempo
 * na etapa — é a fila de resgate do comercial.
 */
export function HighInterestSection({ data }: { data: HighInterestData }) {
  const headers = ['Responsável', 'Aluno', 'Etapa', 'Atendente', 'Dias na etapa', 'Telefone'];
  const csvRows: CsvCell[][] = data.leads.map((l) => [
    l.name,
    l.childName ?? '',
    l.stageName,
    l.assignedName ?? '',
    l.daysSinceEntered,
    l.phone ?? '',
  ]);

  return (
    <section className="rounded-lg border border-amber-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
            Interesse alto × não fechou matrícula
          </h3>
          <p className="mt-0.5 text-xs text-brand-400">
            Leads quentes ainda em aberto — retrato atual, priorizado por tempo parado na etapa.
          </p>
        </div>
        <ExportButton filename="interesse-alto-nao-fechou" headers={headers} rows={csvRows} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-2xl font-semibold tabular-nums text-amber-700">
            {formatInt(data.open)}
          </p>
          <p className="mt-0.5 text-xs text-amber-700">Em aberto (agir agora)</p>
        </div>
        <div className="rounded-md border border-brand-100 bg-brand-50 p-3">
          <p className="text-2xl font-semibold tabular-nums text-brand-700">
            {formatInt(data.converted)}
          </p>
          <p className="mt-0.5 text-xs text-brand-500">Fecharam matrícula</p>
        </div>
        <div className="rounded-md border border-brand-100 bg-brand-50 p-3">
          <p className="text-2xl font-semibold tabular-nums text-red-700">{formatInt(data.lost)}</p>
          <p className="mt-0.5 text-xs text-brand-500">Perdidos</p>
        </div>
      </div>

      {data.byStage.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {data.byStage.map((s) => (
            <span
              key={s.stage}
              className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-white px-2.5 py-1 text-xs text-brand-600"
            >
              {s.label}
              <span className="font-semibold tabular-nums text-brand-700">{s.count}</span>
            </span>
          ))}
        </div>
      )}

      {data.leads.length === 0 ? (
        <p className="mt-4 text-sm text-brand-400">
          Nenhum lead de interesse alto em aberto. 🎉
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-brand-500">
              <tr>
                <th className="pb-2 pr-3">Responsável / aluno</th>
                <th className="pb-2 pr-3">Etapa</th>
                <th className="pb-2 pr-3">Atendente</th>
                <th className="pb-2 text-right">Dias na etapa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-100">
              {data.leads.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 pr-3">
                    <Link
                      href={`/leads?lead=${l.id}`}
                      className="focus-ring rounded font-medium text-brand-700 hover:underline"
                    >
                      {l.name}
                    </Link>
                    {l.childName && (
                      <span className="block text-xs text-brand-400">{l.childName}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-brand-600">{l.stageName}</td>
                  <td className="py-2 pr-3 text-brand-600">{l.assignedName ?? '—'}</td>
                  <td className="py-2 text-right tabular-nums text-brand-700">
                    {l.daysSinceEntered}
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

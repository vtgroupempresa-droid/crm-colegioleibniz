'use client';

import Link from 'next/link';
import { formatInt } from '@/lib/dashboard/format';
import type { HighInterestData } from '@/types/dashboard';

const MAX_VISIBLE_LEADS = 5;

/**
 * Requisito da reunião: cruzamento "nível de interesse ALTO × não fechou
 * matrícula". Mostra o retrato atual (não filtra por período): quantos leads
 * quentes seguem abertos, onde estão parados e a lista priorizada por tempo
 * na etapa — é a fila de resgate do comercial.
 */
export function HighInterestSection({ data }: { data: HighInterestData }) {
  const visibleLeads = data.leads.slice(0, MAX_VISIBLE_LEADS);
  const remaining = Math.max(0, data.leads.length - visibleLeads.length);

  return (
    <section className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-brand-700">Prioridades para agir agora</h3>
          <p className="mt-0.5 text-xs text-brand-400">
            Famílias com interesse alto que ainda não concluíram a matrícula.
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
          {formatInt(data.open)} em aberto
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-amber-50 px-3 py-2.5">
          <p className="text-xl font-semibold tabular-nums text-amber-800">{formatInt(data.open)}</p>
          <p className="mt-0.5 text-[11px] font-medium text-amber-800">Precisam de retorno</p>
        </div>
        <div className="rounded-lg bg-brand-50 px-3 py-2.5">
          <p className="text-xl font-semibold tabular-nums text-brand-700">{formatInt(data.converted)}</p>
          <p className="mt-0.5 text-[11px] text-brand-500">Já matricularam</p>
        </div>
      </div>

      {data.leads.length === 0 ? (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
          Nenhum lead de interesse alto em aberto. 🎉
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-brand-100 border-y border-brand-100">
          {visibleLeads.map((lead) => (
            <li key={lead.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/leads?lead=${lead.id}`}
                  className="focus-ring block truncate rounded text-sm font-semibold text-brand-700 hover:underline"
                >
                  {lead.name}
                </Link>
                <p className="truncate text-[11px] text-brand-400">
                  {lead.childName ?? 'Aluno não informado'} · {lead.stageName}
                  {lead.assignedName ? ` · ${lead.assignedName}` : ''}
                </p>
              </div>
              <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-amber-800">
                {lead.daysSinceEntered}d
              </span>
            </li>
          ))}
        </ul>
      )}

      {remaining > 0 && (
        <Link
          href="/oportunidades"
          className="focus-ring mt-3 inline-flex rounded text-xs font-semibold text-brand-700 underline-offset-2 hover:underline"
        >
          Ver mais {remaining} no Funil →
        </Link>
      )}
    </section>
  );
}

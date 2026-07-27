'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LEAD_SOURCES, LEAD_SOURCE_LABELS } from '@/types/lead';

/**
 * Filtros do rastreio lead a lead: busca por nome + canal de origem. Ambos via
 * searchParams (padrão do dashboard) — a página refaz a query no servidor.
 */
export function LeadsAuditFilters({ search, source }: { search: string; source: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [term, setTerm] = useState(search);
  const [, startTransition] = useTransition();

  function apply(next: { q?: string; canal?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    const q = next.q ?? term;
    const canal = next.canal ?? source;
    if (q) params.set('q', q);
    else params.delete('q');
    if (canal) params.set('canal', canal);
    else params.delete('canal');
    params.delete('page'); // filtro novo volta à 1ª página
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply({});
        }}
      >
        <input
          className="w-56 rounded-md border border-brand-200 px-3 py-1.5 text-sm"
          placeholder="Buscar por nome…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <button
          type="submit"
          className="rounded-md border border-brand-200 px-3 py-1.5 text-sm font-medium text-brand-600 hover:bg-brand-50"
        >
          Buscar
        </button>
      </form>
      <select
        className="rounded-md border border-brand-200 px-2 py-1.5 text-sm text-brand-600"
        value={source}
        onChange={(e) => apply({ canal: e.target.value })}
      >
        <option value="">Todos os canais</option>
        {LEAD_SOURCES.map((s) => (
          <option key={s} value={s}>
            {LEAD_SOURCE_LABELS[s]}
          </option>
        ))}
      </select>
    </div>
  );
}

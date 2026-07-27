'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PERIOD_KINDS, PERIOD_LABELS, type PeriodKind } from '@/lib/dashboard/period';
import { cn } from '@/lib/utils/cn';

interface PeriodFilterProps {
  current: PeriodKind;
  from?: string;
  to?: string;
}

/**
 * Filtro de período global do dashboard. Atualiza os searchParams da URL
 * (?period=&from=&to=) e deixa o Server Component refazer todas as queries.
 */
export function PeriodFilter({ current, from, to }: PeriodFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [customFrom, setCustomFrom] = useState(from ?? '');
  const [customTo, setCustomTo] = useState(to ?? '');

  function apply(kind: PeriodKind, f?: string, t?: string) {
    // Parte dos params atuais — trocar o período não pode descartar a visão
    // (?visao=) nem outros filtros da página.
    const params = new URLSearchParams(searchParams.toString());
    params.set('period', kind);
    params.delete('from');
    params.delete('to');
    if (kind === 'custom' && f && t) {
      params.set('from', f);
      params.set('to', t);
    }
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {PERIOD_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => (kind === 'custom' ? apply('custom', customFrom, customTo) : apply(kind))}
            disabled={isPending}
            className={cn(
              'focus-ring rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60',
              current === kind
                ? 'border-brand-700 bg-brand-700 text-canvas'
                : 'border-brand-200 bg-white text-brand-600 hover:bg-brand-50',
            )}
          >
            {PERIOD_LABELS[kind]}
          </button>
        ))}
      </div>

      {current === 'custom' && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-[11px] text-brand-500">
            De
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="focus-ring h-8 rounded-md border border-brand-200 px-2 text-xs text-brand-700"
            />
          </label>
          <label className="flex flex-col text-[11px] text-brand-500">
            Até
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="focus-ring h-8 rounded-md border border-brand-200 px-2 text-xs text-brand-700"
            />
          </label>
          <button
            type="button"
            onClick={() => apply('custom', customFrom, customTo)}
            disabled={isPending || !customFrom || !customTo}
            className="focus-ring h-8 rounded-md bg-brand-700 px-3 text-xs font-medium text-canvas hover:bg-brand-800 disabled:opacity-50"
          >
            Aplicar
          </button>
        </div>
      )}
    </div>
  );
}

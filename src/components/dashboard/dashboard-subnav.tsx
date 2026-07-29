'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

const SECTIONS = [
  { href: '/dashboard', label: 'Visão geral' },
  { href: '/dashboard/topo-funil', label: 'Captação' },
  { href: '/dashboard/pipeline-forecast', label: 'Vendas e previsão' },
  { href: '/dashboard/performance-individual', label: 'Equipe' },
] as const;

/** Só o filtro de período viaja entre as seções — filtros locais não. */
const SHARED_PARAMS = ['period', 'from', 'to'] as const;

/**
 * Abas da área Dashboard (visão executiva + seções por categoria). Preserva o
 * período selecionado ao trocar de seção, para a leitura ser contínua.
 */
export function DashboardSubnav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const shared = new URLSearchParams();
  for (const key of SHARED_PARAMS) {
    const value = searchParams.get(key);
    if (value) shared.set(key, value);
  }
  const suffix = shared.toString() ? `?${shared.toString()}` : '';

  // Links, em vez de tabs locais, preservam o SSR de cada seção e o período.
  return (
    <nav
      aria-label="Seções do dashboard"
      className="-mx-1 flex gap-1 overflow-x-auto rounded-xl border border-brand-100 bg-brand-50/70 p-1"
    >
      {SECTIONS.map((section) => {
        const active = pathname === section.href;
        return (
          <Link
            key={section.href}
            href={`${section.href}${suffix}`}
            className={cn(
              'focus-ring shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-white text-brand-700 shadow-sm'
                : 'text-brand-500 hover:bg-white/70 hover:text-brand-700',
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}

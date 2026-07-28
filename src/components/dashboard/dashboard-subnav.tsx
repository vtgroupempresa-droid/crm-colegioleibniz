'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

const SECTIONS = [
  { href: '/dashboard', label: 'Geral' },
  { href: '/dashboard/topo-funil', label: 'Topo de Funil' },
  { href: '/dashboard/leads-detalhado', label: 'Leads Detalhado' },
  { href: '/dashboard/pipeline-forecast', label: 'Pipeline & Forecast' },
  { href: '/dashboard/performance-individual', label: 'Performance Individual' },
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

  // Mesmo visual do <Tabs> compartilhado (abas sublinhadas), mas com <Link>
  // porque cada seção é uma rota server-rendered.
  return (
    <nav className="flex flex-wrap gap-1 border-b border-brand-100">
      {SECTIONS.map((section) => {
        const active = pathname === section.href;
        return (
          <Link
            key={section.href}
            href={`${section.href}${suffix}`}
            className={cn(
              'focus-ring -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'border-brand-700 text-brand-700'
                : 'border-transparent text-brand-400 hover:text-brand-600',
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}

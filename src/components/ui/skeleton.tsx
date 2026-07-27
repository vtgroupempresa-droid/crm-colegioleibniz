import { cn } from '@/lib/utils/cn';

/**
 * Bloco de carregamento com shimmer (animate-pulse). Base para os skeletons
 * de Kanban, tabelas do dashboard e LeadDrawer (Fase 8).
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-brand-100', className)} aria-hidden="true" />;
}

import { Skeleton } from '@/components/ui/skeleton';

/** Skeleton de uma tabela do dashboard: cabeçalho + N linhas. */
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-brand-100 bg-white p-4">
      <Skeleton className="mb-2 h-5 w-40" />
      <div className="flex gap-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Skeleton da página de dashboard: KPIs + funil + tabelas de performance. */
export function DashboardSkeleton() {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-40" />
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border border-brand-100 bg-white p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-2 w-full" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TableSkeleton rows={6} cols={3} />
        <TableSkeleton rows={6} cols={3} />
      </div>
    </section>
  );
}

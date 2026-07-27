import { Skeleton } from '@/components/ui/skeleton';

/**
 * Skeleton do board Kanban, com as proporções reais: header da página, colunas
 * e cards empilhados. Usado nos loading.tsx das rotas de pipeline (Fase 8).
 */
export function KanbanSkeleton({ columns = 5 }: { columns?: number }) {
  return (
    <section className="flex h-full flex-col gap-4">
      <header className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-24" />
      </header>
      <div className="flex flex-1 gap-3 overflow-hidden pb-2">
        {Array.from({ length: columns }).map((_, col) => (
          <div key={col} className="flex w-72 shrink-0 flex-col gap-3 rounded-lg bg-brand-50/60 p-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-6" />
            </div>
            {Array.from({ length: 3 - (col % 3) }).map((_, card) => (
              <div
                key={card}
                className="flex flex-col gap-2 rounded-md border border-brand-100 bg-white p-3"
              >
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-5 w-9 rounded-full" />
                </div>
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-32" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

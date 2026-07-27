import { Skeleton } from '@/components/ui/skeleton';

/** Skeleton do LeadDrawer enquanto /api/leads/:id carrega (Fase 8). */
export function LeadDrawerSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      {/* Abas */}
      <div className="flex gap-2 border-b border-brand-100 pb-2">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-7 w-28" />
      </div>
      {/* Bloco de score */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
      {/* Grid de campos */}
      <div className="grid grid-cols-2 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}

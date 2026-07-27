import { Skeleton } from '@/components/ui/skeleton';

/**
 * Skeleton do /chat — espelha o layout de 3 colunas (lista, conversa, painel
 * do lead) enquanto getConversations() resolve no servidor. Evita a tela em
 * branco durante o carregamento da rota.
 */
export default function Loading() {
  return (
    <div className="flex h-[calc(100vh-7.5rem)] overflow-hidden rounded-lg border border-brand-100 bg-white">
      {/* Coluna 1 — lista de conversas */}
      <div className="w-full shrink-0 border-r border-brand-100 sm:w-80">
        <div className="flex flex-col gap-2 border-b border-brand-100 p-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-6 w-2/3" />
        </div>
        <div className="flex flex-col gap-3 p-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Coluna 2 — conversa */}
      <div className="hidden min-w-0 flex-1 flex-col sm:flex">
        <div className="border-b border-brand-100 p-4">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="flex flex-1 flex-col justify-end gap-3 p-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="ml-auto h-10 w-1/2" />
          <Skeleton className="h-10 w-3/5" />
        </div>
      </div>

      {/* Coluna 3 — painel do lead */}
      <div className="hidden w-80 shrink-0 border-l border-brand-100 p-4 lg:block">
        <Skeleton className="h-5 w-32" />
        <div className="mt-4 space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  );
}

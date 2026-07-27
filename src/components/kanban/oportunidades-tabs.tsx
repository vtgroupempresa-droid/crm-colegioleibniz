'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { cn } from '@/lib/utils/cn';
import { PIPELINE_LABELS, type PipelineKind } from '@/types/pipeline';

interface OportunidadesTabsProps {
  pipelines: readonly PipelineKind[];
  active: PipelineKind;
  /** Leads ativos por pipeline (contador ao lado do nome da aba). */
  counts?: Partial<Record<PipelineKind, number>>;
}

/**
 * Seletor de pipeline da tela unificada /oportunidades. Troca o pipeline via
 * query string (?pipeline=), preservando o histórico do navegador.
 */
export function OportunidadesTabs({ pipelines, active, counts }: OportunidadesTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function select(pipeline: PipelineKind) {
    if (pipeline === active) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('pipeline', pipeline);
    startTransition(() => {
      router.push(`/oportunidades?${params.toString()}`);
    });
  }

  return (
    <div
      className="flex flex-wrap gap-1 border-b border-brand-100"
      role="tablist"
      aria-label="Pipelines"
    >
      {pipelines.map((pipeline) => {
        const isActive = pipeline === active;
        const count = counts?.[pipeline];
        return (
          <button
            key={pipeline}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => select(pipeline)}
            disabled={isPending}
            className={cn(
              'focus-ring -mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'border-brand-700 text-brand-700'
                : 'border-transparent text-brand-500 hover:text-brand-700',
            )}
          >
            {PIPELINE_LABELS[pipeline]}
            {count !== undefined && (
              <span
                className={cn(
                  'ml-1.5 text-xs tabular-nums',
                  isActive ? 'text-brand-500' : 'text-brand-300',
                )}
              >
                {count.toLocaleString('pt-BR')}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

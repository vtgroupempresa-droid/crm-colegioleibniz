'use client';

import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS } from '@/types/lead';
import { PIPELINE_LABELS, isPipelineKind } from '@/types/pipeline';

export interface RelatorioFilterOption {
  id: string;
  name: string;
}

export interface RelatorioStageGroup {
  pipeline: string;
  stages: { slug: string; name: string }[];
}

interface RelatorioFiltersProps {
  /** Valor atual do stage no formato `pipeline:slug` (vazio = todos). */
  stageValue: string;
  /** Responsável pelo lead (assigned_to). */
  assignedTo: string;
  /** Quem fechou a matrícula (deals.closed_by). */
  closedBy: string;
  educationLevel: string;
  stageGroups: RelatorioStageGroup[];
  team: RelatorioFilterOption[];
}

/**
 * Filtros da aba Relatórios — etapa do funil, nível de ensino, responsável e
 * quem fechou a matrícula — gravados na URL (mesmo padrão do dashboard). O
 * período fica no PeriodFilter à parte. A etapa combina pipeline+stage num
 * único select (`pipeline:slug`), já que o slug se repete entre pipelines.
 */
export function RelatorioFilters({
  stageValue,
  assignedTo,
  closedBy,
  educationLevel,
  stageGroups,
  team,
}: RelatorioFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function apply(
    next: Partial<{ stage: string; responsavel: string; fechadoPor: string; ensino: string }>,
  ) {
    const params = new URLSearchParams(searchParams.toString());

    if (next.stage !== undefined) {
      // `pipeline:slug` → dois params separados; vazio limpa ambos.
      params.delete('pipeline');
      params.delete('stage');
      if (next.stage) {
        const [pipeline, slug] = next.stage.split(':');
        if (pipeline) params.set('pipeline', pipeline);
        if (slug) params.set('stage', slug);
      }
    }
    for (const [key, value] of [
      ['responsavel', next.responsavel],
      ['fechadoPor', next.fechadoPor],
      ['ensino', next.ensino],
    ] as const) {
      if (value === undefined) continue;
      if (value) params.set(key, value);
      else params.delete(key);
    }

    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  const selectClass =
    'rounded-md border border-brand-200 px-2 py-1.5 text-sm text-brand-600 focus-ring';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={selectClass}
        value={stageValue}
        onChange={(e) => apply({ stage: e.target.value })}
        aria-label="Etapa do funil"
      >
        <option value="">Todas as etapas</option>
        {stageGroups.map((group) => (
          <optgroup
            key={group.pipeline}
            label={isPipelineKind(group.pipeline) ? PIPELINE_LABELS[group.pipeline] : group.pipeline}
          >
            {group.stages.map((s) => (
              <option key={`${group.pipeline}:${s.slug}`} value={`${group.pipeline}:${s.slug}`}>
                {s.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <select
        className={selectClass}
        value={educationLevel}
        onChange={(e) => apply({ ensino: e.target.value })}
        aria-label="Nível de ensino"
      >
        <option value="">Todos os níveis</option>
        {EDUCATION_LEVELS.map((level) => (
          <option key={level} value={level}>
            {EDUCATION_LEVEL_LABELS[level]}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        value={assignedTo}
        onChange={(e) => apply({ responsavel: e.target.value })}
        aria-label="Responsável pelo lead"
      >
        <option value="">Todos os responsáveis</option>
        {team.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        value={closedBy}
        onChange={(e) => apply({ fechadoPor: e.target.value })}
        aria-label="Quem fechou a matrícula"
      >
        <option value="">Fechada por qualquer um</option>
        {team.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    </div>
  );
}

import type { Activity } from '@/types/lead';

/**
 * Retorna a data ISO da última mudança de stage do lead.
 * Se nunca mudou, usa a data de criação do lead como proxy.
 */
export function lastStageChangeAt(
  activities: readonly Pick<Activity, 'type' | 'created_at'>[],
  fallback: string,
): string {
  const stageChange = activities.find((a) => a.type === 'stage_change');
  return stageChange?.created_at ?? fallback;
}

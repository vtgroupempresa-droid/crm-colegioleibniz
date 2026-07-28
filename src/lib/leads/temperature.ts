/**
 * Temperatura do lead derivada das tags.
 *
 * Fontes externas (webhooks, importações) podem classificar leads com tags de
 * temperatura (superquente/quente/morno/frio), às vezes entre aspas ou com
 * espaço ("super quente"). Em vez de manter uma coluna que precisaria ser
 * sincronizada a cada novo lead/tag, derivamos a temperatura das próprias
 * tags — fonte única e sempre coerente.
 */

export const LEAD_TEMPERATURES = ['superquente', 'quente', 'morno', 'frio'] as const;
export type LeadTemperature = (typeof LEAD_TEMPERATURES)[number];

export const TEMPERATURE_LABELS: Record<LeadTemperature, string> = {
  superquente: 'Super quente',
  quente: 'Quente',
  morno: 'Morno',
  frio: 'Frio',
};

/** Prioridade: a temperatura mais quente vence quando há mais de uma tag. */
const TEMPERATURE_RANK: Record<LeadTemperature, number> = {
  superquente: 4,
  quente: 3,
  morno: 2,
  frio: 1,
};

/** minúsculas, sem aspas/espaços nas pontas e sem espaços internos. */
function normalizeTag(tag: string): string {
  return tag
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

function asTemperature(value: string): LeadTemperature | null {
  return (LEAD_TEMPERATURES as readonly string[]).includes(value)
    ? (value as LeadTemperature)
    : null;
}

/**
 * Deriva a temperatura do lead a partir das tags. Retorna a mais quente
 * encontrada, ou null se nenhuma tag de temperatura estiver presente.
 */
export function leadTemperature(
  tags: readonly string[] | null | undefined,
): LeadTemperature | null {
  if (!tags) return null;
  let best: LeadTemperature | null = null;
  for (const raw of tags) {
    const match = asTemperature(normalizeTag(raw));
    if (match && (!best || TEMPERATURE_RANK[match] > TEMPERATURE_RANK[best])) {
      best = match;
    }
  }
  return best;
}

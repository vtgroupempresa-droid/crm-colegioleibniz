/**
 * Tabela de SLA da cadência de contato do comercial.
 *
 * Cada nova tentativa cria um deadline para a próxima:
 *   1 → 5min · 2 → 2h · 3 → 1d · 4 → 2d · 5 → 3d · 6 → 5d · 7 → 7d · 8 → null
 *
 * Quando a 8ª tentativa sem resposta acontece, o lead vai para a etapa
 * Follow-Up do pipeline comercial (regra implementada na Server Action).
 *
 * Tabelas em milissegundos para soma direta com `Date.now()`.
 */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Quanto tempo o SDR tem para fazer a PRÓXIMA tentativa após registrar a `n`. */
const SLA_AFTER_ATTEMPT_MS: Record<number, number | null> = {
  1: 5 * MIN,
  2: 2 * HOUR,
  3: 1 * DAY,
  4: 2 * DAY,
  5: 3 * DAY,
  6: 5 * DAY,
  7: 7 * DAY,
  8: null,
};

export const MAX_ATTEMPTS = 8;

/** Retorna o deadline ISO da próxima tentativa após `attemptNumber`. */
export function slaDeadlineAfter(attemptNumber: number, now: Date = new Date()): string | null {
  const offset = SLA_AFTER_ATTEMPT_MS[attemptNumber];
  if (offset === null || offset === undefined) return null;
  return new Date(now.getTime() + offset).toISOString();
}

export interface SlaStatus {
  status: 'breached' | 'warning' | 'ok' | 'none';
  /** Milissegundos restantes (negativo = vencido). null se sem SLA. */
  remainingMs: number | null;
}

/** Status visual do SLA a partir de uma deadline ISO. */
export function slaStatusFor(deadline: string | null, now: Date = new Date()): SlaStatus {
  if (!deadline) return { status: 'none', remainingMs: null };
  const remaining = new Date(deadline).getTime() - now.getTime();
  if (remaining <= 0) return { status: 'breached', remainingMs: remaining };
  if (remaining <= 2 * HOUR) return { status: 'warning', remainingMs: remaining };
  return { status: 'ok', remainingMs: remaining };
}

/** Formata "vence em 1h 20min" / "VENCIDO" / "vence em 2 dias". */
export function formatSlaCountdown(deadline: string | null, now: Date = new Date()): string {
  if (!deadline) return 'sem SLA';
  const remaining = new Date(deadline).getTime() - now.getTime();
  if (remaining <= 0) return 'VENCIDO';

  const days = Math.floor(remaining / DAY);
  const hours = Math.floor((remaining % DAY) / HOUR);
  const minutes = Math.floor((remaining % HOUR) / MIN);

  if (days >= 1) {
    return hours > 0 ? `vence em ${days}d ${hours}h` : `vence em ${days}d`;
  }
  if (hours >= 1) {
    return minutes > 0 ? `vence em ${hours}h ${minutes}min` : `vence em ${hours}h`;
  }
  return `vence em ${Math.max(1, minutes)}min`;
}

/**
 * Formatadores específicos do Dashboard CEO (Fase 6). `formatBRL`/`formatDate`
 * vivem em `@/lib/utils/format`; aqui ficam só taxas, deltas e durações.
 */

const INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return INT.format(Math.round(value));
}

/** Fração 0..1 → "12%". */
export function formatPercent(frac: number | null | undefined, digits = 0): string {
  if (frac === null || frac === undefined || !Number.isFinite(frac)) return '—';
  return `${(frac * 100).toFixed(digits)}%`;
}

/** Múltiplo → "3.2x". */
export function formatRatio(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}x`;
}

export type DeltaTone = 'up' | 'down' | 'flat';

export function formatDelta(frac: number | null | undefined): { text: string; tone: DeltaTone } {
  if (frac === null || frac === undefined || !Number.isFinite(frac)) {
    return { text: '—', tone: 'flat' };
  }
  const pct = frac * 100;
  const tone: DeltaTone = pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat';
  const sign = pct > 0 ? '+' : '';
  return { text: `${sign}${pct.toFixed(0)}%`, tone };
}

export function formatMinutes(mins: number | null | undefined): string {
  if (mins === null || mins === undefined || !Number.isFinite(mins)) return '—';
  if (mins < 60) return `${Math.round(mins)}min`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

export function formatDays(days: number | null | undefined): string {
  if (days === null || days === undefined || !Number.isFinite(days)) return '—';
  return `${days.toFixed(1)} d`;
}

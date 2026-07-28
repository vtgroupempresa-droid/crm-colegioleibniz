/**
 * Filtro de período global do Dashboard CEO (Fase 6).
 *
 * Tudo é ancorado no fuso de Brasília (BRT = UTC-3, sem horário de verão desde
 * 2019). As janelas são calculadas em UTC mas representam o calendário BRT, pra
 * que "este mês" comece à meia-noite de Brasília, não em UTC.
 *
 * Para o delta percentual ("vs período anterior") usamos a regra única e
 * inequívoca: o período anterior é a janela de MESMA DURAÇÃO imediatamente
 * anterior a `start`. Isso compara maçã com maçã (ex.: mês-até-agora vs os
 * mesmos N dias do mês passado) e funciona até para intervalos custom.
 */

export type PeriodKind =
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'last_month'
  | 'quarter'
  | 'semester'
  | 'custom';

export const PERIOD_KINDS: readonly PeriodKind[] = [
  'today',
  'this_week',
  'this_month',
  'last_month',
  'quarter',
  'semester',
  'custom',
] as const;

export const PERIOD_LABELS: Record<PeriodKind, string> = {
  today: 'Hoje',
  this_week: 'Esta semana',
  this_month: 'Este mês',
  last_month: 'Mês anterior',
  quarter: 'Últimos 3 meses',
  semester: 'Últimos 6 meses',
  custom: 'Personalizado',
};

export function isPeriodKind(value: string | undefined | null): value is PeriodKind {
  return value != null && (PERIOD_KINDS as readonly string[]).includes(value);
}

export interface ResolvedPeriod {
  kind: PeriodKind;
  /** Início inclusivo da janela atual. */
  start: Date;
  /** Fim exclusivo da janela atual (geralmente "agora"). */
  end: Date;
  /** Início inclusivo da janela anterior comparável. */
  prevStart: Date;
  /** Fim exclusivo da janela anterior comparável. */
  prevEnd: Date;
  /** Rótulo legível com o intervalo de datas. */
  label: string;
}

const BRT_OFFSET_HOURS = -3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Converte um horário de parede BRT em um instante UTC (Date). */
function brtWallToUtc(
  year: number,
  monthIndex: number,
  day: number,
  hour = 0,
  minute = 0,
): Date {
  // UTC = BRT + 3h, logo somamos -offset (= +3) às horas.
  return new Date(Date.UTC(year, monthIndex, day, hour - BRT_OFFSET_HOURS, minute));
}

/** Partes do calendário BRT correspondentes a um instante UTC. */
function brtParts(instant: Date): { y: number; m: number; d: number; dow: number } {
  const shifted = new Date(instant.getTime() + BRT_OFFSET_HOURS * 60 * 60 * 1000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    dow: shifted.getUTCDay(), // 0=domingo ... 6=sábado
  };
}

function parseIsoDate(value: string | undefined): { y: number; m: number; d: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  return { y, m, d };
}

const DATE_FMT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});

function rangeLabel(start: Date, end: Date): string {
  // `end` é exclusivo; mostramos o último dia coberto (end - 1ms).
  const lastDay = new Date(end.getTime() - 1);
  return `${DATE_FMT.format(start)} – ${DATE_FMT.format(lastDay)}`;
}

/**
 * Resolve a janela atual e a anterior comparável para um período.
 * `now` é injetável para testes; por padrão usa o instante real.
 */
export function resolvePeriod(
  kind: PeriodKind,
  opts: { from?: string; to?: string; now?: Date } = {},
): ResolvedPeriod {
  const now = opts.now ?? new Date();
  const { y, m, d, dow } = brtParts(now);
  const startOfToday = brtWallToUtc(y, m, d);

  let start: Date;
  let end: Date = now;

  switch (kind) {
    case 'today':
      start = startOfToday;
      break;
    case 'this_week': {
      // Semana inicia na segunda-feira.
      const daysFromMonday = (dow + 6) % 7;
      start = new Date(startOfToday.getTime() - daysFromMonday * MS_PER_DAY);
      break;
    }
    case 'this_month':
      start = brtWallToUtc(y, m, 1);
      break;
    case 'last_month': {
      const prevMonth = m === 0 ? 11 : m - 1;
      const prevYear = m === 0 ? y - 1 : y;
      start = brtWallToUtc(prevYear, prevMonth, 1);
      end = brtWallToUtc(y, m, 1); // primeiro dia do mês atual (exclusivo)
      break;
    }
    // Trimestre/semestre são janelas MÓVEIS (últimos 3/6 meses até agora), não o
    // trimestre/semestre do calendário: logo no início de um Q/S o recorte de
    // calendário tinha dias demais de vazio (ex.: em 08/jul, "Trimestre" virava
    // 01/07–08/07 — menor que "Mês anterior") e confundia a leitura.
    case 'quarter': {
      start = brtWallToUtc(y, m - 3, d);
      break;
    }
    case 'semester': {
      start = brtWallToUtc(y, m - 6, d);
      break;
    }
    case 'custom': {
      const from = parseIsoDate(opts.from);
      const to = parseIsoDate(opts.to);
      if (from && to) {
        start = brtWallToUtc(from.y, from.m, from.d);
        // `to` inclusivo → somamos um dia para virar fim exclusivo.
        end = brtWallToUtc(to.y, to.m, to.d + 1);
      } else {
        // Fallback seguro: mês atual.
        start = brtWallToUtc(y, m, 1);
      }
      break;
    }
    default:
      start = brtWallToUtc(y, m, 1);
  }

  if (end.getTime() < start.getTime()) end = start;

  const durationMs = end.getTime() - start.getTime();
  const prevEnd = start;
  const prevStart = new Date(start.getTime() - durationMs);

  return { kind, start, end, prevStart, prevEnd, label: rangeLabel(start, end) };
}

/**
 * Lista os meses (1-based) cobertos por uma janela, no calendário BRT.
 * Usado para somar metas/investimento mensais (`dashboard_config`) do período.
 */
export function monthsCovered(start: Date, end: Date): { mes: number; ano: number }[] {
  const res: { mes: number; ano: number }[] = [];
  if (end.getTime() <= start.getTime()) {
    const only = brtParts(start);
    return [{ mes: only.m + 1, ano: only.y }];
  }
  const first = brtParts(start);
  const last = brtParts(new Date(end.getTime() - 1));
  let y = first.y;
  let m = first.m; // 0-based
  while (y < last.y || (y === last.y && m <= last.m)) {
    res.push({ mes: m + 1, ano: y });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return res;
}

/** Lê o período a partir dos searchParams da página. */
export function parsePeriodParams(searchParams: {
  period?: string | string[];
  from?: string | string[];
  to?: string | string[];
}): { kind: PeriodKind; from?: string; to?: string } {
  const raw = Array.isArray(searchParams.period) ? searchParams.period[0] : searchParams.period;
  const from = Array.isArray(searchParams.from) ? searchParams.from[0] : searchParams.from;
  const to = Array.isArray(searchParams.to) ? searchParams.to[0] : searchParams.to;
  const kind = isPeriodKind(raw) ? raw : 'this_month';
  return { kind, from, to };
}

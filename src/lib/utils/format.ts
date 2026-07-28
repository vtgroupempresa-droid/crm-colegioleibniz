const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

const DATE = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const DATETIME = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatBRL(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return BRL.format(value);
}

// A conta de anúncios da Meta é em USD — gasto/CPC/CPM da aba Tráfego usam este.
const USD = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

export function formatUSD(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return USD.format(value);
}

// BRL com centavos — CPL/CPC convertidos do dólar perdem sentido arredondados.
const BRL_CENTS = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
});

export function formatBRLCents(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return BRL_CENTS.format(value);
}

/**
 * Valor em USD exibido em R$ pela cotação atual (aba Tráfego). Sem cotação
 * (API de câmbio fora), degrada para o valor original em US$.
 */
export function formatUsdAsBrl(
  value: number | null | undefined,
  usdBrlRate: number | null,
): string {
  if (value === null || value === undefined) return '—';
  return usdBrlRate ? BRL_CENTS.format(value * usdBrlRate) : USD.format(value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return DATE.format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return DATETIME.format(date);
}

const RELATIVE = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
const TIME_UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
];

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  const diff = date.getTime() - Date.now();
  for (const { unit, ms } of TIME_UNITS) {
    if (Math.abs(diff) >= ms) {
      return RELATIVE.format(Math.round(diff / ms), unit);
    }
  }
  return 'agora';
}

/** Títulos que precedem o nome ("Dra. Viviane") — nunca são o primeiro nome. */
const HONORIFICS = new Set([
  'dr',
  'dra',
  'dr(a)',
  'doutor',
  'doutora',
  'sr',
  'sra',
  'srta',
  'prof',
  'profa',
]);

/**
 * Primeiro nome de um lead em capitalização de nome próprio — alimenta a
 * variável automática {{nome}} dos templates de WhatsApp. Pula títulos
 * ("Dra. Viviane Enokawa" → "Viviane"; caso real: {{nome}} saiu "Dra." e a
 * mensagem abriu "Oi, Dr(a). Dra., tudo bem?"). Retorna null quando não sobra
 * token com letras (ex.: contato salvo só com o telefone, ou só o título).
 */
export function firstNameOf(fullName: string | null | undefined): string | null {
  const token = (fullName ?? '')
    .trim()
    .split(/\s+/)
    .filter((t) => /\p{L}/u.test(t))
    .find((t) => !HONORIFICS.has(t.replace(/[.()]/g, '').toLocaleLowerCase('pt-BR')));
  if (!token) return null;
  return token.charAt(0).toLocaleUpperCase('pt-BR') + token.slice(1).toLocaleLowerCase('pt-BR');
}

/**
 * Tempo relativo COMPACTO para datas passadas — badge da coluna "Criado" em
 * /leads ("hoje", "ontem", "5d", "3 sem", "2 meses", "1 ano").
 */
export function formatRelativeCompact(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  const days = Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)} sem`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return months === 1 ? '1 mês' : `${months} meses`;
  }
  const years = Math.floor(days / 365);
  return years === 1 ? '1 ano' : `${years} anos`;
}

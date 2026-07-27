import type { CSSProperties } from 'react';

/**
 * Tema compartilhado dos gráficos do dashboard (recharts).
 *
 * Paleta categórica validada (CVD ΔE adjacente 24.2 na superfície branca —
 * skill dataviz). A ORDEM dos slots é o mecanismo de segurança para
 * daltonismo: nunca reordenar nem gerar cores além das 8 — série 9+ vira
 * "Outros". Cores seguem a ENTIDADE (ordem first-seen no dataset sem filtro),
 * nunca o rank filtrado. Aqua/amarelo/magenta têm contraste <3:1 no branco:
 * todo gráfico traz legenda com valores visíveis (regra de alívio).
 */
export const SERIES_COLORS = [
  '#2a78d6', // azul
  '#1baf7a', // verde-água
  '#eda100', // amarelo
  '#008300', // verde
  '#4a3aa7', // violeta
  '#e34948', // vermelho
  '#e87ba4', // magenta
  '#eb6834', // laranja
] as const;

/** Cores de status (reservadas — nunca reutilizar como série). */
export const STATUS_COLORS = {
  pago: '#008300',
  pendente: '#eda100',
  atrasado: '#e34948',
  cancelado: '#c3c2b7',
} as const;

/** Cromo recessivo: grid/eixos em hairline, texto em tokens de texto. */
export const CHART_CHROME = {
  grid: '#e1e0d9',
  axisLine: '#c3c2b7',
  tick: { fill: '#898781', fontSize: 11 },
} as const;

export const TOOLTIP_STYLE: CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e1e0d9',
  borderRadius: 8,
  fontSize: 12,
  boxShadow: '0 2px 8px rgba(11,11,11,0.08)',
};

const BRL_COMPACT = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Ticks de eixo: "R$ 50 mil" em vez de "R$ 50.000,00". */
export function formatBRLCompact(value: number): string {
  return BRL_COMPACT.format(value);
}

/** Valor curto para cards: "R$ 1,2M" / "R$ 50k". */
export function brlShort(v: number): string {
  const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  if (v >= 1_000_000) return `R$ ${fmt(v / 1_000_000)}M`;
  if (v >= 1_000) return `R$ ${fmt(v / 1_000)}k`;
  return `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
}

/**
 * Mapa entidade → cor por ordem first-seen no dataset SEM filtro, para a cor
 * não mudar quando o usuário filtra. Além de 8 entidades, usa cinza "Outros".
 */
export function buildColorMap(entities: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  entities.forEach((name, i) => {
    map[name] = SERIES_COLORS[i] ?? '#898781';
  });
  return map;
}

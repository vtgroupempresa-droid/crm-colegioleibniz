import 'server-only';

/**
 * Busca TODAS as linhas de uma query PostgREST paginando em blocos de 1000
 * (teto de linhas por resposta do PostgREST). Helper único dos dashboards —
 * antes cada módulo de analytics tinha uma cópia local que aguardava página
 * por página EM SÉRIE (11 mil leads = 12 idas ao banco encadeadas).
 *
 * Estratégia: a primeira página é aguardada sozinha — em tabelas com menos de
 * 1000 linhas resolve em uma única ida. Se vier cheia, as páginas seguintes
 * saem em ONDAS de `WAVE` requisições paralelas até aparecer uma página
 * incompleta (a última onda pode buscar 1 página vazia a mais — custo
 * desprezível perto do ganho de paralelismo).
 *
 * O caller DEVE ordenar a query por coluna estável (ex.: `.order('id')`) para
 * os ranges paralelos não pularem/repetirem linhas — mesma exigência que a
 * versão sequencial já tinha.
 */
const PAGE = 1000;
const WAVE = 6;

export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null }>,
): Promise<T[]> {
  const first = await build(0, PAGE - 1);
  const all = [...((first.data ?? []) as T[])];
  if (all.length < PAGE) return all;

  for (let page = 1; ; page += WAVE) {
    const results = await Promise.all(
      Array.from({ length: WAVE }, (_, i) => {
        const from = (page + i) * PAGE;
        return build(from, from + PAGE - 1);
      }),
    );
    for (const r of results) {
      const rows = (r.data ?? []) as T[];
      all.push(...rows);
      if (rows.length < PAGE) return all;
    }
  }
}

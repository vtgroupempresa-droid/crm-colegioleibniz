/**
 * Modo demonstração — REMOVIDO (Parte 4, jun/2026).
 *
 * O CRM passou a operar exclusivamente sobre dados de produção quando os
 * primeiros leads reais entraram (importação GHL). O switch demo/produção da
 * sidebar e os dados fictícios foram removidos.
 *
 * `getDemoMode()` é mantido apenas como ponto único de verdade e retorna
 * SEMPRE `false` — todas as queries continuam filtrando `is_demo = false`
 * (produção). A coluna `is_demo` permanece no banco (sempre false) e pode ser
 * dropada numa migration futura sem impacto funcional.
 */
export function getDemoMode(): boolean {
  return false;
}

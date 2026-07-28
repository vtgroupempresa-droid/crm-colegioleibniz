/**
 * Parser GENÉRICO da nomenclatura de campanhas (Meta Ads / UTM).
 *
 * Convenção suportada: colchetes viram tags do lead e o primeiro colchete
 * "temático" vira o tema da campanha. Ex.:
 *   "[Matrículas 2027] [Infantil] - Vídeo Tour - Conversão"
 *     → raw_tags: ["Matrículas 2027", "Infantil"], campaign_theme: "Matrículas 2027"
 *
 * Campanhas sem colchetes retornam vazio — a atribuição fica só nos campos
 * utm_* e meta_* do lead. Quando a Traffic AI entrar, a nomenclatura dela pode
 * ser mapeada aqui.
 *
 * Função PURA — sem I/O. Chamada sempre que um webhook recebe `campaign_name`
 * ou `utm_campaign`. Os valores extraídos viram:
 *   - tags no lead (raw_tags)
 *   - utm_campaign = campaign_theme
 */

export interface ParsedCampaign {
  campaign_theme: string | null;
  raw_tags: string[];
}

const BRACKET_RE = /\[([^\]]+)\]/g;

export function parseCampaignName(campaignName: string | null | undefined): ParsedCampaign {
  const empty: ParsedCampaign = {
    campaign_theme: null,
    raw_tags: [],
  };

  if (!campaignName || typeof campaignName !== 'string') return empty;

  const rawTags: string[] = [];
  for (const match of campaignName.matchAll(BRACKET_RE)) {
    const value = match[1]?.trim();
    if (value) rawTags.push(value);
  }

  if (rawTags.length === 0) return empty;

  return {
    campaign_theme: rawTags[0] ?? null,
    raw_tags: rawTags,
  };
}

/**
 * ad_creative derivado do nome da campanha. Na nomenclatura genérica não há
 * código de criativo embutido — a atribuição de criativo vem dos campos
 * meta_ad_name/meta_adset_name do próprio webhook. Mantido por compatibilidade
 * com os callers (retorna sempre null).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function campaignAdCreative(_parsed: ParsedCampaign): string | null {
  return null;
}

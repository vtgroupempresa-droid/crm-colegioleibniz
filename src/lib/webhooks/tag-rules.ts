import { TAG_RULE_OPS, type TagRule, type TagRuleOp } from '@/types/webhooks';
import { getByPath } from './field-mapping';

/**
 * Avaliação das tag_rules de um webhook_source (Fase 9).
 * Regra: "se campo X (contains|equals|exists) Y então tag Z".
 *
 * Função PURA — usada tanto no endpoint quanto no preview ao vivo do wizard.
 *
 * FILOSOFIA DE TAGS (Fase 10): tags servem apenas para origem do lead,
 * características do ICP, comportamento de engajamento e campanhas de marketing.
 * NUNCA use tags para produtos vendidos — o produto vendido vive em
 * deals.product_id. Ao configurar tag_rules, não crie tags que representem
 * produtos.
 */

function isTagRuleOp(value: unknown): value is TagRuleOp {
  return typeof value === 'string' && (TAG_RULE_OPS as readonly string[]).includes(value);
}

/** Lê tag_rules desconhecidas (jsonb) com segurança de tipos. */
export function parseTagRules(raw: unknown): TagRule[] {
  if (!Array.isArray(raw)) return [];
  const out: TagRule[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.field !== 'string' || typeof r.tag !== 'string') continue;
    if (!isTagRuleOp(r.op)) continue;
    if (!r.field || !r.tag) continue;
    out.push({
      field: r.field,
      op: r.op,
      value: typeof r.value === 'string' ? r.value : '',
      tag: r.tag,
    });
  }
  return out;
}

function valueAsString(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return null;
}

/** Uma regra individual bate no payload? */
export function ruleMatches(payload: unknown, rule: TagRule): boolean {
  const raw = getByPath(payload, rule.field);
  if (rule.op === 'exists') {
    return raw != null && raw !== '';
  }
  const actual = valueAsString(raw);
  if (actual == null) return false;
  const haystack = actual.toLowerCase();
  const needle = rule.value.toLowerCase();
  if (rule.op === 'equals') return haystack === needle;
  return haystack.includes(needle); // contains
}

/** Tags geradas pelas regras que baterem (sem duplicatas, ordem estável). */
export function evaluateTagRules(payload: unknown, rules: TagRule[]): string[] {
  const tags = new Set<string>();
  for (const rule of rules) {
    if (ruleMatches(payload, rule)) tags.add(rule.tag);
  }
  return [...tags];
}

/** Une listas de tags removendo vazios e duplicatas (case-insensitive no slug). */
export function mergeTags(...lists: (string[] | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    if (!list) continue;
    for (const raw of list) {
      const tag = raw?.trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

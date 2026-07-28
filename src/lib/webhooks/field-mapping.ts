import {
  MAPPABLE_LEAD_FIELDS,
  type FieldMapping,
  type FieldMappingRule,
  type FieldTransform,
  type MappableLeadField,
} from '@/types/webhooks';

/**
 * Aplicação do field_mapping configurado por webhook_source (Fase 9).
 *
 * Suporta:
 *  - dot notation para campos aninhados ("contact.phone", "data.0.value");
 *  - transformações simples (uppercase / lowercase / trim);
 *  - valores fixos ({ fixed: 'x' }).
 *
 * Função PURA — não toca no banco. Retorna apenas os campos do lead que o
 * mapeamento conseguiu preencher (o endpoint decide o que fazer com eles).
 */

/** Lê um caminho dot-notation de um objeto/array desconhecido. */
export function getByPath(source: unknown, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split('.');
  let current: unknown = source;
  for (const part of parts) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(part);
      current = Number.isInteger(idx) ? current[idx] : undefined;
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function applyTransform(value: string, transform: FieldTransform | undefined): string {
  switch (transform) {
    case 'uppercase':
      return value.toUpperCase();
    case 'lowercase':
      return value.toLowerCase();
    case 'trim':
      return value.trim();
    default:
      return value;
  }
}

function toStringValue(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return null;
}

/** Resolve uma única regra contra o payload. */
export function resolveRule(payload: unknown, rule: FieldMappingRule): string | null {
  if ('fixed' in rule) {
    return rule.fixed ?? null;
  }
  const raw = getByPath(payload, rule.from);
  const str = toStringValue(raw);
  if (str == null) return null;
  const transformed = applyTransform(str, rule.transform);
  return transformed === '' ? null : transformed;
}

/** Campos numéricos do lead — convertidos de string para number. */
const NUMERIC_FIELDS: ReadonlySet<MappableLeadField> = new Set(['child_age']);

export interface MappedLead {
  /** Campos texto resolvidos (ex.: name, phone, email, utm_*, ...). */
  values: Partial<Record<MappableLeadField, string>>;
  /** Campos numéricos resolvidos (ex.: child_age). */
  numbers: Partial<Record<MappableLeadField, number>>;
}

/** Type guard: garante que a chave do mapeamento é um campo permitido. */
function isMappableField(key: string): key is MappableLeadField {
  return (MAPPABLE_LEAD_FIELDS as readonly string[]).includes(key);
}

/**
 * Lê um FieldMapping desconhecido (vindo do jsonb) com segurança de tipos.
 * Ignora chaves fora do conjunto permitido e regras malformadas.
 */
export function parseFieldMapping(raw: unknown): FieldMapping {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: FieldMapping = {};
  for (const [key, rule] of Object.entries(raw as Record<string, unknown>)) {
    if (!isMappableField(key)) continue;
    if (rule == null || typeof rule !== 'object') continue;
    if ('fixed' in rule && typeof (rule as { fixed: unknown }).fixed === 'string') {
      out[key] = { fixed: (rule as { fixed: string }).fixed };
    } else if ('from' in rule && typeof (rule as { from: unknown }).from === 'string') {
      const r = rule as { from: string; transform?: unknown };
      const transform =
        typeof r.transform === 'string' ? (r.transform as FieldTransform) : undefined;
      out[key] = { from: r.from, transform };
    }
  }
  return out;
}

/** Aplica todo o mapeamento ao payload, separando texto de número. */
export function applyFieldMapping(payload: unknown, mapping: FieldMapping): MappedLead {
  const values: Partial<Record<MappableLeadField, string>> = {};
  const numbers: Partial<Record<MappableLeadField, number>> = {};

  for (const field of MAPPABLE_LEAD_FIELDS) {
    const rule = mapping[field];
    if (!rule) continue;
    const resolved = resolveRule(payload, rule);
    if (resolved == null) continue;

    if (NUMERIC_FIELDS.has(field)) {
      const num = Number(resolved.replace(/[^\d.,-]/g, '').replace(',', '.'));
      if (Number.isFinite(num)) numbers[field] = num;
    } else {
      values[field] = resolved;
    }
  }

  return { values, numbers };
}

/** Lista os caminhos (dot notation) detectáveis em um payload de teste. */
export function detectPayloadFields(payload: unknown, prefix = '', depth = 0): string[] {
  if (depth > 4 || payload == null || typeof payload !== 'object') return [];
  const paths: string[] = [];
  const entries = Array.isArray(payload)
    ? payload.map((v, i) => [String(i), v] as const)
    : Object.entries(payload as Record<string, unknown>);

  for (const [key, value] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value != null && typeof value === 'object') {
      paths.push(...detectPayloadFields(value, path, depth + 1));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

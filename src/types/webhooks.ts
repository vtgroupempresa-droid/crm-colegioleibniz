import type { Tables, TablesInsert, TablesUpdate } from './database';

export type WebhookSource = Tables<'webhook_sources'>;
export type WebhookSourceInsert = TablesInsert<'webhook_sources'>;
export type WebhookSourceUpdate = TablesUpdate<'webhook_sources'>;

export type WebhookLog = Tables<'webhook_logs'>;
export type WebhookLogInsert = TablesInsert<'webhook_logs'>;

/** Status de processamento de um recebimento — enum fechado (CHECK no banco). */
export type WebhookLogStatus = 'processing' | 'success' | 'error' | 'duplicate' | 'ignored';

export const WEBHOOK_LOG_STATUS_META: Record<
  WebhookLogStatus,
  { label: string; tone: 'neutral' | 'success' | 'danger' | 'warning' | 'info' }
> = {
  processing: { label: 'Processando', tone: 'info' },
  success: { label: 'Sucesso', tone: 'success' },
  error: { label: 'Erro', tone: 'danger' },
  duplicate: { label: 'Duplicado', tone: 'warning' },
  ignored: { label: 'Ignorado', tone: 'neutral' },
};

/**
 * Campos do lead que o admin pode mapear via webhook (conjunto FECHADO).
 * Mantém o no-code seguro: nenhuma fonte externa escreve em colunas internas
 * (score, assigned_to, is_demo, pipeline...).
 */
export const MAPPABLE_LEAD_FIELDS = [
  'name',
  'phone',
  'email',
  'instagram',
  'city',
  'state',
  'child_name',
  'child_age',
  'education_level',
  'school_year',
  'interest_level',
  'with_child',
  'source',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'ad_creative',
  'landing_page',
] as const;

export type MappableLeadField = (typeof MAPPABLE_LEAD_FIELDS)[number];

export const MAPPABLE_LEAD_FIELD_LABELS: Record<MappableLeadField, string> = {
  name: 'Nome do responsável',
  phone: 'Telefone',
  email: 'Email',
  instagram: 'Instagram',
  city: 'Cidade',
  state: 'Estado (UF)',
  child_name: 'Nome do filho',
  child_age: 'Idade do filho',
  education_level: 'Nível de ensino',
  school_year: 'Ano escolar',
  interest_level: 'Nível de interesse',
  with_child: 'Entra com o filho',
  source: 'Origem',
  utm_source: 'UTM Source',
  utm_medium: 'UTM Medium',
  utm_campaign: 'UTM Campaign',
  utm_content: 'UTM Content',
  utm_term: 'UTM Term',
  ad_creative: 'Criativo',
  landing_page: 'Landing page',
};

/** Transformações simples aplicáveis a um valor extraído. */
export const FIELD_TRANSFORMS = ['none', 'uppercase', 'lowercase', 'trim'] as const;
export type FieldTransform = (typeof FIELD_TRANSFORMS)[number];

/**
 * Uma regra de mapeamento por campo destino:
 *  - { from: 'dot.path', transform } → extrai do payload (dot notation) e transforma.
 *  - { fixed: 'valor' }              → grava um valor fixo independente do payload.
 */
export type FieldMappingRule =
  | { from: string; transform?: FieldTransform }
  | { fixed: string };

/** Mapeamento completo: campo do lead → regra. */
export type FieldMapping = Partial<Record<MappableLeadField, FieldMappingRule>>;

export const TAG_RULE_OPS = ['contains', 'equals', 'exists'] as const;
export type TagRuleOp = (typeof TAG_RULE_OPS)[number];

export const TAG_RULE_OP_LABELS: Record<TagRuleOp, string> = {
  contains: 'contém',
  equals: 'é igual a',
  exists: 'existe',
};

/** Regra "se campo X (op) Y então tag Z". */
export interface TagRule {
  field: string;
  op: TagRuleOp;
  value: string;
  tag: string;
}

/** Opções comuns oferecidas no passo 1 do wizard (apenas rótulo/UX). */
export const WEBHOOK_SOURCE_PRESETS = [
  'Meta Ads',
  'Elementor',
  'Typeform',
  'Google Forms',
  'RD Station',
  'n8n / Zapier',
  'Checkout',
  'Outro',
] as const;

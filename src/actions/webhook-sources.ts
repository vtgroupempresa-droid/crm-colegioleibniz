'use server';

import { revalidatePath } from 'next/cache';
import crypto from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { parseFieldMapping, applyFieldMapping, getByPath } from '@/lib/webhooks/field-mapping';
import { parseTagRules, evaluateTagRules, mergeTags } from '@/lib/webhooks/tag-rules';
import { parseCampaignName, campaignAdCreative } from '@/lib/webhooks/campaign-parser';
import { PIPELINES, type PipelineKind } from '@/types/pipeline';
import type { Json } from '@/types/database';
import type { FieldMapping, TagRule, WebhookLog, WebhookSource } from '@/types/webhooks';
import type { ActionResult } from './leads';

/**
 * Server Actions do motor de webhooks no-code (Fase 9).
 * Escrita/leitura restritas a admin/CEO (RLS + checagem aqui).
 */

async function requireAdminOrCeo() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Não autenticado' };
  const { data: me } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (me?.role !== 'admin') {
    return { ok: false as const, error: 'Acesso restrito ao admin' };
  }
  return { ok: true as const, user, supabase };
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base || 'fonte'}-${suffix}`;
}

export interface WebhookSourceStats {
  source: WebhookSource;
  lastReceivedAt: string | null;
  total: number;
  successCount: number;
}

/** Lista as fontes com estatísticas de recebimento (tela /integracoes/webhooks). */
export async function getWebhookSources(): Promise<WebhookSourceStats[]> {
  const auth = await requireAdminOrCeo();
  if (!auth.ok) return [];
  const { supabase } = auth;

  const { data: sources } = await supabase
    .from('webhook_sources')
    .select('*')
    .order('created_at', { ascending: false });

  if (!sources) return [];

  return Promise.all(
    sources.map(async (source) => {
      const [{ count: total }, { count: successCount }, { data: last }] = await Promise.all([
        supabase
          .from('webhook_logs')
          .select('id', { count: 'exact', head: true })
          .eq('source_id', source.id),
        supabase
          .from('webhook_logs')
          .select('id', { count: 'exact', head: true })
          .eq('source_id', source.id)
          .in('status', ['success', 'duplicate']),
        supabase
          .from('webhook_logs')
          .select('received_at')
          .eq('source_id', source.id)
          .order('received_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        source,
        lastReceivedAt: last?.received_at ?? null,
        total: total ?? 0,
        successCount: successCount ?? 0,
      };
    }),
  );
}

export async function getWebhookSourceBySlug(slug: string): Promise<WebhookSource | null> {
  const auth = await requireAdminOrCeo();
  if (!auth.ok) return null;
  const { data } = await auth.supabase
    .from('webhook_sources')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  return data ?? null;
}

/** Últimos 100 recebimentos de uma fonte (tela de logs). */
export async function getWebhookLogs(sourceId: string): Promise<WebhookLog[]> {
  const auth = await requireAdminOrCeo();
  if (!auth.ok) return [];
  const { data } = await auth.supabase
    .from('webhook_logs')
    .select('*')
    .eq('source_id', sourceId)
    .order('received_at', { ascending: false })
    .limit(100);
  return data ?? [];
}

export interface SaveWebhookSourceInput {
  name: string;
  default_pipeline: string;
  default_stage: string;
  field_mapping: FieldMapping;
  tag_rules: TagRule[];
}

function validatePipeline(value: string): PipelineKind {
  return (PIPELINES as readonly string[]).includes(value) ? (value as PipelineKind) : 'comercial';
}

export async function createWebhookSource(
  input: SaveWebhookSourceInput,
): Promise<ActionResult<{ slug: string; secret: string }>> {
  const auth = await requireAdminOrCeo();
  if (!auth.ok) return { ok: false, error: auth.error };
  const { supabase } = auth;

  if (!input.name || input.name.trim().length < 2) {
    return { ok: false, error: 'Nome obrigatório' };
  }

  const slug = slugify(input.name);
  const secret = crypto.randomBytes(24).toString('hex');

  const { error } = await supabase.from('webhook_sources').insert({
    name: input.name.trim(),
    slug,
    secret,
    default_pipeline: validatePipeline(input.default_pipeline),
    default_stage: input.default_stage || 'novo_lead',
    field_mapping: parseFieldMapping(input.field_mapping) as unknown as Json,
    tag_rules: parseTagRules(input.tag_rules) as unknown as Json,
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath('/integracoes/webhooks');
  return { ok: true, data: { slug, secret } };
}

export async function updateWebhookSource(
  id: string,
  input: SaveWebhookSourceInput,
): Promise<ActionResult> {
  const auth = await requireAdminOrCeo();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { error } = await auth.supabase
    .from('webhook_sources')
    .update({
      name: input.name.trim(),
      default_pipeline: validatePipeline(input.default_pipeline),
      default_stage: input.default_stage || 'novo_lead',
      field_mapping: parseFieldMapping(input.field_mapping) as unknown as Json,
      tag_rules: parseTagRules(input.tag_rules) as unknown as Json,
    })
    .eq('id', id);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/integracoes/webhooks');
  return { ok: true, data: undefined };
}

export async function setWebhookSourceActive(id: string, isActive: boolean): Promise<ActionResult> {
  const auth = await requireAdminOrCeo();
  if (!auth.ok) return { ok: false, error: auth.error };
  const { error } = await auth.supabase
    .from('webhook_sources')
    .update({ is_active: isActive })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/integracoes/webhooks');
  return { ok: true, data: undefined };
}

export async function deleteWebhookSource(id: string): Promise<ActionResult> {
  const auth = await requireAdminOrCeo();
  if (!auth.ok) return { ok: false, error: auth.error };
  const { error } = await auth.supabase.from('webhook_sources').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/integracoes/webhooks');
  return { ok: true, data: undefined };
}

export interface WebhookPreview {
  values: Record<string, string>;
  numbers: Record<string, number>;
  tags: string[];
  adCreative: string | null;
  campaignTheme: string | null;
}

/**
 * Dry-run do mapeamento + parser + tag_rules sobre um payload de teste.
 * NÃO cria lead — usado nos passos 2/3/4 do wizard para preview ao vivo.
 */
export async function previewWebhook(
  payloadText: string,
  fieldMapping: FieldMapping,
  tagRules: TagRule[],
): Promise<ActionResult<WebhookPreview>> {
  const auth = await requireAdminOrCeo();
  if (!auth.ok) return { ok: false, error: auth.error };

  let payload: unknown;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    return { ok: false, error: 'JSON de teste inválido' };
  }

  const mapping = parseFieldMapping(fieldMapping);
  const mapped = applyFieldMapping(payload, mapping);

  const campaignRaw =
    (getByPath(payload, 'campaign_name') as string | undefined) ??
    (getByPath(payload, 'utm_campaign') as string | undefined) ??
    mapped.values.utm_campaign ??
    null;
  const parsed = parseCampaignName(campaignRaw);
  const adCreative = campaignAdCreative(parsed);

  const ruleTags = evaluateTagRules(payload, parseTagRules(tagRules));
  const tags = mergeTags(
    parsed.raw_tags,
    parsed.campaign_theme ? [parsed.campaign_theme] : [],
    ruleTags,
  );

  return {
    ok: true,
    data: {
      values: mapped.values as Record<string, string>,
      numbers: mapped.numbers as Record<string, number>,
      tags,
      adCreative,
      campaignTheme: parsed.campaign_theme,
    },
  };
}

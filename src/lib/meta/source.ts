import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type DbClient = SupabaseClient<Database>;

/**
 * webhook_source dedicado da Meta (Fase 11).
 *
 * O webhook unificado da Meta (/api/meta/webhook) e o importador histórico de
 * Lead Ads registram cada recebimento em `webhook_logs`, que exige um
 * `source_id`. Como a Meta não passa pelo fluxo no-code (/receive/[slug]),
 * mantemos uma fonte fixa de slug `meta` só para amarrar os logs.
 *
 * Sem dependência de Next (cookies/cache) — pode rodar no script CLI e no
 * webhook via admin client.
 */

export const META_SOURCE_SLUG = 'meta';

/** Acha (ou cria) a fonte fixa da Meta e devolve o id. */
export async function getOrCreateMetaSource(admin: DbClient): Promise<string> {
  const { data: existing } = await admin
    .from('webhook_sources')
    .select('id')
    .eq('slug', META_SOURCE_SLUG)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await admin
    .from('webhook_sources')
    .insert({
      name: 'Meta (WhatsApp / Instagram / Lead Ads)',
      slug: META_SOURCE_SLUG,
      secret: crypto.randomUUID(),
      default_pipeline: 'comercial',
      default_stage: 'novo_lead',
      is_active: true,
    })
    .select('id')
    .single();

  if (created) return created.id;

  // Corrida: outra escrita criou a fonte em paralelo — relê pelo slug único.
  const { data: retry } = await admin
    .from('webhook_sources')
    .select('id')
    .eq('slug', META_SOURCE_SLUG)
    .maybeSingle();
  if (retry) return retry.id;

  throw new Error(error?.message ?? 'Falha ao criar a fonte Meta em webhook_sources');
}

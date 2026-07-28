'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchLeadForms, type LeadForm } from '@/lib/meta/client';
import { getMetaConfigStatus, type MetaConfigStatus } from '@/lib/meta/config';
import { getMetaWebhookStatus, type MetaWebhookStatus } from '@/lib/meta/status';
import { parseCampaignName, campaignAdCreative } from '@/lib/webhooks/campaign-parser';
import type { ActionResult } from './leads';

/**
 * Server Actions da tela /integracoes/meta (Fase 9).
 * Tudo restrito a admin/CEO. Degradação graciosa: sem credencial, nada lança.
 */

async function requireAdminOrCeo(): Promise<boolean> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: me } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  return me?.role === 'admin';
}

/** Status (sem segredos) das conexões da Meta — consumido pela tela. */
export async function getMetaStatus(): Promise<MetaConfigStatus | null> {
  if (!(await requireAdminOrCeo())) return null;
  return getMetaConfigStatus();
}

/** Status operacional do webhook (vars, último evento, leads 24h). */
export async function fetchMetaWebhookStatus(): Promise<MetaWebhookStatus | null> {
  if (!(await requireAdminOrCeo())) return null;
  return getMetaWebhookStatus(createAdminClient());
}

/** Lista os formulários de Lead Ads (aba Lead Ads). */
export async function getLeadForms(): Promise<
  ActionResult<{ forms: LeadForm[]; configured: boolean }>
> {
  if (!(await requireAdminOrCeo())) return { ok: false, error: 'Acesso restrito ao admin' };
  const result = await fetchLeadForms();
  if (!result.ok) {
    if (result.skipped) return { ok: true, data: { forms: [], configured: false } };
    return { ok: false, error: result.error };
  }
  return { ok: true, data: { forms: result.data, configured: true } };
}

export interface TestLeadPreview {
  name: string;
  phone: string;
  email: string;
  tags: string[];
  adCreative: string | null;
  campaignTheme: string | null;
  source: string;
}

/**
 * Testa o fluxo de Lead Ads com um lead fictício (dry-run, NÃO grava nada).
 * Mostra como o campaign-parser trataria uma campanha real da escola.
 */
export async function previewTestLeadAds(): Promise<ActionResult<TestLeadPreview>> {
  if (!(await requireAdminOrCeo())) return { ok: false, error: 'Acesso restrito ao admin' };

  const sampleCampaign = '[SD] [ESR 2605] [Beleza] - Criativo Antes Depois - Conversão';
  const parsed = parseCampaignName(sampleCampaign);

  return {
    ok: true,
    data: {
      name: 'Dra. Lead de Teste',
      phone: '+5511999990000',
      email: 'teste@colegioleibniz.com.br',
      tags: [...parsed.raw_tags, parsed.campaign_theme ?? '', 'lead-ads'].filter(Boolean),
      adCreative: campaignAdCreative(parsed),
      campaignTheme: parsed.campaign_theme,
      source: 'meta_ads',
    },
  };
}

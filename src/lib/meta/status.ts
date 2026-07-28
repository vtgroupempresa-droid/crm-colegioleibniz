import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isConfigured, isInstagramDirectConfigured, metaEnv } from './config';
import { getOrCreateMetaSource } from './source';
import { fetchInstagramAccount, fetchPageStatus } from './client';
import type { Database } from '@/types/database';

type DbClient = SupabaseClient<Database>;

/**
 * Status operacional do webhook unificado da Meta (Fase 11).
 *
 * Consumido pelo endpoint GET /api/meta/webhook/status e pela tela
 * /integracoes/meta. Não expõe segredos — apenas se cada variável está
 * configurada, o timestamp do último evento e o volume das últimas 24h.
 */

export interface MetaEnvVarStatus {
  key: string;
  label: string;
  configured: boolean;
}

export interface MetaWebhookStatus {
  vars: MetaEnvVarStatus[];
  allConfigured: boolean;
  lastEventAt: string | null;
  leads24h: number;
}

export async function getMetaWebhookStatus(admin: DbClient): Promise<MetaWebhookStatus> {
  const vars: MetaEnvVarStatus[] = [
    { key: 'META_APP_ID', label: 'App ID', configured: isConfigured(metaEnv.appId) },
    { key: 'META_APP_SECRET', label: 'App Secret', configured: isConfigured(metaEnv.appSecret) },
    {
      key: 'META_VERIFY_TOKEN',
      label: 'Verify Token',
      configured: isConfigured(metaEnv.verifyToken),
    },
    {
      key: 'INSTAGRAM_PAGE_ID',
      label: 'Instagram Page ID',
      configured: isConfigured(metaEnv.instagramPageId),
    },
    {
      key: 'INSTAGRAM_ACCESS_TOKEN',
      label: 'Instagram Access Token',
      configured: isConfigured(metaEnv.instagramPageToken),
    },
    {
      key: 'WHATSAPP_PHONE_NUMBER_ID',
      label: 'WhatsApp Phone Number ID',
      configured: isConfigured(metaEnv.whatsappPhoneNumberId),
    },
    {
      key: 'WHATSAPP_ACCESS_TOKEN',
      label: 'WhatsApp Access Token',
      configured: isConfigured(metaEnv.whatsappToken),
    },
  ];

  // Último evento recebido via Meta (webhook_logs da fonte fixa).
  let lastEventAt: string | null = null;
  const sourceId = await getOrCreateMetaSource(admin).catch(() => null);
  if (sourceId) {
    const { data: lastLog } = await admin
      .from('webhook_logs')
      .select('received_at')
      .eq('source_id', sourceId)
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    lastEventAt = lastLog?.received_at ?? null;
  }

  // Leads criados via Meta nas últimas 24h (produção, origem meta_ads).
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('is_demo', false)
    .eq('source', 'meta_ads')
    .gte('created_at', since);

  return {
    vars,
    allConfigured: vars.every((v) => v.configured),
    lastEventAt,
    leads24h: count ?? 0,
  };
}

// ============================================================================
// Status detalhado (Parte 5) — página, Instagram Direct, últimos eventos e
// volumes 24h. Faz chamadas ao vivo na Graph API (admin/CEO, force-dynamic).
// ============================================================================

type ConnectionStatus = 'connected' | 'not_configured' | 'error';

export interface MetaPageStatus {
  id: string | null;
  name: string | null;
  subscribed_fields: string[];
  status: ConnectionStatus;
  error?: string;
}

export interface InstagramDirectStatus {
  user_id: string | null;
  username: string | null;
  status: ConnectionStatus;
  error?: string;
}

export interface MetaIntegrationStatus {
  page: MetaPageStatus;
  instagram_direct: InstagramDirectStatus;
  last_events: {
    leadgen: string | null;
    instagram_message: string | null;
  };
  counts_24h: {
    leads_meta_ads: number;
    instagram_messages: number;
  };
}

export async function getMetaIntegrationStatus(admin: DbClient): Promise<MetaIntegrationStatus> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Página do Facebook (campos assinados: leadgen etc.).
  const pageResult = await fetchPageStatus();
  const page: MetaPageStatus = pageResult.ok
    ? {
        id: pageResult.data.id,
        name: pageResult.data.name,
        subscribed_fields: pageResult.data.subscribed_fields,
        status: 'connected',
      }
    : {
        id: isConfigured(metaEnv.instagramPageId) ? metaEnv.instagramPageId ?? null : null,
        name: null,
        subscribed_fields: [],
        status: pageResult.skipped ? 'not_configured' : 'error',
        error: pageResult.error,
      };

  // Instagram Direct (DMs).
  let instagram_direct: InstagramDirectStatus;
  if (!isInstagramDirectConfigured()) {
    instagram_direct = { user_id: null, username: null, status: 'not_configured' };
  } else {
    const acc = await fetchInstagramAccount();
    instagram_direct = acc.ok
      ? { user_id: acc.data.id, username: acc.data.username, status: 'connected' }
      : {
          user_id: metaEnv.instagramUserId ?? null,
          username: null,
          status: 'error',
          error: acc.error,
        };
  }

  // Último leadgen recebido (webhook_logs com payload.via = 'meta-leadgen').
  const { data: lastLeadgen } = await admin
    .from('webhook_logs')
    .select('received_at')
    .eq('payload->>via', 'meta-leadgen')
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Conversas de Instagram → última mensagem inbound + volume 24h.
  const { data: igConvs } = await admin
    .from('conversations')
    .select('id')
    .eq('channel', 'instagram');
  const igIds = (igConvs ?? []).map((c) => c.id);

  let lastInstagramMessage: string | null = null;
  let instagramMessages24h = 0;
  if (igIds.length > 0) {
    const [{ data: lastMsg }, { count: igCount }] = await Promise.all([
      admin
        .from('messages')
        .select('created_at')
        .in('conversation_id', igIds)
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .in('conversation_id', igIds)
        .eq('direction', 'inbound')
        .gte('created_at', since),
    ]);
    lastInstagramMessage = lastMsg?.created_at ?? null;
    instagramMessages24h = igCount ?? 0;
  }

  // Leads via Meta Ads nas últimas 24h.
  const { count: leadsMetaAds } = await admin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('is_demo', false)
    .eq('source', 'meta_ads')
    .gte('created_at', since);

  return {
    page,
    instagram_direct,
    last_events: {
      leadgen: lastLeadgen?.received_at ?? null,
      instagram_message: lastInstagramMessage,
    },
    counts_24h: {
      leads_meta_ads: leadsMetaAds ?? 0,
      instagram_messages: instagramMessages24h,
    },
  };
}

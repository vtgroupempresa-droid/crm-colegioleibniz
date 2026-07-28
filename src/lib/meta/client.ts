import 'server-only';
import { META_GRAPH_BASE, isConfigured, isInstagramDirectConfigured, metaEnv } from './config';
import type { ChatChannel, MessageType } from '@/types/chat';

/**
 * Cliente da Graph API da Meta — WhatsApp Cloud API + Instagram Messaging
 * (Messenger Platform via página) + Lead Ads.
 *
 * Instagram Direct: o envio usa POST /{PAGE_ID}/messages em graph.facebook.com
 * com o Page Access Token da página "Colégio Leibniz" (token de System User,
 * sem expiração). O destinatário é o IGSID recebido no webhook.
 *
 * DEGRADAÇÃO GRACIOSA: nenhuma função lança. Quando a credencial necessária
 * está ausente/placeholder, retornamos `{ ok: false, skipped: true }`. O caller
 * (Server Action / webhook) trata isso como "não configurado" sem quebrar.
 */

export type MetaResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; skipped?: boolean };

/**
 * Identidade de envio da Cloud API (multi-número, 2026-07-23). Cada instância
 * `provider='official'` tem seu próprio `phone_number_id`; quando o número vive
 * em OUTRA WABA/BM (ex.: "API OFICIAL MS" na BM própria vs. o número SariDoctors
 * na BM do BSP), também precisa do token daquela WABA (`instance_token`).
 * Campos ausentes caem no env (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN).
 */
export interface OfficialVia {
  phoneNumberId?: string | null;
  accessToken?: string | null;
}

/** Resolve phone_number_id + token efetivos (instância → env). */
export function resolveOfficialVia(via?: OfficialVia): {
  phoneNumberId: string | undefined;
  accessToken: string | undefined;
} {
  return {
    phoneNumberId: via?.phoneNumberId ?? metaEnv.whatsappPhoneNumberId,
    accessToken: via?.accessToken ?? metaEnv.whatsappToken,
  };
}

interface OutboundMessage {
  type: MessageType;
  content?: string | null;
  mediaUrl?: string | null;
}

export async function graphRequest<T>(
  url: string,
  init: RequestInit,
): Promise<MetaResult<T>> {
  try {
    const res = await fetch(url, init);
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const errObj = json.error as { message?: string } | undefined;
      return { ok: false, error: errObj?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, data: json as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Falha de rede' };
  }
}

/** Monta o objeto de mensagem do WhatsApp conforme o tipo. */
function whatsappBody(to: string, msg: OutboundMessage): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp', to };
  switch (msg.type) {
    case 'image':
      return { ...base, type: 'image', image: { link: msg.mediaUrl } };
    case 'video':
      return { ...base, type: 'video', video: { link: msg.mediaUrl } };
    case 'audio': {
      // OGG/Opus (gravação de voz do chat) vai com voice=true — é o que faz o
      // WhatsApp renderizar como mensagem de voz NATIVA (waveform + microfone).
      // Sem o flag, até OGG chega como arquivo de áudio genérico.
      const isVoiceNote = ((msg.mediaUrl ?? '').toLowerCase().split('?')[0] ?? '').endsWith('.ogg');
      return {
        ...base,
        type: 'audio',
        audio: { link: msg.mediaUrl, ...(isVoiceNote ? { voice: true } : {}) },
      };
    }
    case 'document':
      return { ...base, type: 'document', document: { link: msg.mediaUrl } };
    default:
      return { ...base, type: 'text', text: { body: msg.content ?? '' } };
  }
}

export async function sendWhatsappMessage(
  to: string,
  msg: OutboundMessage,
  via?: OfficialVia,
): Promise<MetaResult<{ messageId: string | null }>> {
  const { phoneNumberId, accessToken } = resolveOfficialVia(via);
  if (!isConfigured(phoneNumberId) || !isConfigured(accessToken)) {
    return { ok: false, error: 'WhatsApp não configurado', skipped: true };
  }
  const url = `${META_GRAPH_BASE}/${phoneNumberId}/messages`;
  const result = await graphRequest<{ messages?: { id: string }[] }>(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(whatsappBody(to, msg)),
  });
  if (!result.ok) return result;
  return { ok: true, data: { messageId: result.data.messages?.[0]?.id ?? null } };
}

/**
 * Reage a uma mensagem do WhatsApp (type=reaction). O alvo é o wamid da
 * mensagem original; emoji vazio ('') remove a reação. Funciona para mensagens
 * de qualquer direção dentro da janela da conversa.
 */
export async function sendWhatsappReaction(
  to: string,
  targetMessageId: string,
  emoji: string,
  via?: OfficialVia,
): Promise<MetaResult<{ messageId: string | null }>> {
  const { phoneNumberId, accessToken } = resolveOfficialVia(via);
  if (!isConfigured(phoneNumberId) || !isConfigured(accessToken)) {
    return { ok: false, error: 'WhatsApp não configurado', skipped: true };
  }
  const url = `${META_GRAPH_BASE}/${phoneNumberId}/messages`;
  const result = await graphRequest<{ messages?: { id: string }[] }>(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'reaction',
      reaction: { message_id: targetMessageId, emoji },
    }),
  });
  if (!result.ok) return result;
  return { ok: true, data: { messageId: result.data.messages?.[0]?.id ?? null } };
}

export async function sendInstagramMessage(
  recipientId: string,
  msg: OutboundMessage,
): Promise<MetaResult<{ messageId: string | null }>> {
  if (!isInstagramDirectConfigured()) {
    return { ok: false, error: 'Instagram Direct não configurado', skipped: true };
  }
  // Messenger Platform for Instagram: envia via graph.facebook.com com o Page
  // Access Token da página vinculada ao IG. recipientId é o IGSID do contato.
  const token = metaEnv.instagramPageToken;
  const url = `${META_GRAPH_BASE}/${metaEnv.instagramPageId}/messages?access_token=${token}`;
  // Tipos de attachment aceitos pelo IG: image | video | audio | file.
  const igAttachmentType =
    msg.type === 'image' || msg.type === 'sticker'
      ? 'image'
      : msg.type === 'video'
        ? 'video'
        : msg.type === 'audio'
          ? 'audio'
          : 'file';
  const message =
    msg.type === 'text' || !msg.mediaUrl
      ? { text: msg.content ?? '' }
      : { attachment: { type: igAttachmentType, payload: { url: msg.mediaUrl } } };
  const result = await graphRequest<{ message_id?: string }>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, message }),
  });
  if (!result.ok) return result;
  return { ok: true, data: { messageId: result.data.message_id ?? null } };
}

/** Envia por canal — roteia para WhatsApp ou Instagram. */
export async function sendByChannel(
  channel: ChatChannel,
  externalId: string,
  msg: OutboundMessage,
  via?: OfficialVia,
): Promise<MetaResult<{ messageId: string | null }>> {
  return channel === 'whatsapp'
    ? sendWhatsappMessage(externalId, msg, via)
    : sendInstagramMessage(externalId, msg);
}

/**
 * Baixa uma mídia recebida (WhatsApp envia apenas media_id):
 *  1. GET /{mediaId} → { url, mime_type }
 *  2. GET url (com Bearer) → binário
 */
export async function downloadWhatsappMedia(
  mediaId: string,
  accessToken?: string | null,
): Promise<MetaResult<{ buffer: ArrayBuffer; mimeType: string }>> {
  // Mídia pertence à WABA que a recebeu: número de outra WABA/BM (ex.: API
  // OFICIAL MS) exige o token daquela instância — o do env não a enxerga.
  const token = accessToken ?? metaEnv.whatsappToken;
  if (!isConfigured(token)) {
    return { ok: false, error: 'WhatsApp não configurado', skipped: true };
  }
  const meta = await graphRequest<{ url?: string; mime_type?: string }>(
    `${META_GRAPH_BASE}/${mediaId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!meta.ok) return meta;
  if (!meta.data.url) return { ok: false, error: 'media url ausente' };

  try {
    const bin = await fetch(meta.data.url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!bin.ok) return { ok: false, error: `HTTP ${bin.status} ao baixar mídia` };
    const buffer = await bin.arrayBuffer();
    return {
      ok: true,
      data: { buffer, mimeType: meta.data.mime_type ?? 'application/octet-stream' },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Falha ao baixar mídia' };
  }
}

export interface LeadgenField {
  name: string;
  values: string[];
}

export interface LeadgenData {
  field_data: LeadgenField[];
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  form_id: string | null;
}

/** Busca os dados de um lead do Lead Ads pelo leadgen_id. */
export async function fetchLeadgenData(leadgenId: string): Promise<MetaResult<LeadgenData>> {
  // Page Access Token da página Colégio Leibniz (tem leads_retrieval); o getter
  // já cai no token de System User se o token de página não estiver definido.
  const token = metaEnv.instagramPageToken;
  if (!isConfigured(token)) {
    return { ok: false, error: 'Token da Meta não configurado', skipped: true };
  }
  const fields =
    'field_data,campaign_name,adset_name,ad_name,campaign_id,adset_id,ad_id,form_id';
  const url = `${META_GRAPH_BASE}/${leadgenId}?fields=${fields}&access_token=${token}`;
  const result = await graphRequest<{
    field_data?: LeadgenField[];
    campaign_name?: string;
    adset_name?: string;
    ad_name?: string;
    campaign_id?: string;
    adset_id?: string;
    ad_id?: string;
    form_id?: string;
  }>(url, { method: 'GET' });
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      field_data: result.data.field_data ?? [],
      campaign_name: result.data.campaign_name ?? null,
      adset_name: result.data.adset_name ?? null,
      ad_name: result.data.ad_name ?? null,
      campaign_id: result.data.campaign_id ?? null,
      adset_id: result.data.adset_id ?? null,
      ad_id: result.data.ad_id ?? null,
      form_id: result.data.form_id ?? null,
    },
  };
}

/**
 * Resolve o nome de um objeto da Graph API (campanha/adset/anúncio/formulário)
 * pelo id, com o Page/System User Token. Best-effort: falha → null.
 */
export async function fetchObjectName(objectId: string): Promise<string | null> {
  const token = metaEnv.instagramPageToken;
  if (!isConfigured(token)) return null;
  const url = `${META_GRAPH_BASE}/${objectId}?fields=name&access_token=${token}`;
  const result = await graphRequest<{ name?: string }>(url, { method: 'GET' });
  return result.ok ? result.data.name ?? null : null;
}

export interface LeadForm {
  id: string;
  name: string;
  status: string;
}

export interface InstagramProfile {
  id: string;
  name: string | null;
  username: string | null;
}

/**
 * Busca o perfil de um usuário do Instagram (quem mandou DM) pelo IGSID, via
 * graph.facebook.com com o Page Access Token. Usado no webhook de mensagens.
 */
export async function fetchInstagramUserProfile(
  igUserId: string,
): Promise<MetaResult<InstagramProfile>> {
  const token = metaEnv.instagramPageToken;
  if (!isConfigured(token)) {
    return { ok: false, error: 'Instagram Direct não configurado', skipped: true };
  }
  const url = `${META_GRAPH_BASE}/${igUserId}?fields=name,username&access_token=${token}`;
  const result = await graphRequest<{ id?: string; name?: string; username?: string }>(url, {
    method: 'GET',
  });
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      id: result.data.id ?? igUserId,
      name: result.data.name ?? null,
      username: result.data.username ?? null,
    },
  };
}

/** Valida a conta de Instagram Direct configurada (endpoint de teste). */
export async function fetchInstagramAccount(): Promise<MetaResult<InstagramProfile>> {
  if (!isInstagramDirectConfigured()) {
    return {
      ok: false,
      error:
        'Instagram Direct não configurado (defina INSTAGRAM_PAGE_ID, INSTAGRAM_PAGE_TOKEN e INSTAGRAM_USER_ID)',
      skipped: true,
    };
  }
  const token = metaEnv.instagramPageToken;
  const url = `${META_GRAPH_BASE}/${metaEnv.instagramUserId}?fields=id,name,username&access_token=${token}`;
  const result = await graphRequest<{ id?: string; name?: string; username?: string }>(url, {
    method: 'GET',
  });
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      id: result.data.id ?? (metaEnv.instagramUserId as string),
      name: result.data.name ?? null,
      username: result.data.username ?? null,
    },
  };
}

export interface PageStatus {
  id: string;
  name: string | null;
  subscribed_fields: string[];
}

/**
 * Status da página do Facebook: nome + campos assinados no webhook (leadgen
 * etc.). Usa o Page Access Token (graph.facebook.com). Degradação graciosa.
 */
export async function fetchPageStatus(): Promise<MetaResult<PageStatus>> {
  const pageId = metaEnv.instagramPageId;
  const token = metaEnv.instagramPageToken;
  if (!isConfigured(pageId) || !isConfigured(token)) {
    return {
      ok: false,
      error: 'Página da Meta não configurada (INSTAGRAM_PAGE_ID + token)',
      skipped: true,
    };
  }

  const info = await graphRequest<{ id?: string; name?: string }>(
    `${META_GRAPH_BASE}/${pageId}?fields=id,name&access_token=${token}`,
    { method: 'GET' },
  );
  if (!info.ok) return info;

  const subs = await graphRequest<{
    data?: { subscribed_fields?: (string | { name?: string })[] }[];
  }>(`${META_GRAPH_BASE}/${pageId}/subscribed_apps?access_token=${token}`, { method: 'GET' });

  const rawFields = subs.ok ? subs.data.data?.[0]?.subscribed_fields ?? [] : [];
  const subscribed_fields = rawFields
    .map((f) => (typeof f === 'string' ? f : f.name ?? ''))
    .filter((f): f is string => f.length > 0);

  return {
    ok: true,
    data: { id: info.data.id ?? (pageId as string), name: info.data.name ?? null, subscribed_fields },
  };
}

/** Lista os formulários de Lead Ads da página (aba Lead Ads). */
export async function fetchLeadForms(): Promise<MetaResult<LeadForm[]>> {
  const token = metaEnv.instagramPageToken;
  const pageId = metaEnv.instagramPageId;
  if (!isConfigured(token) || !isConfigured(pageId)) {
    return { ok: false, error: 'Página da Meta não configurada', skipped: true };
  }
  const url = `${META_GRAPH_BASE}/${pageId}/leadgen_forms?access_token=${token}`;
  const result = await graphRequest<{ data?: LeadForm[] }>(url, { method: 'GET' });
  if (!result.ok) return result;
  return { ok: true, data: result.data.data ?? [] };
}

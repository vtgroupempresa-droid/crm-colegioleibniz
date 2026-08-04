import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  downloadWhatsappMedia,
  fetchLeadgenData,
  fetchInstagramUserProfile,
  fetchObjectName,
} from './client';
import { metaEnv, webhookDebugEnabled } from './config';
import { getOrCreateMetaSource } from './source';
import { ingestLead } from '@/lib/webhooks/ingest';
import { findLeadByIdentity } from '@/lib/leads/identity';
import { reactivateLeadOnInbound } from '@/lib/leads/reactivation';
import { parseSchoolFields } from './form-qualification';
import { parseCampaignName, campaignAdCreative } from '@/lib/webhooks/campaign-parser';
import { mergeTags } from '@/lib/webhooks/tag-rules';
import { createNotification } from '@/actions/notifications';
import {
  handleLeibnizBotInbound,
  isLeibnizBotHandling,
} from '@/lib/whatsapp/leibniz-bot';
import type { Database, Json } from '@/types/database';
import {
  messagePreview,
  type ChatChannel,
  type MessageMetadata,
  type MessageType,
  type SharedContactCard,
} from '@/types/chat';
import type { MappableLeadField } from '@/types/webhooks';

type DbClient = SupabaseClient<Database>;

/**
 * Processamento dos eventos recebidos no webhook unificado da Meta:
 * mensagens de WhatsApp (WABA), mensagens de Instagram e leads do Lead Ads.
 *
 * Tudo via admin client (sem sessão). Inserts em `messages`/`conversations`
 * disparam o Realtime automaticamente (tabelas publicadas na migration inicial).
 */

interface ContactInfo {
  name?: string | null;
  phone?: string | null;
  instagram?: string | null;
}

/**
 * Acha o lead (unificação cross-canal — Parte 4) ou cria um novo.
 *
 * Para Instagram, `externalId` é o IGSID do remetente → vira `instagram_user_id`
 * (chave estável de identidade). Para WhatsApp, é o telefone. O matching e o
 * backfill de identificadores ficam em ingestLead/findLeadByIdentity.
 */
async function findOrCreateLead(
  admin: DbClient,
  channel: ChatChannel,
  externalId: string,
  contact: ContactInfo,
): Promise<{ id: string; assignedTo: string | null; created: boolean }> {
  const phone = channel === 'whatsapp' ? (contact.phone ?? externalId) : (contact.phone ?? null);
  const instagramHandle = channel === 'instagram' ? (contact.instagram ?? null) : null;
  const instagramUserId = channel === 'instagram' ? externalId : null;

  const values: Partial<Record<MappableLeadField, string>> = {
    name: contact.name ?? phone ?? instagramHandle ?? instagramUserId ?? 'Contato',
  };
  if (phone) values.phone = phone;
  if (instagramHandle) values.instagram = instagramHandle;

  const result = await ingestLead(admin, {
    values,
    numbers: {},
    tags: [channel === 'whatsapp' ? 'whatsapp-inbound' : 'instagram-inbound'],
    defaultSource: channel === 'whatsapp' ? 'whatsapp' : 'instagram',
    pipeline: 'comercial',
    stage: 'novo_lead',
    sourceName: channel === 'whatsapp' ? 'WhatsApp (chat)' : 'Instagram (chat)',
    identity: { instagramUserId },
    // Se o identificador casar um lead existente, é contato espontâneo.
    reactivationChannel: channel === 'whatsapp' ? 'WhatsApp' : 'Instagram',
  });
  return { id: result.leadId, assignedTo: result.assignedTo };
}

/** Acha a conversa por (channel, external_id) ou cria. */
async function findOrCreateConversation(
  admin: DbClient,
  channel: ChatChannel,
  externalId: string,
  leadId: string | null,
  assignedTo: string | null,
  wabaId: string | null,
  whatsappInstanceId: string | null = null,
  contactName: string | null = null,
): Promise<{ id: string; assignedTo: string | null }> {
  const { data: existing } = await admin
    .from('conversations')
    .select('id, assigned_to, whatsapp_instance_id, contact_name, lead_id')
    .eq('channel', channel)
    .eq('external_id', externalId)
    .maybeSingle();

  if (existing) {
    // Backfill: instância (API oficial), nome do contato e lead — conversa que
    // nasceu de eco do dispositivo (sem lead) é vinculada ao lead na 1ª resposta.
    const patch = {
      ...(whatsappInstanceId && existing.whatsapp_instance_id !== whatsappInstanceId
        ? { whatsapp_instance_id: whatsappInstanceId }
        : {}),
      ...(contactName && !existing.contact_name ? { contact_name: contactName } : {}),
      ...(leadId && !existing.lead_id ? { lead_id: leadId } : {}),
      ...(leadId && !existing.lead_id && !existing.assigned_to && assignedTo
        ? { assigned_to: assignedTo }
        : {}),
    };
    if (Object.keys(patch).length > 0) {
      await admin.from('conversations').update(patch).eq('id', existing.id);
    }
    return { id: existing.id, assignedTo: existing.assigned_to ?? assignedTo, created: false };
  }

  // UPSERT em (channel, external_id): evita "duplicate key" quando dois eventos
  // (ex.: mensagem + eco) chegam concorrentemente antes do SELECT acima ver a linha.
  const { data: created, error } = await admin
    .from('conversations')
    .upsert(
      {
        channel,
        external_id: externalId,
        lead_id: leadId,
        assigned_to: assignedTo,
        waba_id: wabaId,
        whatsapp_instance_id: whatsappInstanceId,
        contact_name: contactName,
        // status fica FORA do payload: no INSERT o default é 'open'; na colisão
        // o upsert não pode rebaixar uma conversa resolvida/aguardando de volta
        // p/ 'open' — só mensagem inbound reabre (saveInboundMessage).
        last_message_at: new Date().toISOString(),
      },
      { onConflict: 'channel,external_id' },
    )
    .select('id, assigned_to')
    .single();

  if (error || !created) throw new Error(error?.message ?? 'Falha ao criar conversa');
  return { id: created.id, assignedTo: created.assigned_to, created: true };
}

/** Sobe uma mídia baixada para o bucket chat-media e devolve a URL pública. */
async function uploadMedia(
  admin: DbClient,
  conversationId: string,
  buffer: ArrayBuffer,
  mimeType: string,
): Promise<string | null> {
  const ext = mimeType.split('/')[1]?.split(';')[0] ?? 'bin';
  const path = `${conversationId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await admin.storage
    .from('chat-media')
    .upload(path, buffer, { contentType: mimeType, upsert: false });
  if (error) return null;
  const { data } = admin.storage.from('chat-media').getPublicUrl(path);
  return data.publicUrl ?? null;
}

/**
 * Espelha uma mídia de URL externa no bucket chat-media (best-effort). As URLs
 * do CDN do Instagram (lookaside.fbsbx.com) expiram em poucos dias — sem o
 * espelho, a mídia some do histórico. Falhou → devolve a URL original.
 */
export async function mirrorRemoteMedia(
  admin: DbClient,
  conversationId: string,
  url: string,
): Promise<{ url: string; mimeType: string | null }> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { url, mimeType: null };
    const mimeType = res.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream';
    // CDN expirado/bloqueado devolve página HTML com 200 — espelhar isso grava
    // um ".html" no lugar da mídia (caso real: "vídeos" text/plain no bucket).
    if (mimeType.startsWith('text/')) return { url, mimeType: null };
    const buffer = await res.arrayBuffer();
    // Limite defensivo de 25MB — acima disso mantém a URL original.
    if (buffer.byteLength > 25 * 1024 * 1024) return { url, mimeType };
    const stored = await uploadMedia(admin, conversationId, buffer, mimeType);
    return { url: stored ?? url, mimeType };
  } catch {
    return { url, mimeType: null };
  }
}

interface InboundMessageInput {
  conversationId: string;
  assignedTo: string | null;
  externalMessageId: string | null;
  type: MessageType;
  content: string | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  metadata: MessageMetadata | null;
  contactName: string | null;
  channel: ChatChannel;
  notifyAssigned?: boolean;
}

/**
 * true se uma mensagem inbound com este id externo já foi gravada. A Meta
 * REENVIA o mesmo evento quando o webhook demora a responder (retry) — sem
 * este guard o retry reprocessava a mensagem inteira: linha duplicada no
 * /chat e as automações (coleta de comentários/story, IAs) respondendo de
 * novo à mesma mensagem.
 */
async function isDuplicateInboundMid(admin: DbClient, mid: string | null): Promise<boolean> {
  if (!mid) return false;
  const { data } = await admin
    .from('messages')
    .select('id')
    .eq('external_message_id', mid)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

/** Insere a mensagem inbound, atualiza last_message_at e notifica o responsável. */
async function saveInboundMessage(admin: DbClient, input: InboundMessageInput): Promise<void> {
  await admin.from('messages').insert({
    conversation_id: input.conversationId,
    external_message_id: input.externalMessageId,
    direction: 'inbound',
    type: input.type,
    content: input.content,
    media_url: input.mediaUrl,
    media_mime_type: input.mediaMimeType,
    metadata: input.metadata ? (input.metadata as unknown as Json) : null,
    status: 'delivered',
    sent_at: new Date().toISOString(),
  });

  await admin
    .from('conversations')
    .update({ last_message_at: new Date().toISOString(), status: 'open' })
    .eq('id', input.conversationId);

  if (input.notifyAssigned !== false && input.assignedTo) {
    const preview = messagePreview(input.type, input.content);
    await createNotification(
      input.assignedTo,
      'novo_lead',
      `Nova mensagem · ${input.contactName ?? 'Contato'}`,
      preview.slice(0, 120),
      null,
    );
  }
}

type WhatsappContactCard = {
  name?: { formatted_name?: string; first_name?: string; last_name?: string };
  phones?: { phone?: string; wa_id?: string; type?: string }[];
  emails?: { email?: string; type?: string }[];
  org?: { company?: string };
};

type WhatsappMessage = {
  from: string;
  id: string;
  type: string;
  text?: { body?: string };
  image?: { id: string; mime_type?: string; caption?: string };
  audio?: { id: string; mime_type?: string; voice?: boolean };
  document?: { id: string; mime_type?: string; filename?: string };
  video?: { id: string; mime_type?: string; caption?: string };
  sticker?: { id: string; mime_type?: string };
  contacts?: WhatsappContactCard[];
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  /** Resposta a botões/lista enviados pelo negócio. */
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  /** Resposta a botão de template (quick reply legado). */
  button?: { payload?: string; text?: string };
  /** Reação a uma mensagem (emoji + id da mensagem original). */
  reaction?: { message_id?: string; emoji?: string };
};

/** Cartões do payload oficial → estrutura persistida em messages.metadata. */
function whatsappContactsToMetadata(cards: WhatsappContactCard[]): SharedContactCard[] {
  return cards.map((card) => ({
    name:
      card.name?.formatted_name ??
      [card.name?.first_name, card.name?.last_name].filter(Boolean).join(' ') ??
      'Contato',
    phones: (card.phones ?? []).map((p) => p.phone ?? p.wa_id ?? '').filter(Boolean),
    emails: (card.emails ?? []).map((e) => e.email ?? '').filter(Boolean),
    org: card.org?.company ?? null,
  }));
}

/**
 * Cartões de contato compartilhados → texto legível no chat (uma linha por
 * contato: nome — telefones · e-mails · empresa). O payload completo não é
 * persistido; o que não entrar aqui é descartado.
 */
function formatWhatsappContacts(cards: WhatsappContactCard[]): string {
  return cards
    .map((card) => {
      const name =
        card.name?.formatted_name ??
        [card.name?.first_name, card.name?.last_name].filter(Boolean).join(' ');
      const details = [
        (card.phones ?? [])
          .map((p) => p.phone ?? p.wa_id)
          .filter(Boolean)
          .join(', '),
        (card.emails ?? [])
          .map((e) => e.email)
          .filter(Boolean)
          .join(', '),
        card.org?.company,
      ]
        .filter(Boolean)
        .join(' · ');
      return `👤 ${name || 'Contato'}${details ? ` — ${details}` : ''}`;
    })
    .join('\n');
}

/** Localização compartilhada → nome/endereço + link do Google Maps. */
function formatWhatsappLocation(location: NonNullable<WhatsappMessage['location']>): string {
  const label = [location.name, location.address].filter(Boolean).join(' — ');
  const maps =
    location.latitude != null && location.longitude != null
      ? `https://maps.google.com/?q=${location.latitude},${location.longitude}`
      : null;
  return [`📍 ${label || 'Localização'}`, maps].filter(Boolean).join('\n');
}

/** Eco de mensagem enviada pelo próprio número (coexistência app+Cloud API). */
type WhatsappMessageEcho = {
  from?: string;
  to?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  contacts?: WhatsappContactCard[];
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
};

/**
 * Salva um eco do WhatsApp oficial como mensagem outbound (sent_by=null —
 * enviada pelo app/dispositivo, não pelo CRM). Dedup por id externo cobre
 * tanto retries quanto eventuais ecos de mensagens enviadas via API.
 */
async function saveWhatsappEcho(
  admin: DbClient,
  echo: WhatsappMessageEcho,
  wabaId: string | null,
): Promise<void> {
  const phone = echo.to?.replace(/\D/g, '') || null;
  if (!phone) return;

  if (echo.id) {
    const { data: dup } = await admin
      .from('messages')
      .select('id')
      .eq('external_message_id', echo.id)
      .maybeSingle();
    if (dup) return;
  }

  // Instância oficial pelo phone_number_id (mesma resolução do inbound).
  let instanceId: string | null = null;
  if (wabaId) {
    const { data: instance } = await admin
      .from('whatsapp_instances')
      .select('id, is_active')
      .eq('phone_number_id', wabaId)
      .maybeSingle();
    if (instance?.is_active) instanceId = instance.id;
  }

  // Conversa do destinatário; se não existe, cria vinculando lead já conhecido
  // pelo telefone (sem criar lead novo — mensagem ativa do time não é lead).
  const { data: existing } = await admin
    .from('conversations')
    .select('id')
    .eq('channel', 'whatsapp')
    .eq('external_id', phone)
    .maybeSingle();

  let conversationId: string;
  if (existing) {
    conversationId = existing.id;
  } else {
    const lead = await findLeadByIdentity(admin, { phone });
    const { data: created, error } = await admin
      .from('conversations')
      .upsert(
        {
          channel: 'whatsapp',
          external_id: phone,
          lead_id: lead?.id ?? null,
          assigned_to: lead?.assigned_to ?? null,
          waba_id: wabaId,
          whatsapp_instance_id: instanceId,
          contact_name: null,
          // Sem status: eco é mensagem NOSSA — não reabre conversa resolvida.
          last_message_at: new Date().toISOString(),
        },
        { onConflict: 'channel,external_id' },
      )
      .select('id')
      .single();
    if (error || !created) throw new Error(error?.message ?? 'Falha ao criar conversa do eco');
    conversationId = created.id;
  }

  const echoContent =
    echo.text?.body ??
    (echo.contacts?.length ? formatWhatsappContacts(echo.contacts) : null) ??
    (echo.location ? formatWhatsappLocation(echo.location) : null) ??
    `[${echo.type ?? 'mensagem'}]`;

  await admin.from('messages').insert({
    conversation_id: conversationId,
    external_message_id: echo.id ?? null,
    direction: 'outbound',
    type: 'text',
    content: echoContent,
    media_url: null,
    media_mime_type: null,
    status: 'sent',
    sent_by: null,
    sent_at: new Date().toISOString(),
  });

  // Eco = mensagem enviada pelo número — atualiza o relógio, mas NÃO reabre.
  await admin
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId);
}

/** Processa um `change.value` de WhatsApp (mensagens + status + ecos). */
export async function processWhatsappValue(admin: DbClient, value: unknown): Promise<void> {
  if (!value || typeof value !== 'object') return;
  const v = value as {
    metadata?: { phone_number_id?: string };
    contacts?: { profile?: { name?: string }; wa_id?: string }[];
    messages?: WhatsappMessage[];
    statuses?: { id: string; status: string }[];
    // field=smb_message_echoes: mensagens enviadas pelo app do WhatsApp Business
    // do número conectado em coexistência — entram no /chat como outbound.
    message_echoes?: WhatsappMessageEcho[];
  };

  // Log compacto de todo evento de WhatsApp (diagnóstico de entrega por
  // número — essencial no multi-WABA; payload completo só com DEBUG_WEBHOOK).
  // eslint-disable-next-line no-console
  console.log(
    '[meta/webhook] whatsapp',
    JSON.stringify({
      phoneNumberId: v.metadata?.phone_number_id ?? null,
      messages: Array.isArray(v.messages) ? v.messages.length : 0,
      statuses: Array.isArray(v.statuses) ? v.statuses.length : 0,
      echoes: Array.isArray(v.message_echoes) ? v.message_echoes.length : 0,
      from: v.messages?.[0]?.from ?? null,
    }),
  );

  // Atualizações de status (entregue/lido/falha) das mensagens enviadas.
  if (Array.isArray(v.statuses)) {
    for (const s of v.statuses) {
      const status =
        s.status === 'read'
          ? 'read'
          : s.status === 'delivered'
            ? 'delivered'
            : s.status === 'failed'
              ? 'failed'
              : 'sent';
      await admin.from('messages').update({ status }).eq('external_message_id', s.id);
    }
  }

  // Ecos (enviadas pelo dispositivo/app do número conectado) → outbound.
  if (Array.isArray(v.message_echoes)) {
    for (const echo of v.message_echoes) {
      await saveWhatsappEcho(admin, echo, v.metadata?.phone_number_id ?? null);
    }
  }

  if (!Array.isArray(v.messages)) return;
  const wabaId = v.metadata?.phone_number_id ?? null;
  const contactName = v.contacts?.[0]?.profile?.name ?? null;

  // Instância da API oficial: identificada pelo metadata.phone_number_id
  // (cada número conectado à Cloud API tem uma linha em whatsapp_instances).
  // O token da instância também sai daqui: mídia recebida num número de outra
  // WABA só baixa com o token daquela WABA.
  let instanceId: string | null = null;
  let instanceToken: string | null = null;
  let botEnabled = false;
  if (wabaId) {
    const { data: instance } = await admin
      .from('whatsapp_instances')
      .select('id, name, is_active, instance_token, bot_enabled')
      .eq('phone_number_id', wabaId)
      .maybeSingle();
    if (instance?.is_active) {
      instanceId = instance.id;
      instanceToken = instance.instance_token;
      botEnabled = instance.bot_enabled;
    }
  }

  for (const msg of v.messages) {
    // Retry da Meta: mensagem já processada não roda o pipeline de novo.
    if (await isDuplicateInboundMid(admin, msg.id ?? null)) continue;

    let type: MessageType = 'text';
    let content: string | null = null;
    let mediaUrl: string | null = null;
    let mediaMime: string | null = null;
    let mediaId: string | null = null;
    let metadata: MessageMetadata | null = null;

    if (msg.type === 'text') {
      content = msg.text?.body ?? '';
    } else if (msg.type === 'image' && msg.image) {
      type = 'image';
      content = msg.image.caption ?? null;
      mediaId = msg.image.id;
      mediaMime = msg.image.mime_type ?? null;
    } else if (msg.type === 'audio' && msg.audio) {
      type = 'audio';
      mediaId = msg.audio.id;
      mediaMime = msg.audio.mime_type ?? null;
      metadata = { audio: { ptt: msg.audio.voice ?? false, seconds: null } };
    } else if (msg.type === 'document' && msg.document) {
      type = 'document';
      content = msg.document.filename ?? null;
      mediaId = msg.document.id;
      mediaMime = msg.document.mime_type ?? null;
      metadata = { file: { name: msg.document.filename ?? null, sizeBytes: null } };
    } else if (msg.type === 'video' && msg.video) {
      type = 'video';
      content = msg.video.caption ?? null;
      mediaId = msg.video.id;
      mediaMime = msg.video.mime_type ?? null;
    } else if (msg.type === 'sticker' && msg.sticker) {
      type = 'sticker';
      mediaId = msg.sticker.id;
      mediaMime = msg.sticker.mime_type ?? null;
    } else if (msg.type === 'contacts' && msg.contacts?.length) {
      type = 'contact';
      // content mantém o texto legível (previews/histórico da IA); o card do
      // chat renderiza a partir do metadata estruturado.
      content = formatWhatsappContacts(msg.contacts);
      metadata = { contacts: whatsappContactsToMetadata(msg.contacts) };
    } else if (msg.type === 'location' && msg.location) {
      type = 'location';
      content = formatWhatsappLocation(msg.location);
      metadata = {
        location: {
          latitude: msg.location.latitude ?? null,
          longitude: msg.location.longitude ?? null,
          name: msg.location.name ?? null,
          address: msg.location.address ?? null,
        },
      };
    } else if (msg.type === 'interactive' && msg.interactive) {
      // Resposta do contato a botões/lista enviados pelo negócio.
      const reply = msg.interactive.button_reply ?? msg.interactive.list_reply ?? null;
      type = 'interactive';
      content = reply?.title ?? null;
      metadata = {
        interactive: {
          kind: msg.interactive.type ?? 'button_reply',
          id: reply?.id ?? null,
          title: reply?.title ?? null,
          description: msg.interactive.list_reply?.description ?? null,
        },
      };
    } else if (msg.type === 'button' && msg.button) {
      // Quick reply de template (formato legado do botão).
      type = 'interactive';
      content = msg.button.text ?? null;
      metadata = {
        interactive: {
          kind: 'button',
          id: msg.button.payload ?? null,
          title: msg.button.text ?? null,
          description: null,
        },
      };
    } else if (msg.type === 'reaction' && msg.reaction) {
      type = 'reaction';
      content = msg.reaction.emoji ?? null;
      metadata = {
        reaction: {
          emoji: msg.reaction.emoji ?? null,
          targetExternalId: msg.reaction.message_id ?? null,
        },
      };
    } else {
      // Tipo ainda não suportado: fallback legível + log do tipo cru para
      // facilitar adicionar suporte depois.
      console.warn('[meta/webhook] tipo de mensagem WhatsApp não suportado:', msg.type);
      metadata = { unsupportedType: msg.type };
    }

    // WhatsApp na escola: quem manda mensagem numa das linhas comerciais é
    // potencial família interessada — número desconhecido CRIA lead direto em
    // comercial/novo_lead (o telefone é sinal forte de identidade). Número já
    // conhecido vincula o lead existente (unificação cross-canal).
    const existingLead = await findLeadByIdentity(admin, { phone: msg.from });
    let lead: { id: string; assignedTo: string | null } | null = null;
    // Reativação adiada para depois de resolver a conversa (ver abaixo).
    let reactivateLeadId: string | null = null;
    if (existingLead) {
      lead = { id: existingLead.id, assignedTo: existingLead.assigned_to };
      reactivateLeadId = existingLead.id;
    } else {
      lead = await findOrCreateLead(admin, 'whatsapp', msg.from, {
        name: contactName,
        phone: msg.from,
      });
    }

    // Rastreabilidade por linha (coluna leads.whatsapp_instance_id): grava de
    // qual número o lead veio quando ainda não está preenchido.
    if (lead?.id && instanceId) {
      await admin
        .from('leads')
        .update({ whatsapp_instance_id: instanceId })
        .eq('id', lead.id)
        .is('whatsapp_instance_id', null);
    }

    const conv = await findOrCreateConversation(
      admin,
      'whatsapp',
      msg.from,
      lead?.id ?? null,
      lead?.assignedTo ?? null,
      wabaId,
      instanceId,
      contactName,
    );

    const botHandling =
      instanceId !== null &&
      (await isLeibnizBotHandling(admin, conv.id, conv.created, botEnabled));

    // Parte 1: mensagem inbound do LEAD → reativa contato espontâneo, mas só se
    // NÃO for resposta a follow-up recente (checagem via conversationId). Antes
    // de salvar esta mensagem, para ler a última mensagem anterior da conversa.
    if (reactivateLeadId) {
      await reactivateLeadOnInbound(admin, reactivateLeadId, 'WhatsApp', {
        conversationId: conv.id,
      });
    }

    // Baixa a mídia e sobe pro Storage (best-effort). Token da instância:
    // mídia de número em outra WABA não baixa com o token do env.
    if (mediaId) {
      const media = await downloadWhatsappMedia(mediaId, instanceToken);
      if (media.ok) {
        mediaUrl = await uploadMedia(admin, conv.id, media.data.buffer, media.data.mimeType);
        mediaMime = media.data.mimeType;
        if (type === 'document') {
          metadata = {
            ...metadata,
            file: { name: metadata?.file?.name ?? null, sizeBytes: media.data.buffer.byteLength },
          };
        }
      } else {
        console.warn('[meta/webhook] falha ao baixar mídia', mediaId, media.error);
      }
    }

    await saveInboundMessage(admin, {
      conversationId: conv.id,
      assignedTo: conv.assignedTo,
      externalMessageId: msg.id,
      type,
      content,
      mediaUrl,
      mediaMimeType: mediaMime,
      metadata,
      contactName,
      channel: 'whatsapp',
      notifyAssigned: !botHandling,
    });

    if (instanceId && botHandling) {
      await handleLeibnizBotInbound(admin, {
        conversationId: conv.id,
        leadId: lead?.id ?? null,
        whatsappInstanceId: instanceId,
        from: msg.from,
        contactName,
        isNewConversation: conv.created,
        botEnabled,
        via: { phoneNumberId: wabaId, accessToken: instanceToken },
        message: {
          type,
          content,
          interactiveId: metadata?.interactive?.id ?? null,
        },
      });
    }
  }
}

type InstagramMessaging = {
  sender?: { id?: string; username?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: { type?: string; payload?: { url?: string } }[];
    /** Presente quando a mensagem é resposta a um story (id/url do story). */
    reply_to?: { story?: { id?: string; url?: string } };
  };
};

/** Tipo do attachment de Instagram → enum do CRM (sticker/video/audio/file…). */
function instagramAttachmentType(raw: string | undefined): MessageType {
  switch (raw) {
    case 'image':
      return 'image';
    case 'video':
    case 'ig_reel':
    case 'reel':
      return 'video';
    case 'audio':
      return 'audio';
    case 'sticker':
    case 'like_heart':
      return 'sticker';
    case 'story_mention':
      // Menção em story: a mídia do story vem no payload — renderiza como imagem.
      return 'image';
    case 'share':
      return 'text';
    default:
      return 'document';
  }
}

/** Log condicional (DEBUG_WEBHOOK=true) para diagnosticar Instagram em produção. */
function igLog(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  if (webhookDebugEnabled()) console.log('[meta/webhook][instagram]', ...args);
}

/**
 * Eco de mensagem enviada pela conta @dra.sarina (is_echo=true).
 *
 * Quando alguém do time responde pelo APP do Instagram (não pelo CRM), a
 * mensagem precisa aparecer no /chat como outbound. Ecos de mensagens enviadas
 * PELO CRM via API são deduplicados pelo mid (sendMessage grava o
 * external_message_id ao enviar) — com fallback heurístico para a janela curta
 * em que o eco chega antes do update do external_message_id.
 */
async function processInstagramEcho(admin: DbClient, event: InstagramMessaging): Promise<void> {
  // No eco, sender = conta da escola e recipient = o contato (cliente).
  const recipientId = event.recipient?.id;
  const message = event.message;
  if (!recipientId || !message) {
    igLog('eco sem recipient/message — ignorado');
    return;
  }

  // Dedup (a): mid já registrado = mensagem enviada pelo CRM via API.
  if (message.mid) {
    const { data: dup } = await admin
      .from('messages')
      .select('id')
      .eq('external_message_id', message.mid)
      .maybeSingle();
    if (dup) {
      igLog('eco de mensagem do CRM — já registrada', { mid: message.mid });
      return;
    }
  }

  // Conversa do contato (external_id = IGSID do cliente).
  const { data: existingConv } = await admin
    .from('conversations')
    .select('id, contact_name')
    .eq('channel', 'instagram')
    .eq('external_id', recipientId)
    .maybeSingle();

  // Dedup (b): corrida do eco com o update do external_message_id — se há uma
  // mensagem outbound de USUÁRIO do CRM com o mesmo texto nos últimos 2min e
  // sem id externo ainda, é o mesmo envio refletido.
  if (existingConv && message.text) {
    const { data: recent } = await admin
      .from('messages')
      .select('id')
      .eq('conversation_id', existingConv.id)
      .eq('direction', 'outbound')
      .eq('content', message.text)
      .is('external_message_id', null)
      .not('sent_by', 'is', null)
      .gte('sent_at', new Date(Date.now() - 2 * 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle();
    if (recent) {
      igLog('eco casou com envio recente do CRM — ignorado', { mid: message.mid });
      return;
    }
  }

  let conversationId: string;
  if (existingConv) {
    conversationId = existingConv.id;
  } else {
    // Conversa iniciada pelo app: cria sem exigir lead (igual à triagem de DMs);
    // vincula lead existente se o IGSID já for conhecido de outro canal.
    const profile = await fetchInstagramUserProfile(recipientId);
    const displayName = profile.ok
      ? (profile.data.name ?? (profile.data.username ? `@${profile.data.username}` : null))
      : null;
    const lead = await findLeadByIdentity(admin, { instagramUserId: recipientId });
    const { data: created, error } = await admin
      .from('conversations')
      .upsert(
        {
          channel: 'instagram',
          external_id: recipientId,
          lead_id: lead?.id ?? null,
          assigned_to: lead?.assigned_to ?? null,
          contact_name: displayName,
          waba_id: null,
          // Sem status: eco é mensagem NOSSA — não reabre conversa resolvida.
          last_message_at: new Date().toISOString(),
        },
        { onConflict: 'channel,external_id' },
      )
      .select('id')
      .single();
    if (error || !created) throw new Error(error?.message ?? 'Falha ao criar conversa do eco');
    conversationId = created.id;
  }

  const attachment = message.attachments?.[0];
  let type: MessageType = 'text';
  let mediaUrl: string | null = null;
  let mediaMime: string | null = null;
  if (attachment?.payload?.url) {
    type = instagramAttachmentType(attachment.type);
    if (attachment.type === 'share') {
      type = 'text';
    } else {
      // CDN do Instagram expira — espelha no chat-media (best-effort).
      const mirrored = await mirrorRemoteMedia(admin, conversationId, attachment.payload.url);
      mediaUrl = mirrored.url;
      mediaMime = mirrored.mimeType;
    }
  }

  await admin.from('messages').insert({
    conversation_id: conversationId,
    external_message_id: message.mid ?? null,
    direction: 'outbound',
    type,
    content: message.text ?? (mediaUrl ? null : attachment?.payload?.url ?? ''),
    media_url: mediaUrl,
    media_mime_type: mediaMime,
    status: 'sent',
    // sent_by null: enviada pelo app do Instagram, não por um usuário do CRM.
    sent_by: null,
    sent_at: new Date().toISOString(),
  });

  // Eco = mensagem enviada pela conta — atualiza o relógio, mas NÃO reabre.
  await admin
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId);

  igLog('eco do app salvo como outbound', { conversationId, mid: message.mid ?? null });
}

/**
 * Processa um item `entry.messaging[]` de Instagram Direct.
 *
 * - sender.id = quem enviou (IGSID); recipient.id = a conta da escola
 *   (deve casar com INSTAGRAM_USER_ID).
 * - Busca nome/@username do remetente via Instagram User Token (graph.instagram.com).
 * - Cria/acha conversation channel='instagram' external_id=sender.id e o lead.
 * - Ignora eco (mensagens que nós mesmos enviamos).
 */
export async function processInstagramMessaging(
  admin: DbClient,
  event: InstagramMessaging,
): Promise<void> {
  const senderId = event.sender?.id;
  const recipientId = event.recipient?.id ?? null;

  igLog('evento recebido', {
    senderId,
    recipientId,
    expectedRecipient: metaEnv.instagramUserId ?? null,
    recipientMatches: recipientId ? recipientId === metaEnv.instagramUserId : null,
    isEcho: event.message?.is_echo ?? false,
    hasMessage: Boolean(event.message),
  });

  // Eco: mensagem enviada PELA conta da escola. Duas origens possíveis:
  //  (a) o CRM acabou de enviar via API → já está em `messages` (dedup por mid);
  //  (b) alguém respondeu pelo APP do Instagram → registrar como outbound.
  if (event.message?.is_echo) {
    await processInstagramEcho(admin, event);
    return;
  }
  if (!senderId || !event.message) {
    igLog('sem sender/message — ignorado');
    return;
  }

  // Retry da Meta: mesmo mid já gravado → não reprocessa (evita mensagem
  // duplicada no /chat e resposta dupla das automações de coleta/social selling).
  if (await isDuplicateInboundMid(admin, event.message.mid ?? null)) {
    igLog('mid já processado (retry da Meta) — ignorado', { mid: event.message.mid });
    return;
  }

  // Perfil do remetente (nome + @username) via Instagram User Token.
  let profileName: string | null = null;
  let username: string | null = event.sender?.username ?? null;
  const profile = await fetchInstagramUserProfile(senderId);
  if (profile.ok) {
    profileName = profile.data.name;
    username = profile.data.username ?? username;
    igLog('perfil resolvido', profile.data);
  } else {
    igLog('falha ao buscar perfil do remetente:', profile.error);
  }

  // Nome REAL resolvido pelo perfil (nome → @username), ou null se não veio.
  const profileDisplay = profileName ?? (username ? `@${username}` : null);
  // Nome de exibição do lead/conversa: NUNCA o IGSID puro. Sem perfil, cai em
  // "@{IGSID}" (mais legível que o número e detectável como placeholder p/ heal).
  // O IGSID não vai para o campo `instagram` (handle) — `instagram` guarda só o
  // @username real; a identidade estável é o instagram_user_id.
  const displayName = profileDisplay ?? `@${senderId}`;

  // Conversa existente (pode ou não ter lead — DMs sem interesse ficam sem).
  const { data: existingConv } = await admin
    .from('conversations')
    .select('id, assigned_to, lead_id, contact_name')
    .eq('channel', 'instagram')
    .eq('external_id', senderId)
    .maybeSingle();

  // Backfill/auto-heal do nome na lista do /chat: define quando vazio E corrige
  // o placeholder (IGSID ou @IGSID) assim que o perfil real resolve.
  if (existingConv && profileDisplay) {
    const cur = existingConv.contact_name;
    if (!cur || cur === senderId || cur === `@${senderId}`) {
      await admin
        .from('conversations')
        .update({ contact_name: profileDisplay })
        .eq('id', existingConv.id);
    }
  }

  // DM de Instagram NÃO cria lead automaticamente (muito ruído: reações a
  // story, emojis, spam). A conversa fica em triagem no /chat até o time criar
  // o lead com um clique — mas se o IGSID já pertence a um lead conhecido
  // (unificação cross-canal), vincula direto.
  let lead: { id: string; assignedTo: string | null } | null = null;
  // Reativação adiada para depois de resolver a conversa (ver antes do
  // saveInboundMessage), para checar se é contato espontâneo ou resposta a
  // follow-up recente.
  let reactivateLeadId: string | null = null;

  if (existingConv?.lead_id) {
    lead = { id: existingConv.lead_id, assignedTo: existingConv.assigned_to };
    reactivateLeadId = existingConv.lead_id;
  } else {
    // Unificação cross-canal: lead pode existir de outro canal (Lead Ads etc.)
    // mesmo sem conversa de Instagram.
    const unified = await findLeadByIdentity(admin, { instagramUserId: senderId });
    if (unified) {
      lead = { id: unified.id, assignedTo: unified.assigned_to };
      reactivateLeadId = unified.id;
    } else {
      igLog('IGSID sem lead conhecido — conversa segue em triagem');
    }
  }

  // Auto-heal: leads criados antes (token expirado) ficaram com o IGSID — ou o
  // placeholder @IGSID — como nome. Assim que o perfil REAL resolve, atualiza
  // nome/@handle; só sobrescreve o placeholder (name == IGSID ou @IGSID), nunca
  // um nome já resolvido/editado por humano.
  if (lead && (profileDisplay || username)) {
    const patch: { name?: string; instagram?: string } = {};
    if (profileDisplay) patch.name = profileDisplay;
    if (username) patch.instagram = username;
    if (Object.keys(patch).length > 0) {
      await admin
        .from('leads')
        .update(patch)
        .eq('id', lead.id)
        .in('name', [senderId, `@${senderId}`]);
    }
  }

  let conv: { id: string; assignedTo: string | null };
  if (existingConv) {
    conv = { id: existingConv.id, assignedTo: existingConv.assigned_to };
    if (lead && !existingConv.lead_id) {
      // Lead nasceu numa conversa que já estava em triagem: quem triava herda o
      // lead (continuidade do atendimento) — senão a conversa herda o dono do lead.
      if (existingConv.assigned_to && existingConv.assigned_to !== lead.assignedTo) {
        await admin
          .from('leads')
          .update({ assigned_to: existingConv.assigned_to })
          .eq('id', lead.id);
        lead.assignedTo = existingConv.assigned_to;
      }
      await admin
        .from('conversations')
        .update({
          lead_id: lead.id,
          ...(existingConv.assigned_to ? {} : { assigned_to: lead.assignedTo }),
        })
        .eq('id', existingConv.id);
      conv = { id: existingConv.id, assignedTo: existingConv.assigned_to ?? lead.assignedTo };
    }
  } else {
    // Conversa nova. Sem lead fica sem responsável (triagem) — a equipe toda
    // enxerga o /chat (RLS por papel, não por assigned_to).
    const assignedTo = lead ? lead.assignedTo : null;
    const { data: created, error } = await admin
      .from('conversations')
      .upsert(
        {
          channel: 'instagram',
          external_id: senderId,
          lead_id: lead?.id ?? null,
          assigned_to: assignedTo,
          contact_name: displayName,
          waba_id: null,
          // Sem status: INSERT usa o default 'open'; na colisão não rebaixa uma
          // resolvida — o reopen do inbound acontece no saveInboundMessage.
          last_message_at: new Date().toISOString(),
        },
        { onConflict: 'channel,external_id' },
      )
      .select('id, assigned_to')
      .single();
    if (error || !created) throw new Error(error?.message ?? 'Falha ao criar conversa');
    conv = { id: created.id, assignedTo: created.assigned_to };
  }

  const attachment = event.message.attachments?.[0];
  let type: MessageType = 'text';
  let content: string | null = event.message.text ?? null;
  let mediaUrl: string | null = null;
  let mediaMime: string | null = null;
  let metadata: MessageMetadata | null = null;

  if (attachment?.payload?.url) {
    type = instagramAttachmentType(attachment.type);
    if (attachment.type === 'share') {
      // Post/reel compartilhado: vira texto com o link (não é mídia baixável).
      content = content ?? attachment.payload.url;
    } else {
      // CDN do Instagram expira — espelha no bucket chat-media (best-effort).
      const mirrored = await mirrorRemoteMedia(admin, conv.id, attachment.payload.url);
      mediaUrl = mirrored.url;
      mediaMime = mirrored.mimeType;
    }
  } else if (attachment?.type) {
    console.warn('[meta/webhook] attachment de Instagram não suportado:', attachment.type);
    metadata = { unsupportedType: attachment.type };
  }

  // Parte 1: DM inbound do LEAD → reativa contato espontâneo, mas só se NÃO for
  // resposta a follow-up recente (checagem via conversationId). Antes de salvar
  // esta mensagem, para ler a última mensagem anterior da conversa.
  if (reactivateLeadId) {
    await reactivateLeadOnInbound(admin, reactivateLeadId, 'Instagram', {
      conversationId: conv.id,
    });
  }

  await saveInboundMessage(admin, {
    conversationId: conv.id,
    assignedTo: conv.assignedTo,
    externalMessageId: event.message.mid ?? null,
    type,
    content: content ?? (mediaUrl ? null : ''),
    mediaUrl,
    mediaMimeType: mediaMime,
    metadata,
    contactName: profileName ?? username,
    channel: 'instagram',
  });

  igLog('mensagem inbound salva', { conversationId: conv.id, leadId: lead?.id ?? null, type });
}

/** Campos úteis do `change.value` de um evento leadgen (webhook da Meta). */
export interface LeadgenChangeValue {
  leadgen_id: string;
  page_id?: string;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  form_id?: string;
}

/**
 * Processa um evento leadgen do Meta Lead Ads:
 *  - busca os dados do lead na Graph API;
 *  - mapeia campos padrão (full_name/phone_number/email);
 *  - resolve a atribuição real (ad/adset/campaign/form — ids do payload +
 *    nomes via Graph API); campaign-parser fica como fallback;
 *  - extrai os campos escolares do formulário (filho, nível de ensino...);
 *  - cria o lead (source=meta_ads) + cria conversa WhatsApp se tiver phone.
 */
export async function processLeadgen(
  admin: DbClient,
  input: LeadgenChangeValue,
): Promise<{ leadId: string; duplicate: boolean } | null> {
  const started = Date.now();
  const leadgenId = input.leadgen_id;
  const fetched = await fetchLeadgenData(leadgenId);
  if (!fetched.ok) {
    // Loga a falha de busca para o status da integração refletir o problema.
    const sourceId = await getOrCreateMetaSource(admin).catch(() => null);
    if (sourceId) {
      await admin.from('webhook_logs').insert({
        source_id: sourceId,
        status: 'error',
        processing_time_ms: Date.now() - started,
        error_message: fetched.error,
        payload: { via: 'meta-leadgen', leadgen_id: leadgenId },
      });
    }
    return null;
  }

  const { field_data, campaign_name, adset_name, ad_name } = fetched.data;
  const values: Partial<Record<MappableLeadField, string>> = {};
  const numbers: Partial<Record<MappableLeadField, number>> = {};
  let facebookUserId: string | null = null;
  // Todas as respostas do formulário (inclusive perguntas de qualificação que
  // não têm coluna própria) — gravadas em leads.meta_form_answers e exibidas
  // na seção "Origem do lead" do drawer.
  const formAnswers: { question: string; answer: string }[] = [];

  for (const field of field_data) {
    const value = field.values?.[0];
    if (!value) continue;
    if (field.name === 'facebook_user_id' || field.name === 'fb_user_id') {
      facebookUserId = value;
      continue;
    }
    formAnswers.push({
      question: field.name,
      answer: field.values?.filter(Boolean).join(', ') ?? value,
    });
    switch (field.name) {
      case 'full_name':
      case 'name':
        values.name = value;
        break;
      case 'phone_number':
      case 'phone':
        values.phone = value;
        break;
      case 'email':
        values.email = value;
        break;
      case 'city':
        values.city = value;
        break;
      default:
        break;
    }
  }

  // Campos escolares do formulário (nome/idade do filho, nível de ensino, ano
  // escolar, visita com o filho) — best-effort; as respostas completas ficam em
  // meta_form_answers de qualquer jeito.
  const extraFields = parseSchoolFields(formAnswers);

  // Atribuição real: ids do payload do webhook (fonte primária) com fallback
  // nos campos do objeto leadgen retornado pela Graph API.
  const adId = input.ad_id ?? fetched.data.ad_id;
  const adsetId = input.adset_id ?? fetched.data.adset_id;
  const campaignId = input.campaign_id ?? fetched.data.campaign_id;
  const formId = input.form_id ?? fetched.data.form_id;

  // Nomes: usa os que já vieram no leadgen; os que faltam são resolvidos em
  // paralelo via GET /{id}?fields=name (não impacta a latência do webhook).
  const [adName, adsetName, campaignName, formName] = await Promise.all([
    ad_name ?? (adId ? fetchObjectName(adId) : null),
    adset_name ?? (adsetId ? fetchObjectName(adsetId) : null),
    campaign_name ?? (campaignId ? fetchObjectName(campaignId) : null),
    formId ? fetchObjectName(formId) : null,
  ]);

  // Campaign-parser mantido como FALLBACK (tags/tema pela nomenclatura) —
  // a fonte primária de atribuição são os campos reais da Meta.
  const parsed = parseCampaignName(campaignName ?? adsetName ?? adName ?? null);
  const adCreative = campaignAdCreative(parsed);
  if (adCreative) values.ad_creative = adCreative;

  // Retrocompatibilidade com o dashboard: utm_campaign/utm_content recebem os
  // nomes reais de campanha/anúncio (antes vinham do parser de nomenclatura).
  if (campaignName) values.utm_campaign = campaignName;
  else if (parsed.campaign_theme) values.utm_campaign = parsed.campaign_theme;
  if (adName) values.utm_content = adName;

  const tags = mergeTags(
    parsed.raw_tags,
    parsed.campaign_theme ? [parsed.campaign_theme] : [],
    ['lead-ads'],
  );

  // Snapshot desta entrada para o histórico append-only (leads.meta_entries):
  // a atribuição DESTE formulário. `kind` é definido no ingest ('first' no lead
  // novo, 'reentry' no existente). Assim o painel "Origem do lead" mostra 1ª
  // entrada e reentradas SEPARADAS.
  const metaEntry = {
    at: new Date().toISOString(),
    kind: 'first' as const,
    leadgenId,
    campaignId: campaignId ?? null,
    campaignName: campaignName ?? null,
    adsetId: adsetId ?? null,
    adsetName: adsetName ?? null,
    adId: adId ?? null,
    adName: adName ?? null,
    formId: formId ?? null,
    formName: formName ?? null,
  };

  const result = await ingestLead(admin, {
    values,
    numbers,
    tags,
    defaultSource: 'meta_ads',
    pipeline: 'comercial',
    stage: 'novo_lead',
    sourceName: 'Meta Lead Ads',
    identity: { facebookUserId },
    matchNameCity: true,
    metaEntry,
    extraFields,
    // Lead preencheu novo formulário Meta por iniciativa própria — entrada
    // DECLARADA: reativa mesmo sem janela de silêncio.
    reactivationChannel: 'novo formulário (Meta Lead Ads)',
    reactivationDeclared: true,
    attribution: {
      adId,
      adName,
      adsetId,
      adsetName,
      campaignId,
      campaignName,
      formId,
      formName,
      formAnswers,
    },
  });

  // Cria conversa de WhatsApp automaticamente quando há telefone.
  if (values.phone && !result.duplicate) {
    await findOrCreateConversation(
      admin,
      'whatsapp',
      values.phone,
      result.leadId,
      result.assignedTo,
      null,
    );
  }

  // Registra o recebimento em webhook_logs (alimenta o status da integração).
  const sourceId = await getOrCreateMetaSource(admin).catch(() => null);
  if (sourceId) {
    await admin.from('webhook_logs').insert({
      source_id: sourceId,
      status: result.duplicate ? 'duplicate' : 'success',
      lead_id: result.leadId,
      processing_time_ms: Date.now() - started,
      payload: {
        via: 'meta-leadgen',
        leadgen_id: leadgenId,
        campaign: campaignName,
        ad: adName,
        form: formName ?? formId,
      },
    });
  }

  return { leadId: result.leadId, duplicate: result.duplicate };
}

/** Helper para o route handler obter o admin client tipado. */
export function metaAdmin(): DbClient {
  return createAdminClient();
}

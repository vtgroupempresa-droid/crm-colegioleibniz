'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { advanceLeadOnFirstOutbound } from '@/lib/leads/stage-automation';
import {
  sendByChannel,
  sendWhatsappReaction,
  fetchInstagramUserProfile,
  type MetaResult,
} from '@/lib/meta/client';
import {
  sendOfficialMessage,
  sendOfficialTemplate,
  markOfficialMessageRead,
  fetchOfficialWhatsappStatus,
  type OfficialWhatsappStatus,
} from '@/lib/whatsapp/official-client';

// Reexport do tipo para o modal (client) consumir sem tocar no módulo server-only.
export type { OfficialWhatsappStatus };
import { ingestLead } from '@/lib/webhooks/ingest';
import type { MappableLeadField } from '@/types/webhooks';
import type { Activity, Lead } from '@/types/lead';
import type { WhatsappInstanceBadge } from '@/types/whatsapp-instance';
import {
  AUTO_LEAD_NAME_VARIABLE,
  messagePreview,
  type ChatChannel,
  type Conversation,
  type ConversationListItem,
  type ConversationStatus,
  type Message,
  type MessageTemplate,
  type MessageType,
} from '@/types/chat';
import { firstNameOf } from '@/lib/utils/format';
import type { ActionResult } from './leads';

/**
 * Server Actions do Live Chat (Fase 9).
 *
 * Leituras passam pelo client autenticado (RLS: assigned_to, closer ou admin —
 * o cargo closer vê todas as conversas desde 2026-07-10, espelhando o acesso
 * que já tinha a todos os leads).
 * O envio chama a Graph API com degradação graciosa — sem credencial, a
 * mensagem é registrada como `failed` e a action devolve um aviso, sem lançar.
 */

export interface ConversationsFilter {
  status?: ConversationStatus | 'all';
  channel?: ChatChannel | 'all';
  /** uuid da instância de WhatsApp | 'all'. Só faz sentido com channel='whatsapp'. */
  instanceId?: string | 'all';
  search?: string;
}

interface ConversationWithLead extends Conversation {
  lead: { name: string } | null;
  whatsapp_instance: WhatsappInstanceBadge | null;
}

/** Lista de conversas enriquecida para a coluna 1 do /chat. */
export async function getConversations(
  filter: ConversationsFilter = {},
): Promise<ConversationListItem[]> {
  const supabase = createClient();
  // instance_token NÃO entra no select — a coluna é revogada para authenticated.
  // IMPORTANTE: TODOS os filtros (inclusive a busca) são aplicados ANTES do
  // limit(200) — filtrar só no client escondia conversas fora da janela das
  // 200 mais recentes (com 2.700+ conversas, a janela cobre só ~4 dias; buscar
  // pelo nome de uma conversa mais antiga "não achava nada").
  let query = supabase
    .from('conversations')
    .select(
      '*, lead:leads(name), whatsapp_instance:whatsapp_instances(id, name, label, color, is_connected, provider)',
    )
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(200);

  if (filter.status && filter.status !== 'all') query = query.eq('status', filter.status);
  if (filter.channel && filter.channel !== 'all') query = query.eq('channel', filter.channel);
  if (filter.instanceId && filter.instanceId !== 'all') {
    query = query.eq('whatsapp_instance_id', filter.instanceId);
  }

  const search = filter.search?.trim();
  if (search) {
    // Sanitiza os caracteres que quebrariam o `.or(...)` do PostgREST.
    const safe = search.replace(/[,()%*]/g, ' ').trim();
    if (safe) {
      const like = `%${safe}%`;
      const ors = [`contact_name.ilike.${like}`, `external_id.ilike.${like}`];
      // Número digitado formatado ((11) 9…) precisa bater com o external_id,
      // que é só dígitos.
      const digits = safe.replace(/\D/g, '');
      if (digits.length >= 4 && digits !== safe) ors.push(`external_id.ilike.%${digits}%`);
      // O nome do lead mora em outra tabela — resolve os ids antes para não
      // forçar !inner (que excluiria conversas de triagem sem lead).
      const { data: leadRows } = await supabase
        .from('leads')
        .select('id')
        .ilike('name', like)
        .limit(100);
      if (leadRows && leadRows.length > 0) {
        ors.push(`lead_id.in.(${leadRows.map((r) => r.id).join(',')})`);
      }
      query = query.or(ors.join(','));
    }
  }

  const { data } = await query;
  const conversations = (data ?? []) as ConversationWithLead[];

  const items = await Promise.all(
    conversations.map(async (conv) => {
      const [{ data: last }, { count: unread }] = await Promise.all([
        supabase
          .from('messages')
          .select('content, type, direction')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', conv.id)
          .eq('direction', 'inbound')
          .in('status', ['sent', 'delivered']),
      ]);

      const preview = last ? messagePreview(last.type, last.content) : null;

      return {
        conversation: conv as Conversation,
        leadName: conv.lead?.name ?? null,
        leadScore: null,
        lastMessagePreview: preview,
        unreadCount: unread ?? 0,
        instance: conv.whatsapp_instance,
      } satisfies ConversationListItem;
    }),
  );

  return items;
}

export interface ChannelUnreadCounts {
  all: number;
  whatsapp: number;
  instagram: number;
}

/**
 * Não-lidas por canal para os badges das tabs do /chat. Conta no banco (join
 * com conversations) — independe do limit(200) da lista.
 */
export async function getChannelUnreadCounts(): Promise<ChannelUnreadCounts> {
  const supabase = createClient();
  const countFor = async (channel: ChatChannel) => {
    const { count } = await supabase
      .from('messages')
      .select('id, conversation:conversations!inner(channel)', { count: 'exact', head: true })
      .eq('direction', 'inbound')
      .in('status', ['sent', 'delivered'])
      .eq('conversation.channel', channel);
    return count ?? 0;
  };
  const [whatsapp, instagram] = await Promise.all([countFor('whatsapp'), countFor('instagram')]);
  return { all: whatsapp + instagram, whatsapp, instagram };
}

/** Dados derivados do lead para o painel/faixa do chat (nomes já resolvidos). */
export interface ThreadLeadExtras {
  assignedName: string | null;
  /** Tentativas de contato da equipe (Tentativa X/8). */
  attemptsCount: number;
}

export interface ConversationThread {
  conversation: Conversation;
  /** Instância de WhatsApp da conversa (badge no header) — null p/ Instagram. */
  instance: WhatsappInstanceBadge | null;
  lead: Lead | null;
  leadExtras: ThreadLeadExtras | null;
  messages: Message[];
  activities: Activity[];
  /** Nomes dos usuários do CRM que enviaram mensagens (sent_by → nome). */
  senders: Record<string, string>;
}

/** Carrega uma conversa + lead + mensagens + últimas atividades (colunas 2/3). */
export async function getConversationThread(
  conversationId: string,
): Promise<ConversationThread | null> {
  const supabase = createClient();
  const { data: conversationRow } = await supabase
    .from('conversations')
    .select(
      '*, whatsapp_instance:whatsapp_instances(id, name, label, color, is_connected, provider)',
    )
    .eq('id', conversationId)
    .maybeSingle();
  if (!conversationRow) return null;
  const { whatsapp_instance: instance, ...conversation } = conversationRow;

  const [{ data: messages }, leadResult, activitiesResult, attemptsResult] = await Promise.all([
    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true }),
    conversation.lead_id
      ? supabase.from('leads').select('*').eq('id', conversation.lead_id).maybeSingle()
      : Promise.resolve({ data: null }),
    conversation.lead_id
      ? supabase
          .from('activities')
          .select('*')
          .eq('lead_id', conversation.lead_id)
          .order('created_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
    conversation.lead_id
      ? supabase
          .from('contact_attempts')
          .select('id', { count: 'exact', head: true })
          .eq('lead_id', conversation.lead_id)
      : Promise.resolve({ count: 0 }),
  ]);

  const lead = (leadResult.data as Lead | null) ?? null;

  // Nome de quem enviou cada outbound (rótulo "Bruna · SDR" da bolha) + extras
  // do painel (produto/responsável). user_profiles é legível por authenticated.
  const senderIds = Array.from(
    new Set((messages ?? []).map((m) => m.sent_by).filter((id): id is string => Boolean(id))),
  );
  if (lead?.assigned_to) senderIds.push(lead.assigned_to);
  const profilesResult =
    senderIds.length > 0
      ? await supabase
          .from('user_profiles')
          .select('id, name, role')
          .in('id', Array.from(new Set(senderIds)))
      : { data: [] as { id: string; name: string; role: string }[] };
  // Rótulo "Nome · Cargo" (ex.: "Lorraine · Comercial") exibido na bolha outbound.
  const roleLabel: Record<string, string> = {
    admin: 'Admin',
    comercial: 'Comercial',
  };
  const senders: Record<string, string> = {};
  for (const p of profilesResult.data ?? []) {
    const suffix = roleLabel[p.role] ? ` · ${roleLabel[p.role]}` : '';
    senders[p.id] = `${p.name}${suffix}`;
  }

  return {
    conversation,
    instance: instance as WhatsappInstanceBadge | null,
    lead,
    leadExtras: lead
      ? {
          assignedName:
            (profilesResult.data ?? []).find((p) => p.id === lead.assigned_to)?.name ?? null,
          attemptsCount: attemptsResult.count ?? 0,
        }
      : null,
    messages: messages ?? [],
    activities: (activitiesResult.data as Activity[] | null) ?? [],
    senders,
  };
}

/** Marca as mensagens inbound de uma conversa como lidas. */
export async function markConversationRead(conversationId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from('messages')
    .update({ status: 'read' })
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .in('status', ['sent', 'delivered']);
  if (error) return { ok: false, error: error.message };

  // API oficial: propaga o ✓✓ azul pro contato (best-effort — falha não
  // atrapalha a leitura local). Marcar a última inbound cobre a conversa toda.
  const { data: conversation } = await supabase
    .from('conversations')
    .select('channel, whatsapp_instance:whatsapp_instances(id, provider)')
    .eq('id', conversationId)
    .maybeSingle();
  const instanceRef = conversation?.whatsapp_instance as {
    id: string;
    provider: string;
  } | null;
  if (conversation?.channel === 'whatsapp' && instanceRef?.provider === 'official') {
    const { data: lastInbound } = await supabase
      .from('messages')
      .select('external_message_id')
      .eq('conversation_id', conversationId)
      .eq('direction', 'inbound')
      .not('external_message_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastInbound?.external_message_id) {
      // O read receipt sai pelo número que RECEBEU a mensagem — busca o
      // phone_number_id/token da instância via admin (instance_token é
      // revogado para authenticated).
      const admin = createAdminClient();
      const { data: instance } = await admin
        .from('whatsapp_instances')
        .select('phone_number_id, instance_token')
        .eq('id', instanceRef.id)
        .maybeSingle();
      await markOfficialMessageRead(lastInbound.external_message_id, {
        phoneNumberId: instance?.phone_number_id ?? null,
        accessToken: instance?.instance_token ?? null,
      });
    }
  }

  return { ok: true, data: undefined };
}

export async function setConversationStatus(
  conversationId: string,
  status: ConversationStatus,
): Promise<ActionResult> {
  const supabase = createClient();
  // .select() para detectar o "sucesso" silencioso do RLS (0 linhas afetadas):
  // sem isso o usuário via o toast de OK e o status nunca mudava.
  const { data, error } = await supabase
    .from('conversations')
    .update({ status })
    .eq('id', conversationId)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: 'Sem permissão para alterar o status desta conversa.' };
  }
  return { ok: true, data: undefined };
}

export interface SendMessageResult {
  messageId: string;
  delivered: boolean;
  warning: string | null;
}

/**
 * Roteia o envio outbound pela INSTÂNCIA da conversa (somente API oficial):
 *  - WhatsApp com instância cadastrada → Cloud API pelo phone_number_id/token
 *    DA instância (multi-número); sem instância, cai no número do env.
 *  - Instagram segue direto pela Graph API.
 */
async function dispatchOutbound(
  admin: ReturnType<typeof createAdminClient>,
  channel: ChatChannel,
  externalId: string,
  whatsappInstanceId: string | null,
  msg: { type: MessageType; content?: string | null; mediaUrl?: string | null },
): Promise<MetaResult<{ messageId: string | null }>> {
  if (channel === 'whatsapp' && whatsappInstanceId) {
    const { data: instance } = await admin
      .from('whatsapp_instances')
      .select('id, provider, is_active, phone_number_id, instance_token')
      .eq('id', whatsappInstanceId)
      .maybeSingle();
    if (instance?.provider === 'official' && instance.phone_number_id) {
      return sendOfficialMessage(externalId, msg, {
        phoneNumberId: instance.phone_number_id,
        accessToken: instance.instance_token,
      });
    }
  }
  return sendByChannel(channel, externalId, msg);
}

/**
 * Envia uma mensagem outbound: registra no banco e dispara na Graph API.
 * Sem credencial configurada, a mensagem fica como `failed` e devolvemos um
 * aviso (delivered=false) — nunca lança.
 */
export async function sendMessage(
  conversationId: string,
  content: string,
  type: MessageType = 'text',
  mediaUrl?: string | null,
): Promise<ActionResult<SendMessageResult>> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  if (type === 'text' && !content.trim()) {
    return { ok: false, error: 'Mensagem vazia' };
  }

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, channel, external_id, whatsapp_instance_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conversation) return { ok: false, error: 'Conversa não encontrada' };

  const { data: inserted, error: insertError } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      direction: 'outbound',
      type,
      content: content || null,
      media_url: mediaUrl ?? null,
      status: 'sent',
      sent_by: user.id,
      sent_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (insertError || !inserted) {
    return { ok: false, error: insertError?.message ?? 'Falha ao registrar mensagem' };
  }

  // Atualiza o last_message_at e (re)arma a âncora da cadência de follow-up:
  // todo contato humano "zera o relógio" do Cenário B. Se o lead sumir depois,
  // o follow-up D2+ parte deste momento.
  await supabase
    .from('conversations')
    .update({
      last_message_at: new Date().toISOString(),
      followup_last_sent_at: new Date().toISOString(),
      followup_day: 0,
      followup_stopped: false,
      followup_stop_reason: null,
    })
    .eq('id', conversationId);

  // Dispara no provedor do canal. Usa admin para resolver token e atualizar status.
  const admin = createAdminClient();

  // Automação de pipeline: 1ª mensagem manual de WhatsApp a um lead em
  // sdr/novo_lead move para primeiro_contato (best-effort, nunca lança).
  const movedStage = await advanceLeadOnFirstOutbound(admin, conversationId, {
    actorUserId: user.id,
    via: 'chat',
  });
  if (movedStage) revalidatePath('/oportunidades');

  const result = await dispatchOutbound(
    admin,
    conversation.channel as ChatChannel,
    conversation.external_id,
    conversation.whatsapp_instance_id,
    { type, content, mediaUrl },
  );

  if (result.ok) {
    if (result.data.messageId) {
      await admin
        .from('messages')
        .update({ external_message_id: result.data.messageId })
        .eq('id', inserted.id);
    }
    return { ok: true, data: { messageId: inserted.id, delivered: true, warning: null } };
  }

  // Não entregue: marca failed, mas mantém a mensagem visível no histórico.
  await admin.from('messages').update({ status: 'failed' }).eq('id', inserted.id);
  return {
    ok: true,
    data: {
      messageId: inserted.id,
      delivered: false,
      warning: result.skipped
        ? 'Canal não configurado — mensagem salva mas não enviada.'
        : `Falha no envio: ${result.error}`,
    },
  };
}

/**
 * Reage a uma mensagem do WhatsApp com um emoji (API oficial e UaZAPI; emoji
 * vazio removeria a reação, mas a UI só envia). A reação é registrada como
 * linha type='reaction' ancorada pelo external_message_id da mensagem alvo —
 * mesmo formato do inbound, então a timeline anexa o emoji à bolha.
 */
export async function reactToMessage(
  messageId: string,
  emoji: string,
): Promise<ActionResult<{ delivered: boolean }>> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };
  if (!emoji.trim()) return { ok: false, error: 'Escolha um emoji' };

  const { data: target } = await supabase
    .from('messages')
    .select('id, conversation_id, external_message_id, type')
    .eq('id', messageId)
    .maybeSingle();
  if (!target) return { ok: false, error: 'Mensagem não encontrada' };
  if (!target.external_message_id) {
    return { ok: false, error: 'Mensagem sem id externo — não é possível reagir' };
  }
  if (target.type === 'reaction') {
    return { ok: false, error: 'Não é possível reagir a uma reação' };
  }

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, channel, external_id, whatsapp_instance_id')
    .eq('id', target.conversation_id)
    .maybeSingle();
  if (!conversation) return { ok: false, error: 'Conversa não encontrada' };
  if (conversation.channel !== 'whatsapp') {
    return { ok: false, error: 'Reações estão disponíveis apenas no WhatsApp' };
  }

  const admin = createAdminClient();

  // Mesmo roteamento do dispatchOutbound: instância oficial → Cloud API pela
  // credencial da instância; sem instância, credenciais do env.
  let result: MetaResult<{ messageId: string | null }>;
  const { data: instance } = conversation.whatsapp_instance_id
    ? await admin
        .from('whatsapp_instances')
        .select('id, provider, phone_number_id, instance_token')
        .eq('id', conversation.whatsapp_instance_id)
        .maybeSingle()
    : { data: null };
  if (instance?.provider === 'official' && instance.phone_number_id) {
    result = await sendWhatsappReaction(
      conversation.external_id,
      target.external_message_id,
      emoji,
      { phoneNumberId: instance.phone_number_id, accessToken: instance.instance_token },
    );
  } else {
    result = await sendWhatsappReaction(conversation.external_id, target.external_message_id, emoji);
  }
  if (!result.ok) {
    return { ok: false, error: result.skipped ? 'Canal não configurado' : result.error };
  }

  await admin.from('messages').insert({
    conversation_id: conversation.id,
    direction: 'outbound',
    type: 'reaction',
    content: emoji,
    status: 'sent',
    sent_by: user.id,
    sent_at: new Date().toISOString(),
    external_message_id: result.data.messageId,
    metadata: { reaction: { emoji, targetExternalId: target.external_message_id } },
  });

  return { ok: true, data: { delivered: true } };
}

/**
 * Envia um template do chat com as variáveis preenchidas ({{produto}} etc.).
 * Em conversa da instância OFICIAL com template vinculado à Meta
 * (meta_template_name), dispara como mensagem type=template — único formato que
 * entrega fora da janela de 24h. Nas demais (UaZAPI/Instagram) o texto
 * renderizado sai como mensagem comum.
 */
export async function sendTemplateMessage(
  conversationId: string,
  templateId: string,
  values: Record<string, string>,
  /** skipStageAutomation: disparos em lote não contam como "primeiro contato". */
  opts?: { skipStageAutomation?: boolean },
): Promise<ActionResult<SendMessageResult>> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, channel, external_id, whatsapp_instance_id, contact_name, lead:leads(name)')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conversation) return { ok: false, error: 'Conversa não encontrada' };

  const { data: template } = await supabase
    .from('message_templates')
    .select('*')
    .eq('id', templateId)
    .eq('is_active', true)
    .maybeSingle();
  if (!template) return { ok: false, error: 'Template não encontrado' };

  // {{nome}} é automático: primeiro nome do lead da conversa. Resolver aqui
  // (por destinatário) é o que faz o disparo em lote sair personalizado.
  const resolved = { ...values };
  if (
    template.variables.includes(AUTO_LEAD_NAME_VARIABLE) &&
    !resolved[AUTO_LEAD_NAME_VARIABLE]?.trim()
  ) {
    const first = firstNameOf(conversation.lead?.name ?? conversation.contact_name);
    if (!first) {
      return { ok: false, error: 'Lead sem nome cadastrado — não dá para preencher {{nome}}.' };
    }
    resolved[AUTO_LEAD_NAME_VARIABLE] = first;
  }

  // Toda variável precisa vir preenchida — a Meta rejeita parâmetro vazio e o
  // texto ficaria quebrado de qualquer forma.
  const filled = template.variables.map((v) => resolved[v]?.trim() ?? '');
  if (filled.some((v) => !v)) {
    return { ok: false, error: 'Preencha todas as variáveis do template.' };
  }
  let content = template.content;
  template.variables.forEach((v, i) => {
    content = content.split(`{{${v}}}`).join(filled[i]);
  });

  const { data: inserted, error: insertError } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      direction: 'outbound',
      type: 'template',
      content,
      status: 'sent',
      sent_by: user.id,
      sent_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (insertError || !inserted) {
    return { ok: false, error: insertError?.message ?? 'Falha ao registrar mensagem' };
  }

  // Mesmo efeito do sendMessage: contato humano re-ancora a cadência de follow-up.
  await supabase
    .from('conversations')
    .update({
      last_message_at: new Date().toISOString(),
      followup_last_sent_at: new Date().toISOString(),
      followup_day: 0,
      followup_stopped: false,
      followup_stop_reason: null,
    })
    .eq('id', conversationId);

  const admin = createAdminClient();

  // Automação de pipeline: template enviado pela equipe conta como primeiro
  // contato — inclusive disparo em lote (desde 2026-07-24 o disparo também
  // move novo_lead → primeiro_contato).
  if (!opts?.skipStageAutomation) {
    const movedStage = await advanceLeadOnFirstOutbound(admin, conversationId, {
      actorUserId: user.id,
      via: 'template',
    });
    if (movedStage) revalidatePath('/oportunidades');
  }

  // Instância oficial + template vinculado à Meta → envio type=template (as
  // variáveis posicionais {{1}}, {{2}}… seguem a ordem do array `variables`).
  let result: MetaResult<{ messageId: string | null }> | null = null;
  if (
    conversation.channel === 'whatsapp' &&
    template.meta_template_name &&
    conversation.whatsapp_instance_id
  ) {
    const { data: instance } = await admin
      .from('whatsapp_instances')
      .select('id, provider, phone_number_id, instance_token')
      .eq('id', conversation.whatsapp_instance_id)
      .maybeSingle();
    if (instance?.provider === 'official') {
      result = await sendOfficialTemplate(
        conversation.external_id,
        {
          name: template.meta_template_name,
          language: template.meta_template_language,
          bodyParams: filled,
        },
        { phoneNumberId: instance.phone_number_id, accessToken: instance.instance_token },
      );
    }
  }
  if (!result) {
    result = await dispatchOutbound(
      admin,
      conversation.channel as ChatChannel,
      conversation.external_id,
      conversation.whatsapp_instance_id,
      { type: 'text', content },
    );
  }

  if (result.ok) {
    if (result.data.messageId) {
      await admin
        .from('messages')
        .update({ external_message_id: result.data.messageId })
        .eq('id', inserted.id);
    }
    return { ok: true, data: { messageId: inserted.id, delivered: true, warning: null } };
  }

  await admin.from('messages').update({ status: 'failed' }).eq('id', inserted.id);
  return {
    ok: true,
    data: {
      messageId: inserted.id,
      delivered: false,
      warning: result.skipped
        ? 'Canal não configurado — mensagem salva mas não enviada.'
        : `Falha no envio: ${result.error}`,
    },
  };
}

/**
 * Trava "IA não entra nesta conversa" (botão do /chat). Mutar também derruba a
 * IA na hora se ela estiver ativa. Desmutar volta a valer as regras normais
 * (8min sem resposta humana + guarda de humano ativo nas últimas 24h).
 */
export async function setConversationAiMuted(
  conversationId: string,
  muted: boolean,
): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  // .select() detecta o "sucesso" silencioso do RLS (0 linhas afetadas).
  const { data, error } = await supabase
    .from('conversations')
    .update({
      ai_muted: muted,
      ...(muted ? { ai_active: false, ai_deactivated_at: new Date().toISOString() } : {}),
    })
    .eq('id', conversationId)
    .select('id, lead_id');
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: 'Sem permissão para alterar esta conversa.' };
  }

  const row = data[0];
  if (row?.lead_id) {
    await supabase.from('activities').insert({
      lead_id: row.lead_id,
      user_id: user.id,
      type: 'system',
      title: muted ? 'IA bloqueada na conversa' : 'IA liberada na conversa',
      description: muted
        ? 'Um humano bloqueou a IA nesta conversa — ela não responde nem faz follow-up aqui.'
        : 'A IA foi liberada nesta conversa (voltam a valer as regras normais).',
      is_demo: false,
      metadata: { via: 'ai-sdr', event: muted ? 'muted' : 'unmuted', conversation_id: conversationId },
    });
  }
  return { ok: true, data: undefined };
}

/** Resultado do envio de template pela IA — inclui o texto resolvido p/ o log. */
export interface SendTemplateAsAiResult extends SendMessageResult {
  content: string;
}

/**
 * Envia um TEMPLATE automático (sender_type='ai', sem usuário logado) — usado
 * pelas automações (primeiro contato, follow-up) na API OFICIAL, onde fora da
 * janela de 24h só template aprovado pela Meta entrega (texto livre → 131047).
 * Resolve sozinho {{nome}} (primeiro nome do lead); demais variáveis vêm de
 * extraValues. Template com variável não resolvida → erro.
 */
export async function sendTemplateMessageAsAi(
  conversationId: string,
  templateId: string,
  extraValues?: Record<string, string>,
): Promise<ActionResult<SendTemplateAsAiResult>> {
  const admin = createAdminClient();

  const { data: conversation } = await admin
    .from('conversations')
    .select('id, channel, external_id, whatsapp_instance_id, contact_name, lead:leads(name)')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conversation) return { ok: false, error: 'Conversa não encontrada' };

  const { data: template } = await admin
    .from('message_templates')
    .select('*')
    .eq('id', templateId)
    .eq('is_active', true)
    .maybeSingle();
  if (!template) return { ok: false, error: 'Template não encontrado ou inativo' };

  // Resolve as variáveis por lead. `nome` = primeiro nome; extraValues cobre
  // variáveis geradas pelo chamador (ex.: {{mensagem}} do follow-up
  // personalizado). Qualquer outra → erro.
  const resolved: Record<string, string> = {};
  for (const variable of template.variables) {
    if (extraValues?.[variable]?.trim()) {
      resolved[variable] = extraValues[variable].trim();
    } else if (variable === AUTO_LEAD_NAME_VARIABLE) {
      const first = firstNameOf(conversation.lead?.name ?? conversation.contact_name);
      if (!first) return { ok: false, error: 'Lead sem nome — não dá para preencher {{nome}}.' };
      resolved[variable] = first;
    } else {
      return {
        ok: false,
        error: `Template tem variável {{${variable}}} que a automação não sabe preencher.`,
      };
    }
  }

  const filled = template.variables.map((v) => resolved[v] ?? '');
  let content = template.content;
  template.variables.forEach((v, i) => {
    content = content.split(`{{${v}}}`).join(filled[i]);
  });

  const { data: inserted, error: insertError } = await admin
    .from('messages')
    .insert({
      conversation_id: conversationId,
      direction: 'outbound',
      type: 'template',
      content,
      status: 'sent',
      sender_type: 'ai',
      sent_by: null,
      sent_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (insertError || !inserted) {
    return { ok: false, error: insertError?.message ?? 'Falha ao registrar mensagem' };
  }

  await admin
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId);

  // Instância oficial + template vinculado à Meta → type=template (entrega fora
  // da janela). Demais canais (UaZAPI) aceitam o texto renderizado como comum.
  let result: MetaResult<{ messageId: string | null }> | null = null;
  if (conversation.channel === 'whatsapp' && template.meta_template_name && conversation.whatsapp_instance_id) {
    const { data: instance } = await admin
      .from('whatsapp_instances')
      .select('id, provider, phone_number_id, instance_token')
      .eq('id', conversation.whatsapp_instance_id)
      .maybeSingle();
    if (instance?.provider === 'official') {
      result = await sendOfficialTemplate(
        conversation.external_id,
        {
          name: template.meta_template_name,
          language: template.meta_template_language,
          bodyParams: filled,
        },
        { phoneNumberId: instance.phone_number_id, accessToken: instance.instance_token },
      );
    }
  }
  if (!result) {
    result = await dispatchOutbound(
      admin,
      conversation.channel as ChatChannel,
      conversation.external_id,
      conversation.whatsapp_instance_id,
      { type: 'text', content },
    );
  }

  if (result.ok) {
    if (result.data.messageId) {
      await admin
        .from('messages')
        .update({ external_message_id: result.data.messageId })
        .eq('id', inserted.id);
    }
    return { ok: true, data: { messageId: inserted.id, delivered: true, warning: null, content } };
  }

  await admin.from('messages').update({ status: 'failed' }).eq('id', inserted.id);
  return {
    ok: true,
    data: {
      messageId: inserted.id,
      delivered: false,
      warning: result.skipped
        ? 'Canal não configurado — mensagem salva mas não enviada.'
        : `Falha no envio: ${result.error}`,
      content,
    },
  };
}

/**
 * Shadow Mode (Bloco 4) — aprova uma mensagem da IA que estava `pending_approval`:
 * dispara no canal correto e marca aprovada/enviada. Lê via client autenticado
 * (RLS escopa a conversa ao responsável/admin) e despacha via admin.
 */
export async function approveAiMessage(
  messageId: string,
): Promise<ActionResult<{ delivered: boolean; warning: string | null }>> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { data: msg } = await supabase
    .from('messages')
    .select('id, conversation_id, content, type, media_url, pending_approval')
    .eq('id', messageId)
    .maybeSingle();
  if (!msg) return { ok: false, error: 'Mensagem não encontrada' };
  if (!msg.pending_approval) return { ok: false, error: 'Mensagem não está pendente de aprovação' };

  const admin = createAdminClient();
  const { data: conversation } = await admin
    .from('conversations')
    .select('id, channel, external_id, whatsapp_instance_id')
    .eq('id', msg.conversation_id)
    .maybeSingle();
  if (!conversation) return { ok: false, error: 'Conversa não encontrada' };

  const result = await dispatchOutbound(
    admin,
    conversation.channel as ChatChannel,
    conversation.external_id,
    conversation.whatsapp_instance_id,
    { type: msg.type as MessageType, content: msg.content, mediaUrl: msg.media_url },
  );

  const approvalPatch = {
    pending_approval: false,
    approved_by: user.id,
    approved_at: new Date().toISOString(),
  };

  if (result.ok) {
    await admin
      .from('messages')
      .update({
        ...approvalPatch,
        status: 'sent',
        sent_at: new Date().toISOString(),
        ...(result.data.messageId ? { external_message_id: result.data.messageId } : {}),
      })
      .eq('id', messageId);
    await admin
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', msg.conversation_id);
    return { ok: true, data: { delivered: true, warning: null } };
  }

  await admin
    .from('messages')
    .update({ ...approvalPatch, status: 'failed' })
    .eq('id', messageId);
  return {
    ok: true,
    data: {
      delivered: false,
      warning: result.skipped
        ? 'Canal não configurado — mensagem aprovada mas não entregue.'
        : `Falha no envio: ${result.error}`,
    },
  };
}

/**
 * Shadow Mode — descarta uma mensagem pendente da IA (não envia). Remove a
 * mensagem do histórico. Lê via client autenticado (RLS) e apaga via admin.
 */
export async function rejectAiMessage(messageId: string): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { data: msg } = await supabase
    .from('messages')
    .select('id, pending_approval')
    .eq('id', messageId)
    .maybeSingle();
  if (!msg) return { ok: false, error: 'Mensagem não encontrada' };
  if (!msg.pending_approval) return { ok: false, error: 'Mensagem não está pendente de aprovação' };

  const admin = createAdminClient();
  const { error } = await admin.from('messages').delete().eq('id', messageId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

/**
 * Abre (ou cria) a conversa de um lead — usado pelo botão de chat no Kanban.
 * Prefere WhatsApp (se houver phone), senão Instagram (se houver instagram).
 */
export async function openConversationForLead(
  leadId: string,
): Promise<ActionResult<{ conversationId: string }>> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { data: lead } = await supabase
    .from('leads')
    .select('id, phone, instagram')
    .eq('id', leadId)
    .maybeSingle();
  if (!lead) return { ok: false, error: 'Lead não encontrado' };

  // Já existe conversa para esse lead?
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('lead_id', leadId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (existing) return { ok: true, data: { conversationId: existing.id } };

  const channel: ChatChannel | null = lead.phone ? 'whatsapp' : lead.instagram ? 'instagram' : null;
  // external_id do WhatsApp são só dígitos (igual aos webhooks UaZAPI/Meta), para
  // reaproveitar uma conversa de triagem/eco que já exista para o mesmo número.
  const externalId = lead.phone
    ? lead.phone.replace(/\D/g, '')
    : lead.instagram ?? null;
  if (!channel || !externalId) {
    return { ok: false, error: 'Lead sem telefone ou Instagram para iniciar conversa' };
  }

  // Pode já existir uma conversa (triagem/eco de dispositivo) para esse
  // (channel, external_id) ainda SEM lead vinculado — inserir uma nova violaria a
  // UNIQUE (channel, external_id) (era o "duplicate key" ao abrir o chat). Usa o
  // admin p/ enxergar conversas que a RLS esconderia e reaproveita/vincula.
  const admin = createAdminClient();
  const { data: existingByKey } = await admin
    .from('conversations')
    .select('id, lead_id, assigned_to')
    .eq('channel', channel)
    .eq('external_id', externalId)
    .maybeSingle();
  if (existingByKey) {
    const patch: { lead_id?: string; assigned_to?: string } = {};
    if (!existingByKey.lead_id) patch.lead_id = leadId;
    if (!existingByKey.assigned_to) patch.assigned_to = user.id;
    if (Object.keys(patch).length > 0) {
      await admin.from('conversations').update(patch).eq('id', existingByKey.id);
    }
    return { ok: true, data: { conversationId: existingByKey.id } };
  }

  // UPSERT em (channel, external_id): fecha a janela de corrida entre o SELECT
  // acima e o INSERT (ex.: webhook inbound criando a conversa no mesmo instante).
  const { data: created, error } = await admin
    .from('conversations')
    .upsert(
      {
        lead_id: leadId,
        channel,
        external_id: externalId,
        assigned_to: user.id,
        // Sem status: abrir o chat pelo Kanban não reabre conversa resolvida
        // (INSERT novo usa o default 'open').
      },
      { onConflict: 'channel,external_id' },
    )
    .select('id')
    .single();

  if (error || !created) {
    return { ok: false, error: error?.message ?? 'Falha ao criar conversa' };
  }
  return { ok: true, data: { conversationId: created.id } };
}

export interface LeadConversation {
  conversation: Conversation;
  instance: WhatsappInstanceBadge | null;
  messages: Message[];
}

/**
 * Conversas (com mensagens) de um lead — alimenta a aba "Conversas" do
 * LeadDrawer, para ver o chat sem sair do Kanban. RLS aplica o escopo
 * (responsável, closer ou admin).
 */
export async function getLeadConversations(leadId: string): Promise<LeadConversation[]> {
  const supabase = createClient();
  const { data: conversations } = await supabase
    .from('conversations')
    .select(
      '*, whatsapp_instance:whatsapp_instances(id, name, label, color, is_connected, provider)',
    )
    .eq('lead_id', leadId)
    .order('last_message_at', { ascending: false, nullsFirst: false });

  if (!conversations || conversations.length === 0) return [];

  return Promise.all(
    conversations.map(async (row) => {
      const { whatsapp_instance: instance, ...conversation } = row;
      const { data: messages } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true });
      return {
        conversation: conversation as Conversation,
        instance: instance as WhatsappInstanceBadge | null,
        messages: messages ?? [],
      };
    }),
  );
}

/**
 * Cria (ou unifica) um lead a partir de uma conversa de triagem — conversas
 * (ex.: DM de Instagram) podem ficar sem lead até a equipe decidir converter.
 */
export async function createLeadFromConversation(
  conversationId: string,
): Promise<ActionResult<{ leadId: string }>> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  // Lido com o client autenticado: RLS garante que só o responsável (ou
  // closer/admin) consegue converter a conversa.
  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, channel, external_id, lead_id, assigned_to')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conversation) return { ok: false, error: 'Conversa não encontrada' };
  if (conversation.lead_id) return { ok: false, error: 'A conversa já tem um lead vinculado' };

  const channel = conversation.channel as ChatChannel;
  const admin = createAdminClient();

  // Nome de exibição: para Instagram tenta o perfil (nome/@username) na hora.
  let name: string | null = null;
  let instagramHandle: string | null = null;
  if (channel === 'instagram') {
    const profile = await fetchInstagramUserProfile(conversation.external_id);
    if (profile.ok) {
      name = profile.data.name ?? null;
      instagramHandle = profile.data.username ?? null;
      if (!name && instagramHandle) name = `@${instagramHandle}`;
    }
  }

  const values: Partial<Record<MappableLeadField, string>> = {
    name: name ?? conversation.external_id,
  };
  if (channel === 'whatsapp') values.phone = conversation.external_id;
  if (instagramHandle) values.instagram = instagramHandle;

  const result = await ingestLead(admin, {
    values,
    numbers: {},
    tags: [channel === 'whatsapp' ? 'whatsapp-inbound' : 'instagram-inbound'],
    defaultSource: channel === 'whatsapp' ? 'whatsapp' : 'instagram',
    pipeline: 'comercial',
    stage: 'novo_lead',
    sourceName: channel === 'whatsapp' ? 'WhatsApp (chat)' : 'Instagram (chat)',
    identity: channel === 'instagram' ? { instagramUserId: conversation.external_id } : {},
  });

  // Continuidade: lead NOVO fica com quem está na conversa (não redistribui).
  // Lead unificado (já existia) mantém o responsável atual.
  if (!result.duplicate) {
    const owner = conversation.assigned_to ?? user.id;
    if (owner !== result.assignedTo) {
      await admin.from('leads').update({ assigned_to: owner }).eq('id', result.leadId);
    }
  }
  await admin.from('conversations').update({ lead_id: result.leadId }).eq('id', conversationId);

  return { ok: true, data: { leadId: result.leadId } };
}

/**
 * Cria (ou unifica) um lead a partir de um CARTÃO DE CONTATO compartilhado numa
 * conversa (vCard). O lead nasce em sdr/novo_lead com o usuário atual como
 * responsável — indicação passada pelo próprio contato da conversa.
 */
export async function createLeadFromSharedContact(input: {
  name: string;
  phone: string;
}): Promise<ActionResult<{ leadId: string; duplicate: boolean }>> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const name = input.name.trim();
  const digits = input.phone.replace(/\D/g, '');
  if (!name && !digits) return { ok: false, error: 'Contato sem nome e sem telefone' };
  if (digits.length < 10) return { ok: false, error: 'Telefone do contato inválido' };

  const admin = createAdminClient();
  const result = await ingestLead(admin, {
    values: { name: name || digits, phone: `+${digits}` },
    numbers: {},
    tags: ['contato-compartilhado'],
    defaultSource: 'whatsapp',
    pipeline: 'comercial',
    stage: 'novo_lead',
    sourceName: 'Contato compartilhado (chat)',
    assignedToOverride: user.id,
  });
  return { ok: true, data: { leadId: result.leadId, duplicate: result.duplicate } };
}

/**
 * Total de mensagens inbound não lidas visíveis ao usuário (RLS aplica o escopo
 * por conversa). Alimenta o contador do item "Chat" na sidebar.
 */
export async function getUnreadChatCount(): Promise<number> {
  const supabase = createClient();
  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'inbound')
    .in('status', ['sent', 'delivered']);
  return count ?? 0;
}

export async function getMessageTemplates(channel?: ChatChannel): Promise<MessageTemplate[]> {
  const supabase = createClient();
  let query = supabase
    .from('message_templates')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (channel) query = query.eq('channel', channel);
  const { data } = await query;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Nova conversa (Fase: chat — iniciar conversa ativa)
// ---------------------------------------------------------------------------

export interface ChatLeadSearchResult {
  id: string;
  name: string;
  phone: string | null;
  instagram: string | null;
}

/** Busca leads (nome/telefone/email) para o modal "Nova conversa". RLS aplica o escopo. */
export async function searchChatLeads(term: string): Promise<ChatLeadSearchResult[]> {
  const q = term.trim();
  if (q.length < 2) return [];
  // Sanitiza os caracteres que quebrariam o filtro `.or(...)` do PostgREST.
  const safe = q.replace(/[,()%*]/g, ' ').trim();
  if (!safe) return [];
  const like = `%${safe}%`;
  const supabase = createClient();
  const { data } = await supabase
    .from('leads')
    .select('id, name, phone, instagram')
    .eq('is_archived', false)
    .or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`)
    .order('updated_at', { ascending: false })
    .limit(10);
  return (data ?? []) as ChatLeadSearchResult[];
}

/** Status do número oficial (Cloud API) — usado no modal antes de enviar. */
export async function getOfficialWhatsappStatus(): Promise<OfficialWhatsappStatus> {
  return fetchOfficialWhatsappStatus();
}

export interface StartConversationInput {
  /** Opção A: lead existente do CRM. */
  leadId?: string | null;
  /** Opção B: número novo (dígitos ou formatado) — cria um lead mínimo. */
  phone?: string | null;
  /** Nome do contato (Opção B) — usado ao criar o lead. */
  contactName?: string | null;
  /** whatsapp_instances.id do número que envia (oficial/UaZAPI). */
  instanceId: string;
  message: string;
}

/**
 * Inicia (ou reaproveita) uma conversa de WhatsApp e envia a 1ª mensagem.
 *
 * Opção A: lead existente (usa o telefone do lead).
 * Opção B: número novo → cria um lead mínimo (sdr/novo_lead) do dono atual.
 *
 * Tudo via admin: a conversa é criada/atualizada e a mensagem é despachada
 * independentemente da RLS (o próprio remetente vira dono se a conversa não
 * tinha responsável). Envio com degradação graciosa — nunca lança.
 */
export async function startConversation(
  input: StartConversationInput,
): Promise<ActionResult<{ conversationId: string; warning: string | null }>> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const message = input.message?.trim();
  if (!message) return { ok: false, error: 'Mensagem vazia' };
  if (!input.instanceId) return { ok: false, error: 'Selecione um número para enviar' };

  const admin = createAdminClient();

  const { data: instance } = await admin
    .from('whatsapp_instances')
    .select('id, is_active')
    .eq('id', input.instanceId)
    .maybeSingle();
  if (!instance || !instance.is_active) {
    return { ok: false, error: 'Número (instância) inválido ou inativo' };
  }

  // 1. Resolve o lead e o telefone (external_id = só dígitos, igual aos webhooks).
  let leadId: string | null = input.leadId ?? null;
  let phoneDigits: string;
  const typedDigits = input.phone ? input.phone.replace(/\D/g, '') : '';

  if (leadId) {
    const { data: lead } = await admin
      .from('leads')
      .select('id, phone')
      .eq('id', leadId)
      .maybeSingle();
    if (!lead) return { ok: false, error: 'Lead não encontrado' };
    const leadDigits = lead.phone ? lead.phone.replace(/\D/g, '') : '';
    phoneDigits = leadDigits || typedDigits;
    if (!phoneDigits) return { ok: false, error: 'O lead selecionado não tem telefone de WhatsApp.' };
  } else {
    if (typedDigits.length < 10) return { ok: false, error: 'Informe um telefone de WhatsApp válido.' };
    phoneDigits = typedDigits;
    const name = input.contactName?.trim() || phoneDigits;
    // Cria (ou unifica) um lead mínimo; o dono é quem iniciou a conversa.
    const result = await ingestLead(admin, {
      values: { name, phone: `+${phoneDigits}` },
      numbers: {},
      tags: ['nova-conversa'],
      defaultSource: 'whatsapp',
      pipeline: 'comercial',
      stage: 'novo_lead',
      sourceName: 'Nova conversa (chat)',
      assignedToOverride: user.id,
    });
    leadId = result.leadId;
  }

  // 2. Conversa por (channel, external_id): reaproveita a existente (sem roubar
  //    dono já definido) ou cria via UPSERT. O número escolhido passa a ser a
  //    instância de envio.
  const { data: existingConv } = await admin
    .from('conversations')
    .select('id, assigned_to, lead_id')
    .eq('channel', 'whatsapp')
    .eq('external_id', phoneDigits)
    .maybeSingle();

  let conversationId: string;
  if (existingConv) {
    await admin
      .from('conversations')
      .update({
        whatsapp_instance_id: instance.id,
        status: 'open',
        last_message_at: new Date().toISOString(),
        ...(existingConv.lead_id ? {} : { lead_id: leadId }),
        ...(existingConv.assigned_to ? {} : { assigned_to: user.id }),
      })
      .eq('id', existingConv.id);
    conversationId = existingConv.id;
  } else {
    const { data: conv, error: convErr } = await admin
      .from('conversations')
      .upsert(
        {
          channel: 'whatsapp',
          external_id: phoneDigits,
          lead_id: leadId,
          assigned_to: user.id,
          whatsapp_instance_id: instance.id,
          contact_name: input.contactName?.trim() || null,
          status: 'open',
          last_message_at: new Date().toISOString(),
        },
        { onConflict: 'channel,external_id' },
      )
      .select('id')
      .single();
    if (convErr || !conv) return { ok: false, error: convErr?.message ?? 'Falha ao abrir a conversa' };
    conversationId = conv.id;
  }

  // 3. Registra e despacha a mensagem (admin: independe da RLS/dono da conversa).
  const { data: inserted, error: msgErr } = await admin
    .from('messages')
    .insert({
      conversation_id: conversationId,
      direction: 'outbound',
      type: 'text',
      content: message,
      status: 'sent',
      sent_by: user.id,
      sent_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (msgErr || !inserted) {
    return { ok: false, error: msgErr?.message ?? 'Falha ao registrar a mensagem' };
  }

  // Automação de pipeline: abrir conversa já é o primeiro contato — se o lead
  // (existente ou recém-criado) está em sdr/novo_lead, move para primeiro_contato.
  const movedStage = await advanceLeadOnFirstOutbound(admin, conversationId, {
    actorUserId: user.id,
    via: 'nova_conversa',
  });
  if (movedStage) revalidatePath('/oportunidades');

  const dispatch = await dispatchOutbound(admin, 'whatsapp', phoneDigits, instance.id, {
    type: 'text',
    content: message,
  });

  let warning: string | null = null;
  if (dispatch.ok) {
    if (dispatch.data.messageId) {
      await admin
        .from('messages')
        .update({ external_message_id: dispatch.data.messageId })
        .eq('id', inserted.id);
    }
  } else {
    await admin.from('messages').update({ status: 'failed' }).eq('id', inserted.id);
    warning = dispatch.skipped
      ? 'Número não configurado — conversa criada, mas a mensagem não foi enviada.'
      : `Conversa criada, mas o envio falhou: ${dispatch.error}`;
  }

  return { ok: true, data: { conversationId, warning } };
}

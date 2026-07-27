'use server';

import { createClient } from '@/lib/supabase/server';
import { sendTemplateMessage } from './conversations';
import type { MessageTemplate } from '@/types/chat';
import type { ActionResult } from './leads';

/**
 * Server Actions da tela /disparos — envio de template oficial da Meta em lote.
 *
 * Público-alvo (v1): conversas da instância OFICIAL do WhatsApp (leads que
 * entraram em contato pela Cloud API). O envio sai como type=template, o único
 * formato que a Meta aceita fora da janela de 24h — texto livre é rejeitado.
 * RLS escopa quais conversas cada usuário enxerga/dispara.
 *
 * Limite: enquanto o display name do número não for aprovado, a Meta limita
 * conversas business-initiated a 250/24h — o disparo respeita esse teto.
 */

/** Templates disparáveis: ativos e vinculados a um template APROVADO na Meta. */
export async function listBroadcastTemplates(): Promise<MessageTemplate[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('message_templates')
    .select('*')
    .eq('is_active', true)
    .eq('channel', 'whatsapp')
    .not('meta_template_name', 'is', null)
    .order('name', { ascending: true });
  return data ?? [];
}

export interface BroadcastTarget {
  conversationId: string;
  leadId: string | null;
  name: string;
  phone: string;
  lastMessageAt: string | null;
  pipeline: string | null;
  stage: string | null;
  /** Nome da instância oficial (ex.: "API OFICIAL MS") — filtro por número. */
  instanceName: string | null;
}

interface TargetRow {
  id: string;
  external_id: string;
  contact_name: string | null;
  last_message_at: string | null;
  lead_id: string | null;
  lead: { id: string; name: string; pipeline: string; stage: string } | null;
  whatsapp_instance: { provider: string; name: string } | null;
}

/** Conversas da instância oficial (quem já falou com o número da Cloud API). */
export async function listOfficialBroadcastTargets(): Promise<BroadcastTarget[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('conversations')
    .select(
      'id, external_id, contact_name, last_message_at, lead_id, lead:leads(id, name, pipeline, stage), whatsapp_instance:whatsapp_instances!inner(provider, name)',
    )
    .eq('channel', 'whatsapp')
    .eq('whatsapp_instance.provider', 'official')
    .order('last_message_at', { ascending: false, nullsFirst: false });

  return ((data ?? []) as unknown as TargetRow[]).map((row) => ({
    conversationId: row.id,
    leadId: row.lead?.id ?? row.lead_id,
    name: row.lead?.name ?? row.contact_name ?? row.external_id,
    phone: row.external_id,
    lastMessageAt: row.last_message_at,
    pipeline: row.lead?.pipeline ?? null,
    stage: row.lead?.stage ?? null,
    instanceName: row.whatsapp_instance?.name ?? null,
  }));
}

export interface BroadcastItemResult {
  conversationId: string;
  ok: boolean;
  error: string | null;
}

/**
 * Dispara o template para um lote de conversas (sequencial). Cada envio passa
 * pelo mesmo caminho do chat (sendTemplateMessage): registra a mensagem na
 * conversa e dispara como template oficial — o histórico fica completo.
 * O client chama em chunks (10 por vez) para mostrar progresso.
 */
export async function sendTemplateBroadcast(
  templateId: string,
  values: Record<string, string>,
  conversationIds: string[],
  /** Valores por conversa (ex.: {{nome}} conferido/ajustado na lista) — sobrepõem os globais. */
  perConversationValues?: Record<string, Record<string, string>>,
): Promise<ActionResult<{ sent: number; failed: number; results: BroadcastItemResult[] }>> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  if (conversationIds.length === 0) return { ok: false, error: 'Selecione ao menos um lead.' };
  if (conversationIds.length > 250) {
    return { ok: false, error: 'Máximo de 250 envios por disparo (limite diário da Meta).' };
  }

  const results: BroadcastItemResult[] = [];
  for (const conversationId of conversationIds) {
    const r = await sendTemplateMessage(conversationId, templateId, {
      ...values,
      ...(perConversationValues?.[conversationId] ?? {}),
    });
    if (!r.ok) {
      results.push({ conversationId, ok: false, error: r.error });
    } else if (!r.data.delivered) {
      results.push({ conversationId, ok: false, error: r.data.warning ?? 'Falha no envio' });
    } else {
      results.push({ conversationId, ok: true, error: null });
    }
  }
  const sent = results.filter((r) => r.ok).length;
  return { ok: true, data: { sent, failed: results.length - sent, results } };
}

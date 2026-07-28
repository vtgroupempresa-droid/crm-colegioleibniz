import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type DbClient = SupabaseClient<Database>;

/**
 * Automação de pipeline do funil comercial (matrículas):
 *
 *  - A PRIMEIRA mensagem enviada pela equipe a um lead em `novo_lead` move o
 *    lead para `primeiro_contato` — o stage rastreia TENTATIVA de contato, não
 *    resposta (mesma semântica do registro de tentativa em "não atendeu").
 *  - Quando o lead RESPONDE (WhatsApp/Instagram), também garante que ele saia
 *    de `novo_lead` para `primeiro_contato`.
 *
 * Contam envios humanos (chat manual, template avulso, "Nova conversa", eco do
 * aparelho físico), disparos em lote e o primeiro contato automático.
 */

const FIRST_OUTBOUND_PIPELINES: readonly string[] = ['comercial'];
const FROM_STAGE = 'novo_lead';
const TO_STAGE = 'primeiro_contato';

export interface FirstOutboundContext {
  /** Autor da mensagem: user.id nas Server Actions; null no eco do dispositivo. */
  actorUserId: string | null;
  /** Origem legível para a activity. */
  via: 'chat' | 'template' | 'nova_conversa' | 'dispositivo' | 'disparo' | 'auto';
}

/**
 * Best-effort: nunca lança (não pode derrubar o envio da mensagem). Idempotente
 * e à prova de corrida: o update é condicionado ao stage atual — dois envios
 * quase simultâneos produzem um único move e uma única activity.
 * Retorna `true` se moveu o lead.
 */
export async function advanceLeadOnFirstOutbound(
  admin: DbClient,
  conversationId: string,
  ctx: FirstOutboundContext,
): Promise<boolean> {
  try {
    const { data: conversation } = await admin
      .from('conversations')
      .select('id, channel, lead_id')
      .eq('id', conversationId)
      .maybeSingle();
    // Conversa em triagem (sem lead) não tem o que mover.
    if (!conversation || !conversation.lead_id) {
      return false;
    }

    const { data: lead } = await admin
      .from('leads')
      .select('id, pipeline, stage, is_archived, is_demo')
      .eq('id', conversation.lead_id)
      .maybeSingle();
    if (!lead || lead.is_archived) return false;
    if (!FIRST_OUTBOUND_PIPELINES.includes(lead.pipeline) || lead.stage !== FROM_STAGE) {
      return false;
    }

    // Destino precisa existir e estar ativo (protege contra renomeação do slug).
    const { data: destStage } = await admin
      .from('pipeline_stages')
      .select('slug')
      .eq('pipeline', lead.pipeline)
      .eq('slug', TO_STAGE)
      .eq('is_active', true)
      .maybeSingle();
    if (!destStage) return false;

    const { data: moved } = await admin
      .from('leads')
      .update({ stage: TO_STAGE })
      .eq('id', lead.id)
      .eq('pipeline', lead.pipeline)
      .eq('stage', FROM_STAGE)
      .select('id');
    if (!moved || moved.length === 0) return false;

    await admin.from('activities').insert({
      lead_id: lead.id,
      user_id: ctx.actorUserId,
      type: 'stage_change',
      title: `Etapa: ${FROM_STAGE} → ${TO_STAGE}`,
      description: 'Movido automaticamente: primeira mensagem enviada ao lead',
      is_demo: lead.is_demo,
      metadata: {
        from: FROM_STAGE,
        to: TO_STAGE,
        pipeline: lead.pipeline,
        automation: 'first_outbound_message',
        via: ctx.via,
        conversation_id: conversationId,
      },
    });
    return true;
  } catch (error) {
    console.error('[stage-automation] advanceLeadOnFirstOutbound falhou:', error);
    return false;
  }
}

/**
 * O lead RESPONDEU (WhatsApp/Instagram) → garante que saiu de `novo_lead` para
 * `primeiro_contato` (conversa estabelecida). De `primeiro_contato` em diante o
 * lead nunca regride. Best-effort, idempotente e à prova de corrida (update
 * condicionado ao stage atual).
 */
const REPLY_FROM_STAGES = ['novo_lead'];
const REPLY_TO_STAGE = 'primeiro_contato';

export async function advanceLeadOnReply(admin: DbClient, leadId: string): Promise<boolean> {
  try {
    const { data: lead } = await admin
      .from('leads')
      .select('id, pipeline, stage, is_archived, is_demo')
      .eq('id', leadId)
      .maybeSingle();
    if (!lead || lead.is_archived) return false;
    if (lead.pipeline !== 'comercial' || !REPLY_FROM_STAGES.includes(lead.stage)) {
      return false;
    }

    const { data: destStage } = await admin
      .from('pipeline_stages')
      .select('slug')
      .eq('pipeline', 'comercial')
      .eq('slug', REPLY_TO_STAGE)
      .eq('is_active', true)
      .maybeSingle();
    if (!destStage) return false;

    const { data: moved } = await admin
      .from('leads')
      .update({ stage: REPLY_TO_STAGE })
      .eq('id', lead.id)
      .eq('pipeline', 'comercial')
      .in('stage', REPLY_FROM_STAGES)
      .select('id');
    if (!moved || moved.length === 0) return false;

    await admin.from('activities').insert({
      lead_id: lead.id,
      user_id: null,
      type: 'stage_change',
      title: `Etapa: ${lead.stage} → ${REPLY_TO_STAGE}`,
      description: 'Movido automaticamente: lead respondeu à equipe',
      is_demo: lead.is_demo,
      metadata: {
        from: lead.stage,
        to: REPLY_TO_STAGE,
        pipeline: 'comercial',
        automation: 'lead_reply',
      },
    });
    return true;
  } catch (error) {
    console.error('[stage-automation] advanceLeadOnReply falhou:', error);
    return false;
  }
}

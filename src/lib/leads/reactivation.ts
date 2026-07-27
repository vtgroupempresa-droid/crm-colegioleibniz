import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyRoles } from '@/actions/notifications';
import type { Database } from '@/types/database';

type DbClient = SupabaseClient<Database>;

/**
 * Reativação por contato espontâneo.
 *
 * Regra do produto: um lead que JÁ existe no CRM e volta a procurar o colégio
 * POR INICIATIVA PRÓPRIA (mensagem inbound de WhatsApp/Instagram ou um novo
 * formulário) deve voltar ao TOPO da fila — `comercial/novo_lead` — preservando
 * TODO o histórico (activities, messages, deals).
 *
 * Só vale para contato iniciado pelo LEAD (direction='inbound'). Follow-ups do
 * time (outbound / eco) NÃO disparam reativação — os callers já separam esses
 * fluxos antes de chamar esta função.
 */

const ENTRY_PIPELINE = 'comercial';
const ENTRY_STAGE = 'novo_lead';

/**
 * Etapas do comercial em que um contato espontâneo traz o lead de volta ao topo:
 * cadência de contato (`primeiro_contato`), fila de follow-up (`follow_up`) e
 * perdidos (`perdido`). Ficam onde estão (não movem): `novo_lead` (já é o topo),
 * `visita_presencial` e `em_negociacao` (equipe trabalhando ativamente) e
 * `cliente_fechado` (já é família da escola — pós-matrícula cuida).
 */
const REACTIVATE_STAGES = new Set<string>(['primeiro_contato', 'follow_up', 'perdido']);

/**
 * Regra do produto: um lead só volta ao topo se ficamos MUITO tempo sem nenhuma
 * troca de mensagem — nem a gente mandou, nem o lead mandou — e então ele
 * reaparece. Se houve conversa recente (de qualquer lado) dentro dessa janela,
 * o contato é continuação do relacionamento ativo e NÃO reativa.
 */
const SILENCE_DAYS = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReactivationContext {
  /**
   * Conversa do canal (WhatsApp/Instagram). Mantido por compatibilidade com os
   * callers; a decisão de reativar olha TODAS as conversas do lead, não só esta.
   */
  conversationId?: string | null;
  /**
   * Entrada DECLARADA: o lead preencheu um formulário/webhook de uma fonte
   * nossa (site, Meta Lead Ads). Intenção explícita, não uma simples mensagem.
   * Nesse caso a reativação IGNORA a janela de silêncio de 15 dias — inclusive
   * para leads em `perdido` (a nova entrada declarada supera a perda antiga).
   * Mensagens inbound de WhatsApp/Instagram continuam com a janela.
   */
  declaredEntry?: boolean;
  /** Destino da reentrada quando a fonte tem fila própria (default comercial/novo_lead). */
  entryPipeline?: Database['public']['Enums']['pipeline_kind'];
  entryStage?: string;
}

/**
 * Timestamp da última mensagem trocada com o lead em QUALQUER direção (inbound
 * ou outbound), considerando todas as conversas do lead. Na hora da reativação a
 * mensagem inbound atual ainda não foi inserida, então isto reflete o último
 * contato ANTERIOR. Retorna null se o lead nunca trocou mensagens.
 */
async function lastContactAt(admin: DbClient, leadId: string): Promise<string | null> {
  const { data: convs } = await admin.from('conversations').select('id').eq('lead_id', leadId);
  const ids = (convs ?? []).map((c) => c.id);
  if (!ids.length) return null;
  const { data: msgs } = await admin
    .from('messages')
    .select('created_at')
    .in('conversation_id', ids)
    .order('created_at', { ascending: false })
    .limit(1);
  return msgs?.[0]?.created_at ?? null;
}

/** Decide se um lead no estado atual deve ser reativado por contato espontâneo. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function shouldReactivate(pipeline: string, stage: string, _declaredEntry: boolean): boolean {
  if (pipeline !== ENTRY_PIPELINE) return false;
  return REACTIVATE_STAGES.has(stage);
}

/**
 * Reativa um lead existente que entrou em contato espontaneamente.
 *
 * - Move para `comercial/novo_lead` mantendo responsável e todo o histórico.
 * - Registra activity `system` + `stage_change`.
 * - Notifica admin ("Lead voltou espontaneamente").
 *
 * Best-effort: nunca lança (não pode derrubar o processamento da mensagem). O
 * `channel` é um rótulo legível ("WhatsApp", "Instagram", "novo formulário").
 * Retorna `true` se moveu o lead, `false` se nada a fazer.
 */
export async function reactivateLeadOnInbound(
  admin: DbClient,
  leadId: string,
  channel: string,
  ctx: ReactivationContext = {},
): Promise<boolean> {
  try {
    const { data: lead } = await admin
      .from('leads')
      .select('id, name, pipeline, stage, is_archived, is_demo, created_at')
      .eq('id', leadId)
      .maybeSingle();

    const declaredEntry = ctx.declaredEntry ?? false;
    const entryPipeline = ctx.entryPipeline ?? ENTRY_PIPELINE;
    const entryStage = ctx.entryStage ?? ENTRY_STAGE;

    // Lead arquivado (lixo: número inválido / duplicado) não ressuscita.
    if (!lead || lead.is_archived) return false;
    // Já está na fila de entrada do destino → nada a mover.
    if (lead.pipeline === entryPipeline && lead.stage === entryStage) return false;
    if (!shouldReactivate(lead.pipeline, lead.stage, declaredEntry)) return false;

    // Regra dos 15 dias: só reativa se ficamos esse tempo SEM nenhum contato
    // (nenhuma mensagem, de qualquer lado). Conversa recente → relacionamento
    // ativo, não reativa. Sem mensagens, mede a partir da criação do lead.
    // Entrada DECLARADA (novo formulário) pula a janela: preencher um form é
    // intenção explícita mesmo com conversa recente.
    const baseline = (await lastContactAt(admin, leadId)) ?? lead.created_at;
    const silenceMs = Date.now() - new Date(baseline).getTime();
    if (!declaredEntry && silenceMs < SILENCE_DAYS * DAY_MS) return false;
    const silenceDays = Math.max(0, Math.floor(silenceMs / DAY_MS));

    const fromPipeline = lead.pipeline;
    const fromStage = lead.stage;

    // `last_entered_at` marca a REENTRADA: ordena a coluna Novo Lead (lead que
    // voltou vai pro topo mesmo com created_at antigo) e alimenta o "Voltou em"
    // do drawer. `created_at` permanece a primeira entrada.
    const { error } = await admin
      .from('leads')
      .update({
        pipeline: entryPipeline,
        stage: entryStage,
        last_entered_at: new Date().toISOString(),
      })
      .eq('id', leadId);
    if (error) return false;

    const reasonTitle = declaredEntry
      ? `Lead voltou por nova entrada via ${channel}`
      : `Lead reativado após ${silenceDays} dias sem contato`;
    const reasonDescription = declaredEntry
      ? `O lead preencheu uma nova entrada por iniciativa própria via ${channel}. Voltou de ${fromPipeline}/${fromStage} para ${entryPipeline}/${entryStage} — histórico preservado.`
      : `Ficamos ${silenceDays} dias sem nenhuma troca de mensagem com o lead e ele voltou a entrar em contato por iniciativa própria via ${channel}. Voltou de ${fromPipeline}/${fromStage} para ${entryPipeline}/${entryStage} — histórico preservado.`;

    await admin.from('activities').insert([
      {
        lead_id: leadId,
        user_id: null,
        type: 'system',
        title: reasonTitle,
        description: reasonDescription,
        is_demo: lead.is_demo,
        metadata: {
          via: 'reactivation',
          channel,
          declared_entry: declaredEntry,
          conversation_id: ctx.conversationId ?? null,
          silence_days: silenceDays,
          last_contact_at: baseline,
          from_pipeline: fromPipeline,
          from_stage: fromStage,
          to_pipeline: entryPipeline,
          to_stage: entryStage,
        },
      },
      {
        lead_id: leadId,
        user_id: null,
        type: 'stage_change',
        title: `Etapa: ${fromStage} → ${entryStage}`,
        description: declaredEntry
          ? `Reentrada declarada — lead voltou via ${channel}`
          : `Reativação após ${silenceDays} dias sem contato — lead voltou via ${channel}`,
        is_demo: lead.is_demo,
        metadata: {
          from: fromStage,
          to: entryStage,
          from_pipeline: fromPipeline,
          to_pipeline: entryPipeline,
          reactivation: true,
          declared_entry: declaredEntry,
          silence_days: silenceDays,
        },
      },
    ]);

    // Notifica admin. Não dispara p/ demo.
    if (!lead.is_demo) {
      await notifyRoles(
        ['admin'],
        'sistema',
        declaredEntry ? 'Lead voltou por nova entrada' : 'Lead voltou após período sem contato',
        declaredEntry
          ? `${lead.name} voltou via ${channel} (nova entrada declarada)`
          : `${lead.name} voltou via ${channel} após ${silenceDays} dias sem contato`,
        leadId,
      );
    }

    return true;
  } catch {
    // Reativação é side-effect: falha nunca derruba o processamento da mensagem.
    return false;
  }
}

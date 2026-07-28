'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { MAX_ATTEMPTS, slaDeadlineAfter } from '@/lib/sla/rules';
import { CONTACT_CHANNELS, CONTACT_OUTCOMES } from '@/types/lead';
import {
  SDR_CONTACT_RESULTS,
  SDR_CONTACT_RESULT_LABELS,
  type SdrContactResult,
  type SdrContactNextAction,
} from '@/types/sdr-contact';
import type { ActionResult } from './leads';

/**
 * Engine de tentativas de contato da equipe comercial.
 *
 * Regras de negócio:
 *  - attempt_number é sequencial por lead (1..8) — calculado a partir do maior atual.
 *  - sla_deadline é calculado pela tabela em `lib/sla/rules.ts`.
 *  - Toda tentativa gera activity ('call', 'whatsapp' ou 'email', conforme canal).
 *  - Na 8ª tentativa sem resposta (outcome no_answer/busy), o lead vai
 *    automaticamente para a etapa Follow-Up, com activity 'system' indicando o
 *    motivo — a régua de reativação/rematrícula trabalha em cima dessa coluna.
 *  - outcome 'scheduled' NÃO move o lead aqui — quem move é a Server Action
 *    de criação da visita (ver appointments.ts).
 */

const createContactAttemptSchema = z.object({
  leadId: z.string().uuid(),
  channel: z.enum(CONTACT_CHANNELS as unknown as [string, ...string[]]),
  outcome: z.enum(CONTACT_OUTCOMES as unknown as [string, ...string[]]),
  notes: z.string().max(2000).nullable().optional(),
});

export type CreateContactAttemptInput = z.infer<typeof createContactAttemptSchema>;

export interface ContactAttemptResult {
  attemptNumber: number;
  slaDeadline: string | null;
  /** O lead foi movido automaticamente para Follow-Up (8 tentativas sem resposta). */
  movedToReactivation: boolean;
}

type TypedChannel = 'whatsapp' | 'phone' | 'email' | 'instagram' | 'presencial';

const CHANNEL_TO_ACTIVITY: Record<TypedChannel, 'whatsapp' | 'call' | 'email' | 'note'> = {
  whatsapp: 'whatsapp',
  phone: 'call',
  email: 'email',
  instagram: 'note',
  presencial: 'note',
};

const OUTCOME_LABELS: Record<'no_answer' | 'busy' | 'responded' | 'scheduled', string> = {
  no_answer: 'Sem resposta',
  busy: 'Ocupado',
  responded: 'Respondeu',
  scheduled: 'Agendou',
};

/** Etapa de destino quando esgotam as tentativas sem resposta. */
const EXHAUSTED_ATTEMPTS_STAGE = 'follow_up';

export async function createContactAttempt(
  rawInput: unknown,
): Promise<ActionResult<ContactAttemptResult>> {
  const parsed = createContactAttemptSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { leadId, channel, outcome, notes } = parsed.data;

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id, pipeline, stage, is_demo')
    .eq('id', leadId)
    .single();
  if (leadError || !lead) return { ok: false, error: 'Lead não encontrado' };

  // Próximo attempt_number (sequencial por lead).
  const { data: lastAttempt } = await supabase
    .from('contact_attempts')
    .select('attempt_number')
    .eq('lead_id', leadId)
    .order('attempt_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const attemptNumber = (lastAttempt?.attempt_number ?? 0) + 1;
  const slaDeadline = slaDeadlineAfter(attemptNumber);

  const typedChannel = channel as TypedChannel;
  const typedOutcome = outcome as 'no_answer' | 'busy' | 'responded' | 'scheduled';

  const { error: insertError } = await supabase.from('contact_attempts').insert({
    lead_id: leadId,
    created_by: user.id,
    attempt_number: attemptNumber,
    channel: typedChannel,
    outcome: typedOutcome,
    notes: notes ?? null,
    sla_deadline: slaDeadline,
    is_demo: lead.is_demo,
  });
  if (insertError) return { ok: false, error: insertError.message };

  // Activity da tentativa.
  await supabase.from('activities').insert({
    lead_id: leadId,
    user_id: user.id,
    type: CHANNEL_TO_ACTIVITY[typedChannel],
    title: `Tentativa ${attemptNumber}/${MAX_ATTEMPTS} · ${OUTCOME_LABELS[typedOutcome]}`,
    description: notes ?? null,
    is_demo: lead.is_demo,
    metadata: {
      attempt_number: attemptNumber,
      channel: typedChannel,
      outcome: typedOutcome,
      sla_deadline: slaDeadline,
    },
  });

  // Regra: 8ª tentativa sem resposta nem agendamento → etapa Follow-Up.
  let movedToReactivation = false;
  if (
    attemptNumber === MAX_ATTEMPTS &&
    typedOutcome !== 'responded' &&
    typedOutcome !== 'scheduled' &&
    lead.pipeline === 'comercial' &&
    lead.stage !== EXHAUSTED_ATTEMPTS_STAGE
  ) {
    const { error: moveError } = await supabase
      .from('leads')
      .update({ stage: EXHAUSTED_ATTEMPTS_STAGE })
      .eq('id', leadId);

    if (!moveError) {
      movedToReactivation = true;
      await supabase.from('activities').insert({
        lead_id: leadId,
        user_id: user.id,
        type: 'system',
        title: `${MAX_ATTEMPTS} tentativas sem resposta — movido para Follow-Up`,
        description: `Etapa anterior: ${lead.stage} → ${EXHAUSTED_ATTEMPTS_STAGE}`,
        is_demo: lead.is_demo,
        metadata: {
          from_stage: lead.stage,
          to_stage: EXHAUSTED_ATTEMPTS_STAGE,
          reason: 'max_attempts_no_response',
        },
      });
      // Também registra como stage_change para os filtros de timeline.
      await supabase.from('activities').insert({
        lead_id: leadId,
        user_id: user.id,
        type: 'stage_change',
        title: `Etapa: ${lead.stage} → ${EXHAUSTED_ATTEMPTS_STAGE}`,
        description: 'Movido automaticamente após 8 tentativas',
        is_demo: lead.is_demo,
        metadata: {
          from: lead.stage,
          to: EXHAUSTED_ATTEMPTS_STAGE,
          pipeline: lead.pipeline,
        },
      });
    }
  }

  revalidatePath('/oportunidades');
  revalidatePath('/leads');

  return {
    ok: true,
    data: { attemptNumber, slaDeadline, movedToReactivation },
  };
}

/**
 * Próxima etapa quando a equipe registra "Não atendeu": um lead ainda em
 * Novo Lead avança para Primeiro Contato (a primeira tentativa aconteceu).
 * Demais casos mantêm a etapa (retorna null).
 */
function nextStageForNoAnswer(pipeline: string, stage: string): string | null {
  if (pipeline === 'comercial' && stage === 'novo_lead') return 'primeiro_contato';
  return null;
}

const recordSdrContactSchema = z.object({
  leadId: z.string().uuid(),
  result: z.enum(SDR_CONTACT_RESULTS as unknown as [string, ...string[]]),
  notes: z.string().max(2000).nullable().optional(),
});

export interface SdrContactResultData {
  nextAction: SdrContactNextAction;
  movedTo: string | null;
}

// Resultado → outcome de contact_attempt (para SLA/contador). qualified_schedule
// e no_profile transicionam de fluxo (agendamento/perda) e não criam tentativa.
const CONTACT_RESULT_OUTCOME: Record<SdrContactResult, 'no_answer' | 'responded' | null> = {
  no_answer: 'no_answer',
  qualifying: 'responded',
  call_later: 'no_answer',
  qualified_schedule: null,
  no_profile: null,
};

/**
 * Mini-fluxo "Registrar contato" do card do board (funil comercial): registra
 * uma activity com o resultado, atualiza o SLA do card (nova tentativa) quando
 * faz sentido e roteia a etapa. Devolve `nextAction` para a UI abrir o modal de
 * agendamento de visita (qualified_schedule) ou de motivo de perda (no_profile).
 */
export async function recordSdrContact(
  rawInput: unknown,
): Promise<ActionResult<SdrContactResultData>> {
  const parsed = recordSdrContactSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { leadId, notes } = parsed.data;
  const result = parsed.data.result as SdrContactResult;

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id, pipeline, stage, is_demo')
    .eq('id', leadId)
    .single();
  if (leadError || !lead) return { ok: false, error: 'Lead não encontrado' };

  // 1. Tentativa de contato (atualiza SLA + contador) — só para os resultados
  //    que mantêm o lead na fila de atendimento.
  const outcome = CONTACT_RESULT_OUTCOME[result];
  if (outcome) {
    const { data: lastAttempt } = await supabase
      .from('contact_attempts')
      .select('attempt_number')
      .eq('lead_id', leadId)
      .order('attempt_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    const attemptNumber = (lastAttempt?.attempt_number ?? 0) + 1;
    await supabase.from('contact_attempts').insert({
      lead_id: leadId,
      created_by: user.id,
      attempt_number: attemptNumber,
      channel: 'phone',
      outcome,
      notes: notes ?? null,
      sla_deadline: slaDeadlineAfter(attemptNumber),
      is_demo: lead.is_demo,
    });
  }

  // 2. Activity do contato.
  await supabase.from('activities').insert({
    lead_id: leadId,
    user_id: user.id,
    type: 'call',
    title: `Contato: ${SDR_CONTACT_RESULT_LABELS[result]}`,
    description: notes ?? null,
    is_demo: lead.is_demo,
    metadata: { via: 'registrar-contato', result },
  });

  // 3. Roteamento de etapa (apenas "Não atendeu" avança Novo Lead → Primeiro
  //    Contato).
  let movedTo: string | null = null;
  if (result === 'no_answer') {
    const target = nextStageForNoAnswer(lead.pipeline, lead.stage);
    if (target && target !== lead.stage) {
      const { data: stageRow } = await supabase
        .from('pipeline_stages')
        .select('slug')
        .eq('pipeline', lead.pipeline)
        .eq('slug', target)
        .eq('is_active', true)
        .maybeSingle();
      if (stageRow) {
        const { error: moveError } = await supabase
          .from('leads')
          .update({ stage: target })
          .eq('id', leadId);
        if (!moveError) {
          movedTo = target;
          await supabase.from('activities').insert({
            lead_id: leadId,
            user_id: user.id,
            type: 'stage_change',
            title: `Etapa: ${lead.stage} → ${target}`,
            description: 'Registrar contato: sem resposta',
            is_demo: lead.is_demo,
            metadata: { from: lead.stage, to: target, pipeline: lead.pipeline },
          });
        }
      }
    }
  }

  // "Sem interesse": a UI abre o modal de motivo de perda — a decisão de marcar
  // como perdido (e o motivo) é explícita de quem atendeu.
  const nextAction: SdrContactNextAction =
    result === 'qualified_schedule' ? 'schedule' : result === 'no_profile' ? 'lost' : null;

  revalidatePath('/oportunidades');
  revalidatePath('/leads');
  return { ok: true, data: { nextAction, movedTo } };
}

// checkSlaBreaches roda no cron /api/sla/check-breaches (5min) — fora do
// caminho de render do board.

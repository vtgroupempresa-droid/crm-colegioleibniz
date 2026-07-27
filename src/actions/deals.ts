'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { notifyRoles } from './notifications';
import {
  LOST_REASONS,
  EDUCATION_LEVELS,
  type EducationLevel,
  type LostReason,
} from '@/types/lead';
import { CALL_NEXT_ACTIONS, type CallNextAction } from '@/types/deal';
import type { ActionResult } from './leads';

/**
 * Fluxo de fechamento de matrícula:
 *  - `closeDeal` registra a matrícula em `deals`, move o lead para
 *    `cliente_fechado` e registra activities + notificação para os admins.
 *  - `markLost` exige motivo do enum (proibido texto livre). `numero_invalido`
 *    ARQUIVA o lead (lixo). Os demais movem para o stage `perdido` — o lead
 *    permanece consultável para campanhas futuras de reativação.
 */

const PAYMENT_METHODS = ['pix', 'boleto', 'cartao_credito', 'transferencia', 'dinheiro'] as const;

const closeDealSchema = z.object({
  leadId: z.string().uuid(),
  /** Nome do aluno matriculado (default: nome do filho no cadastro do lead). */
  studentName: z.string().min(1, 'Informe o nome do aluno').max(200),
  educationLevel: z.enum(EDUCATION_LEVELS as unknown as [string, ...string[]], {
    errorMap: () => ({ message: 'Selecione o nível de ensino' }),
  }),
  schoolYear: z.string().min(1, 'Informe o ano escolar').max(60),
  /** Ano letivo da matrícula (ex.: "2027"). */
  enrollmentYear: z.string().regex(/^\d{4}$/, 'Ano letivo inválido'),
  /** Valor total (anuidade). */
  contractValue: z.number().nonnegative(),
  monthlyValue: z.number().nonnegative().nullable().optional(),
  discountPct: z.number().min(0).max(100).nullable().optional(),
  installments: z.number().int().min(1).max(13).nullable().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  signedAt: z.string().min(1),
  notes: z.string().max(2000).nullable().optional(),
});

export type CloseDealInput = z.infer<typeof closeDealSchema>;

const CALL_NEXT_ACTION_STAGE: Record<Exclude<CallNextAction, 'close_now'>, string> = {
  send_proposal: 'em_negociacao',
  schedule_followup: 'follow_up',
};

const recordCallResultSchema = z.object({
  appointmentId: z.string().uuid(),
  callNotes: z.string().min(1, 'Anote como foi a visita').max(4000),
  nextAction: z.enum(CALL_NEXT_ACTIONS),
});

export type RecordCallResultInput = z.infer<typeof recordCallResultSchema>;

/**
 * Registra o desfecho de uma visita presencial. Marca `showed_up=true`, cria
 * activity com as anotações e move o lead conforme `nextAction`. Quando
 * `nextAction === 'close_now'`, a Server Action NÃO cria a matrícula — apenas
 * registra a visita; o modal de matrícula é disparado pela UI em seguida.
 */
export async function recordCallResult(
  rawInput: unknown,
): Promise<ActionResult<{ leadId: string; nextStage: string | null }>> {
  const parsed = recordCallResultSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { appointmentId, callNotes, nextAction } = parsed.data;

  const { data: apt, error: aptError } = await supabase
    .from('appointments')
    .select('id, lead_id, scheduled_at, is_demo')
    .eq('id', appointmentId)
    .single();
  if (aptError || !apt) return { ok: false, error: 'Visita não encontrada' };

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id, name, stage, is_demo')
    .eq('id', apt.lead_id)
    .single();
  if (leadError || !lead) return { ok: false, error: 'Lead não encontrado' };

  // 1. Marca showed_up=true.
  const { error: updateAptError } = await supabase
    .from('appointments')
    .update({ showed_up: true, status: 'realizado' })
    .eq('id', appointmentId);
  if (updateAptError) return { ok: false, error: updateAptError.message };

  // 2. Move o lead conforme nextAction (close_now mantém o stage).
  let nextStage: string | null = null;
  if (nextAction !== 'close_now') {
    nextStage = CALL_NEXT_ACTION_STAGE[nextAction];
    const fromStage = lead.stage;
    const { error: moveError } = await supabase
      .from('leads')
      .update({ stage: nextStage })
      .eq('id', lead.id);
    if (moveError) return { ok: false, error: moveError.message };

    await supabase.from('activities').insert({
      lead_id: lead.id,
      user_id: user.id,
      type: 'stage_change',
      title: `Etapa: ${fromStage} → ${nextStage}`,
      description: `Desfecho da visita: ${nextAction}`,
      is_demo: lead.is_demo,
      metadata: {
        from: fromStage,
        to: nextStage,
        next_action: nextAction,
        appointment_id: appointmentId,
      },
    });
  }

  // 3. Activity com as anotações da visita.
  await supabase.from('activities').insert({
    lead_id: lead.id,
    user_id: user.id,
    type: 'appointment',
    title: 'Visita realizada',
    description: callNotes,
    is_demo: lead.is_demo,
    metadata: {
      appointment_id: appointmentId,
      scheduled_at: apt.scheduled_at,
      next_action: nextAction,
      showed_up: true,
    },
  });

  revalidatePath('/oportunidades');
  revalidatePath('/leads');
  return { ok: true, data: { leadId: lead.id, nextStage } };
}

const CLOSED_STAGE = 'cliente_fechado';
const LOST_STAGE = 'perdido';

function brl(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value);
}

export async function closeDeal(rawInput: unknown): Promise<ActionResult<{ dealId: string }>> {
  const parsed = closeDealSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const {
    leadId,
    studentName,
    educationLevel,
    schoolYear,
    enrollmentYear,
    contractValue,
    monthlyValue,
    discountPct,
    installments,
    paymentMethod,
    signedAt,
    notes,
  } = parsed.data;

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id, name, email, phone, pipeline, stage, is_demo, assigned_to')
    .eq('id', leadId)
    .single();
  if (leadError || !lead) return { ok: false, error: 'Lead não encontrado' };

  // signed_at vem de um <input type="date"> (só a data). Ancorar ao MEIO-DIA de
  // Brasília evita o off-by-one no dashboard: "2026-06-30" salvo como 00:00Z
  // cairia em 29/06 no fuso BRT (UTC-3); com 12:00-03:00 fica dentro do dia certo.
  const signedDate = /^\d{4}-\d{2}-\d{2}$/.test(signedAt)
    ? new Date(`${signedAt}T12:00:00-03:00`).toISOString()
    : new Date(signedAt).toISOString();

  const { data: deal, error: dealError } = await supabase
    .from('deals')
    .insert({
      lead_id: leadId,
      student_name: studentName,
      education_level: educationLevel as (typeof EDUCATION_LEVELS)[number],
      school_year: schoolYear,
      enrollment_year: enrollmentYear,
      contract_value: contractValue,
      monthly_value: monthlyValue ?? null,
      discount_pct: discountPct ?? null,
      installments: installments ?? null,
      payment_method: paymentMethod ?? null,
      sale_status: 'ativa',
      signed_at: signedDate,
      closed_by: user.id,
      notes: notes ?? null,
      is_demo: lead.is_demo,
    })
    .select('id')
    .single();
  if (dealError || !deal)
    return { ok: false, error: dealError?.message ?? 'Falha ao salvar a matrícula' };

  // Mantém os dados do aluno no cadastro do lead em sincronia com a matrícula.
  const fromStage = lead.stage;
  const { error: moveError } = await supabase
    .from('leads')
    .update({
      stage: CLOSED_STAGE,
      child_name: studentName,
      education_level: educationLevel as (typeof EDUCATION_LEVELS)[number],
      school_year: schoolYear,
    })
    .eq('id', leadId);
  if (moveError) return { ok: false, error: moveError.message };

  await supabase.from('activities').insert({
    lead_id: leadId,
    user_id: user.id,
    type: 'system',
    title: `Matrícula fechada — ${brl(contractValue)}`,
    description: `${studentName} · ${schoolYear} · ano letivo ${enrollmentYear}`,
    is_demo: lead.is_demo,
    metadata: {
      deal_id: deal.id,
      student_name: studentName,
      education_level: educationLevel,
      school_year: schoolYear,
      enrollment_year: enrollmentYear,
      contract_value: contractValue,
      monthly_value: monthlyValue ?? null,
    },
  });
  await supabase.from('activities').insert({
    lead_id: leadId,
    user_id: user.id,
    type: 'stage_change',
    title: `Etapa: ${fromStage} → ${CLOSED_STAGE}`,
    description: 'Matrícula registrada',
    is_demo: lead.is_demo,
    metadata: { from: fromStage, to: CLOSED_STAGE, deal_id: deal.id },
  });

  // Notifica os admins da matrícula fechada (não dispara para leads demo).
  if (!lead.is_demo) {
    await notifyRoles(
      ['admin'],
      'matricula_fechada',
      `Matrícula fechada: ${lead.name}`,
      `${studentName} · ${schoolYear} · ${brl(contractValue)}`,
      leadId,
    );
  }

  revalidatePath('/oportunidades');
  revalidatePath('/leads');
  revalidatePath('/dashboard');
  return { ok: true, data: { dealId: deal.id } };
}

const markLostSchema = z.object({
  leadId: z.string().uuid(),
  lostReason: z.enum(LOST_REASONS as unknown as [string, ...string[]]),
  notes: z.string().max(2000).nullable().optional(),
});

export type MarkLostInput = z.infer<typeof markLostSchema>;

/** Reasons que tornam o lead "lixo" — não voltam, vão para arquivamento. */
const TRASH_LOST_REASONS: ReadonlySet<LostReason> = new Set<LostReason>(['numero_invalido']);

export async function markLost(
  rawInput: unknown,
): Promise<ActionResult<{ archived: boolean; movedToReativacao: boolean }>> {
  const parsed = markLostSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { leadId, lostReason, notes } = parsed.data;
  const typedReason = lostReason as LostReason;

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id, pipeline, stage, is_demo')
    .eq('id', leadId)
    .single();
  if (leadError || !lead) return { ok: false, error: 'Lead não encontrado' };

  const goesToTrash = TRASH_LOST_REASONS.has(typedReason);
  const fromStage = lead.stage;

  if (goesToTrash) {
    const { error: archiveError } = await supabase
      .from('leads')
      .update({ is_archived: true, lost_reason: typedReason })
      .eq('id', leadId);
    if (archiveError) return { ok: false, error: archiveError.message };

    await supabase.from('activities').insert({
      lead_id: leadId,
      user_id: user.id,
      type: 'system',
      title: `Perdido: ${typedReason}`,
      description: notes ?? 'Lead arquivado — contato inválido',
      is_demo: lead.is_demo,
      metadata: { lost_reason: typedReason, archived: true, notes: notes ?? null },
    });

    revalidatePath('/oportunidades');
    revalidatePath('/leads');
    return { ok: true, data: { archived: true, movedToReativacao: false } };
  }

  // Caso normal: vai para o stage Perdido (fica disponível para reativação futura).
  const { error: moveError } = await supabase
    .from('leads')
    .update({ stage: LOST_STAGE, lost_reason: typedReason })
    .eq('id', leadId);
  if (moveError) return { ok: false, error: moveError.message };

  await supabase.from('activities').insert({
    lead_id: leadId,
    user_id: user.id,
    type: 'system',
    title: `Perdido: ${typedReason}`,
    description: notes ?? 'Lead marcado como perdido',
    is_demo: lead.is_demo,
    metadata: { lost_reason: typedReason, notes: notes ?? null },
  });
  await supabase.from('activities').insert({
    lead_id: leadId,
    user_id: user.id,
    type: 'stage_change',
    title: `Etapa: ${fromStage} → ${LOST_STAGE}`,
    description: `Motivo: ${typedReason}`,
    is_demo: lead.is_demo,
    metadata: { from: fromStage, to: LOST_STAGE, lost_reason: typedReason },
  });

  revalidatePath('/oportunidades');
  revalidatePath('/leads');
  return { ok: true, data: { archived: false, movedToReativacao: true } };
}

export interface LeadEnrollmentDefaults {
  childName: string | null;
  educationLevel: EducationLevel | null;
  schoolYear: string | null;
}

/**
 * Dados do aluno já cadastrados no lead, para pré-preencher o modal de
 * matrícula. A secretaria confirma em vez de redigitar o que a família já
 * informou no primeiro contato.
 */
export async function getLeadEnrollmentDefaults(
  leadId: string,
): Promise<LeadEnrollmentDefaults | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('leads')
    .select('child_name, education_level, school_year')
    .eq('id', leadId)
    .maybeSingle();
  if (!data) return null;
  return {
    childName: data.child_name,
    educationLevel: data.education_level,
    schoolYear: data.school_year,
  };
}

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  LEAD_QUALIFICATION_NEXT_ACTIONS,
  LEAD_QUALIFICATION_STATUSES,
  type LeadQualificationNextAction,
  type LeadQualificationStatus,
} from '@/types/lead';
import type { ActionResult } from './leads';

const qualificationSchema = z
  .object({
    leadId: z.string().uuid(),
    status: z.enum(LEAD_QUALIFICATION_STATUSES),
    description: z.string().trim().max(2000, 'A descrição aceita no máximo 2.000 caracteres'),
    nextAction: z.enum(LEAD_QUALIFICATION_NEXT_ACTIONS).nullable(),
    nextActionAt: z.string().datetime().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'outro' && !value.description) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['description'],
        message: 'Descreva a situação ao escolher Outro',
      });
    }
    if (!value.nextAction && value.nextActionAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nextActionAt'],
        message: 'Escolha o próximo passo antes de definir uma data',
      });
    }
  });

export interface SaveLeadQualificationInput {
  leadId: string;
  status: LeadQualificationStatus;
  description: string;
  nextAction: LeadQualificationNextAction | null;
  /** ISO 8601 em UTC, ou null quando não existe data de retorno. */
  nextActionAt: string | null;
}

/**
 * Persiste o resumo atual e a activity de histórico pela RPC transacional.
 * A função no banco usa SECURITY INVOKER, portanto RLS e a sessão do usuário
 * continuam obrigatórias — nenhum privilégio administrativo é exposto ao client.
 */
export async function saveLeadQualification(
  rawInput: SaveLeadQualificationInput,
): Promise<ActionResult> {
  const parsed = qualificationSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join(', ') };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { error } = await supabase.rpc('set_lead_qualification', {
    p_lead_id: parsed.data.leadId,
    p_status: parsed.data.status,
    p_note: parsed.data.description || null,
    p_next_action: parsed.data.nextAction,
    p_next_action_at: parsed.data.nextActionAt,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath('/leads');
  revalidatePath('/oportunidades');
  revalidatePath('/calendario');
  return { ok: true, data: undefined };
}

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { FOLLOWUP_DAYS } from '@/types/follow-up';
import type { ActionResult } from './leads';

/**
 * Follow-up tracker do closer (Fase 4).
 *
 * Checkpoints fixos: D+1, D+2, D+7, D+15, D+30 a partir do início da etapa de
 * follow-up (após a call principal). Cada checkpoint é uma activity do tipo
 * `note` com `metadata: { followup_day: number }` — não há tabela dedicada
 * pra preservar a timeline coesa.
 */

const recordFollowUpSchema = z.object({
  leadId: z.string().uuid(),
  day: z.number().int(),
  notes: z.string().max(2000).nullable().optional(),
});

export type RecordFollowUpInput = z.infer<typeof recordFollowUpSchema>;

export async function recordFollowUp(rawInput: unknown): Promise<ActionResult> {
  const parsed = recordFollowUpSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }
  const { leadId, day, notes } = parsed.data;
  if (!(FOLLOWUP_DAYS as readonly number[]).includes(day)) {
    return { ok: false, error: 'Dia de follow-up inválido' };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { data: lead } = await supabase
    .from('leads')
    .select('is_demo')
    .eq('id', leadId)
    .maybeSingle();

  const { error } = await supabase.from('activities').insert({
    lead_id: leadId,
    user_id: user.id,
    type: 'note',
    title: `Follow-up D+${day} realizado`,
    description: notes ?? null,
    is_demo: lead?.is_demo ?? false,
    metadata: { followup_day: day },
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/oportunidades');
  revalidatePath('/leads');
  return { ok: true, data: undefined };
}

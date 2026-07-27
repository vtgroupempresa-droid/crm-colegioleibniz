'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSession, isAdmin } from '@/lib/auth/session';
import type { ActionResult } from './leads';

const noteSchema = z.object({
  leadId: z.string().uuid(),
  text: z.string().min(1, 'Nota não pode ser vazia').max(2000),
});

const updateNoteSchema = z.object({
  activityId: z.string().uuid(),
  text: z.string().min(1, 'Nota não pode ser vazia').max(2000),
});

export async function addNote(rawInput: unknown): Promise<ActionResult> {
  const parsed = noteSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { data: lead } = await supabase
    .from('leads')
    .select('is_demo')
    .eq('id', parsed.data.leadId)
    .maybeSingle();

  const { error } = await supabase.from('activities').insert({
    lead_id: parsed.data.leadId,
    user_id: user.id,
    type: 'note',
    title: 'Nota manual',
    description: parsed.data.text,
    is_demo: lead?.is_demo ?? false,
    metadata: {},
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/leads`);
  return { ok: true, data: undefined };
}

/**
 * Edita o texto de uma nota manual (activity type='note'). Só o autor da nota
 * ou um admin pode editar. Usa admin client porque `activities` não tem policy
 * de UPDATE (a edição é autorizada aqui, no servidor, não pela RLS).
 */
export async function updateNote(rawInput: unknown): Promise<ActionResult> {
  const parsed = updateNoteSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const session = await getSession();
  if (!session) return { ok: false, error: 'Não autenticado' };

  const admin = createAdminClient();
  const { data: activity } = await admin
    .from('activities')
    .select('id, user_id, type')
    .eq('id', parsed.data.activityId)
    .maybeSingle();

  if (!activity || activity.type !== 'note') {
    return { ok: false, error: 'Nota não encontrada' };
  }
  if (activity.user_id !== session.userId && !isAdmin(session.role)) {
    return { ok: false, error: 'Você só pode editar suas próprias notas' };
  }

  const { error } = await admin
    .from('activities')
    .update({ description: parsed.data.text })
    .eq('id', parsed.data.activityId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/leads');
  revalidatePath('/oportunidades');
  return { ok: true, data: undefined };
}

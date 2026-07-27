'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSession, isAdmin } from '@/lib/auth/session';
import type { Tables } from '@/types/database';
import type { ActionResult } from './leads';

export type UserGoal = Tables<'user_goals'>;

/**
 * Metas individuais mensais (Categoria 5). RLS: cada usuário lê a própria
 * meta; admin lê e escreve todas (policies da migration 057).
 */

export async function listUserGoals(mes: number, ano: number): Promise<UserGoal[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('user_goals')
    .select('*')
    .eq('mes', mes)
    .eq('ano', ano);
  return (data ?? []) as UserGoal[];
}

const upsertGoalSchema = z.object({
  userId: z.string().uuid('Usuário inválido'),
  mes: z.number().int().min(1).max(12),
  ano: z.number().int().min(2020).max(2100),
  metaVendas: z.number().min(0).default(0),
  metaFaturamento: z.number().min(0).default(0),
  metaAgendamentos: z.number().min(0).default(0),
});

export async function upsertUserGoal(rawInput: unknown): Promise<ActionResult<undefined>> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Não autenticado' };
  if (!isAdmin(session.role)) return { ok: false, error: 'Acesso restrito a administradores' };

  const parsed = upsertGoalSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }
  const { userId, mes, ano, metaVendas, metaFaturamento, metaAgendamentos } = parsed.data;

  const supabase = createClient();
  const { error } = await supabase.from('user_goals').upsert(
    {
      user_id: userId,
      mes,
      ano,
      meta_vendas: metaVendas,
      meta_faturamento: metaFaturamento,
      meta_agendamentos: metaAgendamentos,
      created_by: session.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,mes,ano' },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin');
  revalidatePath('/dashboard/performance-individual');
  return { ok: true, data: undefined };
}

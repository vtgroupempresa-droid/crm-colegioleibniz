'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { Json } from '@/types/database';
import type { DashboardConfig } from '@/types/dashboard';
import type { ActionResult } from './leads';

/**
 * Metas e investimentos por mês (Fase 6). Lidos pelo Dashboard CEO para as
 * barras de meta e os KPIs de CAC/ROAS. Escrita restrita a admin/CEO (RLS +
 * checagem aqui). Uma linha por (mes, ano) — upsert via constraint única.
 */

/** Leitura usada pelo formulário do /admin ao trocar de mês. */
export async function getDashboardConfig(
  mes: number,
  ano: number,
): Promise<DashboardConfig | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('dashboard_config')
    .select('*')
    .eq('mes', mes)
    .eq('ano', ano)
    .maybeSingle();
  return data ?? null;
}

const upsertSchema = z.object({
  mes: z.number().int().min(1).max(12),
  ano: z.number().int().min(2020).max(2100),
  meta_leads: z.number().nonnegative(),
  meta_agendamentos: z.number().nonnegative(),
  meta_vendas: z.number().nonnegative(),
  meta_faturamento: z.number().nonnegative(),
  investimento_total_ads: z.number().nonnegative(),
  investimento_por_canal: z.record(z.string(), z.number().nonnegative()),
});

export async function upsertDashboardConfig(rawInput: unknown): Promise<ActionResult> {
  const parsed = upsertSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { data: me } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (me?.role !== 'admin') {
    return { ok: false, error: 'Apenas o admin pode editar metas e investimentos' };
  }

  const { investimento_por_canal, ...rest } = parsed.data;
  const { error } = await supabase.from('dashboard_config').upsert(
    {
      ...rest,
      investimento_por_canal: investimento_por_canal as Json,
      created_by: user.id,
    },
    { onConflict: 'mes,ano' },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin');
  revalidatePath('/dashboard');
  return { ok: true, data: undefined };
}

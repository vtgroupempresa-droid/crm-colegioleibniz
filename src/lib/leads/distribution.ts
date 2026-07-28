import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type DbClient = SupabaseClient<Database>;

/**
 * Distribuição automática de leads novos — round-robin por MENOR CARGA.
 *
 * Regra do Leibniz: sem faixas de score. Todo lead novo vai para o membro da
 * equipe comercial com MENOS leads ativos (pipeline comercial, não arquivado,
 * fora das etapas terminais). Se não houver ninguém com cargo `comercial`
 * cadastrado, cai para qualquer usuário (admin) — o lead nunca fica órfão por
 * falta de equipe.
 */

export interface LeadAssignment {
  assignedTo: string | null;
  assignedName: string | null;
}

export async function assignLeadRoundRobin(admin: DbClient): Promise<LeadAssignment> {
  const { data: profiles } = await admin.from('user_profiles').select('id, name, role');
  const all = profiles ?? [];
  if (all.length === 0) return { assignedTo: null, assignedName: null };

  const pool = all.filter((p) => p.role === 'comercial');
  const candidates = pool.length > 0 ? pool : all;

  // Etapas terminais não contam como carga (matrícula fechada / perdido).
  const { data: terminalStages } = await admin
    .from('pipeline_stages')
    .select('slug')
    .eq('pipeline', 'comercial')
    .eq('is_terminal', true);
  const terminalSlugs = (terminalStages ?? []).map((s) => s.slug);

  let query = admin
    .from('leads')
    .select('assigned_to')
    .eq('pipeline', 'comercial')
    .eq('is_archived', false)
    .not('assigned_to', 'is', null);
  if (terminalSlugs.length > 0) {
    query = query.not('stage', 'in', `(${terminalSlugs.join(',')})`);
  }
  const { data: activeLeads } = await query;

  const load = new Map<string, number>();
  for (const c of candidates) load.set(c.id, 0);
  for (const row of activeLeads ?? []) {
    if (row.assigned_to && load.has(row.assigned_to)) {
      load.set(row.assigned_to, (load.get(row.assigned_to) ?? 0) + 1);
    }
  }

  let chosen = candidates[0]!;
  let best = load.get(chosen.id) ?? 0;
  for (const c of candidates) {
    const n = load.get(c.id) ?? 0;
    if (n < best) {
      chosen = c;
      best = n;
    }
  }

  return { assignedTo: chosen.id, assignedName: chosen.name };
}

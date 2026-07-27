'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSession, isAdmin } from '@/lib/auth/session';
import { mergeLeadsCore } from '@/lib/leads/merge-core';

/**
 * Unificação de leads (Parte 4).
 *
 * A regra de merge (mover histórico, backfill, arquivar secundário, marcar o
 * par em duplicate_candidates) mora em src/lib/leads/merge-core.ts — é
 * compartilhada com scripts de manutenção. Aqui fica só o que é da action:
 * gate de sessão admin e revalidação das rotas.
 */

export interface DuplicateMember {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  score: number;
  created_at: string;
}

export interface DuplicateGroup {
  matchType: 'phone' | 'email';
  matchKey: string;
  members: DuplicateMember[];
}

export interface LeadSearchRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  city: string | null;
  created_at: string;
}

export type MergeResult =
  | { ok: true; primaryId: string; secondaryId: string }
  | { ok: false; error: string; needsConfirmation?: boolean };

/** Grupos de prováveis duplicatas (telefone normalizado / email). */
export async function getDuplicateGroups(): Promise<DuplicateGroup[]> {
  const session = await getSession();
  if (!session || !isAdmin(session.role)) return [];

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('duplicate_lead_groups');
  if (error || !data) return [];

  return data.map((row) => ({
    matchType: row.match_type === 'email' ? 'email' : 'phone',
    matchKey: row.match_key,
    members: (Array.isArray(row.members) ? row.members : []) as unknown as DuplicateMember[],
  }));
}

/** Busca leads por nome/telefone/email para unificação manual. */
export async function searchLeadsForMerge(term: string): Promise<LeadSearchRow[]> {
  const session = await getSession();
  if (!session || !isAdmin(session.role)) return [];

  const q = term.trim();
  if (q.length < 2) return [];

  const admin = createAdminClient();
  const digits = q.replace(/\D/g, '');
  const like = `%${q}%`;
  const orFilters = [`name.ilike.${like}`, `email.ilike.${like}`];
  if (digits.length >= 3) orFilters.push(`phone_normalized.ilike.%${digits}%`);

  const { data } = await admin
    .from('leads')
    .select('id, name, phone, email, instagram, city, created_at')
    .eq('is_archived', false)
    .or(orFilters.join(','))
    .order('created_at', { ascending: false })
    .limit(25);

  return (data ?? []) as LeadSearchRow[];
}

/**
 * Unifica dois leads. Se ambos tiverem deals (negócios fechados), exige
 * confirmação explícita (`force=true`) — evita merge acidental de vendas.
 */
export async function mergeLeads(
  primaryLeadId: string,
  secondaryLeadId: string,
  opts: { force?: boolean } = {},
): Promise<MergeResult> {
  const session = await getSession();
  if (!session || !isAdmin(session.role)) {
    return { ok: false, error: 'Acesso restrito ao admin' };
  }

  const admin = createAdminClient();
  const result = await mergeLeadsCore(admin, primaryLeadId, secondaryLeadId, {
    force: opts.force,
    performer: { userId: session.userId, name: session.name },
  });
  if (!result.ok) return result;

  revalidatePath('/admin');
  revalidatePath('/leads');
  revalidatePath('/oportunidades');
  revalidatePath('/chat');

  return result;
}

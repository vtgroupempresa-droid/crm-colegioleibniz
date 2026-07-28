'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSession, isAdmin } from '@/lib/auth/session';
import {
  SUPPORTING_SIGNAL_LABELS,
  type SupportingSignal,
} from '@/lib/leads/duplicate-detection';

/**
 * Revisão dos candidatos a duplicata por SIMILARIDADE DE NOME (Camadas 2/3 —
 * ver src/lib/leads/duplicate-detection.ts). Os pares vêm da tabela
 * duplicate_candidates, populada pela auditoria (audit-name-duplicates.ts) e
 * pela checagem contínua no ingest. A unificação em si reusa mergeLeads — este
 * módulo só lista os pendentes e marca "não é duplicata".
 */

export interface CandidateLeadInfo {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  pipeline: string;
  stage: string;
  created_at: string;
  activityCount: number;
}

export interface NameSimilarityCandidate {
  id: string;
  confidenceLayer: 2 | 3;
  nameSimilarity: number;
  supportingSignals: SupportingSignal[];
  leadA: CandidateLeadInfo;
  leadB: CandidateLeadInfo;
}

function isSupportingSignal(value: string): value is SupportingSignal {
  return value in SUPPORTING_SIGNAL_LABELS;
}

/**
 * Candidatos pendentes, ordenados por camada (2 primeiro — forte candidato) e
 * similaridade descendente. Pares cujo lead já foi arquivado (ex.: unificado
 * por outro caminho) ficam de fora.
 */
export async function getNameSimilarityCandidates(): Promise<NameSimilarityCandidate[]> {
  const session = await getSession();
  if (!session || !isAdmin(session.role)) return [];

  const admin = createAdminClient();

  const { data: candidates } = await admin
    .from('duplicate_candidates')
    .select('id, lead_a_id, lead_b_id, confidence_layer, name_similarity, supporting_signals')
    .eq('status', 'pendente')
    .order('confidence_layer', { ascending: true })
    .order('name_similarity', { ascending: false })
    .limit(300);
  if (!candidates || candidates.length === 0) return [];

  const leadIds = [...new Set(candidates.flatMap((c) => [c.lead_a_id, c.lead_b_id]))];

  const [{ data: leads }, { data: counts }] = await Promise.all([
    admin
      .from('leads')
      .select('id, name, phone, email, city, state, pipeline, stage, created_at')
      .in('id', leadIds)
      .eq('is_archived', false),
    admin.rpc('count_activities_for_leads', { lead_ids: leadIds }),
  ]);

  const countByLead = new Map((counts ?? []).map((c) => [c.lead_id, c.activity_count]));
  const leadById = new Map(
    (leads ?? []).map((l) => [
      l.id,
      {
        id: l.id,
        name: l.name,
        phone: l.phone,
        email: l.email,
        city: l.city,
        state: l.state,
        pipeline: l.pipeline,
        stage: l.stage,
        created_at: l.created_at,
        activityCount: countByLead.get(l.id) ?? 0,
      } satisfies CandidateLeadInfo,
    ]),
  );

  const result: NameSimilarityCandidate[] = [];
  for (const c of candidates) {
    const leadA = leadById.get(c.lead_a_id);
    const leadB = leadById.get(c.lead_b_id);
    if (!leadA || !leadB) continue; // um dos leads foi arquivado/removido
    result.push({
      id: c.id,
      confidenceLayer: c.confidence_layer === 2 ? 2 : 3,
      nameSimilarity: Number(c.name_similarity),
      supportingSignals: c.supporting_signals.filter(isSupportingSignal),
      leadA,
      leadB,
    });
  }
  return result;
}

export type DismissResult = { ok: true } | { ok: false; error: string };

/** "Não é duplicata": marca o par como ignorado — não volta a aparecer. */
export async function dismissDuplicateCandidate(candidateId: string): Promise<DismissResult> {
  const session = await getSession();
  if (!session || !isAdmin(session.role)) {
    return { ok: false, error: 'Acesso restrito ao admin' };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('duplicate_candidates')
    .update({
      status: 'ignorado',
      reviewed_by: session.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', candidateId)
    .eq('status', 'pendente');
  if (error) return { ok: false, error: `Falha ao ignorar candidato: ${error.message}` };

  revalidatePath('/admin');
  return { ok: true };
}

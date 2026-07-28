import type { SupabaseClient } from '@supabase/supabase-js';
import { mergeTags } from '@/lib/webhooks/tag-rules';
import type { Database } from '@/types/database';
import type { Lead, LeadUpdate } from '@/types/lead';

type DbClient = SupabaseClient<Database>;

/**
 * Núcleo da unificação de leads — compartilhado entre a server action
 * mergeLeads (aba Unificar leads do /admin) e scripts de manutenção que rodam
 * com service role. Toda a regra mora aqui; a action só adiciona o gate de
 * sessão/admin e o revalidatePath.
 *
 * Move TODO o histórico (activities, messages via conversations,
 * contact_attempts, appointments, conversations, deals) do lead secundário
 * para o principal, mantém como principal o mais antigo, faz backfill de
 * contatos/dados do aluno faltantes, arquiva o secundário
 * (is_archived=true, merged_into=principal) e registra a operação.
 */

/** Quem executou a unificação — usuário logado (action) ou script (userId null). */
export interface MergePerformer {
  userId: string | null;
  name: string;
}

export type MergeCoreResult =
  | { ok: true; primaryId: string; secondaryId: string }
  | { ok: false; error: string; needsConfirmation?: boolean };

/**
 * Unifica dois leads. Se ambos tiverem deals (matrículas fechadas), exige
 * confirmação explícita (`force=true`) — evita merge acidental de matrículas.
 */
export async function mergeLeadsCore(
  admin: DbClient,
  primaryLeadId: string,
  secondaryLeadId: string,
  opts: { force?: boolean; performer: MergePerformer },
): Promise<MergeCoreResult> {
  if (primaryLeadId === secondaryLeadId) {
    return { ok: false, error: 'Selecione dois leads diferentes' };
  }

  const { data: leads } = await admin
    .from('leads')
    .select('*')
    .in('id', [primaryLeadId, secondaryLeadId]);

  const a = (leads ?? []).find((l) => l.id === primaryLeadId) as Lead | undefined;
  const b = (leads ?? []).find((l) => l.id === secondaryLeadId) as Lead | undefined;
  if (!a || !b) return { ok: false, error: 'Lead não encontrado' };
  if (a.is_archived || b.is_archived) {
    return { ok: false, error: 'Um dos leads já está arquivado' };
  }

  // Mantém como principal o lead mais antigo (preserva a atribuição de origem).
  let primary = a;
  let secondary = b;
  if (b.created_at < a.created_at) {
    primary = b;
    secondary = a;
  }

  // Conflito de matrículas: ambos têm deals → exige confirmação.
  const [{ count: primaryDeals }, { count: secondaryDeals }] = await Promise.all([
    admin.from('deals').select('id', { count: 'exact', head: true }).eq('lead_id', primary.id),
    admin.from('deals').select('id', { count: 'exact', head: true }).eq('lead_id', secondary.id),
  ]);
  if ((primaryDeals ?? 0) > 0 && (secondaryDeals ?? 0) > 0 && !opts.force) {
    return {
      ok: false,
      needsConfirmation: true,
      error:
        'Ambos os leads possuem matrículas registradas. Confirme para unificar mesmo assim — as matrículas serão mantidas no lead principal.',
    };
  }

  // 1. Reassocia o histórico do secundário para o principal. messages migram
  //    junto com conversations (FK conversation_id). Calls explícitas por tabela
  //    para preservar a tipagem do supabase-js (from dinâmico quebra os overloads).
  const moves = await Promise.all([
    admin.from('activities').update({ lead_id: primary.id }).eq('lead_id', secondary.id),
    admin.from('contact_attempts').update({ lead_id: primary.id }).eq('lead_id', secondary.id),
    admin.from('appointments').update({ lead_id: primary.id }).eq('lead_id', secondary.id),
    admin.from('deals').update({ lead_id: primary.id }).eq('lead_id', secondary.id),
    admin.from('conversations').update({ lead_id: primary.id }).eq('lead_id', secondary.id),
  ]);
  const moveError = moves.find((m) => m.error)?.error;
  if (moveError) {
    return { ok: false, error: `Falha ao mover histórico: ${moveError.message}` };
  }

  // 2. Backfill no principal: tags + identificadores/contatos que faltarem.
  const mergedTags = mergeTags(primary.tags ?? [], secondary.tags ?? []);
  const patch: LeadUpdate = { tags: mergedTags };
  if (!primary.phone && secondary.phone) patch.phone = secondary.phone;
  if (!primary.email && secondary.email) patch.email = secondary.email;
  if (!primary.instagram && secondary.instagram) patch.instagram = secondary.instagram;
  if (!primary.instagram_user_id && secondary.instagram_user_id)
    patch.instagram_user_id = secondary.instagram_user_id;
  if (!primary.facebook_user_id && secondary.facebook_user_id)
    patch.facebook_user_id = secondary.facebook_user_id;
  if (!primary.city && secondary.city) patch.city = secondary.city;
  if (!primary.state && secondary.state) patch.state = secondary.state;
  // Dados do aluno: copia do secundário quando o principal está vazio.
  // `== null` (não `!`) porque 0 é valor válido de idade (bebês em meses).
  if (!primary.child_name && secondary.child_name) patch.child_name = secondary.child_name;
  if (primary.child_age == null && secondary.child_age != null)
    patch.child_age = secondary.child_age;
  if (!primary.education_level && secondary.education_level)
    patch.education_level = secondary.education_level;
  if (!primary.school_year && secondary.school_year) patch.school_year = secondary.school_year;
  if (primary.with_child == null && secondary.with_child != null)
    patch.with_child = secondary.with_child;
  if (!primary.interest_level && secondary.interest_level)
    patch.interest_level = secondary.interest_level;
  await admin.from('leads').update(patch).eq('id', primary.id);

  // 3. Arquiva o secundário apontando para o principal.
  await admin
    .from('leads')
    .update({ is_archived: true, merged_into: primary.id })
    .eq('id', secondary.id);

  // 3b. Se o par estava pendente em duplicate_candidates (detecção por
  //     similaridade de nome), marca como unificado com o revisor.
  const pairA = primary.id < secondary.id ? primary.id : secondary.id;
  const pairB = primary.id < secondary.id ? secondary.id : primary.id;
  await admin
    .from('duplicate_candidates')
    .update({
      status: 'unificado',
      reviewed_by: opts.performer.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('lead_a_id', pairA)
    .eq('lead_b_id', pairB)
    .eq('status', 'pendente');

  // 4. Registra a unificação no principal.
  await admin.from('activities').insert({
    lead_id: primary.id,
    user_id: opts.performer.userId,
    type: 'system',
    title: 'Leads unificados',
    description: `Lead "${secondary.name}" unificado neste registro (por ${opts.performer.name}).`,
    is_demo: false,
    metadata: {
      merged_from: secondary.id,
      merged_from_name: secondary.name,
    },
  });

  return { ok: true, primaryId: primary.id, secondaryId: secondary.id };
}

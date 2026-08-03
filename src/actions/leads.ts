'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { normalizePhone } from '@/lib/leads/identity';
import { validateRequiredFields } from '@/lib/leads/validators';
import { notifyLeadCreated } from '@/actions/notifications';
import {
  EDUCATION_LEVELS,
  INTEREST_LEVELS,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  LOST_REASONS,
  type Lead,
  type LeadInsert,
  type LeadSource,
  type LeadUpdate,
} from '@/types/lead';
import { PIPELINES, type PipelineKind } from '@/types/pipeline';
import {
  listAssignableUsers as listAssignableUsersQuery,
  type AssignableUser,
} from './leads-queries';

/**
 * Server Actions para leads. Regra de ouro do projeto:
 *  - Toda mudança de stage gera activity (type='stage_change').
 *  - Mutações nunca acontecem do client direto — sempre passam por aqui.
 *  - Distribuição de leads: round-robin entre a equipe (quem tem menos leads
 *    ativos recebe o próximo), a menos que o formulário indique um responsável.
 */

/**
 * Wrapper Server Action de listAssignableUsers. A implementação vive em
 * leads-queries.ts, que é `server-only` e NÃO pode ser importada por Client
 * Components (quebra o build). Server Components chamam a query direto; o card e o
 * LeadDrawer (client) usam esta Server Action.
 */
export async function listAssignableUsers(): Promise<AssignableUser[]> {
  return listAssignableUsersQuery();
}

// ============================================================================
// Schemas Zod
// ============================================================================

const enumOrNull = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).nullable().optional();

const createLeadSchema = z.object({
  name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  phone: z.string().min(8, 'Telefone obrigatório'),
  source: z.enum(LEAD_SOURCES as unknown as [string, ...string[]]),
  email: z.string().email().nullable().optional().or(z.literal('')),
  instagram: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  // Qualificação escolar
  interest_level: enumOrNull(INTEREST_LEVELS as unknown as [string, ...string[]]),
  with_child: z.boolean().nullable().optional(),
  child_name: z.string().nullable().optional(),
  child_age: z.number().int().min(0).max(25).nullable().optional(),
  budget: z
    .number()
    .finite()
    .min(0, 'O orçamento não pode ser negativo')
    .max(9_999_999_999.99, 'Orçamento acima do limite permitido')
    .nullable()
    .optional(),
  education_level: enumOrNull(EDUCATION_LEVELS as unknown as [string, ...string[]]),
  school_year: z.string().nullable().optional(),
  // Atribuição
  utm_source: z.string().nullable().optional(),
  utm_medium: z.string().nullable().optional(),
  utm_campaign: z.string().nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
});

const updateLeadSchema = createLeadSchema.partial().extend({
  lost_reason: enumOrNull(LOST_REASONS as unknown as [string, ...string[]]),
  is_no_show: z.boolean().optional(),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; missing?: readonly string[] };

// ============================================================================
// Helpers
// ============================================================================

async function entryStageFor(pipeline: PipelineKind): Promise<string> {
  const supabase = createClient();
  const { data } = await supabase
    .from('pipeline_stages')
    .select('slug')
    .eq('pipeline', pipeline)
    .eq('is_entry', true)
    .order('position')
    .limit(1)
    .maybeSingle();

  return data?.slug ?? 'novo_lead';
}

/**
 * Round-robin da equipe: devolve o usuário com MENOS leads ativos (não
 * arquivados, fora dos stages terminais) no pipeline comercial. Toda a equipe
 * (admin + comercial) participa; se não houver ninguém, devolve null.
 */
async function assignLeadRoundRobin(
  isDemo: boolean,
): Promise<{ assignedTo: string | null; assignedName: string | null }> {
  const supabase = createClient();
  const { data: users } = await supabase.from('user_profiles').select('id, name');
  if (!users || users.length === 0) return { assignedTo: null, assignedName: null };

  const { data: activeLeads } = await supabase
    .from('leads')
    .select('assigned_to')
    .eq('pipeline', 'comercial')
    .eq('is_archived', false)
    .eq('is_demo', isDemo)
    .not('stage', 'in', '(cliente_fechado,perdido)')
    .not('assigned_to', 'is', null);

  const counts = new Map<string, number>();
  for (const u of users) counts.set(u.id, 0);
  for (const row of activeLeads ?? []) {
    if (row.assigned_to && counts.has(row.assigned_to)) {
      counts.set(row.assigned_to, (counts.get(row.assigned_to) ?? 0) + 1);
    }
  }

  let winner = users[0];
  let winnerCount = Number.POSITIVE_INFINITY;
  for (const u of users) {
    const c = counts.get(u.id) ?? 0;
    if (c < winnerCount) {
      winner = u;
      winnerCount = c;
    }
  }
  return { assignedTo: winner?.id ?? null, assignedName: winner?.name ?? null };
}

function nullifyEmptyStrings<T extends Record<string, unknown>>(input: T): T {
  const result = { ...input };
  for (const key of Object.keys(result)) {
    if (result[key] === '') {
      (result as Record<string, unknown>)[key] = null;
    }
  }
  return result;
}

function revalidatePipelines() {
  revalidatePath('/leads');
  revalidatePath('/oportunidades');
}

// ============================================================================
// CRUD
// ============================================================================

export async function createLead(
  rawInput: unknown,
  opts: { isDemo?: boolean } = {},
): Promise<ActionResult<{ id: string; name: string }>> {
  const parsed = createLeadSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const clean = nullifyEmptyStrings(parsed.data);
  const isDemo = opts.isDemo ?? false;

  // Responsável: o formulário pode indicar; sem indicação, round-robin da equipe.
  let assignedTo: string | null = clean.assigned_to ?? null;
  let assignedName: string | null = null;
  if (!assignedTo) {
    const assignment = await assignLeadRoundRobin(isDemo);
    assignedTo = assignment.assignedTo;
    assignedName = assignment.assignedName;
  }

  const pipeline: PipelineKind = 'comercial';
  const stage = await entryStageFor(pipeline);

  const insert: LeadInsert = {
    name: clean.name,
    phone: clean.phone,
    phone_normalized: normalizePhone(clean.phone),
    email: clean.email ?? null,
    instagram: clean.instagram ?? null,
    city: clean.city ?? null,
    state: clean.state ?? null,
    interest_level: (clean.interest_level ?? null) as Lead['interest_level'],
    with_child: clean.with_child ?? null,
    child_name: clean.child_name ?? null,
    child_age: clean.child_age ?? null,
    budget: clean.budget ?? null,
    education_level: (clean.education_level ?? null) as Lead['education_level'],
    school_year: clean.school_year ?? null,
    source: clean.source as Lead['source'],
    utm_source: clean.utm_source ?? null,
    utm_medium: clean.utm_medium ?? null,
    utm_campaign: clean.utm_campaign ?? null,
    pipeline,
    stage,
    assigned_to: assignedTo,
    is_demo: isDemo,
  };

  const { data: created, error } = await supabase
    .from('leads')
    .insert(insert)
    .select('id, name')
    .single();

  if (error || !created) {
    return { ok: false, error: error?.message ?? 'Falha ao criar lead' };
  }

  await supabase.from('activities').insert({
    lead_id: created.id,
    user_id: user.id,
    type: 'system',
    title: 'Lead criado',
    description: `Origem: ${LEAD_SOURCE_LABELS[clean.source as LeadSource]}`,
    is_demo: isDemo,
    metadata: { pipeline, stage, source: clean.source },
  });

  if (assignedName) {
    await supabase.from('activities').insert({
      lead_id: created.id,
      user_id: user.id,
      type: 'system',
      title: 'Distribuição automática',
      description: `Distribuído automaticamente para ${assignedName} (round-robin da equipe).`,
      is_demo: isDemo,
      metadata: { assigned_to: assignedTo, assigned_name: assignedName },
    });
  }

  await notifyLeadCreated({
    leadId: created.id,
    name: created.name,
    assignedTo,
    sourceLabel: LEAD_SOURCE_LABELS[clean.source as LeadSource],
    isDemo,
  });

  revalidatePipelines();
  return { ok: true, data: { id: created.id, name: created.name } };
}

export async function updateLead(id: string, rawInput: unknown): Promise<ActionResult> {
  const parsed = updateLeadSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { data: current, error: fetchError } = await supabase
    .from('leads')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !current) {
    return { ok: false, error: 'Lead não encontrado' };
  }

  const updates = nullifyEmptyStrings(parsed.data) as LeadUpdate;
  if (typeof updates.phone === 'string') {
    updates.phone_normalized = normalizePhone(updates.phone);
  }

  const { error: updateError } = await supabase.from('leads').update(updates).eq('id', id);
  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  revalidatePipelines();
  return { ok: true, data: undefined };
}

// ============================================================================
// Movimentação de stage (drag-and-drop do Kanban)
// ============================================================================

/**
 * Move um lead de stage.
 *
 * Comportamento dos required_fields: **soft warning, não hard block**.
 * Se o `force=false` (default) e houver campos faltantes, retorna `ok:false` com
 * `missing` populado — a UI mostra o modal de confirmação. Se o usuário escolher
 * "Avançar mesmo assim", a UI chama de novo com `force=true`. Nesse caso o move
 * acontece E uma activity 'system' registra quais campos estavam vazios, para
 * preservar o rastreamento sem travar a operação.
 *
 * Para stages terminais que exigem `lost_reason`, o bloqueio continua hard (sem
 * lost_reason não há para onde forçar).
 */
const HARD_BLOCK_FIELDS: ReadonlySet<string> = new Set(['lost_reason']);

/**
 * Sentinela em required_fields: stage que SÓ é alcançável criando um agendamento
 * de visita (via createAppointment). Um move "seco" para esse stage é bloqueado
 * HARD — nem com force — para que nenhum lead fique em 'visita_presencial' sem
 * visita cadastrada. (Ativável adicionando 'appointment_required' ao stage.)
 */
const APPOINTMENT_REQUIRED = 'appointment_required';

export async function moveLeadStage(
  id: string,
  newStage: string,
  force = false,
): Promise<ActionResult<{ stage: string }>> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { data: lead, error: fetchError } = await supabase
    .from('leads')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !lead) {
    return { ok: false, error: 'Lead não encontrado' };
  }

  if (lead.stage === newStage) {
    return { ok: true, data: { stage: newStage } };
  }

  const { data: targetStage, error: stageError } = await supabase
    .from('pipeline_stages')
    .select('slug, name, required_fields')
    .eq('pipeline', lead.pipeline)
    .eq('slug', newStage)
    .maybeSingle();

  if (stageError || !targetStage) {
    return { ok: false, error: 'Stage inválido para este pipeline' };
  }

  // Bloqueio HARD de visita: este stage não é alcançável por move direto —
  // a visita é cadastrada no modal de agendamento (createAppointment).
  if (targetStage.required_fields.includes(APPOINTMENT_REQUIRED)) {
    return {
      ok: false,
      error: 'Registre a visita (data + responsável) para mover o lead para esta etapa.',
      missing: [APPOINTMENT_REQUIRED],
    };
  }

  const validation = validateRequiredFields(lead, targetStage.required_fields);
  if (!validation.ok) {
    // Bloqueio HARD continua quando o campo é estruturalmente obrigatório (motivo de perda).
    const hardBlocked = validation.missing.filter((m) => HARD_BLOCK_FIELDS.has(m));
    if (hardBlocked.length > 0) {
      return {
        ok: false,
        error: `Campos obrigatórios em falta: ${hardBlocked.join(', ')}`,
        missing: hardBlocked,
      };
    }
    // Soft block: sem force, devolve a lista para a UI mostrar confirmação.
    if (!force) {
      return {
        ok: false,
        error: `Atenção: ${validation.missing.join(', ')} ainda não preenchidos`,
        missing: validation.missing,
      };
    }
  }

  const { error: updateError } = await supabase
    .from('leads')
    .update({ stage: newStage })
    .eq('id', id);

  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  await supabase.from('activities').insert({
    lead_id: id,
    user_id: user.id,
    type: 'stage_change',
    title: `Etapa: ${lead.stage} → ${newStage}`,
    description: `Movido para "${targetStage.name}"`,
    is_demo: lead.is_demo,
    metadata: { from: lead.stage, to: newStage, pipeline: lead.pipeline },
  });

  // Se foi forçado com campos pendentes, registra activity 'system' para rastreio.
  if (force && !validation.ok && validation.missing.length > 0) {
    const pendingFields: string[] = [...validation.missing];
    await supabase.from('activities').insert({
      lead_id: id,
      user_id: user.id,
      type: 'system',
      title: 'Etapa avançada com campos pendentes',
      description: `Campos não preenchidos: ${pendingFields.join(', ')}`,
      is_demo: lead.is_demo,
      metadata: {
        from: lead.stage,
        to: newStage,
        pipeline: lead.pipeline,
        pending_fields: pendingFields,
      },
    });
  }

  revalidatePipelines();
  return { ok: true, data: { stage: newStage } };
}

/**
 * Move VÁRIOS leads de uma vez para o mesmo stage (seleção múltipla no board).
 * Todos os leads pertencem ao mesmo pipeline (são do mesmo board). Avança por
 * cima de pendências soft quando `force`; pula — e reporta — os que exigem campo
 * estrutural (motivo de perda), que precisam ser movidos um a um. Retorna quantos
 * moveu e a lista dos pulados.
 */
export async function moveLeadsStage(
  ids: string[],
  newStage: string,
  force = false,
): Promise<
  ActionResult<{ moved: number; skipped: { id: string; name: string; reason: string }[] }>
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
  if (uniqueIds.length === 0) return { ok: false, error: 'Nenhum lead selecionado' };

  const { data: leads, error: fetchError } = await supabase
    .from('leads')
    .select('*')
    .in('id', uniqueIds);
  const firstLead = leads?.[0];
  if (fetchError || !leads || !firstLead) {
    return { ok: false, error: 'Leads não encontrados' };
  }

  const pipeline = firstLead.pipeline;
  const { data: targetStage, error: stageError } = await supabase
    .from('pipeline_stages')
    .select('slug, name, required_fields')
    .eq('pipeline', pipeline)
    .eq('slug', newStage)
    .maybeSingle();
  if (stageError || !targetStage) {
    return { ok: false, error: 'Stage inválido para este pipeline' };
  }

  // Visita não é movimentação em lote: cada lead precisa da sua visita agendada.
  if (targetStage.required_fields.includes(APPOINTMENT_REQUIRED)) {
    return {
      ok: false,
      error: 'Agende cada lead individualmente (data + responsável) para esta etapa.',
    };
  }

  const skipped: { id: string; name: string; reason: string }[] = [];
  const toMove: typeof leads = [];
  for (const lead of leads) {
    if (lead.pipeline !== pipeline) {
      skipped.push({ id: lead.id, name: lead.name, reason: 'pipeline diferente' });
      continue;
    }
    if (lead.stage === newStage) continue; // já está lá — silencioso
    const validation = validateRequiredFields(lead, targetStage.required_fields);
    if (!validation.ok) {
      const hardBlocked = validation.missing.filter((m) => HARD_BLOCK_FIELDS.has(m));
      if (hardBlocked.length > 0) {
        skipped.push({
          id: lead.id,
          name: lead.name,
          reason: `precisa preencher ${hardBlocked.join(', ')} — mova individualmente`,
        });
        continue;
      }
      if (!force) {
        skipped.push({ id: lead.id, name: lead.name, reason: validation.missing.join(', ') });
        continue;
      }
    }
    toMove.push(lead);
  }

  if (toMove.length === 0) {
    return { ok: false, error: 'Nenhum lead pôde ser movido', missing: skipped.map((s) => s.id) };
  }

  const moveIds = toMove.map((l) => l.id);
  const { error: updateError } = await supabase
    .from('leads')
    .update({ stage: newStage })
    .in('id', moveIds);
  if (updateError) return { ok: false, error: updateError.message };

  await supabase.from('activities').insert(
    toMove.map((lead) => ({
      lead_id: lead.id,
      user_id: user.id,
      type: 'stage_change' as const,
      title: `Etapa: ${lead.stage} → ${newStage}`,
      description: `Movido para "${targetStage.name}" (em lote)`,
      is_demo: lead.is_demo,
      metadata: { from: lead.stage, to: newStage, pipeline: lead.pipeline, bulk: true },
    })),
  );

  revalidatePipelines();
  return { ok: true, data: { moved: toMove.length, skipped } };
}

/**
 * Move VÁRIOS leads para OUTRO pipeline (e coluna) de uma vez — o botão "Mover"
 * do board, quando há leads selecionados. Diferente de moveLeadsStage, troca
 * `pipeline` + `stage` para o destino escolhido. Mesmas regras de bloqueio: pula
 * (reportando) quem exige campo estrutural (motivo de perda); com `force` avança
 * por cima de pendências soft. Move dentro do mesmo pipeline também (escolhendo
 * qualquer coluna). Não reatribui responsável.
 */
export async function moveLeadsToPipeline(
  ids: string[],
  targetPipeline: PipelineKind,
  targetStage: string,
  force = false,
): Promise<
  ActionResult<{ moved: number; skipped: { id: string; name: string; reason: string }[] }>
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  if (!PIPELINES.includes(targetPipeline)) {
    return { ok: false, error: 'Pipeline inválido' };
  }

  const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
  if (uniqueIds.length === 0) return { ok: false, error: 'Nenhum lead selecionado' };

  const { data: targetStageRow, error: stageError } = await supabase
    .from('pipeline_stages')
    .select('slug, name, required_fields')
    .eq('pipeline', targetPipeline)
    .eq('slug', targetStage)
    .eq('is_active', true)
    .maybeSingle();
  if (stageError || !targetStageRow) {
    return { ok: false, error: 'Coluna inválida para o pipeline escolhido' };
  }

  const { data: leads, error: fetchError } = await supabase
    .from('leads')
    .select('*')
    .in('id', uniqueIds);
  if (fetchError || !leads || leads.length === 0) {
    return { ok: false, error: 'Leads não encontrados' };
  }

  const skipped: { id: string; name: string; reason: string }[] = [];
  const toMove: typeof leads = [];
  for (const lead of leads) {
    if (lead.pipeline === targetPipeline && lead.stage === targetStage) continue; // já está lá
    const validation = validateRequiredFields(lead, targetStageRow.required_fields);
    if (!validation.ok) {
      const hardBlocked = validation.missing.filter((m) => HARD_BLOCK_FIELDS.has(m));
      if (hardBlocked.length > 0) {
        skipped.push({
          id: lead.id,
          name: lead.name,
          reason: `precisa preencher ${hardBlocked.join(', ')} — mova individualmente`,
        });
        continue;
      }
      if (!force) {
        skipped.push({ id: lead.id, name: lead.name, reason: validation.missing.join(', ') });
        continue;
      }
    }
    toMove.push(lead);
  }

  if (toMove.length === 0) {
    return { ok: false, error: 'Nenhum lead pôde ser movido', missing: skipped.map((s) => s.id) };
  }

  const moveIds = toMove.map((l) => l.id);
  const { error: updateError } = await supabase
    .from('leads')
    .update({ pipeline: targetPipeline, stage: targetStage })
    .in('id', moveIds);
  if (updateError) return { ok: false, error: updateError.message };

  await supabase.from('activities').insert(
    toMove.map((lead) => ({
      lead_id: lead.id,
      user_id: user.id,
      type: 'stage_change' as const,
      title: `Movido: ${lead.pipeline}/${lead.stage} → ${targetPipeline}/${targetStage}`,
      description: `Movido para "${targetStageRow.name}" (em lote)`,
      is_demo: lead.is_demo,
      metadata: {
        from: lead.stage,
        to: targetStage,
        from_pipeline: lead.pipeline,
        to_pipeline: targetPipeline,
        bulk: true,
      },
    })),
  );

  revalidatePipelines();
  return { ok: true, data: { moved: toMove.length, skipped } };
}

// ============================================================================
// Arquivamento (soft delete)
// ============================================================================

export async function archiveLead(id: string): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { data: lead } = await supabase.from('leads').select('is_demo').eq('id', id).maybeSingle();

  const { error } = await supabase.from('leads').update({ is_archived: true }).eq('id', id);

  if (error) return { ok: false, error: error.message };

  await supabase.from('activities').insert({
    lead_id: id,
    user_id: user.id,
    type: 'system',
    title: 'Lead arquivado',
    description: 'Arquivamento manual',
    is_demo: lead?.is_demo ?? false,
    metadata: {},
  });

  revalidatePipelines();
  return { ok: true, data: undefined };
}

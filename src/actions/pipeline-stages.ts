'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSession } from '@/lib/auth/session';
import { isPipelineKind, type PipelineKind, type PipelineStage } from '@/types/pipeline';
import type { Database } from '@/types/database';
import type { ActionResult } from './leads';

type StageUpdate = Database['public']['Tables']['pipeline_stages']['Update'];

/**
 * Editor de pipelines/stages do /admin (Fase 14).
 *
 * Leitura: qualquer authenticated lê pipeline_stages (RLS já permite). Escrita:
 * só admin — gate por role + uso do admin client (service role) para não
 * depender de policies de escrita em pipeline_stages.
 *
 * Stages nunca são deletados — apenas is_active=false (e somem dos boards via
 * getStagesForPipeline). Desativar exige que o stage esteja vazio.
 */

async function requireAdmin(): Promise<ActionResult<{ ok: true }>> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Não autenticado' };
  if (session.role !== 'admin') return { ok: false, error: 'Acesso restrito a administradores' };
  return { ok: true, data: { ok: true } };
}

/** Gera um slug seguro a partir do nome (sem acento, snake_case). */
function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

export interface PipelineGroup {
  pipeline: PipelineKind;
  stages: PipelineStage[];
}

/** Lista TODOS os stages (ativos + inativos) agrupados por pipeline. */
export async function getPipelinesForAdmin(): Promise<PipelineGroup[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('pipeline_stages')
    .select('*')
    .order('pipeline', { ascending: true })
    .order('position', { ascending: true });

  const stages = (data ?? []) as PipelineStage[];
  const byPipeline = new Map<PipelineKind, PipelineStage[]>();
  for (const stage of stages) {
    if (!isPipelineKind(stage.pipeline)) continue;
    const list = byPipeline.get(stage.pipeline) ?? [];
    list.push(stage);
    byPipeline.set(stage.pipeline, list);
  }
  return [...byPipeline.entries()].map(([pipeline, list]) => ({ pipeline, stages: list }));
}

const addStageSchema = z.object({
  pipeline: z.string().refine(isPipelineKind, 'Pipeline inválido'),
  name: z.string().min(1, 'Informe o nome').max(80),
  position: z.number().int().positive().optional(),
  isEntry: z.boolean().optional(),
  isTerminal: z.boolean().optional(),
  color: z.string().max(32).optional(),
  requiredFields: z.array(z.string().min(1)).optional(),
});

export async function addStage(rawInput: unknown): Promise<ActionResult<{ id: string }>> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const parsed = addStageSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }
  const { pipeline, name, position, isEntry, isTerminal, color, requiredFields } = parsed.data;
  const admin = createAdminClient();

  // Slug único dentro do pipeline.
  const base = slugify(name) || 'stage';
  const { data: existing } = await admin
    .from('pipeline_stages')
    .select('slug, position')
    .eq('pipeline', pipeline);
  const taken = new Set((existing ?? []).map((s) => s.slug));
  let slug = base;
  let n = 2;
  while (taken.has(slug)) slug = `${base}_${n++}`;

  // Posição: ao final por padrão.
  const maxPos = (existing ?? []).reduce((m, s) => Math.max(m, s.position), 0);
  const pos = position ?? maxPos + 1;

  const { data: created, error } = await admin
    .from('pipeline_stages')
    .insert({
      pipeline,
      name,
      slug,
      position: pos,
      color: color ?? '#94a3b8',
      is_entry: isEntry ?? false,
      is_terminal: isTerminal ?? false,
      required_fields: requiredFields ?? [],
      is_active: true,
    })
    .select('id')
    .single();

  if (error || !created) return { ok: false, error: error?.message ?? 'Falha ao criar stage' };
  revalidatePath('/admin');
  revalidatePath('/oportunidades');
  return { ok: true, data: { id: created.id } };
}

const updateStageSchema = z.object({
  id: z.string().uuid('Stage inválido'),
  name: z.string().min(1).max(80).optional(),
  color: z.string().max(32).optional(),
  isEntry: z.boolean().optional(),
  isTerminal: z.boolean().optional(),
  requiredFields: z.array(z.string().min(1)).optional(),
  // Probabilidade de fechamento (0-100%) usada pelo Pipeline Ponderado
  // (/dashboard/pipeline-forecast). Relevante para o pipeline closers.
  winProbability: z
    .number()
    .min(0, 'Probabilidade mínima é 0%')
    .max(100, 'Probabilidade máxima é 100%')
    .optional(),
});

export async function updateStage(rawInput: unknown): Promise<ActionResult<undefined>> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const parsed = updateStageSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }
  const { id, name, color, isEntry, isTerminal, requiredFields, winProbability } = parsed.data;
  const patch: StageUpdate = {};
  if (name !== undefined) patch.name = name;
  if (color !== undefined) patch.color = color;
  if (isEntry !== undefined) patch.is_entry = isEntry;
  if (isTerminal !== undefined) patch.is_terminal = isTerminal;
  if (requiredFields !== undefined) patch.required_fields = requiredFields;
  if (winProbability !== undefined) patch.stage_win_probability = winProbability;
  if (Object.keys(patch).length === 0) return { ok: true, data: undefined };

  const admin = createAdminClient();
  const { error } = await admin.from('pipeline_stages').update(patch).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin');
  revalidatePath('/oportunidades');
  return { ok: true, data: undefined };
}

const reorderSchema = z.object({
  pipeline: z.string().refine(isPipelineKind, 'Pipeline inválido'),
  orderedIds: z.array(z.string().uuid()).min(1),
});

export async function reorderStages(rawInput: unknown): Promise<ActionResult<undefined>> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const parsed = reorderSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }
  const { orderedIds } = parsed.data;
  const admin = createAdminClient();

  // Posições 1..N na ordem recebida.
  for (let i = 0; i < orderedIds.length; i += 1) {
    const { error } = await admin
      .from('pipeline_stages')
      .update({ position: i + 1 })
      .eq('id', orderedIds[i] as string);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath('/admin');
  revalidatePath('/oportunidades');
  return { ok: true, data: undefined };
}

const setActiveSchema = z.object({
  id: z.string().uuid('Stage inválido'),
  active: z.boolean(),
});

export async function setStageActive(rawInput: unknown): Promise<ActionResult<undefined>> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const parsed = setActiveSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }
  const { id, active } = parsed.data;
  const admin = createAdminClient();

  // Ao DESATIVAR, bloqueia se houver leads não-arquivados no stage.
  if (!active) {
    const { data: stage } = await admin
      .from('pipeline_stages')
      .select('pipeline, slug, name')
      .eq('id', id)
      .maybeSingle();
    if (!stage) return { ok: false, error: 'Stage não encontrado' };

    const { count } = await admin
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('pipeline', stage.pipeline)
      .eq('stage', stage.slug)
      .eq('is_archived', false);

    if ((count ?? 0) > 0) {
      return {
        ok: false,
        error: `Não é possível desativar "${stage.name}": há ${count} lead(s) nesse stage. Mova-os antes.`,
      };
    }
  }

  const { error } = await admin.from('pipeline_stages').update({ is_active: active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin');
  revalidatePath('/oportunidades');
  return { ok: true, data: undefined };
}

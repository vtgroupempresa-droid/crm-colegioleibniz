'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSession } from '@/lib/auth/session';
import { createEvent, deleteEvent, patchEvent } from '@/lib/google-calendar/client';
import { isGoogleCalendarConnected } from '@/lib/google-calendar/token-store';
import type { ActionResult } from './leads';

/**
 * Tarefas/lembretes ligados a leads, com espelho na agenda Google da escola
 * (evento simples, sem Meet nem convidados). Concluir/cancelar a tarefa remove
 * o evento; mover o evento no Google atualiza o due_at via sync incremental.
 *
 * Tabela tasks é service-role-only (RLS sem policies) — todo acesso passa por
 * aqui, com gate de sessão.
 */

export type TaskStatus = 'pendente' | 'concluida' | 'cancelada';

export interface TaskItem {
  id: string;
  leadId: string | null;
  title: string;
  description: string | null;
  dueAt: string;
  durationMinutes: number;
  status: TaskStatus;
  assignedTo: string | null;
  googleEventId: string | null;
  completedAt: string | null;
}

/** Item enxuto da fila operacional do Funil. */
export interface ActionQueueItem extends TaskItem {
  leadName: string | null;
  childName: string | null;
  stage: string | null;
}

const createTaskSchema = z.object({
  leadId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  dueAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(15).max(480).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  /** Espelha a tarefa como evento na agenda Google (default true). */
  addToCalendar: z.boolean().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

function taskSummary(title: string, leadName: string | null): string {
  return leadName ? `Tarefa — ${title} (${leadName})` : `Tarefa — ${title}`;
}

async function loadLeadName(leadId: string | null | undefined): Promise<string | null> {
  if (!leadId) return null;
  const admin = createAdminClient();
  const { data } = await admin.from('leads').select('name').eq('id', leadId).maybeSingle();
  return data?.name ?? null;
}

function mapRow(row: {
  id: string;
  lead_id: string | null;
  title: string;
  description: string | null;
  due_at: string;
  duration_minutes: number;
  status: string;
  assigned_to: string | null;
  google_event_id: string | null;
  completed_at: string | null;
}): TaskItem {
  return {
    id: row.id,
    leadId: row.lead_id,
    title: row.title,
    description: row.description,
    dueAt: row.due_at,
    durationMinutes: row.duration_minutes,
    // A primeira versão do schema usava o default em inglês ('pending'),
    // enquanto a UI sempre trabalhou em português. Normalizar na borda mantém
    // tarefas antigas e automações existentes visíveis na fila.
    status: row.status === 'pending' ? 'pendente' : ((row.status as TaskStatus) ?? 'pendente'),
    assignedTo: row.assigned_to,
    googleEventId: row.google_event_id,
    completedAt: row.completed_at,
  };
}

const TASK_COLUMNS =
  'id, lead_id, title, description, due_at, duration_minutes, status, assigned_to, google_event_id, completed_at';

export async function createTask(rawInput: unknown): Promise<ActionResult<TaskItem>> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Não autenticado' };
  const parsed = createTaskSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }
  const input = parsed.data;
  const admin = createAdminClient();

  const { data: task, error } = await admin
    .from('tasks')
    .insert({
      lead_id: input.leadId ?? null,
      title: input.title,
      description: input.description ?? null,
      due_at: new Date(input.dueAt).toISOString(),
      duration_minutes: input.durationMinutes ?? 30,
      assigned_to: input.assignedTo ?? session.userId,
      created_by: session.userId,
    })
    .select(TASK_COLUMNS)
    .single();
  if (error || !task) return { ok: false, error: error?.message ?? 'Falha ao criar tarefa' };

  // Espelho no Google — best-effort: falha não desfaz a tarefa.
  if ((input.addToCalendar ?? true) && (await isGoogleCalendarConnected())) {
    try {
      const leadName = await loadLeadName(input.leadId);
      const created = await createEvent({
        summary: taskSummary(input.title, leadName),
        description: input.description ?? undefined,
        startIso: new Date(input.dueAt).toISOString(),
        durationMinutes: input.durationMinutes ?? 30,
      });
      await admin.from('tasks').update({ google_event_id: created.eventId }).eq('id', task.id);
      task.google_event_id = created.eventId;
    } catch (err) {
      console.error('[tasks] falha ao criar evento no Google', {
        taskId: task.id,
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  revalidatePath('/calendario');
  revalidatePath('/oportunidades');
  return { ok: true, data: mapRow(task) };
}

const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  durationMinutes: z.number().int().min(15).max(480).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
});

export async function updateTask(taskId: string, rawInput: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Não autenticado' };
  const parsed = updateTaskSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }
  const input = parsed.data;
  const admin = createAdminClient();

  const { data: task } = await admin.from('tasks').select(TASK_COLUMNS).eq('id', taskId).maybeSingle();
  if (!task) return { ok: false, error: 'Tarefa não encontrada' };

  const values: {
    updated_at: string;
    title?: string;
    description?: string | null;
    due_at?: string;
    duration_minutes?: number;
    assigned_to?: string | null;
  } = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) values.title = input.title;
  if (input.description !== undefined) values.description = input.description;
  if (input.dueAt !== undefined) values.due_at = new Date(input.dueAt).toISOString();
  if (input.durationMinutes !== undefined) values.duration_minutes = input.durationMinutes;
  if (input.assignedTo !== undefined) values.assigned_to = input.assignedTo;

  const { error } = await admin.from('tasks').update(values).eq('id', taskId);
  if (error) return { ok: false, error: error.message };

  if (task.google_event_id && (await isGoogleCalendarConnected())) {
    try {
      const leadName = await loadLeadName(task.lead_id);
      await patchEvent(task.google_event_id, {
        summary: taskSummary(input.title ?? task.title, leadName),
        description: input.description !== undefined ? input.description : task.description,
        startIso: new Date(input.dueAt ?? task.due_at).toISOString(),
        durationMinutes: input.durationMinutes ?? task.duration_minutes,
      });
    } catch (err) {
      console.error('[tasks] falha ao atualizar evento no Google', {
        taskId,
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  revalidatePath('/calendario');
  revalidatePath('/oportunidades');
  return { ok: true, data: undefined };
}

async function closeTask(taskId: string, status: 'concluida' | 'cancelada'): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Não autenticado' };
  const admin = createAdminClient();

  const { data: task } = await admin.from('tasks').select(TASK_COLUMNS).eq('id', taskId).maybeSingle();
  if (!task) return { ok: false, error: 'Tarefa não encontrada' };

  const { error } = await admin
    .from('tasks')
    .update({
      status,
      completed_at: status === 'concluida' ? new Date().toISOString() : null,
      google_event_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);
  if (error) return { ok: false, error: error.message };

  // Remove o lembrete da agenda (best-effort; delete é idempotente).
  if (task.google_event_id && (await isGoogleCalendarConnected())) {
    try {
      await deleteEvent(task.google_event_id);
    } catch (err) {
      console.error('[tasks] falha ao remover evento no Google', {
        taskId,
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  revalidatePath('/calendario');
  revalidatePath('/oportunidades');
  return { ok: true, data: undefined };
}

export async function completeTask(taskId: string): Promise<ActionResult> {
  return closeTask(taskId, 'concluida');
}

export async function cancelTask(taskId: string): Promise<ActionResult> {
  return closeTask(taskId, 'cancelada');
}

/** Tarefas de um lead (aba Tarefas do drawer), por data; UI agrupa por status. */
export async function getTasksForLead(leadId: string): Promise<TaskItem[]> {
  const session = await getSession();
  if (!session) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('lead_id', leadId)
    .order('due_at', { ascending: true });
  return (data ?? []).map(mapRow);
}

/**
 * Próximas ações do usuário logado, ordenadas para execução: atrasadas antes,
 * depois hoje e então as próximas 48 horas. É a fonte da faixa "Minha fila"
 * do Funil e inclui tarefas manuais e geradas por automações.
 */
export async function getMyActionQueue(): Promise<ActionQueueItem[]> {
  const session = await getSession();
  if (!session) return [];

  const until = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const admin = createAdminClient();
  const { data } = await admin
    .from('tasks')
    .select(`${TASK_COLUMNS}, leads (name, child_name, stage)`)
    .eq('assigned_to', session.userId)
    .in('status', ['pendente', 'pending'])
    .lte('due_at', until)
    .order('due_at', { ascending: true })
    .limit(24);

  return (data ?? []).map((row) => {
    const task = mapRow(row);
    const lead = row.leads as { name: string; child_name: string | null; stage: string } | null;
    return {
      ...task,
      leadName: lead?.name ?? null,
      childName: lead?.child_name ?? null,
      stage: lead?.stage ?? null,
    };
  });
}

/** Adia uma ação sem cancelá-la; evita que o atendente "apague" o follow-up. */
export async function snoozeTask(taskId: string, untilIso: string): Promise<ActionResult> {
  const parsed = z.string().datetime({ offset: true }).safeParse(untilIso);
  if (!parsed.success) return { ok: false, error: 'Informe uma nova data e hora válida.' };
  return updateTask(taskId, { dueAt: parsed.data });
}

'use server';

import { revalidatePath } from 'next/cache';
import { getSession, isAdmin } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import type { Enums, Json, Tables } from '@/types/database';

export type AutomationRule = Tables<'automation_rules'>;
export type AutomationTrigger = Enums<'automation_trigger'>;
export type AutomationAction = Enums<'automation_action'>;

export interface AutomationRuleInput {
  name: string;
  description?: string | null;
  is_active: boolean;
  trigger_type: AutomationTrigger;
  trigger_config: Json;
  action_type: AutomationAction;
  action_config: Json;
}

interface ActionResult {
  ok: boolean;
  error?: string;
}

async function requireAdmin(): Promise<{ userId: string } | { error: string }> {
  const session = await getSession();
  if (!session) return { error: 'Sessão expirada.' };
  if (!isAdmin(session.role)) return { error: 'Apenas administradores gerenciam automações.' };
  return { userId: session.userId };
}

export async function listAutomationRules(): Promise<AutomationRule[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('automation_rules')
    .select('*')
    .order('created_at', { ascending: true });
  return data ?? [];
}

export async function createAutomationRule(input: AutomationRuleInput): Promise<ActionResult> {
  const gate = await requireAdmin();
  if ('error' in gate) return { ok: false, error: gate.error };

  const supabase = createClient();
  const { error } = await supabase.from('automation_rules').insert({
    ...input,
    created_by: gate.userId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/automacoes');
  return { ok: true };
}

export async function updateAutomationRule(
  id: string,
  input: Partial<AutomationRuleInput>,
): Promise<ActionResult> {
  const gate = await requireAdmin();
  if ('error' in gate) return { ok: false, error: gate.error };

  const supabase = createClient();
  const { data, error } = await supabase
    .from('automation_rules')
    .update(input)
    .eq('id', id)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: 'Automação não encontrada.' };
  revalidatePath('/admin/automacoes');
  return { ok: true };
}

export async function toggleAutomationRule(id: string, isActive: boolean): Promise<ActionResult> {
  return updateAutomationRule(id, { is_active: isActive });
}

export async function deleteAutomationRule(id: string): Promise<ActionResult> {
  const gate = await requireAdmin();
  if ('error' in gate) return { ok: false, error: gate.error };

  const supabase = createClient();
  const { error } = await supabase.from('automation_rules').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/automacoes');
  return { ok: true };
}

/** Últimos disparos de uma regra — auditoria na UI de automações. */
export async function listAutomationRuns(ruleId: string): Promise<
  Array<{
    id: string;
    executed_at: string;
    status: string;
    error: string | null;
    lead_name: string | null;
  }>
> {
  const supabase = createClient();
  const { data } = await supabase
    .from('automation_runs')
    .select('id, executed_at, status, error, leads (name)')
    .eq('rule_id', ruleId)
    .order('executed_at', { ascending: false })
    .limit(20);
  return (data ?? []).map((run) => ({
    id: run.id,
    executed_at: run.executed_at,
    status: run.status,
    error: run.error,
    lead_name: (run.leads as { name: string } | null)?.name ?? null,
  }));
}

'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { getSession } from '@/lib/auth/session';
import type { UserRole } from '@/types/user';

export interface MyDayTask {
  id: string;
  leadId: string | null;
  leadName: string | null;
  childName: string | null;
  title: string;
  dueAt: string;
  isOverdue: boolean;
}

export interface MyDayAppointment {
  id: string;
  leadId: string;
  leadName: string;
  childName: string | null;
  scheduledAt: string;
  status: string;
  confirmed: boolean;
}

export interface MyDayData {
  userName: string;
  role: UserRole;
  dateLabel: string;
  tasks: MyDayTask[];
  appointments: MyDayAppointment[];
  portfolioCount: number;
  newLeadCount: number;
  unassignedLeadCount: number | null;
}

function saoPauloDay() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  const start = new Date(`${date}T00:00:00-03:00`);
  const end = new Date(`${date}T23:59:59.999-03:00`);

  return {
    start,
    end,
    dateLabel: start.toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
  };
}

/**
 * Rotina individual: tarefas atribuídas, visitas conduzidas e carteira da
 * pessoa autenticada. Admin recebe ainda o único alerta coletivo que exige
 * gestão: famílias sem responsável.
 */
export async function getMyDayData(): Promise<MyDayData | null> {
  const session = await getSession();
  if (!session) return null;

  const { start, end, dateLabel } = saoPauloDay();
  const admin = createAdminClient();
  const [tasksResult, appointmentsResult, portfolioResult, newLeadsResult, unassignedResult] =
    await Promise.all([
      admin
        .from('tasks')
        .select('id, lead_id, title, due_at, leads(name, child_name)')
        .eq('assigned_to', session.userId)
        .in('status', ['pendente', 'pending'])
        .lte('due_at', end.toISOString())
        .order('due_at', { ascending: true })
        .limit(20),
      admin
        .from('appointments')
        .select('id, lead_id, scheduled_at, status, confirmed, leads(name, child_name)')
        .gte('scheduled_at', start.toISOString())
        .lte('scheduled_at', end.toISOString())
        .neq('status', 'cancelado')
        .or(`assigned_to.eq.${session.userId},created_by.eq.${session.userId}`)
        .order('scheduled_at', { ascending: true }),
      admin
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('assigned_to', session.userId)
        .eq('is_archived', false)
        .eq('is_demo', false),
      admin
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('assigned_to', session.userId)
        .eq('stage', 'novo_lead')
        .eq('is_archived', false)
        .eq('is_demo', false),
      session.role === 'admin'
        ? admin
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .is('assigned_to', null)
            .eq('is_archived', false)
            .eq('is_demo', false)
        : Promise.resolve({ count: null }),
    ]);

  const tasks = (tasksResult.data ?? []).map((row) => {
    const lead = row.leads as { name: string; child_name: string | null } | null;
    return {
      id: row.id,
      leadId: row.lead_id,
      leadName: lead?.name ?? null,
      childName: lead?.child_name ?? null,
      title: row.title,
      dueAt: row.due_at,
      isOverdue: new Date(row.due_at).getTime() < start.getTime(),
    } satisfies MyDayTask;
  });

  const appointments = (appointmentsResult.data ?? []).map((row) => {
    const lead = row.leads as { name: string; child_name: string | null } | null;
    return {
      id: row.id,
      leadId: row.lead_id,
      leadName: lead?.name ?? 'Família sem identificação',
      childName: lead?.child_name ?? null,
      scheduledAt: row.scheduled_at,
      status: row.status,
      confirmed: row.confirmed,
    } satisfies MyDayAppointment;
  });

  return {
    userName: session.name,
    role: session.role,
    dateLabel,
    tasks,
    appointments,
    portfolioCount: portfolioResult.count ?? 0,
    newLeadCount: newLeadsResult.count ?? 0,
    unassignedLeadCount: session.role === 'admin' ? (unassignedResult.count ?? 0) : null,
  };
}

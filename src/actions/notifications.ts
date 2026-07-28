'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Notification, NotificationType } from '@/types/notification';
import type { UserRole } from '@/types/user';
import type { ActionResult } from './leads';

/**
 * Notificações in-app (Fase 7).
 *
 * `createNotification` usa o admin client (service role) porque os gatilhos
 * frequentemente criam notificações para OUTRO usuário (ex.: o closer registra
 * no-show e o SDR é notificado) ou rodam sem sessão (webhook de entrada). As
 * leituras (bell) continuam passando pelo client autenticado, então o RLS de
 * SELECT/UPDATE ("apenas as próprias") segue valendo na UI.
 *
 * As notificações NÃO são criadas para leads demo — o flag is_demo fica no lead,
 * e poluir o sino de produção com dados fictícios não faz sentido. Os callers
 * passam o lead já filtrado.
 */

export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  leadId?: string | null,
): Promise<void> {
  if (!userId) return;

  const admin = createAdminClient();
  const { error } = await admin.from('notifications').insert({
    user_id: userId,
    type,
    title,
    body,
    lead_id: leadId ?? null,
  });

  // Notificação é side-effect best-effort: nunca derruba a Server Action principal.
  if (error) {
    console.error('[createNotification] falha ao inserir notificação:', error.message);
  }
}

/**
 * Cria a mesma notificação para todos os usuários de um conjunto de roles.
 * Usado nos gatilhos de Admin (matrícula fechada, lead sem responsável).
 */
export async function notifyRoles(
  roles: readonly UserRole[],
  type: NotificationType,
  title: string,
  body: string,
  leadId?: string | null,
): Promise<void> {
  const admin = createAdminClient();
  const { data: users } = await admin
    .from('user_profiles')
    .select('id')
    .in('role', [...roles]);

  if (!users || users.length === 0) return;

  const rows = users.map((u) => ({
    user_id: u.id,
    type,
    title,
    body,
    lead_id: leadId ?? null,
  }));

  const { error } = await admin.from('notifications').insert(rows);
  if (error) {
    console.error('[notifyRoles] falha ao inserir notificações:', error.message);
  }
}

/**
 * Gatilhos disparados na CRIAÇÃO de um lead (via /leads ou via webhook):
 *  - Se o lead foi atribuído a alguém → notifica o responsável ("novo_lead").
 *  - Sem responsável → notifica os admins para ninguém ficar sem atendimento.
 *
 * Não dispara para leads demo. Best-effort: erros são logados, não propagados.
 */
export async function notifyLeadCreated(params: {
  leadId: string;
  name: string;
  assignedTo: string | null;
  sourceLabel: string;
  isDemo: boolean;
}): Promise<void> {
  const { leadId, name, assignedTo, sourceLabel, isDemo } = params;
  if (isDemo) return;

  if (assignedTo) {
    await createNotification(
      assignedTo,
      'novo_lead',
      `Novo lead: ${name}`,
      `Origem: ${sourceLabel}`,
      leadId,
    );
  } else {
    await notifyRoles(
      ['admin'],
      'novo_lead',
      `Novo lead sem responsável: ${name}`,
      `Origem: ${sourceLabel} — atribua um responsável.`,
      leadId,
    );
  }
}

export interface RecentNotifications {
  items: Notification[];
  unreadCount: number;
}

/** Últimas 10 notificações + contagem de não lidas do usuário logado. */
export async function getRecentNotifications(): Promise<RecentNotifications> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { items: [], unreadCount: 0 };

  const [{ data: items }, { count }] = await Promise.all([
    supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('read', false),
  ]);

  return { items: items ?? [], unreadCount: count ?? 0 };
}

export async function markNotificationRead(id: string): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', user.id)
    .eq('read', false);

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

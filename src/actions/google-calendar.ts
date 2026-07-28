'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getSession, isAdmin } from '@/lib/auth/session';
import { createEvent } from '@/lib/google-calendar/client';
import {
  disconnect,
  getConnectionInfo,
  isGoogleCalendarConnected,
} from '@/lib/google-calendar/token-store';
import { runIncrementalSync } from '@/lib/google-calendar/sync';
import type { ActionResult } from './leads';

/**
 * Server Actions da integração Google Calendar (agenda da escola).
 * Painel de status/conexão em /integracoes; eventos externos no /calendario.
 */

export interface GoogleCalendarStatus {
  connected: boolean;
  connectedEmail: string | null;
  lastSyncedAt: string | null;
}

/** Status da conexão para o painel (admin) e para os forms de agendamento. */
export async function getGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
  const session = await getSession();
  if (!session) return { connected: false, connectedEmail: null, lastSyncedAt: null };
  const info = await getConnectionInfo();
  if (!info) return { connected: false, connectedEmail: null, lastSyncedAt: null };
  return {
    connected: true,
    // e-mail conectado só para admin (demais roles só precisam saber que está ativo).
    connectedEmail: isAdmin(session.role) ? info.connectedEmail : null,
    lastSyncedAt: info.lastSyncedAt,
  };
}

/** Desconecta (revoga token + apaga a linha). Admin-only. */
export async function disconnectGoogleCalendar(): Promise<ActionResult> {
  const session = await getSession();
  if (!session || !isAdmin(session.role)) {
    return { ok: false, error: 'Apenas admin pode desconectar o Google Calendar' };
  }
  try {
    await disconnect();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Falha ao desconectar' };
  }
  revalidatePath('/integracoes');
  return { ok: true, data: undefined };
}

/** Sincronização manual (botão do painel). Admin-only. */
export async function triggerManualSync(): Promise<
  ActionResult<{ processed: number; appointmentsUpdated: number; externalUpserted: number }>
> {
  const session = await getSession();
  if (!session || !isAdmin(session.role)) {
    return { ok: false, error: 'Apenas admin pode sincronizar' };
  }
  try {
    const report = await runIncrementalSync();
    if (report.skipped) return { ok: false, error: 'Google Calendar não conectado' };
    revalidatePath('/calendario');
    revalidatePath('/integracoes');
    return {
      ok: true,
      data: {
        processed: report.processed,
        appointmentsUpdated: report.appointmentsUpdated,
        externalUpserted: report.externalUpserted,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Falha na sincronização' };
  }
}

export interface ExternalCalendarEvent {
  id: string;
  googleEventId: string;
  summary: string | null;
  startAt: string | null;
  endAt: string | null;
  allDay: boolean;
  htmlLink: string | null;
  meetLink: string | null;
}

/**
 * Eventos da agenda Google que NÃO são appointments, num intervalo [from, to)
 * — mesclados na visão do /calendario. Qualquer usuário logado.
 */
export async function getExternalEventsForCalendar(
  fromIso: string,
  toIso: string,
): Promise<ExternalCalendarEvent[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  // Tabela é service-role-only (RLS sem policies) — leitura via admin client
  // depois do gate de sessão acima.
  const admin = createAdminClient();
  const { data } = await admin
    .from('google_calendar_events')
    .select('id, google_event_id, summary, start_at, end_at, all_day, html_link, meet_link')
    .gte('start_at', fromIso)
    .lt('start_at', toIso)
    .neq('status', 'cancelled')
    .order('start_at', { ascending: true });

  return (data ?? []).map((e) => ({
    id: e.id,
    googleEventId: e.google_event_id,
    summary: e.summary,
    startAt: e.start_at,
    endAt: e.end_at,
    allDay: e.all_day,
    htmlLink: e.html_link,
    meetLink: e.meet_link,
  }));
}

const meetLinkSchema = z.object({
  title: z.string().min(1).max(200),
  startAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(15).max(480).default(60),
});

/**
 * Cria um evento avulso na agenda da escola só para obter um link do Google
 * Meet (uso ad-hoc, fora do fluxo de appointment). O evento fica na agenda.
 */
export async function createStandaloneMeetLink(rawInput: unknown): Promise<
  ActionResult<{ meetLink: string; htmlLink: string | null }>
> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Não autenticado' };
  const parsed = meetLinkSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }
  if (!(await isGoogleCalendarConnected())) {
    return { ok: false, error: 'Google Calendar não conectado' };
  }
  try {
    const created = await createEvent({
      summary: parsed.data.title,
      description: `Criado pelo CRM do Colégio Leibniz por ${session.name}.`,
      startIso: new Date(parsed.data.startAt).toISOString(),
      durationMinutes: parsed.data.durationMinutes,
      createMeet: true,
    });
    if (!created.meetLink) {
      return { ok: false, error: 'Google não retornou o link do Meet' };
    }
    return { ok: true, data: { meetLink: created.meetLink, htmlLink: created.htmlLink } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Falha ao criar o link' };
  }
}

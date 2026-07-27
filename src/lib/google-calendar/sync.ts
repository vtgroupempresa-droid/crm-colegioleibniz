import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  extractMeetLink,
  isSyncTokenExpired,
  listEventsPage,
  type GoogleEvent,
} from './client';
import { getSyncState, isGoogleCalendarConnected, saveSyncState } from './token-store';
import type { Json } from '@/types/database';

/**
 * Sync incremental Google → CRM (cron a cada 5 min + botão "Sincronizar
 * agora"). Usa o syncToken do events.list: só as mudanças desde a última
 * execução. Primeira execução (ou 410 GONE) faz full sync com timeMin −60d.
 *
 * Roteamento por evento:
 *  - google_event_id de um appointment → atualiza o appointment (horário,
 *    duração, link; cancelamento vira status 'cancelado');
 *  - google_event_id de uma task → atualiza o due_at;
 *  - demais → cache em google_calendar_events (compromissos da agenda que não
 *    nasceram no CRM, exibidos no /calendario).
 *
 * Anti-eco: o CRM escreve no Google e o cron lê a própria escrita segundos
 * depois — as atualizações comparam campo a campo e só gravam quando algo
 * mudou de fato, sem gerar activities/notificações.
 */

const FULL_SYNC_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

export interface SyncReport {
  skipped: boolean;
  fullSync: boolean;
  processed: number;
  appointmentsUpdated: number;
  tasksUpdated: number;
  externalUpserted: number;
  externalRemoved: number;
  errors: string[];
}

function eventStart(event: GoogleEvent): { iso: string | null; allDay: boolean } {
  if (event.start?.dateTime) return { iso: new Date(event.start.dateTime).toISOString(), allDay: false };
  // Evento de dia inteiro: só a data — fixa em 00:00 de São Paulo (UTC−3).
  if (event.start?.date) return { iso: `${event.start.date}T03:00:00.000Z`, allDay: true };
  return { iso: null, allDay: false };
}

function eventEnd(event: GoogleEvent): string | null {
  if (event.end?.dateTime) return new Date(event.end.dateTime).toISOString();
  if (event.end?.date) return `${event.end.date}T03:00:00.000Z`;
  return null;
}

function durationMinutes(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return ms > 0 ? Math.round(ms / 60_000) : null;
}

async function applyToAppointment(
  event: GoogleEvent,
  apt: {
    id: string;
    scheduled_at: string;
    duration_minutes: number;
    meeting_link: string | null;
    status: string;
  },
): Promise<boolean> {
  const admin = createAdminClient();

  if (event.status === 'cancelled') {
    if (apt.status === 'cancelado') return false;
    await admin
      .from('appointments')
      .update({ status: 'cancelado', google_sync_status: 'synced', google_synced_at: new Date().toISOString() })
      .eq('id', apt.id);
    return true;
  }

  const { iso: startIso } = eventStart(event);
  const duration = durationMinutes(startIso, eventEnd(event));
  const meetLink = extractMeetLink(event);

  const changes: { scheduled_at?: string; duration_minutes?: number; meeting_link?: string } = {};
  if (startIso && startIso !== new Date(apt.scheduled_at).toISOString()) {
    changes.scheduled_at = startIso;
  }
  if (duration && duration !== apt.duration_minutes) changes.duration_minutes = duration;
  if (meetLink && meetLink !== apt.meeting_link) changes.meeting_link = meetLink;
  if (Object.keys(changes).length === 0) return false;

  await admin
    .from('appointments')
    .update({
      ...changes,
      google_sync_status: 'synced',
      google_synced_at: new Date().toISOString(),
    })
    .eq('id', apt.id);
  return true;
}

async function applyToTask(
  event: GoogleEvent,
  task: { id: string; due_at: string; duration_minutes: number; status: string },
): Promise<boolean> {
  const admin = createAdminClient();

  if (event.status === 'cancelled') {
    if (task.status !== 'pendente') return false;
    await admin.from('tasks').update({ status: 'cancelada', google_event_id: null }).eq('id', task.id);
    return true;
  }

  const { iso: startIso } = eventStart(event);
  const duration = durationMinutes(startIso, eventEnd(event));
  const changes: { due_at?: string; duration_minutes?: number } = {};
  if (startIso && startIso !== new Date(task.due_at).toISOString()) changes.due_at = startIso;
  if (duration && duration !== task.duration_minutes) changes.duration_minutes = duration;
  if (Object.keys(changes).length === 0) return false;

  await admin.from('tasks').update(changes).eq('id', task.id);
  return true;
}

async function upsertExternalEvent(event: GoogleEvent, report: SyncReport): Promise<void> {
  const admin = createAdminClient();

  if (event.status === 'cancelled') {
    const { count } = await admin
      .from('google_calendar_events')
      .delete({ count: 'exact' })
      .eq('google_event_id', event.id);
    if (count) report.externalRemoved += count;
    return;
  }

  const { iso: startIso, allDay } = eventStart(event);
  const { error } = await admin.from('google_calendar_events').upsert(
    {
      google_event_id: event.id,
      summary: event.summary ?? null,
      description: event.description ?? null,
      start_at: startIso,
      end_at: eventEnd(event),
      all_day: allDay,
      status: event.status ?? null,
      html_link: event.htmlLink ?? null,
      meet_link: extractMeetLink(event),
      attendees: (event.attendees ?? null) as unknown as Json,
      updated_at_google: event.updated ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'google_event_id' },
  );
  if (error) {
    report.errors.push(`upsert ${event.id}: ${error.message}`);
  } else {
    report.externalUpserted += 1;
  }
}

async function processEvents(events: GoogleEvent[], report: SyncReport): Promise<void> {
  if (events.length === 0) return;
  const admin = createAdminClient();
  const ids = events.map((e) => e.id);

  const [{ data: appointments }, { data: tasks }] = await Promise.all([
    admin
      .from('appointments')
      .select('id, google_event_id, scheduled_at, duration_minutes, meeting_link, status')
      .in('google_event_id', ids),
    admin.from('tasks').select('id, google_event_id, due_at, duration_minutes, status').in('google_event_id', ids),
  ]);
  const aptByEventId = new Map((appointments ?? []).map((a) => [a.google_event_id as string, a]));
  const taskByEventId = new Map((tasks ?? []).map((t) => [t.google_event_id as string, t]));

  for (const event of events) {
    report.processed += 1;
    try {
      const apt = aptByEventId.get(event.id);
      if (apt) {
        if (await applyToAppointment(event, apt)) report.appointmentsUpdated += 1;
        continue;
      }
      const task = taskByEventId.get(event.id);
      if (task) {
        if (await applyToTask(event, task)) report.tasksUpdated += 1;
        continue;
      }
      await upsertExternalEvent(event, report);
    } catch (err) {
      report.errors.push(
        `evento ${event.id}: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
      );
    }
  }
}

export async function runIncrementalSync(): Promise<SyncReport> {
  const report: SyncReport = {
    skipped: false,
    fullSync: false,
    processed: 0,
    appointmentsUpdated: 0,
    tasksUpdated: 0,
    externalUpserted: 0,
    externalRemoved: 0,
    errors: [],
  };

  if (!(await isGoogleCalendarConnected())) {
    report.skipped = true;
    return report;
  }

  const state = await getSyncState();
  let syncToken = state?.syncToken ?? null;
  report.fullSync = !syncToken;
  const timeMinIso = new Date(Date.now() - FULL_SYNC_WINDOW_MS).toISOString();

  let pageToken: string | null = null;
  let nextSyncToken: string | null = null;
  // Loop de páginas; em 410 (syncToken expirado) recomeça como full sync.
  for (;;) {
    let page;
    try {
      page = await listEventsPage({ syncToken, timeMinIso, pageToken });
    } catch (err) {
      if (isSyncTokenExpired(err) && syncToken) {
        syncToken = null;
        pageToken = null;
        report.fullSync = true;
        continue;
      }
      throw err;
    }
    await processEvents(page.events, report);
    if (page.nextSyncToken) nextSyncToken = page.nextSyncToken;
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }

  await saveSyncState(nextSyncToken ?? syncToken);
  return report;
}

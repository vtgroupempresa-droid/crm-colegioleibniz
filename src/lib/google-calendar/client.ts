import 'server-only';
import { CALENDAR_API_BASE, CRM_TIMEZONE } from './config';
import { getCalendarId, getValidAccessToken } from './token-store';

/**
 * Wrappers `fetch` da Google Calendar API v3 (sem SDK googleapis, padrão do
 * repo). Todas as chamadas usam o token da conta conectada (agenda da escola).
 *
 * sendUpdates=all faz o Google enviar convite/atualização/cancelamento por
 * e-mail aos attendees (o lead). conferenceDataVersion=1 é obrigatório para o
 * conferenceData.createRequest gerar o link do Google Meet.
 */

export interface GoogleEventAttendee {
  email: string;
  displayName?: string;
  responseStatus?: string;
}

export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  hangoutLink?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: GoogleEventAttendee[];
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
}

export interface CreateEventInput {
  summary: string;
  description?: string | null;
  startIso: string;
  durationMinutes: number;
  attendeeEmails?: string[];
  /** Gera link do Google Meet via conferenceData.createRequest. */
  createMeet?: boolean;
}

export interface CreatedEvent {
  eventId: string;
  meetLink: string | null;
  htmlLink: string | null;
}

class CalendarApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function isSyncTokenExpired(err: unknown): boolean {
  return err instanceof CalendarApiError && err.status === 410;
}

async function calendarFetch(
  path: string,
  init: RequestInit & { query?: Record<string, string> } = {},
): Promise<Response> {
  const token = await getValidAccessToken();
  const url = new URL(`${CALENDAR_API_BASE}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    cache: 'no-store',
  });
}

async function parseOrThrow(res: Response): Promise<GoogleEvent> {
  const data = (await res.json().catch(() => null)) as
    | (GoogleEvent & { error?: { message?: string } })
    | null;
  if (!res.ok || !data?.id) {
    throw new CalendarApiError(
      res.status,
      `Calendar API ${res.status}: ${data?.error?.message ?? 'resposta inválida'}`,
    );
  }
  return data;
}

export function extractMeetLink(event: GoogleEvent): string | null {
  const video = event.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === 'video' && e.uri,
  );
  return video?.uri ?? event.hangoutLink ?? null;
}

function eventTimes(startIso: string, durationMinutes: number) {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return {
    start: { dateTime: start.toISOString(), timeZone: CRM_TIMEZONE },
    end: { dateTime: end.toISOString(), timeZone: CRM_TIMEZONE },
  };
}

export async function createEvent(input: CreateEventInput): Promise<CreatedEvent> {
  const calendarId = await getCalendarId();
  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description ?? undefined,
    ...eventTimes(input.startIso, input.durationMinutes),
  };
  if (input.attendeeEmails && input.attendeeEmails.length > 0) {
    body.attendees = input.attendeeEmails.map((email) => ({ email }));
  }
  if (input.createMeet) {
    body.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }
  const res = await calendarFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify(body),
    query: { conferenceDataVersion: '1', sendUpdates: 'all' },
  });
  const event = await parseOrThrow(res);
  return { eventId: event.id, meetLink: extractMeetLink(event), htmlLink: event.htmlLink ?? null };
}

export interface PatchEventInput {
  summary?: string;
  description?: string | null;
  startIso?: string;
  durationMinutes?: number;
  attendeeEmails?: string[];
}

export async function patchEvent(eventId: string, changes: PatchEventInput): Promise<void> {
  const calendarId = await getCalendarId();
  const body: Record<string, unknown> = {};
  if (changes.summary !== undefined) body.summary = changes.summary;
  if (changes.description !== undefined) body.description = changes.description;
  if (changes.startIso !== undefined && changes.durationMinutes !== undefined) {
    Object.assign(body, eventTimes(changes.startIso, changes.durationMinutes));
  }
  if (changes.attendeeEmails !== undefined) {
    body.attendees = changes.attendeeEmails.map((email) => ({ email }));
  }
  const res = await calendarFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
      query: { conferenceDataVersion: '1', sendUpdates: 'all' },
    },
  );
  // Evento apagado direto no Google: nada a atualizar, não é erro.
  if (res.status === 404 || res.status === 410) return;
  await parseOrThrow(res);
}

export async function deleteEvent(eventId: string): Promise<void> {
  const calendarId = await getCalendarId();
  const res = await calendarFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', query: { sendUpdates: 'all' } },
  );
  // 404/410 = já não existe; delete é idempotente.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const text = await res.text().catch(() => '');
    throw new CalendarApiError(res.status, `Calendar API ${res.status}: ${text.slice(0, 200)}`);
  }
}

export interface ListEventsPage {
  events: GoogleEvent[];
  nextPageToken: string | null;
  nextSyncToken: string | null;
}

/**
 * Página do events.list. Com syncToken retorna só as mudanças desde o último
 * sync (e NÃO aceita filtros de tempo); sem syncToken faz o full sync com
 * timeMin. Lança CalendarApiError 410 quando o syncToken expirou (o chamador
 * limpa o token e refaz o full sync).
 */
export async function listEventsPage(params: {
  syncToken?: string | null;
  timeMinIso?: string;
  pageToken?: string | null;
}): Promise<ListEventsPage> {
  const calendarId = await getCalendarId();
  const query: Record<string, string> = { maxResults: '250', singleEvents: 'true' };
  if (params.pageToken) query.pageToken = params.pageToken;
  if (params.syncToken) {
    query.syncToken = params.syncToken;
  } else if (params.timeMinIso) {
    query.timeMin = params.timeMinIso;
  }
  const res = await calendarFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    query,
  });
  const data = (await res.json().catch(() => null)) as {
    items?: GoogleEvent[];
    nextPageToken?: string;
    nextSyncToken?: string;
    error?: { message?: string };
  } | null;
  if (!res.ok) {
    throw new CalendarApiError(
      res.status,
      `Calendar API ${res.status}: ${data?.error?.message ?? 'falha no events.list'}`,
    );
  }
  return {
    events: data?.items ?? [],
    nextPageToken: data?.nextPageToken ?? null,
    nextSyncToken: data?.nextSyncToken ?? null,
  };
}

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { createEvent, deleteEvent, patchEvent } from './client';
import { isGoogleCalendarConnected } from './token-store';

/**
 * Ponte appointment ↔ evento no Google Calendar (agenda da escola).
 *
 * Todas as funções são BEST-EFFORT: falha na chamada ao Google nunca desfaz o
 * appointment — o registro fica com google_sync_status='error' e o fluxo do CRM
 * (handoff, score, CAPI…) segue intacto. Com o Google desconectado, viram
 * no-op silencioso (feature-flag natural da integração).
 */

/** Timeout das chamadas ao Google dentro de Server Actions (serverless). */
const GOOGLE_CALL_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Google Calendar: timeout')), GOOGLE_CALL_TIMEOUT_MS),
    ),
  ]);
}

interface AppointmentRow {
  id: string;
  lead_id: string;
  scheduled_at: string;
  duration_minutes: number;
  notes: string | null;
  google_event_id: string | null;
  lead: { name: string; email: string | null; phone: string | null } | null;
}

async function loadAppointment(appointmentId: string): Promise<AppointmentRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('appointments')
    .select(
      'id, lead_id, scheduled_at, duration_minutes, notes, google_event_id, lead:leads(name, email, phone)',
    )
    .eq('id', appointmentId)
    .maybeSingle();
  return (data as AppointmentRow | null) ?? null;
}

function eventSummary(leadName: string): string {
  return `Reunião — ${leadName}`;
}

function eventDescription(apt: AppointmentRow): string {
  const lines = [`Lead: ${apt.lead?.name ?? '—'}`];
  if (apt.lead?.phone) lines.push(`Telefone: ${apt.lead.phone}`);
  if (apt.notes) lines.push('', apt.notes);
  lines.push('', 'Agendado pelo CRM do Colégio Leibniz.');
  return lines.join('\n');
}

async function markSyncResult(
  appointmentId: string,
  values: {
    google_event_id?: string | null;
    meeting_link?: string;
    google_sync_status: 'synced' | 'error' | null;
  },
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from('appointments')
    .update({ ...values, google_synced_at: new Date().toISOString() })
    .eq('id', appointmentId);
}

export interface AppointmentSyncResult {
  ok: boolean;
  meetLink: string | null;
  /** false quando o Google não está conectado (no-op). */
  attempted: boolean;
  /** true quando o lead não tem e-mail (evento criado sem convite). */
  inviteSkipped: boolean;
}

const NOOP: AppointmentSyncResult = {
  ok: true,
  meetLink: null,
  attempted: false,
  inviteSkipped: false,
};

/**
 * Cria o evento (com Meet + convite ao e-mail do lead) para um appointment
 * recém-inserido e grava google_event_id/meeting_link de volta.
 */
export async function syncAppointmentCreate(
  appointmentId: string,
  options: { generateMeetLink: boolean },
): Promise<AppointmentSyncResult> {
  try {
    if (!(await isGoogleCalendarConnected())) return NOOP;
    const apt = await loadAppointment(appointmentId);
    if (!apt || !apt.lead) return NOOP;

    const leadEmail = apt.lead.email?.trim() || null;
    const created = await withTimeout(
      createEvent({
        summary: eventSummary(apt.lead.name),
        description: eventDescription(apt),
        startIso: apt.scheduled_at,
        durationMinutes: apt.duration_minutes,
        attendeeEmails: leadEmail ? [leadEmail] : undefined,
        createMeet: options.generateMeetLink,
      }),
    );

    await markSyncResult(appointmentId, {
      google_event_id: created.eventId,
      ...(created.meetLink ? { meeting_link: created.meetLink } : {}),
      google_sync_status: 'synced',
    });
    return {
      ok: true,
      meetLink: created.meetLink,
      attempted: true,
      inviteSkipped: !leadEmail,
    };
  } catch (err) {
    console.error('[google-calendar] falha ao criar evento do agendamento', {
      appointmentId,
      error: err instanceof Error ? err.message : err,
    });
    await markSyncResult(appointmentId, { google_sync_status: 'error' }).catch(() => undefined);
    return { ok: false, meetLink: null, attempted: true, inviteSkipped: false };
  }
}

/** Reflete edição do appointment (horário/notas) no evento do Google. */
export async function syncAppointmentUpdate(appointmentId: string): Promise<void> {
  try {
    if (!(await isGoogleCalendarConnected())) return;
    const apt = await loadAppointment(appointmentId);
    if (!apt?.google_event_id || !apt.lead) return;
    await withTimeout(
      patchEvent(apt.google_event_id, {
        summary: eventSummary(apt.lead.name),
        description: eventDescription(apt),
        startIso: apt.scheduled_at,
        durationMinutes: apt.duration_minutes,
      }),
    );
    await markSyncResult(appointmentId, { google_sync_status: 'synced' });
  } catch (err) {
    console.error('[google-calendar] falha ao atualizar evento do agendamento', {
      appointmentId,
      error: err instanceof Error ? err.message : err,
    });
    await markSyncResult(appointmentId, { google_sync_status: 'error' }).catch(() => undefined);
  }
}

/**
 * Cancela o evento no Google (o lead recebe o cancelamento por e-mail) e
 * desvincula o google_event_id do appointment.
 */
export async function syncAppointmentCancel(appointmentId: string): Promise<void> {
  try {
    if (!(await isGoogleCalendarConnected())) return;
    const apt = await loadAppointment(appointmentId);
    if (!apt?.google_event_id) return;
    await withTimeout(deleteEvent(apt.google_event_id));
    await markSyncResult(appointmentId, {
      google_event_id: null,
      google_sync_status: null,
    });
  } catch (err) {
    console.error('[google-calendar] falha ao cancelar evento do agendamento', {
      appointmentId,
      error: err instanceof Error ? err.message : err,
    });
    await markSyncResult(appointmentId, { google_sync_status: 'error' }).catch(() => undefined);
  }
}

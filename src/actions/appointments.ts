'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createNotification } from './notifications';
import {
  syncAppointmentCancel,
  syncAppointmentCreate,
  syncAppointmentUpdate,
} from '@/lib/google-calendar/appointment-events';
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS_LABELS,
  type AppointmentStatus,
} from '@/types/appointment';
import type { UserRole } from '@/types/user';
import type { ActionResult } from './leads';

/**
 * Server Actions de visitas presenciais (appointments).
 *
 * Agendar uma visita move o lead para o stage `visita_presencial` do pipeline
 * comercial e define o atendente (assigned_to) como responsável pelo lead.
 *
 * `markNoShow`: a família não compareceu — o lead vai para `follow_up` com a
 * flag is_no_show; a equipe retoma o contato e reagenda.
 */

const createAppointmentSchema = z.object({
  leadId: z.string().uuid(),
  /** Quem vai atender a visita (assigned_to). */
  assignedToId: z.string().uuid(),
  scheduledAt: z.string().datetime({ offset: true }),
  meetingLink: z.string().url().nullable().optional().or(z.literal('')),
  notes: z.string().max(2000).nullable().optional(),
  durationMinutes: z.number().int().min(15).max(480).optional(),
  // Cria o evento na agenda Google da escola com convite ao responsável.
  // Só tem efeito com a integração conectada (senão é no-op).
  generateMeetLink: z.boolean().optional(),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

export interface CreateAppointmentResult {
  /** Link do Meet gerado pelo Google (null se não gerado — visita presencial). */
  meetLink: string | null;
  /** true quando a integração tentou criar o evento e falhou. */
  googleFailed: boolean;
  /** true quando o evento foi criado sem convite (lead sem e-mail). */
  inviteSkipped: boolean;
}

const VISIT_STAGE = 'visita_presencial';
const NO_SHOW_STAGE = 'follow_up';

async function fetchUserName(
  supabase: ReturnType<typeof createClient>,
  userId: string | null,
  fallback: string,
) {
  if (!userId) return fallback;
  const { data } = await supabase
    .from('user_profiles')
    .select('name')
    .eq('id', userId)
    .maybeSingle();
  return data?.name ?? fallback;
}

/**
 * Cria a visita + move o lead para `visita_presencial` com o atendente como
 * responsável.
 */
export async function createAppointment(
  rawInput: unknown,
): Promise<ActionResult<CreateAppointmentResult>> {
  const parsed = createAppointmentSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { leadId, assignedToId, scheduledAt, meetingLink, notes, durationMinutes } = parsed.data;
  const generateMeetLink = parsed.data.generateMeetLink ?? false;

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id, name, email, phone, pipeline, stage, is_demo, assigned_to')
    .eq('id', leadId)
    .single();
  if (leadError || !lead) return { ok: false, error: 'Lead não encontrado' };

  const { data: appointment, error: aptError } = await supabase
    .from('appointments')
    .insert({
      lead_id: leadId,
      assigned_to: assignedToId,
      created_by: user.id,
      scheduled_at: scheduledAt,
      meeting_link: meetingLink || null,
      notes: notes ?? null,
      duration_minutes: durationMinutes ?? 60,
      is_demo: lead.is_demo,
    })
    .select('id')
    .single();
  if (aptError || !appointment) {
    return { ok: false, error: aptError?.message ?? 'Falha ao agendar a visita' };
  }

  // Google Calendar (agenda da escola): cria o evento com convite ao e-mail do
  // responsável. Best-effort — falha não desfaz o agendamento (fica com
  // google_sync_status='error'); desconectado = no-op. Leads demo ficam fora.
  const googleSync = lead.is_demo
    ? { ok: true, meetLink: null, attempted: false, inviteSkipped: false }
    : await syncAppointmentCreate(appointment.id, { generateMeetLink });
  const effectiveMeetingLink = googleSync.meetLink ?? meetingLink ?? null;

  // Move o lead para o stage de visita; o atendente vira responsável.
  const fromStage = lead.stage;
  const stageChanged = fromStage !== VISIT_STAGE;
  const { error: moveError } = await supabase
    .from('leads')
    .update({ stage: VISIT_STAGE, assigned_to: assignedToId })
    .eq('id', leadId);
  if (moveError) return { ok: false, error: moveError.message };

  const [attendantName, schedulerName] = await Promise.all([
    fetchUserName(supabase, assignedToId, 'atendente'),
    fetchUserName(supabase, user.id, 'usuário'),
  ]);
  const dateLabel = new Date(scheduledAt).toLocaleString('pt-BR');

  await supabase.from('activities').insert({
    lead_id: leadId,
    user_id: user.id,
    type: 'appointment',
    title: `Visita agendada por ${schedulerName} com ${attendantName} em ${dateLabel}`,
    description: effectiveMeetingLink,
    is_demo: lead.is_demo,
    metadata: {
      scheduled_at: scheduledAt,
      assigned_to: assignedToId,
      assigned_to_name: attendantName,
      created_by: user.id,
      created_by_name: schedulerName,
      meeting_link: effectiveMeetingLink,
    },
  });
  if (stageChanged) {
    await supabase.from('activities').insert({
      lead_id: leadId,
      user_id: user.id,
      type: 'stage_change',
      title: `Etapa: ${fromStage} → ${VISIT_STAGE}`,
      description: `Visita agendada (${attendantName})`,
      is_demo: lead.is_demo,
      metadata: { from: fromStage, to: VISIT_STAGE, visit: true },
    });
  }

  // Notifica o atendente da visita em tempo real (não dispara para leads demo
  // nem quando o próprio atendente agendou).
  if (!lead.is_demo && assignedToId !== user.id) {
    await createNotification(
      assignedToId,
      'novo_lead',
      `📅 Visita agendada: ${lead.name}`,
      `${dateLabel} · Agendada por: ${schedulerName}`,
      leadId,
    );
  }

  revalidatePath('/oportunidades');
  revalidatePath('/leads');
  revalidatePath('/calendario');
  return {
    ok: true,
    data: {
      meetLink: googleSync.meetLink,
      googleFailed: googleSync.attempted && !googleSync.ok,
      inviteSkipped: googleSync.inviteSkipped,
    },
  };
}

/**
 * Confirma a visita (D-1 / D-0). Idempotente: chamadas repetidas não
 * sobrescrevem o `confirmed_at` original.
 */
export async function confirmAppointment(appointmentId: string): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { data: apt, error: fetchError } = await supabase
    .from('appointments')
    .select('id, lead_id, confirmed, scheduled_at, is_demo')
    .eq('id', appointmentId)
    .single();
  if (fetchError || !apt) return { ok: false, error: 'Visita não encontrada' };

  if (apt.confirmed) {
    return { ok: true, data: undefined };
  }

  const { error: updateError } = await supabase
    .from('appointments')
    .update({ confirmed: true, confirmed_at: new Date().toISOString() })
    .eq('id', appointmentId);
  if (updateError) return { ok: false, error: updateError.message };

  await supabase.from('activities').insert({
    lead_id: apt.lead_id,
    user_id: user.id,
    type: 'appointment',
    title: 'Visita confirmada com a família',
    description: `Para ${new Date(apt.scheduled_at).toLocaleString('pt-BR')}`,
    is_demo: apt.is_demo,
    metadata: { appointment_id: appointmentId, confirmed_at: new Date().toISOString() },
  });

  revalidatePath('/oportunidades');
  revalidatePath('/leads');
  return { ok: true, data: undefined };
}

/**
 * Marca no-show na visita: a família não compareceu. O lead vai para
 * `follow_up` com a flag `is_no_show` — a equipe retoma o contato e reagenda.
 */
export async function markNoShow(appointmentId: string): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { data: apt, error: fetchError } = await supabase
    .from('appointments')
    .select('id, lead_id, assigned_to, scheduled_at, is_demo')
    .eq('id', appointmentId)
    .single();
  if (fetchError || !apt) return { ok: false, error: 'Visita não encontrada' };

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id, name, pipeline, stage, is_demo')
    .eq('id', apt.lead_id)
    .single();
  if (leadError || !lead) return { ok: false, error: 'Lead não encontrado' };

  // 1. Marca no_show na visita.
  const { error: aptUpdateError } = await supabase
    .from('appointments')
    .update({ showed_up: false })
    .eq('id', appointmentId);
  if (aptUpdateError) return { ok: false, error: aptUpdateError.message };

  // 2. Move o lead para follow_up e marca a flag is_no_show.
  const fromStage = lead.stage;
  const { error: moveError } = await supabase
    .from('leads')
    .update({ stage: NO_SHOW_STAGE, is_no_show: true })
    .eq('id', lead.id);
  if (moveError) return { ok: false, error: moveError.message };

  await supabase.from('activities').insert({
    lead_id: lead.id,
    user_id: user.id,
    type: 'system',
    title: 'No-show registrado — família não compareceu à visita',
    description: `${fromStage} → ${NO_SHOW_STAGE}`,
    is_demo: lead.is_demo,
    metadata: {
      appointment_id: appointmentId,
      from_stage: fromStage,
      to_stage: NO_SHOW_STAGE,
    },
  });
  await supabase.from('activities').insert({
    lead_id: lead.id,
    user_id: user.id,
    type: 'stage_change',
    title: `Etapa: ${fromStage} → ${NO_SHOW_STAGE}`,
    description: 'No-show → retomar contato e reagendar',
    is_demo: lead.is_demo,
    metadata: { from: fromStage, to: NO_SHOW_STAGE, no_show: true },
  });

  // Notifica o atendente da visita (não dispara para leads demo).
  if (!lead.is_demo && apt.assigned_to && apt.assigned_to !== user.id) {
    await createNotification(
      apt.assigned_to,
      'no_show',
      `No-show: ${lead.name}`,
      `${lead.name} não compareceu à visita — retomar contato`,
      lead.id,
    );
  }

  revalidatePath('/oportunidades');
  revalidatePath('/leads');
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Edição de visita — status/labels vivem em @/types/appointment
// ---------------------------------------------------------------------------

export interface AppointmentDetail {
  id: string;
  leadId: string;
  /** Atendente da visita (assigned_to). */
  assignedToId: string | null;
  /** Quem agendou (created_by). */
  createdById: string | null;
  scheduledAt: string;
  meetingLink: string | null;
  notes: string | null;
  status: AppointmentStatus;
}

/** Carrega uma visita para edição (RLS aplica o escopo pelo lead). */
export async function getAppointment(appointmentId: string): Promise<AppointmentDetail | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('appointments')
    .select('id, lead_id, assigned_to, created_by, scheduled_at, meeting_link, notes, status')
    .eq('id', appointmentId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    leadId: data.lead_id,
    assignedToId: data.assigned_to,
    createdById: data.created_by,
    scheduledAt: data.scheduled_at,
    meetingLink: data.meeting_link,
    notes: data.notes,
    status: (data.status as AppointmentStatus) ?? 'agendado',
  };
}

export interface CalendarAppointment {
  id: string;
  leadId: string;
  leadName: string;
  scheduledAt: string;
  /** Atendente da visita (assigned_to). */
  assignedToId: string | null;
  assignedToName: string | null;
  /** Quem agendou (created_by). */
  createdById: string | null;
  createdByName: string | null;
  status: AppointmentStatus;
  meetingLink: string | null;
}

/**
 * Visitas num intervalo [from, to) para a tela de calendário. Nomes resolvidos
 * via RPC SECURITY INVOKER. RLS aplica o escopo.
 */
export async function getAppointmentsForCalendar(
  fromIso: string,
  toIso: string,
): Promise<CalendarAppointment[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('appointments')
    .select(
      'id, lead_id, scheduled_at, assigned_to, created_by, status, meeting_link, lead:leads(name)',
    )
    .gte('scheduled_at', fromIso)
    .lt('scheduled_at', toIso)
    .order('scheduled_at', { ascending: true });
  const rows = data ?? [];

  const ids = [
    ...new Set(rows.flatMap((r) => [r.assigned_to, r.created_by]).filter(Boolean)),
  ] as string[];
  const nameById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: people } = await supabase.rpc('list_salespeople');
    for (const p of people ?? []) nameById.set(p.id, p.name);
  }

  return rows.map((r) => ({
    id: r.id,
    leadId: r.lead_id,
    leadName: (r.lead as { name: string } | null)?.name ?? '—',
    scheduledAt: r.scheduled_at,
    assignedToId: r.assigned_to,
    assignedToName: r.assigned_to ? (nameById.get(r.assigned_to) ?? null) : null,
    createdById: r.created_by,
    createdByName: r.created_by ? (nameById.get(r.created_by) ?? null) : null,
    status: (r.status as AppointmentStatus) ?? 'agendado',
    meetingLink: r.meeting_link,
  }));
}

export interface TeamMember {
  id: string;
  name: string;
  role: UserRole;
}

/** Equipe (admin + comercial) para selects de atendente e filtros do calendário. */
export async function listTeamMembers(): Promise<TeamMember[]> {
  const supabase = createClient();
  const { data } = await supabase.rpc('list_salespeople');
  return (data ?? []).map((p) => ({ id: p.id, name: p.name, role: p.role }));
}

const updateAppointmentSchema = z.object({
  scheduledAt: z.string().datetime({ offset: true }),
  /** Atendente da visita (assigned_to). */
  assignedToId: z.string().uuid(),
  meetingLink: z.string().url().nullable().optional().or(z.literal('')),
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(APPOINTMENT_STATUSES as unknown as [AppointmentStatus, ...AppointmentStatus[]]),
});

export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;

/**
 * Edita uma visita. Sincroniza confirmed/showed_up a partir do status (mantém
 * badges do board/tab coerentes) e registra activity com os campos alterados.
 */
export async function updateAppointment(
  appointmentId: string,
  rawInput: unknown,
): Promise<ActionResult> {
  const parsed = updateAppointmentSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { data: apt, error: fetchError } = await supabase
    .from('appointments')
    .select(
      'id, lead_id, assigned_to, created_by, scheduled_at, meeting_link, notes, status, confirmed_at, is_demo',
    )
    .eq('id', appointmentId)
    .single();
  if (fetchError || !apt) return { ok: false, error: 'Visita não encontrada' };

  const { assignedToId, notes, status } = parsed.data;
  const meetingLink = parsed.data.meetingLink || null;
  const scheduledIso = new Date(parsed.data.scheduledAt).toISOString();
  const confirmed = status === 'confirmado' || status === 'realizado';
  const showedUp = status === 'realizado' ? true : null;

  const { error: updateError } = await supabase
    .from('appointments')
    .update({
      scheduled_at: scheduledIso,
      assigned_to: assignedToId,
      meeting_link: meetingLink,
      notes: notes ?? null,
      status,
      confirmed,
      confirmed_at: confirmed ? (apt.confirmed_at ?? new Date().toISOString()) : null,
      showed_up: showedUp,
    })
    .eq('id', appointmentId);
  if (updateError) return { ok: false, error: updateError.message };

  const changes: string[] = [];
  if (scheduledIso !== apt.scheduled_at)
    changes.push(`data → ${new Date(scheduledIso).toLocaleString('pt-BR')}`);
  if (assignedToId !== apt.assigned_to) changes.push('atendente');
  if (meetingLink !== apt.meeting_link) changes.push('link');
  if ((notes ?? null) !== (apt.notes ?? null)) changes.push('observações');
  if (status !== apt.status) changes.push(`status → ${APPOINTMENT_STATUS_LABELS[status]}`);

  const userName = await fetchUserName(supabase, user.id, 'usuário');
  await supabase.from('activities').insert({
    lead_id: apt.lead_id,
    user_id: user.id,
    type: 'appointment',
    title: `Visita editada por ${userName}`,
    description: changes.length > 0 ? changes.join(' · ') : 'sem alterações de campo',
    is_demo: apt.is_demo,
    metadata: { appointment_id: appointmentId, status, scheduled_at: scheduledIso },
  });

  // Reflete no Google Calendar (best-effort, no-op sem integração/evento):
  // cancelamento apaga o evento; demais edições fazem patch.
  if (status === 'cancelado' && apt.status !== 'cancelado') {
    await syncAppointmentCancel(appointmentId);
  } else if (status !== 'cancelado') {
    await syncAppointmentUpdate(appointmentId);
  }

  revalidatePath('/oportunidades');
  revalidatePath('/leads');
  revalidatePath('/calendario');
  return { ok: true, data: undefined };
}

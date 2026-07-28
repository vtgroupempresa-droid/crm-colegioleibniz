import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { assignLeadRoundRobin } from '@/lib/leads/distribution';
import { notifyLeadCreated } from '@/actions/notifications';
import {
  EDUCATION_LEVELS,
  INTEREST_LEVELS,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  type Lead,
  type LeadInsert,
  type LeadSource,
} from '@/types/lead';

/**
 * Webhook público de ENTRADA de leads.
 *
 * POST /api/webhooks/new-lead
 *   { secret, name, phone|email, source?, utm_*?, child_name?, child_age?,
 *     education_level?, school_year?, interest_level?, with_child?, landing_page? }
 *
 * Pensado para o site da escola, Traffic AI e formulários externos
 * (n8n/Zapier/Elementor).
 *
 * Fluxo:
 *  1. valida `secret` contra WEBHOOK_SECRET
 *  2. deduplica por phone/email (leads não arquivados) — devolve o existente (200)
 *  3. cria o lead em comercial/novo_lead com distribuição round-robin
 *  4. registra activities (criação + distribuição) e dispara notificações
 *  5. responde { lead_id, assigned_to } com 201
 *
 * Roda SEM sessão autenticada → usa o admin client (service role).
 */

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    secret: z.string().min(1),
    name: z.string().min(2, 'name é obrigatório'),
    phone: z.string().trim().min(8).optional().or(z.literal('')),
    email: z.string().trim().email().optional().or(z.literal('')),
    source: z.enum(LEAD_SOURCES as unknown as [string, ...string[]]).optional(),
    utm_source: z.string().optional(),
    utm_medium: z.string().optional(),
    utm_campaign: z.string().optional(),
    utm_content: z.string().optional(),
    child_name: z.string().optional(),
    child_age: z.number().int().nonnegative().optional(),
    education_level: z.enum(EDUCATION_LEVELS as unknown as [string, ...string[]]).optional(),
    school_year: z.string().optional(),
    interest_level: z.enum(INTEREST_LEVELS as unknown as [string, ...string[]]).optional(),
    with_child: z.boolean().optional(),
    landing_page: z.string().optional(),
  })
  .refine((d) => Boolean((d.phone && d.phone !== '') || (d.email && d.email !== '')), {
    message: 'phone ou email é obrigatório',
  });

const ENTRY_PIPELINE = 'comercial';
const ENTRY_STAGE = 'novo_lead';

export async function POST(req: Request) {
  const expected = process.env.WEBHOOK_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'WEBHOOK_SECRET não configurado no servidor' },
      { status: 500 },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 400 },
    );
  }

  if (parsed.data.secret !== expected) {
    return NextResponse.json({ error: 'Secret inválido' }, { status: 401 });
  }

  const data = parsed.data;
  const phone = data.phone && data.phone !== '' ? data.phone : null;
  const email = data.email && data.email !== '' ? data.email : null;

  const admin = createAdminClient();

  // 2. Deduplicação por phone/email entre leads NÃO arquivados.
  const orFilters: string[] = [];
  if (phone) orFilters.push(`phone.eq.${phone}`);
  if (email) orFilters.push(`email.eq.${email}`);

  if (orFilters.length > 0) {
    const { data: existing } = await admin
      .from('leads')
      .select('id, assigned_to')
      .eq('is_archived', false)
      .or(orFilters.join(','))
      .limit(1)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        {
          duplicate: true,
          lead_id: existing.id,
          assigned_to: existing.assigned_to,
        },
        { status: 200 },
      );
    }
  }

  // 3. Distribuição round-robin. Webhook é sempre produção (is_demo=false).
  const assignment = await assignLeadRoundRobin(admin);
  const source: LeadSource = (data.source ?? 'site') as LeadSource;

  const insert: LeadInsert = {
    name: data.name,
    phone,
    email,
    child_name: data.child_name ?? null,
    child_age: data.child_age ?? null,
    education_level: (data.education_level ?? null) as Lead['education_level'],
    school_year: data.school_year ?? null,
    interest_level: (data.interest_level ?? null) as Lead['interest_level'],
    with_child: data.with_child ?? null,
    source,
    utm_source: data.utm_source ?? null,
    utm_medium: data.utm_medium ?? null,
    utm_campaign: data.utm_campaign ?? null,
    utm_content: data.utm_content ?? null,
    landing_page: data.landing_page ?? null,
    pipeline: ENTRY_PIPELINE,
    stage: ENTRY_STAGE,
    assigned_to: assignment.assignedTo,
    is_demo: false,
  };

  const { data: created, error } = await admin
    .from('leads')
    .insert(insert)
    .select('id, name, assigned_to')
    .single();

  if (error || !created) {
    return NextResponse.json({ error: error?.message ?? 'Falha ao criar lead' }, { status: 500 });
  }

  // 4. Activities (criação via webhook + distribuição).
  const sourceLabel = LEAD_SOURCE_LABELS[source];
  await admin.from('activities').insert([
    {
      lead_id: created.id,
      user_id: null,
      type: 'system',
      title: 'Lead criado via webhook',
      description: `Origem: ${sourceLabel}`,
      is_demo: false,
      metadata: {
        via: 'webhook',
        source,
        utm_source: data.utm_source ?? null,
        utm_campaign: data.utm_campaign ?? null,
      },
    },
    {
      lead_id: created.id,
      user_id: null,
      type: 'system',
      title: 'Distribuição automática',
      description: assignment.assignedName
        ? `Distribuído para ${assignment.assignedName} (round-robin por menor carga).`
        : 'Sem responsável — nenhum usuário disponível para distribuição.',
      is_demo: false,
      metadata: {
        assigned_to: assignment.assignedTo,
        assigned_name: assignment.assignedName,
      },
    },
  ]);

  // 5. Notificações (novo lead ao responsável ou aos admins).
  await notifyLeadCreated({
    leadId: created.id,
    name: created.name,
    assignedTo: created.assigned_to,
    sourceLabel,
    isDemo: false,
  });

  return NextResponse.json(
    {
      lead_id: created.id,
      assigned_to: created.assigned_to,
      duplicate: false,
    },
    { status: 201 },
  );
}

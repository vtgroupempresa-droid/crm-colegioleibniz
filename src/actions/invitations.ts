'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { USER_ROLES, isUserRole, type UserRole } from '@/types/user';
import type { ActionResult } from './leads';

/**
 * Convites por link (Fase 23).
 *
 * Um admin gera um convite (e-mail + cargo). O sistema cria um token e devolve
 * um link copiável — o admin envia quando/como quiser. A pessoa abre o link,
 * escolhe a própria senha e a conta é criada já com o cargo do convite. A
 * aceitação é pública (sem sessão), então usa o service role; a tabela é RLS
 * só-admin. Apenas funções async são exportadas ('use server').
 */

const INVITE_TTL_DAYS = 7;

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface InvitationRow {
  id: string;
  email: string;
  role: UserRole;
  sectorId: string | null;
  status: InvitationStatus;
  inviteUrl: string;
  createdAt: string;
  expiresAt: string;
}

export interface PublicInvitation {
  email: string;
  role: UserRole;
  sectorId: string | null;
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
}

function inviteUrlFor(token: string): string {
  const base = siteUrl();
  return base ? `${base}/convite/${token}` : `/convite/${token}`;
}

function statusOf(row: {
  accepted_at: string | null;
  revoked_at: string | null;
  expires_at: string;
}): InvitationStatus {
  if (row.accepted_at) return 'accepted';
  if (row.revoked_at) return 'revoked';
  if (new Date(row.expires_at).getTime() < Date.now()) return 'expired';
  return 'pending';
}

const createSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('E-mail inválido'),
    role: z.enum(USER_ROLES as unknown as [string, ...string[]]),
    sectorId: z.string().uuid().nullable(),
  })
  .refine((value) => value.role === 'admin' || value.sectorId, {
    message: 'Selecione o setor do usuário',
    path: ['sectorId'],
  });

/** Cria um convite e devolve o link para o admin enviar. */
export async function createInvitation(
  rawInput: unknown,
): Promise<ActionResult<{ inviteUrl: string }>> {
  const parsed = createSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };
  const { data: me } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (me?.role !== 'admin') return { ok: false, error: 'Apenas admins podem criar convites' };

  const { email, role, sectorId } = parsed.data;
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase.from('invitations').insert({
    email,
    role: role as UserRole,
    sector_id: sectorId,
    token,
    created_by: user.id,
    expires_at: expiresAt,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin');
  return { ok: true, data: { inviteUrl: inviteUrlFor(token) } };
}

/** Lista convites (admin) com status derivado e link pronto. */
export async function listInvitations(): Promise<InvitationRow[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: me } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (me?.role !== 'admin') return [];

  const { data } = await supabase
    .from('invitations')
    .select('id, email, role, sector_id, token, accepted_at, revoked_at, expires_at, created_at')
    .order('created_at', { ascending: false });

  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: isUserRole(row.role) ? row.role : 'comercial',
    sectorId: row.sector_id,
    status: statusOf(row),
    inviteUrl: inviteUrlFor(row.token),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));
}

/** Revoga um convite ainda não aceito. */
export async function revokeInvitation(rawId: unknown): Promise<ActionResult> {
  const parsed = z.string().uuid().safeParse(rawId);
  if (!parsed.success) return { ok: false, error: 'ID inválido' };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };
  const { data: me } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (me?.role !== 'admin') return { ok: false, error: 'Apenas admins podem revogar convites' };

  const { error } = await supabase
    .from('invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', parsed.data)
    .is('accepted_at', null);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin');
  return { ok: true, data: undefined };
}

/** Lê um convite válido pelo token (página pública, service role). */
export async function getInvitationByToken(token: string): Promise<PublicInvitation | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('invitations')
    .select('email, role, sector_id, accepted_at, revoked_at, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (!data || statusOf(data) !== 'pending') return null;
  return {
    email: data.email,
    role: isUserRole(data.role) ? data.role : 'comercial',
    sectorId: data.sector_id,
  };
}

const acceptSchema = z.object({
  token: z.string().min(10),
  name: z.string().trim().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres'),
});

/**
 * Aceita o convite: cria a conta com a senha escolhida e o cargo do convite.
 * Público (sem sessão) — usa service role. O e-mail vem do convite, não do
 * input (a pessoa não pode trocar para quem o convite foi emitido).
 */
export async function acceptInvitation(rawInput: unknown): Promise<ActionResult> {
  const parsed = acceptSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }
  const { token, name, password } = parsed.data;

  const admin = createAdminClient();
  const { data: invite } = await admin
    .from('invitations')
    .select('id, email, role, sector_id, accepted_at, revoked_at, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (!invite) return { ok: false, error: 'Convite inválido' };

  const status = statusOf(invite);
  if (status === 'accepted') return { ok: false, error: 'Este convite já foi utilizado' };
  if (status === 'revoked') return { ok: false, error: 'Este convite foi revogado' };
  if (status === 'expired') return { ok: false, error: 'Este convite expirou' };

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
    user_metadata: { name },
    app_metadata: {
      role: invite.role,
      sector_id: invite.sector_id,
      must_change_password: false,
    },
  });
  if (createErr || !created.user) {
    return { ok: false, error: createErr?.message ?? 'Não foi possível criar a conta' };
  }

  await admin
    .from('invitations')
    .update({ accepted_at: new Date().toISOString(), accepted_user_id: created.user.id })
    .eq('id', invite.id);

  return { ok: true, data: undefined };
}

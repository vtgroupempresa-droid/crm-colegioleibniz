'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSession, isAdmin } from '@/lib/auth/session';
import { fetchOfficialWhatsappStatus } from '@/lib/whatsapp/official-client';
import { WHATSAPP_PROVIDERS } from '@/types/whatsapp-instance';
import type { WhatsappInstanceBadge } from '@/types/whatsapp-instance';
import type { ActionResult } from './leads';

/**
 * Server Actions das linhas de WhatsApp (WABA — API oficial da Meta).
 *
 * O Colégio Leibniz usa exclusivamente a API oficial: cada "instância" é um
 * número (phone_number_id) da conta WhatsApp Business. O instance_token é
 * SEGREDO: só o service role (admin client) lê. Para a UI devolvemos
 * `tokenPreview` (últimos 4 caracteres). Escrita restrita a admin.
 */

const instanceSchema = z.object({
  name: z.string().min(2, 'Nome da linha obrigatório').max(100),
  label: z.string().max(6, 'Sigla de até 6 caracteres').nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Cor em formato hex (#22c55e)')
    .nullable()
    .optional(),
  provider: z.enum(WHATSAPP_PROVIDERS as unknown as [string, ...string[]]).default('official'),
  /** Vazio na edição = mantém o token atual. */
  instanceToken: z.string().max(200).nullable().optional(),
  phoneNumber: z.string().max(30).nullable().optional(),
  isActive: z.boolean().default(true),
});

export type WhatsappInstanceInput = z.infer<typeof instanceSchema>;

/** Linha segura para a tabela do /admin — sem o token cru. */
export interface WhatsappInstanceRow {
  id: string;
  name: string;
  label: string | null;
  color: string | null;
  provider: string;
  phone_number: string | null;
  is_active: boolean;
  is_connected: boolean;
  last_connected_at: string | null;
  created_at: string;
  hasToken: boolean;
  tokenPreview: string | null;
}

async function requireAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Não autenticado' };
  if (!isAdmin(session.role)) {
    return { ok: false, error: 'Apenas o admin pode gerenciar as linhas de WhatsApp' };
  }
  return { ok: true };
}

/** Lista completa para o /admin — token mascarado. */
export async function listWhatsappInstances(): Promise<WhatsappInstanceRow[]> {
  const auth = await requireAdmin();
  if (!auth.ok) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from('whatsapp_instances')
    .select('*')
    .order('created_at', { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    label: row.label,
    color: row.color,
    provider: row.provider,
    phone_number: row.phone_number,
    is_active: row.is_active,
    is_connected: row.is_connected,
    last_connected_at: row.last_connected_at,
    created_at: row.created_at,
    hasToken: Boolean(row.instance_token),
    tokenPreview: row.instance_token ? `…${row.instance_token.slice(-4)}` : null,
  }));
}

/** Badges das linhas ativas para os filtros do /chat (qualquer role). */
export async function listWhatsappInstanceBadges(): Promise<WhatsappInstanceBadge[]> {
  const supabase = createClient();
  // Client do usuário: a RLS permite SELECT, exceto a coluna instance_token.
  const { data } = await supabase
    .from('whatsapp_instances')
    .select('id, name, label, color, is_connected, provider')
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  return data ?? [];
}

export async function createWhatsappInstance(
  rawInput: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const parsed = instanceSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const admin = createAdminClient();
  const d = parsed.data;
  const { data, error } = await admin
    .from('whatsapp_instances')
    .insert({
      name: d.name,
      label: d.label?.trim() || null,
      color: d.color ?? null,
      provider: d.provider,
      instance_token: d.instanceToken?.trim() || null,
      phone_number: d.phoneNumber?.trim() || null,
      is_active: d.isActive,
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'Falha ao criar linha' };

  revalidatePath('/admin');
  revalidatePath('/chat');
  return { ok: true, data: { id: data.id } };
}

export async function updateWhatsappInstance(
  id: string,
  rawInput: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const parsed = instanceSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const admin = createAdminClient();
  const d = parsed.data;
  const token = d.instanceToken?.trim();
  const { error } = await admin
    .from('whatsapp_instances')
    .update({
      name: d.name,
      label: d.label?.trim() || null,
      color: d.color ?? null,
      provider: d.provider,
      phone_number: d.phoneNumber?.trim() || null,
      is_active: d.isActive,
      // Token vazio na edição = mantém o atual (não dá para reexibir o segredo).
      ...(token ? { instance_token: token } : {}),
    })
    .eq('id', id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin');
  revalidatePath('/chat');
  return { ok: true, data: { id } };
}

export async function toggleWhatsappInstanceActive(
  id: string,
  isActive: boolean,
): Promise<ActionResult<{ id: string; isActive: boolean }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const admin = createAdminClient();
  const { error } = await admin
    .from('whatsapp_instances')
    .update({ is_active: isActive })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin');
  revalidatePath('/chat');
  return { ok: true, data: { id, isActive } };
}

export interface InstanceConnectionStatus {
  connected: boolean;
  loggedIn: boolean;
  profileName: string | null;
  phoneNumber: string | null;
}

/**
 * "Testar conexão" do /admin: consulta o número na Graph API oficial
 * (GET {phone_number_id}) e atualiza is_connected / last_connected_at /
 * phone_number da linha.
 */
export async function testWhatsappInstanceConnection(
  id: string,
): Promise<ActionResult<InstanceConnectionStatus>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const admin = createAdminClient();
  const { data: instance } = await admin
    .from('whatsapp_instances')
    .select('id, name, instance_token, provider, is_connected')
    .eq('id', id)
    .maybeSingle();
  if (!instance) return { ok: false, error: 'Linha não encontrada' };

  const status = await fetchOfficialWhatsappStatus();
  const connected = status.configured && !status.error;

  await admin
    .from('whatsapp_instances')
    .update({
      is_connected: connected,
      ...(connected
        ? { last_connected_at: new Date().toISOString() }
        : { last_disconnected_at: new Date().toISOString() }),
      ...(status.displayPhoneNumber ? { phone_number: status.displayPhoneNumber } : {}),
    })
    .eq('id', id);

  revalidatePath('/admin');
  revalidatePath('/chat');

  if (!status.configured) {
    return { ok: false, error: status.error ?? 'WhatsApp oficial ainda não configurado' };
  }
  if (status.error) {
    return { ok: false, error: status.error };
  }

  return {
    ok: true,
    data: {
      connected,
      loggedIn: connected,
      profileName: status.verifiedName,
      phoneNumber: status.displayPhoneNumber,
    },
  };
}

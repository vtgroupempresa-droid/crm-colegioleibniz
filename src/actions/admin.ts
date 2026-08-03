'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { USER_ROLES, type UserRole } from '@/types/user';
import type { ActionResult } from './leads';

/**
 * Atualiza a role de um usuário. Só admins podem chamar — o restante recebe
 * erro de autorização. Sem mexer em outros campos do perfil.
 */
const updateUserRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(USER_ROLES as unknown as [string, ...string[]]),
});

export async function updateUserRole(rawInput: unknown): Promise<ActionResult> {
  const parsed = updateUserRoleSchema.safeParse(rawInput);
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
  if (me?.role !== 'admin') {
    return { ok: false, error: 'Apenas admins podem alterar roles' };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('user_profiles')
    .update({ role: parsed.data.role as UserRole })
    .eq('id', parsed.data.userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin');
  return { ok: true, data: undefined };
}

const updateUserSectorSchema = z.object({
  userId: z.string().uuid(),
  sectorId: z.string().uuid().nullable(),
});

/** Vincula uma conta ao setor que delimita seu inbox. Apenas administradores. */
export async function updateUserSector(rawInput: unknown): Promise<ActionResult> {
  const parsed = updateUserSectorSchema.safeParse(rawInput);
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
  if (me?.role !== 'admin') {
    return { ok: false, error: 'Apenas administradores podem alterar setores' };
  }

  const admin = createAdminClient();
  const { data: target } = await admin
    .from('user_profiles')
    .select('role')
    .eq('id', parsed.data.userId)
    .maybeSingle();
  if (!target) return { ok: false, error: 'Usuário não encontrado' };
  if (target.role !== 'admin' && !parsed.data.sectorId) {
    return { ok: false, error: 'Usuários operacionais precisam de um setor' };
  }

  if (parsed.data.sectorId) {
    const { data: sector } = await admin
      .from('sectors')
      .select('id')
      .eq('id', parsed.data.sectorId)
      .eq('is_active', true)
      .maybeSingle();
    if (!sector) return { ok: false, error: 'Setor inválido ou inativo' };
  }

  const { error } = await admin
    .from('user_profiles')
    .update({ sector_id: parsed.data.sectorId })
    .eq('id', parsed.data.userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin');
  return { ok: true, data: undefined };
}

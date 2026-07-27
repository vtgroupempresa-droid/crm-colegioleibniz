'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
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

  const { error } = await supabase
    .from('user_profiles')
    .update({ role: parsed.data.role as UserRole })
    .eq('id', parsed.data.userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin');
  return { ok: true, data: undefined };
}

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from './leads';

/**
 * Server Actions do perfil do usuário (Fase 8).
 *
 * - `updateProfile`: nome, telefone e avatar_url. Usado tanto na página /perfil
 *   quanto no onboarding (definir o nome remove o redirect de onboarding).
 * - `requestPasswordReset`: dispara o email de reset do Supabase Auth.
 *
 * O role NÃO é editável aqui — alteração é exclusiva do admin.
 */

const updateProfileSchema = z.object({
  name: z.string().trim().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  phone: z.string().trim().max(30).nullable().optional().or(z.literal('')),
  avatarUrl: z.string().url().nullable().optional().or(z.literal('')),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export async function updateProfile(rawInput: unknown): Promise<ActionResult> {
  const parsed = updateProfileSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { name, phone, avatarUrl } = parsed.data;

  const { error } = await supabase
    .from('user_profiles')
    .update({
      name,
      phone: phone && phone !== '' ? phone : null,
      ...(avatarUrl !== undefined ? { avatar_url: avatarUrl && avatarUrl !== '' ? avatarUrl : null } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/perfil');
  revalidatePath('/', 'layout');
  return { ok: true, data: undefined };
}

/** Atualiza apenas o avatar (chamado após upload no client). */
export async function updateAvatar(avatarUrl: string | null): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { error } = await supabase
    .from('user_profiles')
    .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
    .eq('id', user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/perfil');
  revalidatePath('/', 'layout');
  return { ok: true, data: undefined };
}

/**
 * Troca a senha do próprio usuário direto nas configurações, sem reautenticação
 * (usa a sessão atual). Pedido do usuário: a senha padrão de onboarding deve
 * poder ser trocada em /perfil sem precisar do fluxo de e-mail.
 */
const updatePasswordSchema = z
  .object({
    password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres'),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: 'As senhas não conferem',
    path: ['confirm'],
  });

export async function updatePassword(rawInput: unknown): Promise<ActionResult> {
  const parsed = updatePasswordSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado' };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: error.message };

  return { ok: true, data: undefined };
}

/** Dispara o email de redefinição de senha do Supabase Auth. */
export async function requestPasswordReset(): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, error: 'Não autenticado' };

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
    redirectTo: siteUrl ? `${siteUrl}/login` : undefined,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

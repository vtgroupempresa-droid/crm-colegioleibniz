'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ActionResult } from './leads';

const passwordSchema = z
  .object({
    password: z
      .string()
      .min(10, 'A nova senha deve ter pelo menos 10 caracteres')
      .regex(/[a-z]/, 'Inclua uma letra minúscula')
      .regex(/[A-Z]/, 'Inclua uma letra maiúscula')
      .regex(/[0-9]/, 'Inclua um número'),
    confirmation: z.string(),
  })
  .refine((value) => value.password === value.confirmation, {
    message: 'As senhas não coincidem',
    path: ['confirmation'],
  })
  .refine((value) => value.password !== 'Eusei123', {
    message: 'Escolha uma senha diferente da senha temporária',
    path: ['password'],
  });

/** Troca a senha temporária e libera o restante do CRM. */
export async function changeInitialPassword(rawInput: unknown): Promise<ActionResult> {
  const parsed = passwordSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join(', ') };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sua sessão expirou. Entre novamente.' };

  const { error: passwordError } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (passwordError) return { ok: false, error: passwordError.message };

  const admin = createAdminClient();
  const { error: profileError } = await admin
    .from('user_profiles')
    .update({ must_change_password: false })
    .eq('id', user.id);
  if (profileError) {
    return {
      ok: false,
      error: 'A senha foi alterada, mas não foi possível liberar o acesso. Procure um administrador.',
    };
  }

  await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, must_change_password: false },
  });

  return { ok: true, data: undefined };
}

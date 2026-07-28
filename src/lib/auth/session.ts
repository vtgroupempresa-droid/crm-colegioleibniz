import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { UserRole } from '@/types/user';
import { isUserRole } from '@/types/user';

export interface SessionInfo {
  userId: string;
  role: UserRole;
  name: string;
}

/**
 * Resolve o usuário logado + role. Retorna null se não houver sessão.
 * Usado por páginas que precisam de gate por role (ex.: /admin, /integracoes).
 *
 * Envolvido em React cache(): layout, página e componentes aninhados chamam
 * getSession() no MESMO request — sem o cache cada chamada repetia a ida ao
 * Supabase Auth (getUser) + o select em user_profiles.
 */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('name, role')
    .eq('id', user.id)
    .maybeSingle();

  const role: UserRole = profile && isUserRole(profile.role) ? profile.role : 'comercial';
  return { userId: user.id, role, name: profile?.name ?? user.email ?? 'Usuário' };
});

/** Acesso de gestão total (Dércio e Alisson). */
export function isAdmin(role: UserRole): boolean {
  return role === 'admin';
}

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { UserRole } from '@/types/user';
import { isUserRole } from '@/types/user';

export interface SessionInfo {
  userId: string;
  role: UserRole;
  name: string;
  sectorId: string | null;
  sectorName: string | null;
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
    .select('name, role, sector_id, sector:sectors(name)')
    .eq('id', user.id)
    .maybeSingle();

  const role: UserRole = profile && isUserRole(profile.role) ? profile.role : 'comercial';
  const sector = profile?.sector as { name: string } | null | undefined;
  return {
    userId: user.id,
    role,
    name: profile?.name ?? user.email ?? 'Usuário',
    sectorId: profile?.sector_id ?? null,
    sectorName: sector?.name ?? null,
  };
});

/** Acesso de gestão total (Dércio e Alisson). */
export function isAdmin(role: UserRole): boolean {
  return role === 'admin';
}

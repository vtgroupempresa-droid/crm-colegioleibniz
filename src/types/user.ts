import type { Tables, TablesInsert, TablesUpdate, Enums } from './database';

/**
 * Cargos do sistema Colégio Leibniz:
 *  - `admin`: acesso total (Dércio e Alisson) — gestão de usuários, etapas,
 *    automações, metas e integrações.
 *  - `comercial`: equipe de atendimento/vendas (Lorraine, Lucília, Núbia) —
 *    opera leads, chat, visitas e matrículas.
 */
export type UserRole = Enums<'user_role'>;

export type UserProfile = Tables<'user_profiles'>;
export type UserProfileInsert = TablesInsert<'user_profiles'>;
export type UserProfileUpdate = TablesUpdate<'user_profiles'>;
export type Sector = Tables<'sectors'>;

export interface SectorSummary {
  id: string;
  slug: string;
  name: string;
  color: string;
}

export const USER_ROLES: readonly UserRole[] = ['admin', 'comercial'] as const;

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  comercial: 'Comercial',
};

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

/**
 * Cargos que entram nas listas de "quem atende/fecha" da UI (fechar matrícula,
 * responsável por visita, calendário). No Leibniz toda a equipe atende.
 */
export function isCloserRole(role: string): boolean {
  return role === 'admin' || role === 'comercial';
}

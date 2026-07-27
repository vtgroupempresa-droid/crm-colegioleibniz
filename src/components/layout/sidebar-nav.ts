import type { UserRole } from '@/types/user';

/** Chave do ícone SVG do item (mapeada para componente em sidebar.tsx). */
export type NavIconKey =
  | 'leads'
  | 'oportunidades'
  | 'calendario'
  | 'chat'
  | 'disparos'
  | 'dashboard'
  | 'relatorios'
  | 'integracoes'
  | 'admin';

export interface NavItem {
  href: string;
  label: string;
  /** Ícone SVG do design system (components/ui/icons) — emojis descontinuados. */
  icon: NavIconKey;
  roles: readonly UserRole[];
}

/**
 * Itens da sidebar com filtro por cargo:
 *  - Comercial (Lorraine, Lucília, Núbia) → operação: leads, funil,
 *    calendário de visitas, chat e disparos.
 *  - Admin (Dércio, Alisson) → tudo, incluindo dashboard, relatórios,
 *    integrações e configurações (/admin).
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/leads', label: 'Todos os Leads', icon: 'leads', roles: ['admin', 'comercial'] },
  {
    href: '/oportunidades',
    label: 'Funil',
    icon: 'oportunidades',
    roles: ['admin', 'comercial'],
  },
  { href: '/calendario', label: 'Calendário', icon: 'calendario', roles: ['admin', 'comercial'] },
  { href: '/chat', label: 'Chat', icon: 'chat', roles: ['admin', 'comercial'] },
  { href: '/disparos', label: 'Disparos', icon: 'disparos', roles: ['admin', 'comercial'] },
  { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', roles: ['admin'] },
  { href: '/relatorios', label: 'Relatórios', icon: 'relatorios', roles: ['admin'] },
  { href: '/integracoes', label: 'Integrações', icon: 'integracoes', roles: ['admin'] },
  { href: '/admin', label: 'Admin', icon: 'admin', roles: ['admin'] },
] as const;

export function navItemsFor(role: UserRole): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOutAction } from '@/app/(auth)/login/actions';
import { getUnreadChatCount } from '@/actions/conversations';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import {
  CalendarIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  FileTextIcon,
  KanbanIcon,
  LogOutIcon,
  MegaphoneIcon,
  MessageCircleIcon,
  PlugIcon,
  SettingsIcon,
  TrendingUpIcon,
  UsersIcon,
} from '@/components/ui/icons';
import type { UserRole } from '@/types/user';
import { USER_ROLE_LABELS } from '@/types/user';
import { navItemsFor, type NavIconKey } from './sidebar-nav';

/** Ícone SVG de cada item do menu (chave definida em sidebar-nav.ts). */
const NAV_ICONS: Record<NavIconKey, (props: { size?: number; className?: string }) => JSX.Element> =
  {
    leads: UsersIcon,
    oportunidades: KanbanIcon,
    calendario: CalendarIcon,
    chat: MessageCircleIcon,
    disparos: MegaphoneIcon,
    dashboard: TrendingUpIcon,
    relatorios: FileTextIcon,
    integracoes: PlugIcon,
    admin: SettingsIcon,
  };

interface SidebarProps {
  userName: string;
  userRole: UserRole;
  chatUnread?: number;
  /**
   * 'desktop' (padrão): coluna fixa, oculta no mobile (< md).
   * 'drawer': conteúdo da gaveta mobile — sempre expandida, sem toggle,
   * fecha ao navegar (onNavigate).
   */
  variant?: 'desktop' | 'drawer';
  onNavigate?: () => void;
}

const ROLE_LABELS: Record<UserRole, string> = USER_ROLE_LABELS;

const STORAGE_KEY = 'sidebar-collapsed';

export function Sidebar({
  userName,
  userRole,
  chatUnread = 0,
  variant = 'desktop',
  onNavigate,
}: SidebarProps) {
  const pathname = usePathname();
  const items = navItemsFor(userRole);
  const [unread, setUnread] = useState(chatUnread);
  const [collapsedState, setCollapsedState] = useState(false);
  const isDrawer = variant === 'drawer';
  // Gaveta mobile nunca recolhe (não faria sentido numa overlay).
  const collapsed = isDrawer ? false : collapsedState;

  useEffect(() => {
    setUnread(chatUnread);
  }, [chatUnread]);

  // Recolhida/expandida persiste no localStorage (lido após montar p/ evitar
  // mismatch de hidratação).
  useEffect(() => {
    setCollapsedState(window.localStorage.getItem(STORAGE_KEY) === '1');
  }, []);

  function toggle() {
    setCollapsedState((prev) => {
      const next = !prev;
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  }

  // Realtime: qualquer mudança em mensagens recalcula o contador de não lidas.
  // SÓ a sidebar desktop assina: o client do Supabase é singleton e a gaveta
  // mobile montaria uma SEGUNDA assinatura do mesmo canal — o subscribe
  // duplicado lança ("tried to subscribe multiple times") e derrubava a página
  // ao abrir o menu. A gaveta é efêmera e usa o contador inicial da prop.
  useEffect(() => {
    if (isDrawer) return;
    const supabase = createClient();
    const channel = supabase
      .channel('sidebar:chat-unread')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        void getUnreadChatCount().then(setUnread);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isDrawer]);

  return (
    <aside
      className={cn(
        'flex-col border-r border-brand-100 bg-white',
        isDrawer
          ? 'flex h-full w-72'
          : cn(
              // Desktop: coluna fixa; no telefone fica oculta (gaveta via hambúrguer).
              'hidden h-screen transition-[width] duration-200 md:flex',
              collapsed ? 'w-16' : 'w-64',
            ),
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 py-5',
          collapsed ? 'justify-center px-2' : 'justify-between px-6',
        )}
      >
        {!collapsed && (
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-brand-700">Colégio Leibniz</h1>
            <p className="text-xs text-brand-400">CRM Comercial</p>
          </div>
        )}
        {!isDrawer && (
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
            className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-brand-500 hover:bg-brand-100"
          >
            {collapsed ? <ChevronsRightIcon size={16} /> : <ChevronsLeftIcon size={16} />}
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3">
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const showChatBadge = item.href === '/chat' && unread > 0;
            const Icon = NAV_ICONS[item.icon];
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  onClick={onNavigate}
                  className={cn(
                    'flex items-center rounded-md py-2 text-sm font-medium transition-colors',
                    collapsed ? 'justify-center px-0' : 'justify-between px-3',
                    // Toque confortável na gaveta mobile (44px).
                    isDrawer && 'py-2.5',
                    isActive ? 'bg-brand-700 text-canvas' : 'text-brand-600 hover:bg-brand-100',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Icon
                      size={18}
                      className={cn('shrink-0', isActive ? 'text-canvas' : 'text-brand-400')}
                    />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </span>
                  {showChatBadge && (
                    <span
                      className={cn(
                        'flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold',
                        collapsed && 'absolute ml-6 -mt-4',
                        isActive ? 'bg-canvas text-brand-700' : 'bg-rose-500 text-white',
                      )}
                    >
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className={cn('border-t border-brand-100 py-4', collapsed ? 'px-2' : 'px-4')}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-xs font-semibold text-canvas"
              title={`${userName} · ${ROLE_LABELS[userRole]}`}
            >
              {userName.charAt(0).toUpperCase()}
            </span>
            <form action={signOutAction}>
              <button
                type="submit"
                title="Sair"
                aria-label="Sair"
                className="focus-ring flex h-8 w-8 items-center justify-center rounded-md text-brand-500 hover:bg-brand-100 hover:text-brand-700"
              >
                <LogOutIcon size={16} />
              </button>
            </form>
          </div>
        ) : (
          <>
            <p className="truncate text-sm font-medium text-brand-700">{userName}</p>
            <p className="text-xs text-brand-400">{ROLE_LABELS[userRole]}</p>
            <form action={signOutAction} className="mt-3">
              <button
                type="submit"
                className="focus-ring flex items-center gap-1.5 text-xs font-medium text-brand-500 hover:text-brand-700"
              >
                <LogOutIcon size={14} /> Sair
              </button>
            </form>
          </>
        )}
      </div>
    </aside>
  );
}

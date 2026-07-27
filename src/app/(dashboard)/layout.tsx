import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { MobileSidebar } from '@/components/layout/mobile-sidebar';
import { NotificationBell } from '@/components/layout/notification-bell';
import { getRecentNotifications } from '@/actions/notifications';
import { getUnreadChatCount } from '@/actions/conversations';
import { createClient } from '@/lib/supabase/server';
import type { UserRole } from '@/types/user';
import { isUserRole } from '@/types/user';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('name, role, avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  // Onboarding: usuário recém-criado (sem nome no perfil) precisa completar o
  // cadastro antes de entrar no CRM (Fase 8).
  if (!profile || !profile.name || profile.name.trim() === '') {
    redirect('/onboarding');
  }

  // Sem perfil cadastrado: força fallback seguro (comercial) e mostra o email do auth.
  const userName = profile?.name ?? user.email ?? 'Usuário';
  const userRole: UserRole = profile && isUserRole(profile.role) ? profile.role : 'comercial';
  const avatarUrl = profile?.avatar_url ?? null;

  const { items: notifications, unreadCount } = await getRecentNotifications();
  const chatUnread = await getUnreadChatCount();

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar userName={userName} userRole={userRole} chatUnread={chatUnread} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex items-center gap-1 border-b border-brand-100 bg-white px-3 py-2 sm:px-6">
            {/* Mobile: hambúrguer no canto superior esquerdo abre a sidebar em gaveta. */}
            <MobileSidebar userName={userName} userRole={userRole} chatUnread={chatUnread} />
            <div className="ml-auto flex items-center gap-1">
              <NotificationBell
                userId={user.id}
                initialItems={notifications}
                initialUnread={unreadCount}
              />
              <Link
                href="/perfil"
                className="focus-ring flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-brand-100"
                title="Meu perfil"
              >
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt={userName}
                    className="h-7 w-7 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-700 text-xs font-semibold text-canvas">
                    {userName.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="hidden text-sm font-medium text-brand-700 sm:inline">
                  {userName.split(' ')[0]}
                </span>
              </Link>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-4 sm:p-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

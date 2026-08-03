import { redirect } from 'next/navigation';
import { UsersTable } from '@/components/admin/users-table';
import { InvitesManager } from '@/components/admin/invites-manager';
import { listInvitations } from '@/actions/invitations';
import { createClient } from '@/lib/supabase/server';
import type { UserRole } from '@/types/user';
import { isUserRole } from '@/types/user';
import Link from 'next/link';
import { Card } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

interface AdminUserRow {
  id: string;
  name: string;
  role: UserRole;
  sectorId: string | null;
}

export default async function AdminPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: me } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (me?.role !== 'admin') {
    return (
      <section>
        <h2 className="text-2xl font-semibold text-brand-700">Admin</h2>
        <p className="mt-2 text-sm text-red-600">
          Acesso restrito a administradores. Sua role atual é{' '}
          <strong>{me?.role ?? 'desconhecida'}</strong>.
        </p>
      </section>
    );
  }

  const { data } = await supabase
    .from('user_profiles')
    .select('id, name, role, sector_id')
    .order('name', { ascending: true });

  const { data: sectorRows } = await supabase
    .from('sectors')
    .select('id, slug, name, color')
    .eq('is_active', true)
    .order('name', { ascending: true });

  const users: AdminUserRow[] = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    role: isUserRole(row.role) ? row.role : 'comercial',
    sectorId: row.sector_id,
  }));

  const invites = await listInvitations();

  return (
    <section className="flex flex-col gap-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-400">Administração</p>
        <h2 className="mt-1 text-2xl font-semibold text-brand-700">Equipe e acessos</h2>
        <p className="mt-1 text-sm text-brand-500">
          Gerencie quem usa o CRM e as conexões oficiais da escola. {users.length}{' '}
          {users.length === 1 ? 'usuário cadastrado' : 'usuários cadastrados'}.
        </p>
      </header>
      <UsersTable users={users} sectors={sectorRows ?? []} currentUserId={user.id} />

      <section className="rounded-xl border border-brand-100 bg-white p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
          Convidar / criar usuários
        </h3>
        <p className="mt-1 text-sm text-brand-500">
          Gere um link de convite com o cargo desejado e envie para o e-mail da pessoa. Ela abre
          quando quiser, define a própria senha e a conta é criada já com o cargo escolhido. O link
          expira em 7 dias.
        </p>
        <div className="mt-4">
          <InvitesManager invites={invites} sectors={sectorRows ?? []} />
        </div>
      </section>

      <Link href="/integracoes" className="focus-ring rounded-xl">
        <Card className="flex items-start gap-3 transition-shadow hover:shadow-md">
          <span className="text-2xl" aria-hidden="true">🔗</span>
          <div>
            <h3 className="font-semibold text-brand-700">Integrações</h3>
            <p className="mt-1 text-sm text-brand-500">
              Conecte WhatsApp, Instagram, Google Calendar e fontes de entrada ao CRM.
            </p>
          </div>
        </Card>
      </Link>
    </section>
  );
}

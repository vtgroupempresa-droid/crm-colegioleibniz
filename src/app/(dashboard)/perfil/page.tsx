import { redirect } from 'next/navigation';
import { ProfileForm } from '@/components/profile/profile-form';
import { createClient } from '@/lib/supabase/server';
import { isUserRole, type UserRole } from '@/types/user';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Meu perfil · CRM Colégio Leibniz' };

export default async function PerfilPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('name, phone, role, avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  const role: UserRole = profile && isUserRole(profile.role) ? profile.role : 'comercial';

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-700">Meu perfil</h1>
        <p className="text-sm text-brand-500">Gerencie seus dados, foto e senha.</p>
      </header>
      <ProfileForm
        userId={user.id}
        email={user.email ?? ''}
        role={role}
        initialName={profile?.name ?? ''}
        initialPhone={profile?.phone ?? ''}
        initialAvatarUrl={profile?.avatar_url ?? null}
      />
    </div>
  );
}

import { redirect } from 'next/navigation';
import { OnboardingFlow } from '@/components/onboarding/onboarding-flow';
import { createClient } from '@/lib/supabase/server';
import { isUserRole, type UserRole } from '@/types/user';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Bem-vindo · CRM Colégio Leibniz' };

/**
 * Onboarding de novos usuários (Fase 8). Fica FORA do grupo (dashboard) para
 * não cair no redirect de onboarding do layout (evita loop). Acesso já é
 * protegido pelo middleware (precisa estar autenticado).
 *
 * Se o perfil já tem nome, o usuário não precisa onboarding → vai pro app.
 */
export default async function OnboardingPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('name, role')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.name && profile.name.trim() !== '') {
    redirect('/leads');
  }

  const role: UserRole = profile && isUserRole(profile.role) ? profile.role : 'comercial';

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <OnboardingFlow userId={user.id} email={user.email ?? ''} role={role} />
    </main>
  );
}

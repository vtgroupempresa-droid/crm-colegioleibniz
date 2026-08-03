import { redirect } from 'next/navigation';
import { InitialPasswordForm } from '@/components/auth/initial-password-form';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function ChangeInitialPasswordPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('must_change_password')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.must_change_password) redirect('/leads');

  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-50 px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-brand-100 bg-white p-6 shadow-lg sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-400">
          Primeiro acesso
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-brand-800">Crie sua senha pessoal</h1>
        <p className="mt-2 text-sm leading-relaxed text-brand-500">
          A senha recebida é temporária. Defina uma senha exclusiva antes de acessar os dados do
          Colégio Leibniz.
        </p>
        <InitialPasswordForm />
      </section>
    </main>
  );
}

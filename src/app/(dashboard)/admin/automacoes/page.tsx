import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { listAutomationRules } from '@/actions/automations';
import { AutomationsManager } from '@/components/admin/automations-manager';
import { getSession, isAdmin } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Automações · CRM Colégio Leibniz',
};

export default async function AutomacoesPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!isAdmin(session.role)) redirect('/leads');

  const supabase = createClient();
  const [rules, stagesResult, usersResult] = await Promise.all([
    listAutomationRules(),
    supabase
      .from('pipeline_stages')
      .select('slug, name')
      .eq('pipeline', 'comercial')
      .eq('is_active', true)
      .order('position'),
    supabase.from('user_profiles').select('id, name').order('name'),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <AutomationsManager
        rules={rules}
        stages={stagesResult.data ?? []}
        users={usersResult.data ?? []}
      />
    </div>
  );
}

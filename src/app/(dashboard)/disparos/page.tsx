import { listBroadcastTemplates, listOfficialBroadcastTargets } from '@/actions/broadcasts';
import { listAutomationRules } from '@/actions/automations';
import { getSession, isAdmin } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AutomationsManager } from '@/components/admin/automations-manager';
import { BroadcastComposer } from '@/components/broadcasts/broadcast-composer';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Disparos e automações · CRM Colégio Leibniz' };

/**
 * Disparos de template oficial (Meta) em lote — v1: leads que entraram em
 * contato pela instância oficial do WhatsApp. O template sai aprovado pela
 * Meta, então entrega mesmo fora da janela de 24h.
 */
export default async function DisparosPage() {
  const session = await getSession();
  const adminAccess = session ? isAdmin(session.role) : false;
  const supabase = createClient();
  const [templates, targets, rules, stagesResult, usersResult] = await Promise.all([
    listBroadcastTemplates(),
    listOfficialBroadcastTargets(),
    adminAccess ? listAutomationRules() : Promise.resolve([]),
    adminAccess
      ? supabase
          .from('pipeline_stages')
          .select('slug, name')
          .eq('pipeline', 'comercial')
          .eq('is_active', true)
          .order('position')
      : Promise.resolve({ data: [] as { slug: string; name: string }[] }),
    adminAccess
      ? supabase.from('user_profiles').select('id, name').order('name')
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-2xl font-semibold text-brand-700">Disparos e automações</h2>
        <p className="mt-1 text-sm text-brand-500">
          Envie um template oficial do WhatsApp para vários leads de uma vez. Por enquanto, o
          público é quem já falou com o número oficial (Cloud API).
        </p>
      </header>
      <BroadcastComposer templates={templates} initialTargets={targets} />
      {adminAccess && (
        <section className="border-t border-brand-100 pt-6">
          <AutomationsManager
            rules={rules}
            stages={stagesResult.data ?? []}
            users={usersResult.data ?? []}
          />
        </section>
      )}
    </div>
  );
}

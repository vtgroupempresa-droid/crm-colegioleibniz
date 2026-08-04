import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '@/lib/auth/session';
import { getMetaConfigStatus } from '@/lib/meta/config';
import { getMetaWebhookStatus, getMetaIntegrationStatus } from '@/lib/meta/status';
import { createAdminClient } from '@/lib/supabase/admin';
import { MetaPanels } from '@/components/integrations/meta-panels';
import { MetaStatusCard } from '@/components/integrations/meta-status-card';
import { MetaLiveStatusCard } from '@/components/integrations/meta-live-status-card';
import { listWhatsappInstances } from '@/actions/whatsapp-instances';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Meta · Integrações' };

export default async function MetaIntegrationPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!isAdmin(session.role)) redirect('/');

  const admin = createAdminClient();
  const status = getMetaConfigStatus();
  const [webhookStatus, integrationStatus, whatsappInstances] = await Promise.all([
    getMetaWebhookStatus(admin),
    getMetaIntegrationStatus(admin),
    listWhatsappInstances(),
  ]);

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <Link href="/integracoes" className="text-xs text-brand-400 hover:text-brand-600">
          ← Voltar para Integrações
        </Link>
        <h2 className="text-2xl font-semibold text-brand-700">Meta</h2>
        <p className="text-sm text-brand-500">
          WhatsApp, Instagram e Lead Ads. Webhook unificado em{' '}
          <code className="text-xs">/api/meta/webhook</code>.
        </p>
      </header>

      <MetaStatusCard status={webhookStatus} />

      <MetaLiveStatusCard status={integrationStatus} />

      <MetaPanels status={status} whatsappInstances={whatsappInstances} />
    </section>
  );
}

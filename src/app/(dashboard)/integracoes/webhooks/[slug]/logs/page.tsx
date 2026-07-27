import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSession, isAdmin } from '@/lib/auth/session';
import { getWebhookSourceBySlug, getWebhookLogs } from '@/actions/webhook-sources';
import { WebhookLogsView } from '@/components/integrations/webhook-logs-view';

export const metadata = { title: 'Logs · Webhook' };

export default async function WebhookLogsPage({ params }: { params: { slug: string } }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!isAdmin(session.role)) redirect('/');

  const source = await getWebhookSourceBySlug(params.slug);
  if (!source) notFound();

  const logs = await getWebhookLogs(source.id);

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <Link href="/integracoes/webhooks" className="text-xs text-brand-400 hover:text-brand-600">
          ← Voltar para Webhooks
        </Link>
        <h2 className="text-2xl font-semibold text-brand-700">{source.name}</h2>
        <p className="text-sm text-brand-500">
          Últimos {logs.length} recebimentos · <code className="text-xs">/api/webhooks/receive/{source.slug}</code>
        </p>
      </header>

      <WebhookLogsView logs={logs} />
    </section>
  );
}

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSession, isAdmin } from '@/lib/auth/session';
import { getWebhookSources } from '@/actions/webhook-sources';
import { WebhookList } from '@/components/integrations/webhook-list';
import type { PipelineStage } from '@/types/pipeline';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Webhooks · Integrações' };

export default async function WebhooksPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!isAdmin(session.role)) redirect('/');

  const supabase = createClient();
  const [sources, { data: stages }] = await Promise.all([
    getWebhookSources(),
    supabase
      .from('pipeline_stages')
      .select('*')
      .order('pipeline', { ascending: true })
      .order('position', { ascending: true }),
  ]);

  return (
    <WebhookList initialSources={sources} stages={(stages ?? []) as PipelineStage[]} />
  );
}

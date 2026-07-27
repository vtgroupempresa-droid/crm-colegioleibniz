import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getConversations } from '@/actions/conversations';
import { listWhatsappInstanceBadges } from '@/actions/whatsapp-instances';
import { createClient } from '@/lib/supabase/server';
import { isWhatsappConfigured, isInstagramConfigured } from '@/lib/meta/config';
import { ChatLayout, type ChatStageOption } from '@/components/chat/chat-layout';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Chat · CRM Colégio Leibniz' };

export default async function ChatPage({
  searchParams,
}: {
  searchParams: { c?: string };
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  const supabase = createClient();
  const [conversations, instances, { data: stages }] = await Promise.all([
    getConversations(),
    listWhatsappInstanceBadges(),
    supabase
      .from('pipeline_stages')
      .select('slug, name, pipeline')
      .order('pipeline', { ascending: true })
      .order('position', { ascending: true }),
  ]);

  // WhatsApp funciona via UaZAPI (instância cadastrada/env) OU Cloud API da Meta.
  const whatsappConfigured =
    instances.length > 0 || isWhatsappConfigured();

  return (
    <ChatLayout
      initialConversations={conversations}
      initialConversationId={searchParams.c ?? null}
      stages={(stages ?? []) as ChatStageOption[]}
      whatsappConfigured={whatsappConfigured}
      instagramConfigured={isInstagramConfigured()}
      instances={instances}
    />
  );
}

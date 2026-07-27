import { NextResponse } from 'next/server';
import { getLeadById, getStagesForPipeline } from '@/actions/leads-queries';
import { getDemoMode } from '@/lib/demo/context';
import { getSession, isAdmin } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

/**
 * Conversa mais recente do lead VISÍVEL ao usuário atual (client com RLS de
 * propósito): alimenta o botão "Ir para o chat" do drawer — quem não pode ver
 * a conversa no /chat não ganha o botão.
 */
async function getVisibleConversationId(leadId: string): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('lead_id', leadId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

export async function GET(_req: Request, { params }: RouteContext) {
  const isDemo = getDemoMode();
  // Tenta no modo atual; se não achar, faz fallback (cobre o caso de abrir drawer
  // de um lead após trocar de modo na mesma sessão sem refresh).
  let payload = await getLeadById(params.id, { isDemo });
  if (!payload) {
    payload = await getLeadById(params.id, { isDemo: !isDemo });
  }
  if (!payload) {
    return NextResponse.json({ error: 'Lead não encontrado' }, { status: 404 });
  }
  // Identidade do usuário atual: a timeline usa para liberar a edição de nota
  // só ao autor (ou admin); o role libera o editor de composição de pagamento.
  // `stages` alimenta o "Mover etapa" do drawer (colunas do pipeline do lead).
  const [session, stages, conversationId] = await Promise.all([
    getSession(),
    getStagesForPipeline(payload.lead.pipeline),
    getVisibleConversationId(payload.lead.id),
  ]);
  return NextResponse.json({
    ...payload,
    stages,
    conversationId,
    viewerId: session?.userId ?? null,
    viewerIsAdmin: session ? isAdmin(session.role) : false,
    viewerRole: session?.role ?? null,
  });
}

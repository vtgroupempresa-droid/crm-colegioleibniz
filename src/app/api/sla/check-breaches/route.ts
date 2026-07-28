import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createNotification } from '@/actions/notifications';
import { MAX_ATTEMPTS } from '@/lib/sla/rules';

/**
 * Cron (a cada 5min): marca tentativas de contato com SLA estourado
 * (sla_breached=true) e notifica o SDR responsável de cada lead afetado.
 * Notificações não são criadas para leads demo.
 *
 * Antes esse check rodava DENTRO do load de /oportunidades (pipeline SDR) — um
 * UPDATE com varredura no caminho crítico de toda abertura do board. Movido
 * para cá na otimização de performance (2026-07-22); usa o admin client porque
 * o cron não tem sessão e a marcação é manutenção global, não ação de usuário.
 * Protegido pelo CRON_SECRET que a Vercel envia em Authorization: Bearer.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await admin
    .from('contact_attempts')
    .update({ sla_breached: true })
    .lt('sla_deadline', nowIso)
    .eq('sla_breached', false)
    .not('sla_deadline', 'is', null)
    .select('lead_id, attempt_number, is_demo');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const breached = data ?? [];
  const prodBreaches = breached.filter((b) => !b.is_demo);
  if (prodBreaches.length > 0) {
    const leadIds = [...new Set(prodBreaches.map((b) => b.lead_id))];
    const { data: leads } = await admin
      .from('leads')
      .select('id, name, assigned_to')
      .in('id', leadIds);

    const leadById = new Map((leads ?? []).map((l) => [l.id, l]));
    await Promise.all(
      prodBreaches.map(async (b) => {
        const lead = leadById.get(b.lead_id);
        if (!lead?.assigned_to) return;
        await createNotification(
          lead.assigned_to,
          'sla_vencendo',
          `SLA vencido: ${lead.name}`,
          `Tentativa ${b.attempt_number}/${MAX_ATTEMPTS}`,
          lead.id,
        );
      }),
    );
  }

  return NextResponse.json({ ok: true, marked: breached.length });
}

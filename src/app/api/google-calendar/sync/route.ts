import { NextResponse, type NextRequest } from 'next/server';
import { getSession, isAdmin } from '@/lib/auth/session';
import { runIncrementalSync } from '@/lib/google-calendar/sync';

/**
 * Sync incremental Google Calendar → CRM. Chamado pelo cron da Vercel (a cada
 * 5 min, Authorization: Bearer CRON_SECRET) ou por um admin logado (botão
 * "Sincronizar agora" no painel de integrações).
 */

export const dynamic = 'force-dynamic';

// Full sync inicial pagina eventos de 60 dias — folga acima do default.
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const isCron = Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron) {
    const session = await getSession();
    if (!session || !isAdmin(session.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const report = await runIncrementalSync();
    const ok = report.errors.length === 0;
    return NextResponse.json({ ok, ...report }, { status: ok ? 200 : 502 });
  } catch (err) {
    console.error('[google-calendar] sync falhou', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Falha na sincronização' },
      { status: 502 },
    );
  }
}

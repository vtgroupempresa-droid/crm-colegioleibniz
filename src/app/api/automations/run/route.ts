import { NextResponse, type NextRequest } from 'next/server';
import { runAutomations } from '@/lib/automations/engine';

/**
 * Cron (a cada 5min): executa o motor de automações configuráveis
 * (/admin/automacoes) — alertas, follow-ups e lembretes definidos pela equipe.
 * Protegido pelo CRON_SECRET que a Vercel envia em Authorization: Bearer.
 */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const results = await runAutomations();
    const fired = results.reduce((sum, r) => sum + r.fired, 0);
    return NextResponse.json({ ok: true, fired, rules: results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

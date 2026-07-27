import { NextResponse, type NextRequest } from 'next/server';
import { exchangeAuthorizationCode } from '@/lib/google-calendar/token-store';
import { runIncrementalSync } from '@/lib/google-calendar/sync';

/**
 * Callback do OAuth2 do Google Calendar: valida o state (cookie httpOnly),
 * troca o authorization_code por access+refresh tokens, persiste em
 * google_calendar_tokens e dispara o sync inicial (best-effort). Redireciona
 * de volta ao /integracoes com o resultado.
 */

export const dynamic = 'force-dynamic';

// O sync inicial pagina até 60 dias de eventos — folga acima do default.
export const maxDuration = 60;

function redirectToIntegracoes(req: NextRequest, result: string): NextResponse {
  const url = new URL('/integracoes', req.nextUrl.origin);
  url.searchParams.set('google_calendar', result);
  const res = NextResponse.redirect(url);
  res.cookies.delete('google_calendar_oauth_state');
  return res;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const expectedState = req.cookies.get('google_calendar_oauth_state')?.value;

  if (!code) return redirectToIntegracoes(req, 'erro_sem_codigo');
  if (!state || !expectedState || state !== expectedState) {
    return redirectToIntegracoes(req, 'erro_state');
  }

  try {
    await exchangeAuthorizationCode(code);
  } catch (err) {
    console.error('[google-calendar] callback: falha na troca do code', err);
    return redirectToIntegracoes(req, 'erro_token');
  }

  // Sync inicial popula o cache de eventos — falha aqui não invalida a conexão
  // (o cron de 5 min refaz em seguida).
  try {
    await runIncrementalSync();
  } catch (err) {
    console.error('[google-calendar] callback: sync inicial falhou', err);
  }

  return redirectToIntegracoes(req, 'conectada');
}

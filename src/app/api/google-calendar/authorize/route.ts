import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '@/lib/auth/session';
import {
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_OAUTH_AUTH_URL,
  assertGoogleCalendarEnv,
  googleCalendarEnv,
} from '@/lib/google-calendar/config';

/**
 * Início do fluxo OAuth2 do Google Calendar — redireciona o admin para a tela
 * de consentimento com a conta da escola. access_type=offline + prompt=consent
 * garantem que o Google SEMPRE devolva refresh_token (sem prompt=consent,
 * reconexões vêm só com access_token e a integração morre em 1h). state em
 * cookie httpOnly contra CSRF (mesmo padrão da Conta Azul).
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session || !isAdmin(session.role)) {
    return NextResponse.json(
      { error: 'Apenas admin pode conectar o Google Calendar' },
      { status: 403 },
    );
  }

  try {
    assertGoogleCalendarEnv();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Configuração ausente' },
      { status: 500 },
    );
  }

  const state = crypto.randomUUID();
  const url = new URL(GOOGLE_OAUTH_AUTH_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', googleCalendarEnv.clientId);
  url.searchParams.set('redirect_uri', googleCalendarEnv.redirectUri);
  url.searchParams.set('scope', GOOGLE_CALENDAR_SCOPES);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);

  const res = NextResponse.redirect(url);
  res.cookies.set('google_calendar_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/google-calendar',
  });
  return res;
}

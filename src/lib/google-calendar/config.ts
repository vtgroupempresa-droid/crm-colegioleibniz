/**
 * Configuração da integração Google Calendar (agenda da escola).
 *
 * Reusa o OAuth client Google já existente (GOOGLE_CLIENT_ID/SECRET, o mesmo
 * do Sheets em src/lib/google/sheets-core.ts) — o refresh token do Calendar é
 * OUTRO (escopo diferente) e vive na tabela google_calendar_tokens, conectado
 * pelo botão em /integracoes. O GOOGLE_REFRESH_TOKEN (Sheets) fica intocado.
 *
 * Escopos: calendar.events (ler/criar/editar eventos) + userinfo.email (exibir
 * qual conta está conectada no painel). Não usamos o escopo amplo `calendar`.
 */

export const GOOGLE_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_OAUTH_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
export const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

/** Fuso usado na fronteira com o Google (banco continua em UTC ISO). */
export const CRM_TIMEZONE = 'America/Sao_Paulo';

export const googleCalendarEnv = {
  clientId: process.env.GOOGLE_CLIENT_ID ?? '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  redirectUri:
    process.env.GOOGLE_CALENDAR_REDIRECT_URI ??
    'https://crm.colegioleibniz.com.br/api/google-calendar/callback',
};

export function assertGoogleCalendarEnv(): void {
  if (!googleCalendarEnv.clientId || !googleCalendarEnv.clientSecret) {
    throw new Error(
      'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET não configurados no ambiente',
    );
  }
}

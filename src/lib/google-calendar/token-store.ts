import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  GOOGLE_OAUTH_REVOKE_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  assertGoogleCalendarEnv,
  googleCalendarEnv,
} from './config';

/**
 * Armazenamento e renovação dos tokens OAuth2 do Google Calendar (conta da
 * escola). Tabela google_calendar_tokens (RLS sem policies = só service role),
 * uma única linha ativa.
 *
 * Diferente da Conta Azul (Cognito), o refresh_token do Google NÃO rotaciona a
 * cada renovação — por isso não há claim otimista entre instâncias nem cron de
 * refresh: o access_token (1h) é renovado on-demand com margem de 5 min e
 * dedupe local (refreshInFlight). O refresh token só muda quando o admin
 * reconecta (o authorize usa prompt=consent para garantir que ele sempre venha).
 */

interface TokenRow {
  id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  connected_email: string | null;
  calendar_id: string;
  sync_token: string | null;
  last_synced_at: string | null;
  last_refreshed_at: string | null;
}

const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

let refreshInFlight: Promise<string> | null = null;

async function loadTokenRow(): Promise<TokenRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('google_calendar_tokens')
    .select(
      'id, access_token, refresh_token, expires_at, connected_email, calendar_id, sync_token, last_synced_at, last_refreshed_at',
    )
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function fetchTokenEndpoint(body: URLSearchParams): Promise<GoogleTokenResponse> {
  assertGoogleCalendarEnv();
  body.set('client_id', googleCalendarEnv.clientId);
  body.set('client_secret', googleCalendarEnv.clientSecret);
  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => null)) as GoogleTokenResponse | null;
  if (!res.ok || !data?.access_token) {
    const detail = data?.error_description ?? data?.error ?? `HTTP ${res.status}`;
    throw new Error(`Google token endpoint: ${detail}`);
  }
  return data;
}

/**
 * Troca o authorization_code do callback por tokens, resolve o e-mail da conta
 * conectada e persiste (substituindo qualquer conexão anterior).
 */
export async function exchangeAuthorizationCode(code: string): Promise<void> {
  const tokens = await fetchTokenEndpoint(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: googleCalendarEnv.redirectUri,
    }),
  );
  if (!tokens.refresh_token) {
    // Sem refresh_token a integração morre em 1h — melhor falhar alto aqui e
    // orientar a reconectar (o authorize já manda prompt=consent justamente
    // para o Google reemitir o refresh token).
    throw new Error(
      'Google não retornou refresh_token — tente conectar novamente (a tela de consentimento deve aparecer).',
    );
  }

  let email: string | null = null;
  try {
    const res = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      cache: 'no-store',
    });
    if (res.ok) {
      const info = (await res.json()) as { email?: string };
      email = info.email ?? null;
    }
  } catch {
    // e-mail é só informativo no painel — não bloqueia a conexão.
  }

  const admin = createAdminClient();
  const existing = await loadTokenRow();
  const values = {
    access_token: tokens.access_token as string,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
    connected_email: email,
    last_refreshed_at: new Date().toISOString(),
    // Conexão nova invalida o estado de sync anterior (pode ser outra conta).
    sync_token: null,
    last_synced_at: null,
  };
  if (existing) {
    const { error } = await admin
      .from('google_calendar_tokens')
      .update(values)
      .eq('id', existing.id);
    if (error) throw new Error(`Falha ao atualizar tokens do Google Calendar: ${error.message}`);
  } else {
    const { error } = await admin.from('google_calendar_tokens').insert(values);
    if (error) throw new Error(`Falha ao salvar tokens do Google Calendar: ${error.message}`);
  }
}

async function refreshAccessToken(row: TokenRow): Promise<string> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const tokens = await fetchTokenEndpoint(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: row.refresh_token,
      }),
    );
    const admin = createAdminClient();
    await admin
      .from('google_calendar_tokens')
      .update({
        access_token: tokens.access_token as string,
        expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
        last_refreshed_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    return tokens.access_token as string;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/** Google Calendar está conectado? (checagem barata p/ no-op nos hooks). */
export async function isGoogleCalendarConnected(): Promise<boolean> {
  return (await loadTokenRow()) !== null;
}

/**
 * Access token válido — renova on-demand se estiver a menos de 5 min de
 * expirar. Lança erro se o Google Calendar não está conectado.
 */
export async function getValidAccessToken(): Promise<string> {
  const row = await loadTokenRow();
  if (!row) {
    throw new Error(
      'Google Calendar não conectado — inicie a autorização em /api/google-calendar/authorize',
    );
  }
  if (new Date(row.expires_at).getTime() - Date.now() > EXPIRY_MARGIN_MS) {
    return row.access_token;
  }
  return refreshAccessToken(row);
}

/** Calendar alvo dos eventos (default 'primary'). */
export async function getCalendarId(): Promise<string> {
  const row = await loadTokenRow();
  return row?.calendar_id ?? 'primary';
}

/** Metadados da conexão para a UI de status (sem expor tokens). */
export async function getConnectionInfo(): Promise<{
  connectedEmail: string | null;
  calendarId: string;
  lastSyncedAt: string | null;
  lastRefreshedAt: string | null;
} | null> {
  const row = await loadTokenRow();
  if (!row) return null;
  return {
    connectedEmail: row.connected_email,
    calendarId: row.calendar_id,
    lastSyncedAt: row.last_synced_at,
    lastRefreshedAt: row.last_refreshed_at,
  };
}

/** Estado do sync incremental (syncToken do events.list). */
export async function getSyncState(): Promise<{ syncToken: string | null } | null> {
  const row = await loadTokenRow();
  if (!row) return null;
  return { syncToken: row.sync_token };
}

export async function saveSyncState(syncToken: string | null): Promise<void> {
  const row = await loadTokenRow();
  if (!row) return;
  const admin = createAdminClient();
  await admin
    .from('google_calendar_tokens')
    .update({ sync_token: syncToken, last_synced_at: new Date().toISOString() })
    .eq('id', row.id);
}

/** Revoga o token no Google (best-effort) e apaga a conexão local. */
export async function disconnect(): Promise<void> {
  const row = await loadTokenRow();
  if (!row) return;
  try {
    await fetch(`${GOOGLE_OAUTH_REVOKE_URL}?token=${encodeURIComponent(row.refresh_token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      cache: 'no-store',
    });
  } catch {
    // revogação é best-effort: a exclusão local já desativa a integração.
  }
  const admin = createAdminClient();
  await admin.from('google_calendar_tokens').delete().eq('id', row.id);
}

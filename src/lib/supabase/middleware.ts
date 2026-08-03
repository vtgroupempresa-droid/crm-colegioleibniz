import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/types/database';

type CookieToSet = { name: string; value: string; options: CookieOptions };

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const PUBLIC_ROUTES = ['/login', '/convite'];

/**
 * Endpoints chamados por sistemas EXTERNOS sem sessão Supabase — autenticam-se
 * pelo próprio secret/assinatura, então não passam pelo redirect de /login:
 *  - /api/webhooks/*  : ingestão genérica de leads (receive/[slug], new-lead,
 *    landing-page) — valida pelo secret do webhook_source.
 *  - /api/meta/*      : webhook unificado Instagram/WhatsApp/Lead Ads — GET de
 *    verificação (hub.challenge) e POST com assinatura X-Hub-Signature-256.
 *  - /api/sla/check-breaches : cron (5min) que marca SLAs de contato vencidos
 *    e notifica a equipe — protegido pelo CRON_SECRET.
 *  - /api/first-contact/dispatch : cron (1min) do primeiro contato automático —
 *    protegido pelo CRON_SECRET.
 *  - /api/automations/run : cron (5min) do motor de automações (alertas,
 *    follow-ups, lembretes) — protegido pelo CRON_SECRET.
 *  - /api/google-calendar/sync e /callback : cron (5min) e retorno do OAuth do
 *    Google Calendar — o callback valida pelo state em cookie httpOnly, não
 *    pela sessão (o code de 3 min não pode se perder num redirect de /login).
 */
const PUBLIC_API_PREFIXES = [
  '/api/webhooks',
  '/api/meta',
  '/api/sla/check-breaches',
  '/api/first-contact/dispatch',
  '/api/automations/run',
  '/api/google-calendar/sync',
  '/api/google-calendar/callback',
];

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }: CookieToSet) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }: CookieToSet) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Não autenticado tentando acessar rota protegida → /login
  if (!user && !isPublicRoute(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(url);
  }

  if (user) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('must_change_password')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.must_change_password && pathname !== '/trocar-senha') {
      const url = request.nextUrl.clone();
      url.pathname = '/trocar-senha';
      url.search = '';
      return NextResponse.redirect(url);
    }

    if (!profile?.must_change_password && pathname === '/trocar-senha') {
      const url = request.nextUrl.clone();
      url.pathname = '/leads';
      return NextResponse.redirect(url);
    }
  }

  // Autenticado em /login → manda pro app
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/leads';
    return NextResponse.redirect(url);
  }

  return response;
}

import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '@/lib/auth/session';
import { fetchInstagramAccount } from '@/lib/meta/client';
import { isConfigured, metaEnv } from '@/lib/meta/config';

/**
 * GET /api/meta/instagram/test
 *
 * Diagnóstico do Instagram Direct: confirma que a conta @colegio.leibniz está
 * configurada e que o Page Access Token alcança a Graph API. Restrito a admin
 * (nunca expõe o token).
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session || !isAdmin(session.role)) {
    return NextResponse.json(
      { status: 'error', message: 'Acesso restrito ao admin' },
      { status: 403 },
    );
  }

  if (!isConfigured(metaEnv.instagramUserId)) {
    return NextResponse.json(
      { status: 'error', message: 'INSTAGRAM_USER_ID não configurado.' },
      { status: 200 },
    );
  }
  if (!isConfigured(metaEnv.instagramPageToken)) {
    return NextResponse.json(
      { status: 'error', message: 'INSTAGRAM_PAGE_TOKEN não configurado.' },
      { status: 200 },
    );
  }

  const result = await fetchInstagramAccount();
  if (!result.ok) {
    return NextResponse.json({ status: 'error', message: result.error }, { status: 200 });
  }

  return NextResponse.json({
    status: 'connected',
    account: {
      id: result.data.id,
      name: result.data.name,
      username: result.data.username,
    },
  });
}

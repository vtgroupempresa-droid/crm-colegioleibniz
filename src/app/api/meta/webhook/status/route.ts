import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { getMetaIntegrationStatus } from '@/lib/meta/status';

/**
 * GET /api/meta/webhook/status (Parte 5).
 *
 * Status operacional da integração Meta: página + campos assinados (leadgen),
 * Instagram Direct, timestamp do último leadgen / última mensagem Instagram e
 * volumes das últimas 24h. Restrito a admin/CEO (não expõe segredos).
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session || !isAdmin(session.role)) {
    return NextResponse.json({ error: 'Acesso restrito ao admin' }, { status: 403 });
  }

  const admin = createAdminClient();
  const status = await getMetaIntegrationStatus(admin);
  return NextResponse.json(status);
}

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseFieldMapping, applyFieldMapping } from '@/lib/webhooks/field-mapping';
import { parseTagRules, evaluateTagRules, mergeTags } from '@/lib/webhooks/tag-rules';
import { ingestLead } from '@/lib/webhooks/ingest';
import type { PipelineKind } from '@/types/pipeline';
import type { WebhookLogStatus } from '@/types/webhooks';

/**
 * Webhook genérico para formulários de landing pages (site da escola,
 * Elementor, RD Station etc.).
 *
 * POST /api/webhooks/landing-page
 *
 * Diferenças em relação ao motor no-code (/api/webhooks/receive/[slug]):
 *  - valida o WEBHOOK_SECRET global (header X-Webhook-Secret ou body.secret),
 *    sem precisar configurar fonte pelo wizard;
 *  - usa a webhook_source fixa de slug `landing-page` (field_mapping/tag_rules
 *    editáveis pelo wizard; criada via seed no banco).
 *
 * Roda sem sessão → admin client (service role).
 */
export const dynamic = 'force-dynamic';

const LANDING_PAGE_SLUG = 'landing-page';

export async function POST(req: Request) {
  const startedAt = Date.now();

  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'WEBHOOK_SECRET não configurado' }, { status: 503 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  // Secret no header ou no body (formulários sem suporte a headers custom).
  const headerSecret = req.headers.get('x-webhook-secret');
  const bodySecret =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).secret
      : undefined;
  const provided = headerSecret ?? (typeof bodySecret === 'string' ? bodySecret : null);
  if (provided !== secret) {
    return NextResponse.json({ error: 'Secret inválido' }, { status: 401 });
  }

  const admin = createAdminClient();

  // Fonte fixa `landing-page` — concentra logs e o mapeamento editável.
  const { data: source } = await admin
    .from('webhook_sources')
    .select('*')
    .eq('slug', LANDING_PAGE_SLUG)
    .maybeSingle();
  if (!source) {
    return NextResponse.json(
      { error: 'Fonte landing-page não encontrada em webhook_sources' },
      { status: 500 },
    );
  }

  const { data: log } = await admin
    .from('webhook_logs')
    .insert({ source_id: source.id, payload: payload as never, status: 'processing' })
    .select('id')
    .single();

  const finishLog = async (
    status: WebhookLogStatus,
    leadId: string | null,
    errorMessage: string | null,
  ) => {
    if (!log) return;
    await admin
      .from('webhook_logs')
      .update({
        status,
        lead_id: leadId,
        error_message: errorMessage,
        processing_time_ms: Date.now() - startedAt,
      })
      .eq('id', log.id);
  };

  if (!source.is_active) {
    await finishLog('ignored', null, 'Fonte inativa');
    return NextResponse.json({ status: 'ignored', reason: 'Fonte inativa' }, { status: 200 });
  }

  try {
    const mapping = parseFieldMapping(source.field_mapping);
    const mapped = applyFieldMapping(payload, mapping);

    const ruleTags = evaluateTagRules(payload, parseTagRules(source.tag_rules));
    const tags = mergeTags(['landing-page'], ruleTags);

    const result = await ingestLead(admin, {
      values: mapped.values,
      numbers: mapped.numbers,
      tags,
      defaultSource: 'organico',
      pipeline: source.default_pipeline as PipelineKind,
      stage: source.default_stage,
      sourceName: source.name,
      // Lead preencheu um formulário por iniciativa própria → se já existia,
      // volta para comercial/novo_lead com o histórico preservado.
      reactivationChannel: 'novo formulário (landing page)',
      reactivationDeclared: true,
    });

    const finalStatus: WebhookLogStatus = result.duplicate ? 'duplicate' : 'success';
    await finishLog(finalStatus, result.leadId, null);

    return NextResponse.json(
      {
        lead_id: result.leadId,
        status: finalStatus,
        duplicate: result.duplicate,
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao processar webhook';
    await finishLog('error', null, message);
    return NextResponse.json({ status: 'error', error: message }, { status: 500 });
  }
}

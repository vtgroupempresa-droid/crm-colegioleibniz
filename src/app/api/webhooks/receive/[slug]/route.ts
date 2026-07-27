import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  parseFieldMapping,
  applyFieldMapping,
  getByPath,
} from '@/lib/webhooks/field-mapping';
import { parseTagRules, evaluateTagRules, mergeTags } from '@/lib/webhooks/tag-rules';
import { parseCampaignName, campaignAdCreative } from '@/lib/webhooks/campaign-parser';
import { ingestLead } from '@/lib/webhooks/ingest';
import type { MetaFormAnswer } from '@/types/lead';
import type { PipelineKind } from '@/types/pipeline';
import type { WebhookLogStatus } from '@/types/webhooks';

/**
 * Endpoint genérico do motor de webhooks no-code (Fase 9).
 *
 * POST /api/webhooks/receive/[slug]
 *
 * Ordem:
 *  1. busca webhook_source pelo slug
 *  2. valida secret (header X-Webhook-Secret ou body.secret)
 *  3. grava payload bruto em webhook_logs (status 'processing')
 *  4. aplica field_mapping (dot notation + transforms + valores fixos)
 *  5. roda campaign-parser em campaign_name/utm_campaign → tags + ad_creative + tema
 *  6. aplica tag_rules
 *  7. cria/atualiza lead (dedup por phone/email) + distribuição round-robin
 *  8. atualiza webhook_log com status final + lead_id + tempo de processamento
 *  9. responde { lead_id, status, duplicate }
 *
 * Roda sem sessão → admin client (service role).
 */
export const dynamic = 'force-dynamic';

/**
 * CORS — landing pages e o site da escola fazem o POST client-side (pelo
 * navegador). O header custom X-Webhook-Secret torna a requisição "não-simples"
 * e dispara um preflight OPTIONS. Liberamos qualquer origem: o endpoint se
 * autentica pelo próprio secret, não pela origem.
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Webhook-Secret',
  'Access-Control-Max-Age': '86400',
} as const;

/** Resposta JSON já com os headers de CORS — toda resposta do POST os carrega. */
function corsJson(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

/** Preflight CORS: responde 204 liberando o POST cross-origin com X-Webhook-Secret. */
export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Respostas de formulário/quiz que a LP envia no objeto `answers` (ex.:
 * { nivel_de_ensino, turno_preferido, ... }). Convertidas em MetaFormAnswer[]
 * para aparecerem nas informações do lead (leads.meta_form_answers → seção de
 * origem do card). Ignora chaves que já são campos próprios do lead
 * (nome/telefone/e-mail).
 */
const ANSWER_SKIP_KEYS = new Set([
  'nome', 'name', 'sobrenome', 'whatsapp', 'phone', 'telefone', 'email',
]);
function formAnswersFromPayload(payload: unknown): MetaFormAnswer[] | undefined {
  const raw = getByPath(payload, 'answers');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: MetaFormAnswer[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value == null || value === '') continue;
    if (ANSWER_SKIP_KEYS.has(key.toLowerCase())) continue;
    const answer =
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value);
    if (answer.trim()) out.push({ question: key, answer });
  }
  return out.length > 0 ? out : undefined;
}

export async function POST(
  req: Request,
  { params }: { params: { slug: string } },
) {
  const startedAt = Date.now();
  const admin = createAdminClient();

  // 1. Fonte pelo slug.
  const { data: source } = await admin
    .from('webhook_sources')
    .select('*')
    .eq('slug', params.slug)
    .maybeSingle();

  if (!source) {
    return corsJson({ error: 'Fonte de webhook não encontrada' }, 404);
  }

  // Lê o corpo (JSON).
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return corsJson({ error: 'JSON inválido' }, 400);
  }

  // 2. Valida secret.
  const headerSecret = req.headers.get('x-webhook-secret');
  const bodySecret =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).secret
      : undefined;
  const provided = headerSecret ?? (typeof bodySecret === 'string' ? bodySecret : null);

  if (provided !== source.secret) {
    return corsJson({ error: 'Secret inválido' }, 401);
  }

  // 3. Log inicial.
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

  // Fonte inativa: registra e ignora sem criar lead.
  if (!source.is_active) {
    await finishLog('ignored', null, 'Fonte inativa');
    return corsJson({ status: 'ignored', reason: 'Fonte inativa' }, 200);
  }

  try {
    // 4. Field mapping.
    const mapping = parseFieldMapping(source.field_mapping);
    const mapped = applyFieldMapping(payload, mapping);

    // 5. Campaign parser sobre campaign_name / utm_campaign.
    const campaignRaw =
      (getByPath(payload, 'campaign_name') as string | undefined) ??
      (getByPath(payload, 'utm_campaign') as string | undefined) ??
      mapped.values.utm_campaign ??
      null;
    const parsed = parseCampaignName(campaignRaw);

    const adCreative = campaignAdCreative(parsed);
    if (adCreative && !mapped.values.ad_creative) mapped.values.ad_creative = adCreative;
    if (parsed.campaign_theme && !mapped.values.utm_campaign) {
      mapped.values.utm_campaign = parsed.campaign_theme;
    }

    // 6. Tag rules + tags do parser.
    const ruleTags = evaluateTagRules(payload, parseTagRules(source.tag_rules));
    const themeTag = parsed.campaign_theme ? [parsed.campaign_theme] : [];
    const tags = mergeTags(parsed.raw_tags, themeTag, ruleTags);

    // Respostas do formulário/quiz da LP → informações do lead (card).
    const formAnswers = formAnswersFromPayload(payload);

    // 7. Cria/atualiza lead.
    const result = await ingestLead(admin, {
      values: mapped.values,
      numbers: mapped.numbers,
      tags,
      defaultSource: 'site',
      pipeline: source.default_pipeline as PipelineKind,
      stage: source.default_stage,
      sourceName: source.name,
      // Novo envio de formulário por iniciativa do lead → reativa.
      // Entrada declarada: sem janela de 15 dias, devolve à fila de entrada
      // DA FONTE (default_stage).
      reactivationChannel: `novo formulário (${source.name})`,
      reactivationDeclared: true,
      ...(formAnswers ? { attribution: { formAnswers } } : {}),
    });

    // 8. Log final.
    const finalStatus: WebhookLogStatus = result.duplicate ? 'duplicate' : 'success';
    await finishLog(finalStatus, result.leadId, null);

    // 9. Resposta.
    return corsJson(
      {
        lead_id: result.leadId,
        status: finalStatus,
        duplicate: result.duplicate,
      },
      result.duplicate ? 200 : 201,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao processar webhook';
    await finishLog('error', null, message);
    return corsJson({ status: 'error', error: message }, 500);
  }
}

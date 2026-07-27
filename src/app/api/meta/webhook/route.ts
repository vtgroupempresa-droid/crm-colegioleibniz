import { NextResponse } from 'next/server';
import { metaEnv, isConfigured, webhookDebugEnabled } from '@/lib/meta/config';
import { verifyMetaSignatureAny } from '@/lib/meta/signature';
import {
  metaAdmin,
  processWhatsappValue,
  processInstagramMessaging,
  processLeadgen,
  type LeadgenChangeValue,
} from '@/lib/meta/inbound';
import { getOrCreateMetaSource } from '@/lib/meta/source';

/**
 * Webhook unificado da Meta: WhatsApp Cloud API + Instagram Messaging
 * + Lead Ads (leadgen).
 *
 * GET  → verificação do webhook (hub.challenge).
 * POST → eventos. Sempre responde 200 (a Meta reenfileira em qualquer outro
 *        status). Validação de assinatura X-Hub-Signature-256 quando o
 *        META_APP_SECRET estiver configurado; sem ele, processa mesmo assim
 *        para permitir testes locais (degradação graciosa).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token && token === metaEnv.verifyToken) {
    return new NextResponse(challenge ?? '', { status: 200 });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

interface MetaEntry {
  id?: string;
  changes?: { field?: string; value?: unknown }[];
  messaging?: unknown[];
}

interface MetaPayload {
  object?: string;
  entry?: MetaEntry[];
}

export async function POST(req: Request) {
  const raw = await req.text();

  // Assinatura — só exige quando há algum app secret configurado.
  //
  // Cada produto da Meta assina com o SEU app secret: Facebook (object=page,
  // leadgen), Instagram (object=instagram, DMs) e WhatsApp (WABA). Como o
  // webhook é unificado, aceitamos qualquer um dos três — sem isso, eventos
  // legítimos de um produto caem como assinatura inválida.
  const secrets = [metaEnv.appSecret, metaEnv.instagramAppSecret, metaEnv.whatsappAppSecret];
  if (secrets.some((s) => isConfigured(s))) {
    const signature = req.headers.get('x-hub-signature-256');
    if (!verifyMetaSignatureAny(raw, signature, secrets)) {
      return new NextResponse('Invalid signature', { status: 401 });
    }
  }

  let payload: MetaPayload;
  try {
    payload = JSON.parse(raw) as MetaPayload;
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 200 });
  }

  const admin = metaAdmin();
  const object = payload.object ?? '';
  const startedAt = Date.now();
  let processError: string | null = null;

  if (webhookDebugEnabled()) {
    // eslint-disable-next-line no-console
    console.log('[meta/webhook] payload recebido', JSON.stringify({ object, entry: payload.entry }));
  }

  try {
    for (const entry of payload.entry ?? []) {
      // WhatsApp: object = whatsapp_business_account → changes[].value
      if (object === 'whatsapp_business_account') {
        for (const change of entry.changes ?? []) {
          await processWhatsappValue(admin, change.value);
        }
        continue;
      }

      // Instagram: mensagens em messaging[].
      if (object === 'instagram') {
        for (const event of entry.messaging ?? []) {
          await processInstagramMessaging(
            admin,
            event as Parameters<typeof processInstagramMessaging>[1],
          );
        }
        continue;
      }

      // Lead Ads / Página: object = page → changes[] com field 'leadgen'.
      if (object === 'page') {
        for (const change of entry.changes ?? []) {
          if (change.field === 'leadgen') {
            // O value traz, além do leadgen_id, os ids de atribuição
            // (ad/adset/campaign/form) — repassa tudo ao processamento.
            const value = change.value as
              | (Partial<LeadgenChangeValue> & { leadgen_id?: string })
              | undefined;
            if (value?.leadgen_id) {
              await processLeadgen(admin, { ...value, leadgen_id: value.leadgen_id });
            }
          } else if (Array.isArray(entry.messaging)) {
            for (const event of entry.messaging) {
              await processInstagramMessaging(
                admin,
                event as Parameters<typeof processInstagramMessaging>[1],
              );
            }
          }
        }
      }
    }
    processError = null;
  } catch (err) {
    // Loga, mas devolve 200 para a Meta não reenfileirar indefinidamente.
    processError = err instanceof Error ? err.message : String(err);
    console.error('[meta/webhook] erro ao processar evento:', err);
  }

  // Trilha de auditoria de TODO evento recebido, inclusive os que falharam.
  // Sem isto, uma falha de processamento é invisível: a Meta recebe 200 e a
  // mensagem some sem deixar rastro — foi exatamente assim que a constraint
  // errada de `conversations` derrubou o chat inteiro sem ninguém perceber.
  // Nunca deixa o log quebrar a resposta à Meta.
  try {
    const sourceId = await getOrCreateMetaSource(admin);
    await admin.from('webhook_logs').insert({
      source_id: sourceId,
      status: processError ? 'error' : 'success',
      error_message: processError,
      processing_time_ms: Date.now() - startedAt,
      payload: { object, entry: payload.entry ?? [] } as never,
    });
  } catch (logErr) {
    console.error('[meta/webhook] falha ao gravar webhook_log:', logErr);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

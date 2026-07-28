import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendTemplateMessageAsAi } from '@/actions/conversations';
import { advanceLeadOnFirstOutbound } from '@/lib/leads/stage-automation';
import { META_GRAPH_BASE, isConfigured, metaEnv } from '@/lib/meta/config';
import { firstNameOf } from '@/lib/utils/format';

export const dynamic = 'force-dynamic';

/**
 * Cron (a cada 1min): PRIMEIRO CONTATO AUTOMÁTICO — todo lead novo do pipeline
 * comercial recebe o template `primeiro_contato_auto` ("Olá {{nome}}…") pela
 * instância oficial ~2 minutos depois de entrar no CRM, e é movido para
 * primeiro_contato.
 *
 * Guard-rails (ordem importa):
 *  - kill switch: env FIRST_CONTACT_AUTO_DISABLED=true desliga tudo;
 *  - só roda com o template APROVADO na Meta (checa a cada execução);
 *  - janela created_at entre 2min e 60min atrás — lead antigo/backfill NUNCA
 *    recebe (o teto de 60min também impede rajada após downtime do cron);
 *  - uma única tentativa por lead: a tag `primeiro-contato-auto` é gravada
 *    ANTES do envio (claim atômico — dois crons simultâneos não duplicam);
 *  - lead com conversa que já tem mensagem (ex.: inbound de WhatsApp) é pulado:
 *    já está em contato com o time;
 *  - {{nome}}/{{produto}} sem valor utilizável → pulado com o motivo na timeline.
 */

const TEMPLATE_META_NAME = 'primeiro_contato_auto';
const MARKER_TAG = 'primeiro-contato-auto';
const DELAY_MS = 2 * 60_000;
const WINDOW_MS = 60 * 60_000;
const BATCH = 15;

/** Candidatos de external_id: dígitos com e sem o 9º dígito (números BR). */
function phoneVariants(digits: string): string[] {
  const out = [digits];
  if (digits.startsWith('55')) {
    if (digits.length === 13) out.push(digits.slice(0, 4) + digits.slice(5));
    if (digits.length === 12) out.push(digits.slice(0, 4) + '9' + digits.slice(4));
  }
  return out;
}

/** Primeiro nome utilizável ({{nome}}): lead cujo "nome" é o telefone não conta. */
function usableFirstName(raw: string | null): string | null {
  const first = firstNameOf(raw) ?? '';
  const semMascara = first.replace(/[+()\s.-]/g, '');
  if (!semMascara || /^\d+$/.test(semMascara)) return null;
  return first;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (process.env.FIRST_CONTACT_AUTO_DISABLED === 'true') {
    return NextResponse.json({ skipped: 'desligado por env' });
  }

  const admin = createAdminClient();

  // Template cadastrado no CRM e ativo.
  const { data: template } = await admin
    .from('message_templates')
    .select('id, meta_template_name')
    .eq('meta_template_name', TEMPLATE_META_NAME)
    .eq('channel', 'whatsapp')
    .eq('is_active', true)
    .maybeSingle();
  if (!template) return NextResponse.json({ skipped: 'template não cadastrado/ativo' });

  // Template APROVADO na Meta — enquanto PENDING, não gasta tentativa nenhuma.
  const waba = metaEnv.whatsappBusinessAccountId;
  if (!isConfigured(waba) || !isConfigured(metaEnv.whatsappToken)) {
    return NextResponse.json({ skipped: 'WABA/token não configurados' });
  }
  try {
    // no-store: o data cache do Next congelaria o status (caso real: preso em
    // PENDING depois da aprovação) — checagem de aprovação tem que ser ao vivo.
    const res = await fetch(
      `${META_GRAPH_BASE}/${waba}/message_templates?name=${TEMPLATE_META_NAME}&fields=name,status&access_token=${metaEnv.whatsappToken}`,
      { cache: 'no-store' },
    );
    const json = (await res.json().catch(() => ({}))) as {
      data?: { name?: string; status?: string }[];
    };
    const status = json.data?.find((t) => t.name === TEMPLATE_META_NAME)?.status;
    if (status !== 'APPROVED') {
      return NextResponse.json({ skipped: `template na Meta: ${status ?? 'não encontrado'}` });
    }
  } catch {
    return NextResponse.json({ skipped: 'falha ao consultar status do template' });
  }

  // Instância oficial (número do env) — destino das conversas novas.
  const { data: sdInstance } = await admin
    .from('whatsapp_instances')
    .select('id, phone_number_id')
    .eq('provider', 'official')
    .eq('phone_number_id', metaEnv.whatsappPhoneNumberId ?? '')
    .maybeSingle();
  if (!sdInstance) return NextResponse.json({ skipped: 'instância oficial não cadastrada' });

  const now = Date.now();
  const { data: candidates } = await admin
    .from('leads')
    .select('id, name, phone_normalized, is_demo')
    .eq('pipeline', 'comercial')
    .eq('stage', 'novo_lead')
    .eq('is_archived', false)
    .eq('is_demo', false)
    .is('merged_into', null)
    .not('phone', 'is', null)
    .gte('created_at', new Date(now - WINDOW_MS).toISOString())
    .lte('created_at', new Date(now - DELAY_MS).toISOString())
    .not('tags', 'cs', `{${MARKER_TAG}}`)
    .order('created_at', { ascending: true })
    .limit(BATCH);

  const results: { leadId: string; outcome: string }[] = [];
  for (const lead of candidates ?? []) {
    // Claim: grava a tag ANTES de qualquer envio. O update é condicionado à
    // ausência da tag — se outra execução marcou entre a leitura e o update,
    // zero linhas voltam e este lead é pulado (garante UMA tentativa).
    const { data: current } = await admin
      .from('leads')
      .select('tags')
      .eq('id', lead.id)
      .maybeSingle();
    const { data: claimed } = await admin
      .from('leads')
      .update({ tags: [...new Set([...(current?.tags ?? []), MARKER_TAG])] })
      .eq('id', lead.id)
      .not('tags', 'cs', `{${MARKER_TAG}}`)
      .select('id');
    if (!claimed || claimed.length === 0) {
      results.push({ leadId: lead.id, outcome: 'já processado' });
      continue;
    }

    const registrar = async (outcome: string, description: string) => {
      results.push({ leadId: lead.id, outcome });
      await admin.from('activities').insert({
        lead_id: lead.id,
        user_id: null,
        type: 'note',
        title: 'Primeiro contato automático',
        description,
        is_demo: lead.is_demo,
        metadata: { automation: 'first_contact_auto', outcome },
      });
    };

    const digits = lead.phone_normalized ?? '';
    if (digits.replace(/\D/g, '').length < 10) {
      await registrar('pulado', 'Pulado: telefone inválido/incompleto.');
      continue;
    }
    if (!usableFirstName(lead.name)) {
      await registrar('pulado', 'Pulado: lead sem nome utilizável para {{nome}}.');
      continue;
    }

    // Conversa existente (com/sem 9º dígito): se já tem mensagem, o lead já está
    // em contato com o time — não manda template em cima.
    const variants = phoneVariants(digits);
    const { data: existingConv } = await admin
      .from('conversations')
      .select('id')
      .eq('channel', 'whatsapp')
      .in('external_id', variants)
      .maybeSingle();
    let conversationId = existingConv?.id ?? null;
    if (conversationId) {
      const { data: anyMsg } = await admin
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .limit(1)
        .maybeSingle();
      if (anyMsg) {
        await registrar('pulado', 'Pulado: conversa já em andamento com o lead.');
        continue;
      }
    } else {
      const { data: created } = await admin
        .from('conversations')
        .upsert(
          {
            channel: 'whatsapp',
            external_id: digits,
            lead_id: lead.id,
            whatsapp_instance_id: sdInstance.id,
            waba_id: sdInstance.phone_number_id,
            contact_name: lead.name,
          },
          { onConflict: 'channel,external_id' },
        )
        .select('id')
        .single();
      conversationId = created?.id ?? null;
    }
    if (!conversationId) {
      await registrar('erro', 'Falha ao criar a conversa para o envio.');
      continue;
    }

    const sent = await sendTemplateMessageAsAi(conversationId, template.id);
    if (!sent.ok) {
      await registrar('erro', `Não enviado: ${sent.error}`);
      continue;
    }
    if (!sent.data.delivered) {
      await registrar('erro', `Não entregue: ${sent.data.warning ?? 'falha no envio'}`);
      continue;
    }

    await advanceLeadOnFirstOutbound(admin, conversationId, { actorUserId: null, via: 'auto' });
    await registrar('enviado', 'Template de primeiro contato enviado automaticamente (2min após a entrada).');
  }

  return NextResponse.json({
    checked: candidates?.length ?? 0,
    sent: results.filter((r) => r.outcome === 'enviado').length,
    results,
  });
}

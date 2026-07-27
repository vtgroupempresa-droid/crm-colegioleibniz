import 'server-only';
import {
  resolveOfficialVia,
  sendWhatsappMessage,
  type MetaResult,
  type OfficialVia,
} from '@/lib/meta/client';
import { META_GRAPH_BASE, isConfigured, isWhatsappConfigured, metaEnv } from '@/lib/meta/config';
import type { MessageType } from '@/types/chat';

/**
 * Cliente da API OFICIAL do WhatsApp (Meta Cloud API) — instâncias
 * provider='official' em whatsapp_instances.
 *
 * O envio em si (texto + mídia image/audio/document) já vive em
 * `lib/meta/client.ts sendWhatsappMessage` (POST {phone_number_id}/messages
 * com Bearer WHATSAPP_ACCESS_TOKEN) — aqui é a fachada usada pelo roteamento
 * por provider, mais o read receipt que só a API oficial suporta.
 *
 * DEGRADAÇÃO GRACIOSA como o resto do cliente Meta: nunca lança.
 */

interface OfficialOutboundMessage {
  type: MessageType;
  content?: string | null;
  mediaUrl?: string | null;
}

/** Envia texto ou mídia pelo número oficial (da instância via, ou o do env). */
export async function sendOfficialMessage(
  to: string,
  msg: OfficialOutboundMessage,
  via?: OfficialVia,
): Promise<MetaResult<{ messageId: string | null }>> {
  return sendWhatsappMessage(to, msg, via);
}

export interface OfficialWhatsappStatus {
  /** Env WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID presentes (não placeholder). */
  configured: boolean;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  /** null = OK; string = motivo da falha (token expirado, número inválido, rede...). */
  error: string | null;
}

/**
 * Consulta o número oficial na Graph API (GET {phone_number_id}) para confirmar
 * que o token e o número estão válidos antes de enviar. Nunca lança.
 */
export async function fetchOfficialWhatsappStatus(): Promise<OfficialWhatsappStatus> {
  if (!isWhatsappConfigured()) {
    return {
      configured: false,
      displayPhoneNumber: null,
      verifiedName: null,
      qualityRating: null,
      error: 'WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN ainda não configurados (pendente).',
    };
  }
  const fields = 'display_phone_number,verified_name,quality_rating';
  const url = `${META_GRAPH_BASE}/${metaEnv.whatsappPhoneNumberId}?fields=${fields}&access_token=${metaEnv.whatsappToken}`;
  try {
    const res = await fetch(url, { method: 'GET' });
    const json = (await res.json().catch(() => ({}))) as {
      display_phone_number?: string;
      verified_name?: string;
      quality_rating?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        configured: true,
        displayPhoneNumber: null,
        verifiedName: null,
        qualityRating: null,
        error: json.error?.message ?? `HTTP ${res.status}`,
      };
    }
    return {
      configured: true,
      displayPhoneNumber: json.display_phone_number ?? null,
      verifiedName: json.verified_name ?? null,
      qualityRating: json.quality_rating ?? null,
      error: null,
    };
  } catch (err) {
    return {
      configured: true,
      displayPhoneNumber: null,
      verifiedName: null,
      qualityRating: null,
      error: err instanceof Error ? err.message : 'Falha de rede',
    };
  }
}

/**
 * Envia um template APROVADO na Meta (type=template) pelo número oficial.
 * É o único formato aceito fora da janela de 24h — texto livre é rejeitado
 * (erro 131047). `bodyParams` preenche as variáveis posicionais {{1}}, {{2}}…
 * na ordem do array.
 */
export async function sendOfficialTemplate(
  to: string,
  template: { name: string; language: string; bodyParams: string[] },
  via?: OfficialVia,
): Promise<MetaResult<{ messageId: string | null }>> {
  const { phoneNumberId, accessToken } = resolveOfficialVia(via);
  if (!isConfigured(phoneNumberId) || !isConfigured(accessToken)) {
    return { ok: false, error: 'WhatsApp não configurado', skipped: true };
  }
  const digits = to.replace(/\D/g, '');
  if (digits.length < 10) return { ok: false, error: 'Telefone inválido' };
  try {
    const res = await fetch(`${META_GRAPH_BASE}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: digits,
        type: 'template',
        template: {
          name: template.name,
          language: { code: template.language },
          ...(template.bodyParams.length > 0
            ? {
                components: [
                  {
                    type: 'body',
                    parameters: template.bodyParams.map((text) => ({ type: 'text', text })),
                  },
                ],
              }
            : {}),
        },
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
      error?: { message?: string };
    };
    if (!res.ok) return { ok: false, error: json.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, data: { messageId: json.messages?.[0]?.id ?? null } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Falha de rede' };
  }
}

/**
 * Marca uma mensagem recebida como lida (✓✓ azul no aparelho do contato).
 * Marcar a mensagem mais recente marca a conversa inteira até ela.
 */
export async function markOfficialMessageRead(
  messageId: string,
  via?: OfficialVia,
): Promise<MetaResult<{ success: boolean }>> {
  const { phoneNumberId, accessToken } = resolveOfficialVia(via);
  if (!isConfigured(phoneNumberId) || !isConfigured(accessToken)) {
    return { ok: false, error: 'WhatsApp não configurado', skipped: true };
  }
  try {
    const res = await fetch(`${META_GRAPH_BASE}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      error?: { message?: string };
    };
    if (!res.ok) return { ok: false, error: json.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, data: { success: json.success ?? true } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Falha de rede' };
  }
}

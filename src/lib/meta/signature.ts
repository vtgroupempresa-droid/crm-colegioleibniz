import 'server-only';
import crypto from 'node:crypto';

/**
 * Validação da assinatura X-Hub-Signature-256 dos webhooks da Meta (Fase 9).
 *
 * A Meta assina o corpo bruto (raw body) com HMAC-SHA256 usando o META_APP_SECRET
 * e envia no header `X-Hub-Signature-256: sha256=<hex>`. Comparamos em tempo
 * constante. Sem app secret configurado, retornamos false (não validável) —
 * o caller decide se ignora a verificação em ambiente de desenvolvimento.
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined | null,
): boolean {
  if (!appSecret || !signatureHeader) return false;

  const expected =
    'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Valida a assinatura contra QUALQUER um dos segredos fornecidos.
 *
 * A "API do Instagram com Instagram Login" assina os eventos `object=instagram`
 * (mensagens) com o **App Secret do Instagram**, distinto do App Secret do
 * Facebook usado em `object=page` (leadgen). Como o webhook é unificado,
 * aceitamos a assinatura se ela casar com qualquer segredo configurado.
 */
export function verifyMetaSignatureAny(
  rawBody: string,
  signatureHeader: string | null,
  appSecrets: (string | undefined | null)[],
): boolean {
  return appSecrets.some((secret) => verifyMetaSignature(rawBody, signatureHeader, secret));
}

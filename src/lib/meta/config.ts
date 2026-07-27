import 'server-only';

/**
 * Configuração da Meta com DEGRADAÇÃO GRACIOSA.
 *
 * Instagram Direct do Colégio Leibniz opera via Messenger Platform for
 * Instagram COM A PÁGINA do Facebook: a página "Colégio Leibniz"
 * (INSTAGRAM_PAGE_ID) está vinculada ao @colegio.leibniz e o envio usa o
 * Page Access Token (INSTAGRAM_PAGE_TOKEN) em graph.facebook.com — token
 * derivado de System User, SEM expiração (não precisa de cron de refresh).
 *
 * As credenciais de WhatsApp (WABA) serão preenchidas quando a linha oficial
 * for ativada. Enquanto isso os valores ficam vazios ou com o placeholder
 * 'pendente'. Toda funcionalidade que depende da Meta DEVE checar
 * `isConfigured()` antes de chamar a API e nunca lançar erro — a UI mostra
 * "Não configurado" e segue navegável.
 */

const PLACEHOLDER_VALUES = new Set(['', 'pendente', 'replace-with-real-key']);

/** Um valor de env conta como configurado se existir e não for placeholder. */
export function isConfigured(value: string | undefined | null): boolean {
  if (!value) return false;
  return !PLACEHOLDER_VALUES.has(value.trim().toLowerCase());
}

export const META_GRAPH_VERSION = 'v21.0';
export const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export const metaEnv = {
  get appId() {
    return process.env.META_APP_ID;
  },
  get appSecret() {
    return process.env.META_APP_SECRET;
  },
  // App Secret que assina os eventos de WhatsApp (object=whatsapp_business_account).
  // Se a WABA for provisionada no MESMO app do CRM, deixe vazio — cai no META_APP_SECRET.
  get whatsappAppSecret() {
    return process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET;
  },
  get verifyToken() {
    return process.env.META_VERIFY_TOKEN;
  },
  // Token de System User do app (sem expiração) — fallback geral p/ Graph API.
  get systemUserToken() {
    return process.env.META_ACCESS_TOKEN;
  },
  get whatsappToken() {
    return process.env.WHATSAPP_ACCESS_TOKEN;
  },
  get whatsappPhoneNumberId() {
    return process.env.WHATSAPP_PHONE_NUMBER_ID;
  },
  // WABA (WhatsApp Business Account) — gestão de templates.
  get whatsappBusinessAccountId() {
    return process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  },
  // Página "Colégio Leibniz" + Page Access Token (Instagram Direct e Lead Ads).
  get instagramPageId() {
    return process.env.INSTAGRAM_PAGE_ID;
  },
  get instagramPageToken() {
    return process.env.INSTAGRAM_PAGE_TOKEN || process.env.META_ACCESS_TOKEN;
  },
  // Id da conta Instagram Business (@colegio.leibniz) vinculada à página.
  get instagramUserId() {
    return process.env.INSTAGRAM_USER_ID;
  },
};

/** Logs detalhados no processamento de webhooks da Meta (ativar DEBUG_WEBHOOK=true). */
export function webhookDebugEnabled(): boolean {
  return process.env.DEBUG_WEBHOOK === 'true';
}

/** Snapshot seguro (sem segredos) para enviar à UI. */
export interface MetaConfigStatus {
  appConfigured: boolean;
  verifyTokenConfigured: boolean;
  whatsappConfigured: boolean;
  instagramConfigured: boolean;
  whatsappPhoneNumberId: string | null;
  instagramPageId: string | null;
}

export function getMetaConfigStatus(): MetaConfigStatus {
  return {
    appConfigured: isConfigured(metaEnv.appId) && isConfigured(metaEnv.appSecret),
    verifyTokenConfigured: isConfigured(metaEnv.verifyToken),
    whatsappConfigured: isWhatsappConfigured(),
    instagramConfigured: isInstagramConfigured(),
    // Só exibe o ID quando configurado (nunca o placeholder).
    whatsappPhoneNumberId: isConfigured(metaEnv.whatsappPhoneNumberId)
      ? metaEnv.whatsappPhoneNumberId ?? null
      : null,
    instagramPageId: isConfigured(metaEnv.instagramPageId)
      ? metaEnv.instagramPageId ?? null
      : null,
  };
}

export function isWhatsappConfigured(): boolean {
  return isConfigured(metaEnv.whatsappToken) && isConfigured(metaEnv.whatsappPhoneNumberId);
}

/** Página + Page token configurados (Lead Ads e operações da página). */
export function isInstagramConfigured(): boolean {
  return isConfigured(metaEnv.instagramPageToken) && isConfigured(metaEnv.instagramPageId);
}

/** Instagram Direct (DMs) configurado: página + token + id da conta IG. */
export function isInstagramDirectConfigured(): boolean {
  return isInstagramConfigured() && isConfigured(metaEnv.instagramUserId);
}

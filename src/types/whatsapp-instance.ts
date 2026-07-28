import type { Tables, TablesInsert, TablesUpdate } from './database';

export type WhatsappInstance = Tables<'whatsapp_instances'>;
export type WhatsappInstanceInsert = TablesInsert<'whatsapp_instances'>;
export type WhatsappInstanceUpdate = TablesUpdate<'whatsapp_instances'>;

/**
 * Provedor da instância de WhatsApp. Enum FECHADO — alterar exige migration
 * no CHECK da coluna `whatsapp_instances.provider` primeiro.
 */
export type WhatsappProvider = 'uazapi' | 'official';

export const WHATSAPP_PROVIDERS: readonly WhatsappProvider[] = ['uazapi', 'official'] as const;

export const WHATSAPP_PROVIDER_LABELS: Record<WhatsappProvider, string> = {
  uazapi: 'UaZAPI (não oficial)',
  official: 'API oficial (Meta)',
};

export function isWhatsappProvider(value: string | null | undefined): value is WhatsappProvider {
  return value === 'uazapi' || value === 'official';
}

/** Subconjunto seguro da instância para a UI do chat (badge/filtro/header). */
export interface WhatsappInstanceBadge {
  id: string;
  name: string;
  label: string | null;
  color: string | null;
  /** Status de conexão (Correção 4b) — banner/disable no /chat. */
  is_connected: boolean;
  provider: string;
}

/** Instância UaZAPI desconectada → aviso visual + envio bloqueado no /chat. */
export function isInstanceDisconnected(
  instance: Pick<WhatsappInstanceBadge, 'is_connected' | 'provider'> | null | undefined,
): boolean {
  return Boolean(instance && instance.provider === 'uazapi' && instance.is_connected === false);
}

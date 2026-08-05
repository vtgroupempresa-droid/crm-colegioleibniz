import type { Tables, TablesInsert } from './database';
import type { WhatsappInstanceBadge } from './whatsapp-instance';

export type Conversation = Tables<'conversations'>;
export type ConversationInsert = TablesInsert<'conversations'>;

export type Message = Tables<'messages'>;
export type MessageInsert = TablesInsert<'messages'>;

export type MessageTemplate = Tables<'message_templates'>;
export type MessageTemplateInsert = TablesInsert<'message_templates'>;

/**
 * Variável de template preenchida pelo sistema com o primeiro nome do lead da
 * conversa (resolvida por destinatário em sendTemplateMessage) — no disparo em
 * lote cada lead recebe o próprio nome, então o usuário não digita esse campo.
 */
export const AUTO_LEAD_NAME_VARIABLE = 'nome';

/** Canais suportados — enum fechado (CHECK no banco). */
export type ChatChannel = 'whatsapp' | 'instagram';
export const CHAT_CHANNELS: readonly ChatChannel[] = ['whatsapp', 'instagram'] as const;

export const CHAT_CHANNEL_META: Record<ChatChannel, { label: string; icon: string }> = {
  whatsapp: { label: 'WhatsApp', icon: '🟢' },
  instagram: { label: 'Instagram', icon: '🟣' },
};

export type ConversationStatus = 'open' | 'resolved' | 'waiting';
export const CONVERSATION_STATUSES: readonly ConversationStatus[] = [
  'open',
  'waiting',
  'resolved',
] as const;

export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  open: 'Aberta',
  waiting: 'Aguardando',
  resolved: 'Resolvida',
};

export type MessageDirection = 'inbound' | 'outbound';

export type MessageType =
  | 'text'
  | 'audio'
  | 'image'
  | 'video'
  | 'document'
  | 'sticker'
  | 'contact'
  | 'location'
  | 'interactive'
  | 'template'
  | 'reaction';

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

// ---------------------------------------------------------------------------
// Metadata estruturada por tipo (messages.metadata jsonb)
// ---------------------------------------------------------------------------

/** Um contato de cartão compartilhado (vCard) já parseado no webhook. */
export interface SharedContactCard {
  name: string;
  phones: string[];
  emails: string[];
  org: string | null;
}

export interface MessageMetadata {
  /** Resposta/citação de outra mensagem da mesma conversa. */
  reply?: {
    /** UUID local, quando a mensagem citada existe no histórico do CRM. */
    targetMessageId: string | null;
    /** ID do provider (wamid/mid), usado pelo WhatsApp para a resposta nativa. */
    targetExternalId: string;
    /** Direção da mensagem citada — define "Família" ou "Equipe Leibniz". */
    direction: MessageDirection | null;
    /** Tipo e resumo congelados para a citação continuar legível no histórico. */
    type: string;
    preview: string;
  };
  /** type='contact': contatos compartilhados. */
  contacts?: SharedContactCard[];
  /** type='location': coordenadas e rótulos. */
  location?: {
    latitude: number | null;
    longitude: number | null;
    name: string | null;
    address: string | null;
  };
  /** type='interactive': opção escolhida em botões/lista. */
  interactive?: {
    kind: 'button_reply' | 'list_reply' | 'button' | string;
    id: string | null;
    title: string | null;
    description: string | null;
  };
  /** type='reaction': emoji + id externo da mensagem reagida. */
  reaction?: { emoji: string | null; targetExternalId: string | null };
  /** type='document' (e mídias): nome/tamanho do arquivo. */
  file?: { name: string | null; sizeBytes: number | null };
  /** type='audio': mensagem de voz (ptt) e duração, quando o provider informa. */
  audio?: { ptt: boolean; seconds: number | null };
  /** Tipo cru do provider quando não suportado (fallback "Mensagem não suportada"). */
  unsupportedType?: string;
}

/** Lê o metadata jsonb de uma mensagem com tipo estruturado (nunca lança). */
export function parseMessageMetadata(raw: unknown): MessageMetadata {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as MessageMetadata;
}

/** Rótulo curto por tipo — previews da lista, notificações e fallbacks. */
export const MESSAGE_TYPE_PREVIEW: Record<MessageType, string> = {
  text: 'Mensagem',
  audio: 'Mensagem de voz',
  image: 'Foto',
  video: 'Vídeo',
  document: 'Documento',
  sticker: 'Figurinha',
  contact: 'Contato compartilhado',
  location: 'Localização',
  interactive: 'Resposta de botão',
  template: 'Template',
  reaction: 'Reação',
};

/**
 * Preview legível de uma mensagem (lista de conversas, notificações): usa o
 * conteúdo quando existe e um rótulo por tipo no lugar do código cru
 * ("[interactive]", "[contacts]" etc.).
 */
export function messagePreview(type: string, content: string | null): string {
  if (content?.trim() && type !== 'reaction') return content;
  const label = MESSAGE_TYPE_PREVIEW[type as MessageType];
  if (type === 'reaction' && content?.trim()) return `Reagiu com ${content.trim()}`;
  return label ?? 'Mensagem';
}

/** Resumo compacto e estável para citações, sem quebras ou espaços excessivos. */
export function messageReplyPreview(type: string, content: string | null): string {
  const compact = messagePreview(type, content).replace(/\s+/g, ' ').trim();
  return compact.length > 160 ? `${compact.slice(0, 157)}…` : compact;
}

/** Conversa enriquecida com dados do lead/contato para a lista. */
export interface ConversationListItem {
  conversation: Conversation;
  leadName: string | null;
  leadScore: number | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  /** Instância de WhatsApp que recebeu a conversa (badge "MS" etc.) — Fase 15. */
  instance: WhatsappInstanceBadge | null;
}

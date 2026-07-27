import type { Tables, TablesInsert, Enums } from './database';

export type Notification = Tables<'notifications'>;
export type NotificationInsert = TablesInsert<'notifications'>;
export type NotificationType = Enums<'notification_type'>;

export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  'novo_lead',
  'sla_vencendo',
  'no_show',
  'matricula_fechada',
  'followup',
  'lembrete',
  'sistema',
] as const;

/**
 * Cada tipo carrega um rótulo curto e um emoji para a UI do sino.
 * Mantém o significado do tipo desacoplado do texto livre de `title`/`body`.
 */
export const NOTIFICATION_TYPE_META: Record<NotificationType, { label: string; icon: string }> = {
  novo_lead: { label: 'Novo lead', icon: '🎯' },
  sla_vencendo: { label: 'SLA', icon: '⏰' },
  no_show: { label: 'No-show', icon: '🚫' },
  matricula_fechada: { label: 'Matrícula fechada', icon: '🎉' },
  followup: { label: 'Follow-up', icon: '🔁' },
  lembrete: { label: 'Lembrete', icon: '🔔' },
  sistema: { label: 'Sistema', icon: '⚙️' },
};

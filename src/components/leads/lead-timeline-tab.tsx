'use client';

import { useState } from 'react';
import { formatRelative } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import type { Activity } from '@/types/lead';
import type { Message } from '@/types/chat';

const TYPE_ICON: Record<Activity['type'], string> = {
  call: '📞',
  whatsapp: '💬',
  email: '✉️',
  stage_change: '↪',
  appointment: '📅',
  note: '📝',
  qualification: '✨',
  system: '⚙️',
};

type TimelineFilter = 'all' | 'messages' | 'calls' | 'system';

const TIMELINE_FILTER_TYPES: Record<
  Exclude<TimelineFilter, 'all'>,
  ReadonlyArray<Activity['type']>
> = {
  messages: ['whatsapp', 'email'],
  calls: ['call'],
  system: ['system', 'stage_change', 'appointment', 'qualification'],
};

const TIMELINE_FILTER_TABS: { value: TimelineFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'messages', label: 'Mensagens' },
  { value: 'calls', label: 'Chamadas' },
  { value: 'system', label: 'Sistema' },
];

interface LeadTimelineTabProps {
  leadId: string;
  activities: readonly Activity[];
  /** Mapa user_id → nome para mostrar o autor das activities (notas). */
  activityAuthors: Record<string, string>;
  /** Usuário atual: mantido por compatibilidade (edição de nota vive na aba Notas). */
  viewerId: string | null;
  viewerIsAdmin: boolean;
  /** Recarrega o lead no drawer após recalcular score. */
  onMutated?: () => void | Promise<void>;
  messages?: readonly Message[];
}

export function LeadTimelineTab({
  leadId,
  activities,
  activityAuthors,
  viewerIsAdmin,
  onMutated,
  messages = [],
}: LeadTimelineTabProps) {
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>('all');

  // Notas vivem na aba "Notas" — a Timeline nunca as exibe.
  const timelineActivities = activities.filter((a) => a.type !== 'note');
  const visibleActivities =
    timelineFilter === 'all'
      ? timelineActivities
      : timelineFilter === 'messages'
        ? []
        : timelineActivities.filter((a) => TIMELINE_FILTER_TYPES[timelineFilter].includes(a.type));
  const visibleMessages = timelineFilter === 'all' || timelineFilter === 'messages' ? messages : [];
  const events = [
    ...visibleActivities.map((activity) => ({
      kind: 'activity' as const,
      at: activity.created_at,
      activity,
    })),
    ...visibleMessages.map((message) => ({
      kind: 'message' as const,
      at: message.created_at,
      message,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  void leadId;
  void viewerIsAdmin;
  void onMutated;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        {TIMELINE_FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setTimelineFilter(tab.value)}
            className={cn(
              'focus-ring rounded-full px-2 py-1 font-medium',
              timelineFilter === tab.value
                ? 'bg-brand-700 text-canvas'
                : 'bg-brand-100 text-brand-500 hover:bg-brand-200',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <ol className="flex flex-col gap-3">
        {events.length === 0 && (
          <li className="text-sm text-brand-400">Sem atividades nesta categoria.</li>
        )}
        {events.map((event) => {
          if (event.kind === 'message') {
            const message = event.message;
            const direction = message.direction === 'inbound' ? 'Família' : 'Colégio';
            const content = message.content?.trim() || `[${message.type}]`;
            return (
              <li
                key={`message-${message.id}`}
                className="flex gap-3 rounded-md border border-sky-100 bg-sky-50/40 p-3"
              >
                <span aria-hidden className="text-lg leading-none">
                  💬
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-brand-700">
                      {direction} · {message.direction === 'inbound' ? 'recebida' : 'enviada'}
                    </p>
                    <span className="shrink-0 text-[11px] text-brand-400">
                      {formatRelative(message.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-brand-500">{content}</p>
                </div>
              </li>
            );
          }
          const activity = event.activity;
          const isNote = activity.type === 'note';
          const authorName = activity.user_id ? (activityAuthors[activity.user_id] ?? null) : null;
          return (
            <li
              key={activity.id}
              className={cn(
                'group flex gap-3 rounded-md border p-3',
                // Notas ganham fundo âmbar para se destacar do ruído de sistema.
                isNote ? 'border-amber-200 bg-amber-50' : 'border-brand-100 bg-white',
              )}
            >
              <span aria-hidden className="text-lg leading-none">
                {TYPE_ICON[activity.type]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-brand-700">{activity.title}</p>
                  <span className="shrink-0 text-[11px] text-brand-400">
                    {formatRelative(activity.created_at)}
                  </span>
                </div>

                {activity.description && (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-brand-500">
                    {activity.description}
                  </p>
                )}

                {authorName && <p className="mt-1 text-[11px] text-brand-400">por {authorName}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

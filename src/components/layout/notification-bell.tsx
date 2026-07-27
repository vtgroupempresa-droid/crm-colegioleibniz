'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { LeadDrawer } from '@/components/leads/lead-drawer';
import { markAllNotificationsRead, markNotificationRead } from '@/actions/notifications';
import { NOTIFICATION_TYPE_META } from '@/types/notification';
import type { Notification } from '@/types/notification';
import { cn } from '@/lib/utils/cn';

interface NotificationBellProps {
  userId: string;
  initialItems: Notification[];
  initialUnread: number;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Sino de notificações no header (Fase 7).
 *
 * - Badge com contagem de não lidas.
 * - Dropdown com as últimas 10.
 * - Clicar marca como lida e abre o LeadDrawer do lead (quando houver lead_id).
 * - "Marcar todas como lidas".
 * - Supabase Realtime: novas notificações chegam sem refresh.
 *
 * O drawer é renderizado aqui mesmo (busca os dados via /api/leads/:id), então
 * funciona em qualquer rota do dashboard.
 */
export function NotificationBell({ userId, initialItems, initialUnread }: NotificationBellProps) {
  const [items, setItems] = useState<Notification[]>(initialItems);
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Realtime: escuta INSERTs das próprias notificações.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const next = payload.new as Notification;
          setItems((prev) => [next, ...prev].slice(0, 10));
          setUnread((prev) => prev + 1);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  // Fecha o dropdown ao clicar fora.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function handleClickNotification(n: Notification) {
    setOpen(false);
    if (!n.read) {
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read: true } : i)));
      setUnread((prev) => Math.max(0, prev - 1));
      await markNotificationRead(n.id);
    }
    if (n.lead_id) setDrawerLeadId(n.lead_id);
  }

  async function handleMarkAll() {
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    setUnread(0);
    await markAllNotificationsRead();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="focus-ring relative rounded-md p-2 text-brand-600 hover:bg-brand-100"
        aria-label={`Notificações${unread > 0 ? ` (${unread} não lidas)` : ''}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-brand-100 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-brand-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-brand-700">Notificações</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={handleMarkAll}
                className="focus-ring rounded text-xs font-medium text-brand-500 hover:text-brand-700"
              >
                Marcar todas como lidas
              </button>
            )}
          </div>

          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-brand-400">
                Nenhuma notificação ainda.
              </li>
            )}
            {items.map((n) => {
              const meta = NOTIFICATION_TYPE_META[n.type];
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleClickNotification(n)}
                    className={cn(
                      'flex w-full items-start gap-3 border-b border-brand-50 px-4 py-3 text-left transition-colors hover:bg-brand-50',
                      !n.read && 'bg-brand-50/60',
                    )}
                  >
                    <span className="mt-0.5 text-base" aria-hidden="true">
                      {meta.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-brand-700">
                          {n.title}
                        </span>
                        <span className="shrink-0 text-[11px] text-brand-400">
                          {timeAgo(n.created_at)}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-brand-500">{n.body}</span>
                    </span>
                    {!n.read && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <LeadDrawer
        leadId={drawerLeadId}
        open={drawerLeadId !== null}
        onClose={() => setDrawerLeadId(null)}
      />
    </div>
  );
}

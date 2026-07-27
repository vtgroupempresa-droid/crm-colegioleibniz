'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getLeadConversations, type LeadConversation } from '@/actions/conversations';
import { MessageBubble } from '@/components/chat/message-bubble';
import { Badge } from '@/components/ui/badge';
import type { ChatChannel } from '@/types/chat';

const CHANNEL_META: Record<ChatChannel, { icon: string; label: string }> = {
  whatsapp: { icon: '🟢', label: 'WhatsApp' },
  instagram: { icon: '📷', label: 'Instagram' },
};

interface LeadConversationsTabProps {
  leadId: string;
}

/**
 * Aba "Conversas" do LeadDrawer: mostra o chat do lead (WhatsApp/Instagram)
 * sem sair do Kanban — leitura, com link "Responder no chat" para o /chat.
 */
export function LeadConversationsTab({ leadId }: LeadConversationsTabProps) {
  const [items, setItems] = useState<LeadConversation[] | null>(null);
  const [selected, setSelected] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getLeadConversations(leadId).then((data) => {
      if (!cancelled) setItems(data);
    });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  // Conversa selecionada mudou (ou carregou) → rola para a última mensagem.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items, selected]);

  if (items === null) {
    return <p className="p-4 text-sm text-brand-400">Carregando conversas…</p>;
  }
  if (items.length === 0) {
    return (
      <p className="p-4 text-sm text-brand-400">
        Nenhuma conversa de WhatsApp ou Instagram vinculada a este lead ainda.
      </p>
    );
  }

  const active = items[Math.min(selected, items.length - 1)];
  if (!active) return null;
  const channel = active.conversation.channel as ChatChannel;
  const meta = CHANNEL_META[channel];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Seletor — só aparece quando o lead tem mais de uma conversa. */}
      {items.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {items.map((item, i) => {
            const c = item.conversation.channel as ChatChannel;
            return (
              <button
                key={item.conversation.id}
                type="button"
                onClick={() => setSelected(i)}
                className={`focus-ring rounded-md border px-2 py-1 text-xs ${
                  i === selected
                    ? 'border-brand-700 bg-brand-700 text-canvas'
                    : 'border-brand-200 bg-white text-brand-600 hover:bg-brand-50'
                }`}
              >
                {CHANNEL_META[c].icon} {CHANNEL_META[c].label}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-brand-500">
          <span aria-hidden="true">{meta.icon}</span>
          <span className="font-medium text-brand-600">{meta.label}</span>
          {channel === 'whatsapp' && active.instance && (
            <Badge tone="neutral">{active.instance.name}</Badge>
          )}
          <span className="truncate">· {active.conversation.external_id}</span>
        </p>
        <Link
          href={`/chat?c=${active.conversation.id}`}
          className="focus-ring shrink-0 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-canvas hover:bg-brand-800"
        >
          Responder no chat
        </Link>
      </div>

      <div
        ref={scrollRef}
        className="flex max-h-[55vh] min-h-[12rem] flex-col gap-2 overflow-y-auto rounded-md bg-brand-50 p-3"
      >
        {active.messages.length === 0 ? (
          <p className="text-center text-xs text-brand-400">Sem mensagens nesta conversa.</p>
        ) : (
          active.messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
      </div>
    </div>
  );
}

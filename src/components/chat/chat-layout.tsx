'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { LeadDrawer } from '@/components/leads/lead-drawer';
import { MessageCircleIcon, XIcon } from '@/components/ui/icons';
import { ConversationList } from './conversation-list';
import { ConversationView } from './conversation-view';
import { ChatLeadPanel } from './chat-lead-panel';
import { NewConversationModal } from './new-conversation-modal';
import {
  getChannelUnreadCounts,
  getConversations,
  getConversationThread,
  getMessageTemplates,
  markConversationRead,
  sendMessage,
  sendTemplateMessage,
  setConversationStatus,
  transferConversationSector,
  type ChannelUnreadCounts,
  type ConversationThread,
} from '@/actions/conversations';
import { cn } from '@/lib/utils/cn';
import {
  type ChatChannel,
  type ConversationListItem,
  type ConversationStatus,
  type Message,
  type MessageTemplate,
  type MessageType,
} from '@/types/chat';
import type { WhatsappInstanceBadge } from '@/types/whatsapp-instance';

export interface ChatStageOption {
  slug: string;
  name: string;
  pipeline: string;
}

export interface ChatSectorOption {
  id: string;
  slug: string;
  name: string;
  color: string;
}

interface ChatLayoutProps {
  initialConversations: ConversationListItem[];
  initialConversationId: string | null;
  stages: ChatStageOption[];
  whatsappConfigured: boolean;
  instagramConfigured: boolean;
  /** Instâncias de WhatsApp ativas (sub-filtro da tab WhatsApp — Fase 15). */
  instances: WhatsappInstanceBadge[];
  sectors: ChatSectorOption[];
}

type StatusFilter = ConversationStatus | 'all';
type ChannelFilter = ChatChannel | 'all';

export function ChatLayout({
  initialConversations,
  initialConversationId,
  stages,
  whatsappConfigured,
  instagramConfigured,
  instances,
  sectors,
}: ChatLayoutProps) {
  const [conversations, setConversations] = useState<ConversationListItem[]>(initialConversations);
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId);
  const [thread, setThread] = useState<ConversationThread | null>(null);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [sending, setSending] = useState(false);
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);
  const [newConvOpen, setNewConvOpen] = useState(false);
  // Mobile: painel do lead (substitui a 3ª coluna) aberto pelo "ver mais".
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  const [search, setSearch] = useState('');
  // Busca com debounce: vai pro SERVIDOR (o limit(200) da lista esconderia
  // conversas antigas se a busca fosse só no client).
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
  // 'all' | uuid — só se aplica quando a tab WhatsApp está ativa.
  const [instanceFilter, setInstanceFilter] = useState<string>('all');

  // Badges das tabs: contados no banco (independem do limit da lista).
  const [channelUnread, setChannelUnread] = useState<ChannelUnreadCounts>({
    all: 0,
    whatsapp: 0,
    instagram: 0,
  });
  const refreshUnread = useCallback(async () => {
    setChannelUnread(await getChannelUnreadCounts());
  }, []);

  // Os filtros (inclusive a busca) vão pro SERVIDOR: o limit(200) da lista é
  // aplicado depois deles. Filtrar só no client escondia conversas fora da
  // janela das 200 mais recentes ("conversas sumindo" da lista e da busca).
  const refreshSeq = useRef(0);
  const refreshConversations = useCallback(async () => {
    const seq = ++refreshSeq.current;
    const list = await getConversations({
      status: statusFilter,
      channel: channelFilter,
      instanceId: channelFilter === 'whatsapp' ? instanceFilter : 'all',
      search: debouncedSearch,
    });
    // Descarta respostas fora de ordem (digitação rápida na busca).
    if (seq === refreshSeq.current) setConversations(list);
  }, [statusFilter, channelFilter, instanceFilter, debouncedSearch]);

  const loadThread = useCallback(
    async (id: string) => {
      const data = await getConversationThread(id);
      setThread(data);
      await markConversationRead(id);
      setConversations((prev) =>
        prev.map((c) => (c.conversation.id === id ? { ...c, unreadCount: 0 } : c)),
      );
      void refreshUnread();
    },
    [refreshUnread],
  );

  // Templates uma vez + badges de não-lidas.
  useEffect(() => {
    getMessageTemplates().then(setTemplates);
    void refreshUnread();
  }, [refreshUnread]);

  // Recarrega a lista quando qualquer filtro (ou a busca debounced) muda.
  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  // Carrega a thread ao selecionar.
  useEffect(() => {
    if (selectedId) void loadThread(selectedId);
    else setThread(null);
  }, [selectedId, loadThread]);

  // Realtime: lista de conversas (qualquer mudança → atualiza).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('chat:conversations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        void refreshConversations();
        void refreshUnread();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refreshConversations, refreshUnread]);

  // Realtime: mensagens da conversa ativa.
  useEffect(() => {
    if (!selectedId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`chat:messages:${selectedId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${selectedId}`,
        },
        (payload) => {
          const msg = payload.new as Message;
          setThread((prev) =>
            prev && prev.conversation.id === selectedId
              ? prev.messages.some((m) => m.id === msg.id)
                ? prev
                : { ...prev, messages: [...prev.messages, msg] }
              : prev,
          );
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${selectedId}`,
        },
        (payload) => {
          const msg = payload.new as Message;
          setThread((prev) =>
            prev
              ? { ...prev, messages: prev.messages.map((m) => (m.id === msg.id ? msg : m)) }
              : prev,
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedId]);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return conversations.filter((item) => {
      const conv = item.conversation;
      if (statusFilter !== 'all' && conv.status !== statusFilter) return false;
      if (channelFilter !== 'all' && conv.channel !== channelFilter) return false;
      if (
        channelFilter === 'whatsapp' &&
        instanceFilter !== 'all' &&
        conv.whatsapp_instance_id !== instanceFilter
      ) {
        return false;
      }
      if (term) {
        const hay =
          `${item.leadName ?? ''} ${conv.contact_name ?? ''} ${conv.external_id}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [conversations, search, statusFilter, channelFilter, instanceFilter]);

  const channelConfigured =
    thread?.conversation.channel === 'whatsapp'
      ? whatsappConfigured
      : thread?.conversation.channel === 'instagram'
        ? instagramConfigured
        : false;

  async function handleSend(content: string, type: MessageType, mediaUrl?: string | null) {
    if (!selectedId) return;
    setSending(true);
    const result = await sendMessage(selectedId, content, type, mediaUrl);
    setSending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (result.data.warning) toast.warning(result.data.warning);
    await loadThread(selectedId);
    void refreshConversations();
  }

  async function handleSendTemplate(
    templateId: string,
    values: Record<string, string>,
  ): Promise<boolean> {
    if (!selectedId) return false;
    const result = await sendTemplateMessage(selectedId, templateId, values);
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    if (result.data.warning) toast.warning(result.data.warning);
    else toast.success('Template enviado.');
    await loadThread(selectedId);
    void refreshConversations();
    return true;
  }

  async function handleSetStatus(status: ConversationStatus) {
    if (!selectedId) return;
    const result = await setConversationStatus(selectedId, status);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await loadThread(selectedId);
    void refreshConversations();
  }

  async function handleTransferSector(sectorId: string) {
    if (!selectedId || !thread || sectorId === thread.conversation.sector_id) return;
    const result = await transferConversationSector({
      conversationId: selectedId,
      sectorId,
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Conversa encaminhada para ${result.data.sectorName}.`);
    if (!result.data.remainsVisible) {
      setSelectedId(null);
      setThread(null);
    } else {
      await loadThread(selectedId);
    }
    void refreshConversations();
    void refreshUnread();
  }

  const nothingConfigured = !whatsappConfigured && !instagramConfigured;
  const isEmpty = conversations.length === 0;

  // Nome legível do stage atual do lead (faixa mobile "Pipeline · Stage").
  const stageName = thread?.lead
    ? (stages.find((s) => s.pipeline === thread.lead?.pipeline && s.slug === thread.lead?.stage)
        ?.name ?? thread.lead.stage)
    : null;

  return (
    // dvh: no mobile o teclado virtual reduz o viewport — 100dvh acompanha e o
    // composer não fica coberto. No telefone o chat é FULL-BLEED (estilo
    // WhatsApp): -m-4 anula o padding do <main>, sem borda/raio, altura até o
    // header (57px = 40 do conteúdo + 16 de py-2 + 1 de borda).
    <div className="-m-4 flex h-[calc(100dvh-57px)] overflow-hidden border-brand-100 bg-white sm:m-0 sm:h-[calc(100dvh-7.5rem)] sm:rounded-lg sm:border">
      {/* Coluna 1 — 288px até o xl (notebook), 320px em telas largas. */}
      <div className={cn('w-full shrink-0 sm:w-72 xl:w-80', selectedId && 'hidden sm:block')}>
        <ConversationList
          items={filteredItems}
          selectedId={selectedId}
          onSelect={setSelectedId}
          search={search}
          onSearch={setSearch}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          channelFilter={channelFilter}
          onChannelFilter={setChannelFilter}
          channelUnread={channelUnread}
          instances={instances}
          instanceFilter={instanceFilter}
          onInstanceFilter={setInstanceFilter}
          onNewConversation={() => setNewConvOpen(true)}
        />
      </div>

      {/* Coluna 2 */}
      <div className={cn('min-w-0 flex-1', !selectedId && 'hidden sm:block')}>
        {thread ? (
          <ConversationView
            conversation={thread.conversation}
            instance={thread.instance}
            leadName={thread.lead?.name ?? null}
            lead={thread.lead}
            leadExtras={thread.leadExtras}
            stageName={stageName}
            messages={thread.messages}
            senders={thread.senders}
            templates={templates}
            channelConfigured={channelConfigured}
            sending={sending}
            onSend={handleSend}
            onSendTemplate={handleSendTemplate}
            onSetStatus={handleSetStatus}
            sectors={sectors}
            onTransferSector={handleTransferSector}
            onOpenLead={() => thread.lead && setDrawerLeadId(thread.lead.id)}
            onOpenLeadPanel={() => setMobilePanelOpen(true)}
            onBack={() => setSelectedId(null)}
            onMessageResolved={() => {
              if (selectedId) void loadThread(selectedId);
              void refreshConversations();
            }}
            onChanged={() => {
              if (selectedId) void loadThread(selectedId);
              void refreshConversations();
            }}
          />
        ) : isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <MessageCircleIcon size={40} className="text-brand-300" />
            <p className="font-medium text-brand-700">
              {nothingConfigured ? 'Configure o WhatsApp para começar' : 'Nenhuma conversa ainda'}
            </p>
            <p className="max-w-sm text-sm text-brand-500">
              {nothingConfigured
                ? 'As conversas de WhatsApp e Instagram aparecem aqui assim que as credenciais da Meta forem configuradas.'
                : 'Quando um contato enviar mensagem ou você abrir um chat pelo Kanban, a conversa aparece aqui.'}
            </p>
            {nothingConfigured && (
              <a
                href="/integracoes/meta"
                className="focus-ring rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-canvas hover:bg-brand-800"
              >
                Configurar Meta
              </a>
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-brand-400">
            Selecione uma conversa à esquerda.
          </div>
        )}
      </div>

      {/* Coluna 3 — mais estreita no lg (notebook 1366px) p/ sobrar espaço à
          conversa; volta a 320px no xl. */}
      <div className="hidden w-72 shrink-0 border-l border-brand-100 lg:block xl:w-80">
        <ChatLeadPanel
          lead={thread?.lead ?? null}
          leadExtras={thread?.leadExtras ?? null}
          conversation={thread?.conversation ?? null}
          activities={thread?.activities ?? []}
          stages={stages}
          onOpenLead={(id) => setDrawerLeadId(id)}
          onChanged={() => {
            if (selectedId) void loadThread(selectedId);
            void refreshConversations();
          }}
        />
      </div>

      {/* Mobile: painel do lead como bottom sheet (aberto pelo "ver mais"). */}
      {mobilePanelOpen && thread && (
        <div
          className="fixed inset-0 z-40 flex items-end bg-black/40 lg:hidden"
          onClick={() => setMobilePanelOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="max-h-[85%] w-full overflow-hidden rounded-t-2xl bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-brand-100 px-4 py-2.5">
              <span className="text-sm font-semibold text-brand-700">Dados do lead</span>
              <button
                type="button"
                onClick={() => setMobilePanelOpen(false)}
                aria-label="Fechar"
                className="focus-ring flex h-10 w-10 items-center justify-center rounded-full text-brand-500 hover:bg-brand-100"
              >
                <XIcon size={18} />
              </button>
            </div>
            <div className="max-h-[70dvh] overflow-y-auto">
              <ChatLeadPanel
                lead={thread.lead}
                leadExtras={thread.leadExtras}
                conversation={thread.conversation}
                activities={thread.activities}
                stages={stages}
                onOpenLead={(id) => {
                  setMobilePanelOpen(false);
                  setDrawerLeadId(id);
                }}
                onChanged={() => {
                  if (selectedId) void loadThread(selectedId);
                  void refreshConversations();
                }}
              />
            </div>
          </div>
        </div>
      )}

      <LeadDrawer
        leadId={drawerLeadId}
        open={drawerLeadId !== null}
        onClose={() => setDrawerLeadId(null)}
      />

      <NewConversationModal
        open={newConvOpen}
        onClose={() => setNewConvOpen(false)}
        instances={instances}
        onCreated={(conversationId) => {
          void refreshConversations();
          setSelectedId(conversationId);
        }}
      />
    </div>
  );
}

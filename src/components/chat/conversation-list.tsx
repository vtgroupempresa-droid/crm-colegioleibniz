'use client';

import { cn } from '@/lib/utils/cn';
import { Badge } from '@/components/ui/badge';
import { ChatAvatar } from './chat-avatar';
import {
  InstagramIcon,
  PlusIcon,
  SearchIcon,
  WhatsAppIcon,
} from '@/components/ui/icons';
import {
  CONVERSATION_STATUS_LABELS,
  type ChatChannel,
  type ConversationListItem,
  type ConversationStatus,
} from '@/types/chat';
import { isInstanceDisconnected, type WhatsappInstanceBadge } from '@/types/whatsapp-instance';

type StatusFilter = ConversationStatus | 'all';
type ChannelFilter = ChatChannel | 'all';

export interface ChannelUnread {
  all: number;
  whatsapp: number;
  instagram: number;
}

interface ConversationListProps {
  items: ConversationListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearch: (value: string) => void;
  statusFilter: StatusFilter;
  onStatusFilter: (value: StatusFilter) => void;
  channelFilter: ChannelFilter;
  onChannelFilter: (value: ChannelFilter) => void;
  channelUnread: ChannelUnread;
  /** Instâncias de WhatsApp ativas — sub-filtro da tab WhatsApp (Fase 15). */
  instances: WhatsappInstanceBadge[];
  /** 'all' | uuid da instância selecionada. */
  instanceFilter: string;
  onInstanceFilter: (value: string) => void;
  /** Abre o modal "Nova conversa". */
  onNewConversation: () => void;
}

/** Badge colorido com a sigla da instância (tooltip = nome completo). */
export function InstanceBadge({ instance }: { instance: WhatsappInstanceBadge }) {
  return (
    <span
      className="inline-flex h-4 min-w-4 items-center justify-center rounded px-1 text-[9px] font-bold leading-none text-white"
      style={{ backgroundColor: instance.color ?? '#22c55e' }}
      title={instance.name}
    >
      {instance.label ?? instance.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'open', label: 'Abertas' },
  { value: 'waiting', label: 'Aguardando' },
  { value: 'resolved', label: 'Resolvidas' },
];

/** Pill de tab de canal (Todas | WhatsApp | Instagram) com contagem de não lidas. */
function ChannelTab({
  active,
  label,
  icon,
  unread,
  onClick,
}: {
  active: boolean;
  label: string | null;
  icon?: React.ReactNode;
  unread: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label ?? undefined}
      className={cn(
        'focus-ring flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border text-xs font-medium transition-colors',
        active
          ? 'border-brand-700 bg-brand-700 text-canvas'
          : 'border-brand-200 bg-white text-brand-500 hover:bg-brand-50',
      )}
    >
      {icon}
      {label}
      {unread > 0 && (
        <span
          className={cn(
            'flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold',
            active ? 'bg-canvas text-brand-700' : 'bg-rose-500 text-white',
          )}
        >
          {unread}
        </span>
      )}
    </button>
  );
}

export function ConversationList({
  items,
  selectedId,
  onSelect,
  search,
  onSearch,
  statusFilter,
  onStatusFilter,
  channelFilter,
  onChannelFilter,
  channelUnread,
  instances,
  instanceFilter,
  onInstanceFilter,
  onNewConversation,
}: ConversationListProps) {
  return (
    <div className="relative flex h-full w-full flex-col border-r border-brand-100 bg-white">
      {/* Cabeçalho: título + ação de iniciar conversa ativa (desktop). */}
      <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
        <span className="text-base font-bold text-brand-700">Conversas</span>
        <button
          type="button"
          onClick={onNewConversation}
          className="focus-ring hidden items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1.5 text-xs font-medium text-canvas hover:bg-brand-800 sm:flex"
        >
          <PlusIcon size={14} /> Nova conversa
        </button>
      </div>

      {/* Busca */}
      <div className="px-3 py-2">
        <div className="relative">
          <SearchIcon
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-400"
          />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Buscar conversa…"
            className="focus-ring h-10 w-full rounded-full border border-brand-200 bg-brand-50/60 pl-9 pr-3 text-sm"
          />
        </div>
      </div>

      {/* Tabs por canal: Todas | WhatsApp | Instagram, com badge de não lidas. */}
      <div className="flex items-center gap-1.5 px-3 pb-2">
        <ChannelTab
          active={channelFilter === 'all'}
          label="Todas"
          unread={channelUnread.all}
          onClick={() => onChannelFilter('all')}
        />
        <ChannelTab
          active={channelFilter === 'whatsapp'}
          label={null}
          icon={<WhatsAppIcon size={16} className={channelFilter === 'whatsapp' ? '' : 'text-emerald-600'} />}
          unread={channelUnread.whatsapp}
          onClick={() => onChannelFilter('whatsapp')}
        />
        <ChannelTab
          active={channelFilter === 'instagram'}
          label={null}
          icon={
            <InstagramIcon
              size={16}
              className={channelFilter === 'instagram' ? '' : 'text-fuchsia-600'}
            />
          }
          unread={channelUnread.instagram}
          onClick={() => onChannelFilter('instagram')}
        />
      </div>

      {/* Sub-filtro por instância — só na tab WhatsApp e com 1+ instância.
          flex-wrap: com 5+ números a fileira QUEBRA LINHA — cortada com scroll
          escondido deixava pills inalcançáveis com mouse (report Augusto/Bruna). */}
      {channelFilter === 'whatsapp' && instances.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b border-brand-100 px-3 pb-2">
          <button
            type="button"
            onClick={() => onInstanceFilter('all')}
            className={cn(
              'focus-ring shrink-0 rounded-full px-2 py-1 text-[11px] font-medium',
              instanceFilter === 'all'
                ? 'bg-brand-700 text-canvas'
                : 'bg-brand-100 text-brand-500 hover:bg-brand-200',
            )}
          >
            Todos números
          </button>
          {instances.map((inst) => (
            <button
              key={inst.id}
              type="button"
              onClick={() => onInstanceFilter(inst.id)}
              title={inst.name}
              className={cn(
                'focus-ring flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium',
                instanceFilter === inst.id
                  ? 'bg-brand-700 text-canvas'
                  : 'bg-brand-100 text-brand-500 hover:bg-brand-200',
              )}
            >
              <InstanceBadge instance={inst} />
              {inst.name}
              {isInstanceDisconnected(inst) && (
                <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold leading-none text-red-700">
                  Desconectado
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Filtro por status da conversa. */}
      <div className="flex items-center gap-1 border-b border-brand-100 px-3 pb-2 pt-1 text-[11px]">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => onStatusFilter(tab.value)}
            className={cn(
              'focus-ring rounded-full px-2 py-1 font-medium',
              statusFilter === tab.value
                ? 'bg-brand-700 text-canvas'
                : 'bg-brand-100 text-brand-500 hover:bg-brand-200',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <ul className="flex-1 overflow-y-auto">
        {items.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-brand-400">Nenhuma conversa.</li>
        )}
        {items.map((item) => {
          const conv = item.conversation;
          const channel = conv.channel as ChatChannel;
          const active = conv.id === selectedId;
          const name = item.leadName ?? conv.contact_name ?? conv.external_id;
          return (
            <li key={conv.id}>
              <button
                type="button"
                onClick={() => onSelect(conv.id)}
                className={cn(
                  'flex min-h-[68px] w-full items-center gap-3 border-b border-brand-50 px-3 py-2.5 text-left transition-colors hover:bg-brand-50',
                  active && 'bg-brand-50',
                )}
              >
                <ChatAvatar name={name} channel={channel} size={46} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-brand-700">{name}</span>
                      {conv.ai_active && (
                        <span
                          className="shrink-0 rounded-full bg-purple-200 px-1.5 py-0.5 text-[9px] font-bold leading-none text-purple-800"
                          title="IA SDR gerenciando"
                        >
                          IA
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[10px] text-brand-400">
                      {timeAgo(conv.last_message_at)}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    {channel === 'whatsapp' && item.instance && (
                      <InstanceBadge instance={item.instance} />
                    )}
                    <span className="truncate text-xs text-brand-500">
                      {item.lastMessagePreview ?? 'Sem mensagens'}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {item.unreadCount > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-semibold text-white">
                      {item.unreadCount}
                    </span>
                  )}
                  {conv.status !== 'open' && (
                    <Badge tone="neutral">
                      {CONVERSATION_STATUS_LABELS[conv.status as ConversationStatus]}
                    </Badge>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* FAB "nova conversa" — mobile. */}
      <button
        type="button"
        onClick={onNewConversation}
        aria-label="Nova conversa"
        className="focus-ring absolute bottom-4 right-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-700 text-canvas shadow-lg hover:bg-brand-800 sm:hidden"
      >
        <PlusIcon size={24} />
      </button>
    </div>
  );
}

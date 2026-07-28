'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import {
  createLeadFromSharedContact,
  reactToMessage,
  setConversationAiMuted,
} from '@/actions/conversations';
import type { ThreadLeadExtras } from '@/actions/conversations';
import { cn } from '@/lib/utils/cn';
import { MessageBubble } from './message-bubble';
import { ChatAvatar } from './chat-avatar';
import { PendingApprovalCard } from './pending-approval-card';
import { TemplateSendModal } from './template-send-modal';
import { RegisterContactModal } from '@/components/kanban/register-contact-modal';
import { ScheduleHandoffModal } from '@/components/kanban/schedule-handoff-modal';
import { DealModal } from '@/components/kanban/deal-modal';
import { InterestBadge } from '@/components/leads/interest-badge';
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DollarCircleIcon,
  FileTextIcon,
  MicIcon,
  PaperclipIcon,
  PhoneIcon,
  RefreshIcon,
  SendIcon,
  SmileIcon,
  UserIcon,
  XIcon,
} from '@/components/ui/icons';
import { MAX_ATTEMPTS } from '@/lib/sla/rules';
import { PIPELINE_LABELS, type PipelineKind } from '@/types/pipeline';
import {
  CHAT_CHANNEL_META,
  CONVERSATION_STATUSES,
  CONVERSATION_STATUS_LABELS,
  parseMessageMetadata,
  type ChatChannel,
  type ConversationStatus,
  type Message,
  type MessageTemplate,
  type MessageType,
  type SharedContactCard,
} from '@/types/chat';
import type { Conversation } from '@/types/chat';
import type { Lead } from '@/types/lead';
import { isInstanceDisconnected, type WhatsappInstanceBadge } from '@/types/whatsapp-instance';

interface ConversationViewProps {
  conversation: Conversation;
  /** Instância de WhatsApp da conversa (header "WhatsApp · Método Sari"). */
  instance: WhatsappInstanceBadge | null;
  leadName: string | null;
  lead: Lead | null;
  leadExtras: ThreadLeadExtras | null;
  /** Nome legível do stage atual do lead (resolvido pelo chat-layout). */
  stageName: string | null;
  messages: Message[];
  /** sent_by → "Nome · Cargo" (rótulo acima da bolha outbound). */
  senders: Record<string, string>;
  templates: MessageTemplate[];
  channelConfigured: boolean;
  sending: boolean;
  onSend: (content: string, type: MessageType, mediaUrl?: string | null) => void;
  /** Envia um template com variáveis preenchidas; true = saiu (fecha o modal). */
  onSendTemplate: (templateId: string, values: Record<string, string>) => Promise<boolean>;
  onSetStatus: (status: ConversationStatus) => void;
  onOpenLead: () => void;
  /** Mobile: abre o painel/ficha do lead (substitui a 3ª coluna). */
  onOpenLeadPanel?: () => void;
  onBack?: () => void;
  /** Recarrega a thread após aprovar/descartar uma mensagem pendente da IA. */
  onMessageResolved?: () => void;
  /** Recarrega thread + lista após ações dos modais (agendar, venda, contato). */
  onChanged?: () => void;
}

/** Chave do localStorage dos emojis recentes do composer (máx. 16, mais novo primeiro). */
const RECENT_EMOJIS_KEY = 'chat-emoji-recentes';
const RECENT_EMOJIS_MAX = 16;

/** Emojis do picker do composer, agrupados por categoria. */
const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: 'Carinhas',
    emojis: [
      '😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂',
      '😉', '😍', '🥰', '😘', '😋', '😜', '🤗', '🤔', '🤩', '🥳',
      '😌', '😎', '🥺', '😢', '😭', '😤', '😮', '😱', '🤯', '😴',
      '🤒', '🤧', '🙄', '😬', '🫡', '🤝',
    ],
  },
  {
    label: 'Gestos',
    emojis: [
      '👍', '👎', '👏', '👏🏻', '🙌', '🙌🏻', '🙏', '🤲', '👌', '🤞',
      '✌️', '🤙', '👊', '✊', '💪', '👉', '👈', '👆', '👇', '✋',
      '🖐️', '🫶',
    ],
  },
  {
    label: 'Corações',
    emojis: [
      '❤️', '🩷', '🤍', '💙', '💚', '💛', '🧡', '💜', '🖤', '🤎',
      '💖', '💗', '💓', '💞', '💕', '💘', '❤️‍🔥', '💔', '💯',
    ],
  },
  {
    label: 'Celebração',
    emojis: [
      '🎉', '🎊', '🥂', '🍾', '🏆', '🥇', '🎯', '🚀', '🔥', '⭐',
      '🌟', '✨', '💫', '🎁', '🎈', '🪄', '🌷', '💃🏻', '💃🏼',
    ],
  },
  {
    label: 'Trabalho e saúde',
    emojis: [
      '✅', '❌', '⚠️', '📅', '📆', '⏰', '⏳', '📌', '📍', '📞',
      '📱', '💬', '📩', '📧', '📝', '📄', '📊', '💰', '💵', '💳',
      '🧾', '🔗', '💻', '🩺', '💉', '💊', '🧠', '🫀', '🧬', '🥼',
      '🏥', '⚖️', '🍎', '🏃', '🧘', '😷',
    ],
  },
];

/**
 * Limites da Cloud API oficial da Meta por tipo de mídia. Fora disso a Meta
 * rejeita o envio (a mensagem fica "failed" sem explicação pro usuário) —
 * caso real: .mov de 33MB nunca chegou (só aceita MP4/3GPP até 16MB).
 */
const OFFICIAL_MEDIA_RULES = {
  image: {
    mimes: new Set(['image/jpeg', 'image/png']),
    maxBytes: 5 * 1024 * 1024,
    dica: 'A API oficial só aceita imagem JPEG ou PNG até 5MB.',
  },
  video: {
    mimes: new Set(['video/mp4', 'video/3gpp']),
    maxBytes: 16 * 1024 * 1024,
    dica: 'A API oficial só aceita vídeo MP4 (H.264/AAC) até 16MB. Converta o arquivo (ex.: exportar como MP4) ou reduza/corte o vídeo.',
  },
  audio: {
    mimes: new Set(['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/ogg']),
    maxBytes: 16 * 1024 * 1024,
    dica: 'A API oficial só aceita áudio AAC, AMR, MP3, M4A ou OGG até 16MB.',
  },
  document: {
    mimes: new Set([
      'text/plain',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]),
    maxBytes: 100 * 1024 * 1024,
    dica: 'A API oficial só aceita documentos PDF, Word, Excel, PowerPoint ou TXT até 100MB. Converta o arquivo para PDF.',
  },
} as const;

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** Valida um anexo contra os limites da Cloud API. Retorna a mensagem de erro ou null. */
function validateOfficialMedia(file: File): string | null {
  const kind = file.type.startsWith('image/')
    ? 'image'
    : file.type.startsWith('video/')
      ? 'video'
      : file.type.startsWith('audio/')
        ? 'audio'
        : 'document';
  const rule = OFFICIAL_MEDIA_RULES[kind];
  if (file.type && !rule.mimes.has(file.type)) {
    return `Formato não suportado pelo WhatsApp oficial (${file.type || 'desconhecido'}). ${rule.dica}`;
  }
  if (file.size > rule.maxBytes) {
    return `Arquivo de ${formatMb(file.size)} excede o limite. ${rule.dica}`;
  }
  return null;
}

const STOP_REASON_LABEL: Record<string, string> = {
  lead_responded: 'lead respondeu',
  reached_d12: 'chegou ao D12',
  lead_lost: 'lead perdido',
  lead_won: 'lead ganho',
  manual_stop: 'pausada manualmente',
};

const SP_TIMEZONE = 'America/Sao_Paulo';

/** Chave YYYY-MM-DD do dia da mensagem no fuso de São Paulo. */
function spDayKey(iso: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(typeof iso === 'string' ? new Date(iso) : iso);
}

/** Rótulo da pill de data: Hoje/Ontem/Anteontem, dia da semana (7d) ou data. */
function dayLabel(key: string, iso: string): string {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  if (key === spDayKey(new Date(now))) return 'Hoje';
  if (key === spDayKey(new Date(now - dayMs))) return 'Ontem';
  if (key === spDayKey(new Date(now - 2 * dayMs))) return 'Anteontem';
  for (let d = 3; d <= 6; d += 1) {
    if (key === spDayKey(new Date(now - d * dayMs))) {
      const weekday = new Intl.DateTimeFormat('pt-BR', {
        timeZone: SP_TIMEZONE,
        weekday: 'long',
      }).format(new Date(iso));
      return weekday.charAt(0).toUpperCase() + weekday.slice(1);
    }
  }
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: SP_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

/** Ação rápida do composer (ícone + rótulo, rolável no mobile). */
function QuickAction({
  icon,
  label,
  highlighted = false,
  disabled = false,
  title,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  highlighted?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={cn(
        'focus-ring flex h-9 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors',
        highlighted
          ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
          : 'border-brand-200 bg-white text-brand-600 hover:bg-brand-50',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** Item da timeline já com separadores e reações resolvidos. */
type TimelineItem =
  | { kind: 'separator'; key: string; label: string }
  | { kind: 'message'; message: Message; firstOfGroup: boolean; reactions: string[] };

/**
 * Monta a timeline: separadores por dia (fuso SP), reações ancoradas na
 * mensagem original (não viram bolha) e marcação de primeira-do-grupo (bico).
 */
function buildTimeline(messages: Message[]): TimelineItem[] {
  // Reações → emoji anexado à mensagem alvo (por external_message_id).
  const reactionsByTarget = new Map<string, string[]>();
  const anchored = new Set<string>();
  for (const m of messages) {
    if (m.type !== 'reaction') continue;
    const meta = parseMessageMetadata(m.metadata);
    const target = meta.reaction?.targetExternalId;
    const emoji = meta.reaction?.emoji ?? m.content;
    if (!target || !emoji) continue;
    if (messages.some((t) => t.external_message_id === target)) {
      const list = reactionsByTarget.get(target) ?? [];
      list.push(emoji);
      reactionsByTarget.set(target, list);
      anchored.add(m.id);
    }
  }

  const items: TimelineItem[] = [];
  let prevDay: string | null = null;
  let prev: Message | null = null;
  for (const m of messages) {
    if (anchored.has(m.id)) continue;
    const day = spDayKey(m.created_at);
    if (day !== prevDay) {
      items.push({ kind: 'separator', key: day, label: dayLabel(day, m.created_at) });
      prevDay = day;
      prev = null;
    }
    const gapMin = prev
      ? (new Date(m.created_at).getTime() - new Date(prev.created_at).getTime()) / 60000
      : Infinity;
    const firstOfGroup =
      !prev || prev.direction !== m.direction || prev.sent_by !== m.sent_by || gapMin > 10;
    items.push({
      kind: 'message',
      message: m,
      firstOfGroup,
      reactions: m.external_message_id
        ? (reactionsByTarget.get(m.external_message_id) ?? [])
        : [],
    });
    prev = m;
  }
  return items;
}

/**
 * Faixa compacta do lead (mobile) — substitui a 3ª coluna: score, pipeline/
 * stage, tentativas X/8, produto e "ver mais" (abre a ficha completa).
 */
function MobileLeadStrip({
  lead,
  extras,
  stageName,
  onOpenPanel,
}: {
  lead: Lead | null;
  extras: ThreadLeadExtras | null;
  stageName: string | null;
  onOpenPanel?: () => void;
}) {
  if (!lead) {
    return (
      <div className="flex items-center justify-between gap-2 border-b border-brand-100 bg-white px-3 py-1.5 lg:hidden">
        <span className="text-xs text-brand-400">Conversa em triagem — sem lead vinculado</span>
        {onOpenPanel && (
          <button
            type="button"
            onClick={onOpenPanel}
            className="focus-ring flex h-8 shrink-0 items-center gap-0.5 rounded-md px-2 text-xs font-medium text-emerald-700"
          >
            Criar lead <ChevronRightIcon size={13} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 overflow-x-auto border-b border-brand-100 bg-white px-3 py-1.5 lg:hidden">
      <InterestBadge lead={lead} />
      <div className="shrink-0">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-brand-400">Pipeline</p>
        <p className="whitespace-nowrap text-xs font-semibold text-brand-700">
          {PIPELINE_LABELS[lead.pipeline as PipelineKind] ?? lead.pipeline}
          {stageName ? ` · ${stageName}` : ''}
        </p>
      </div>
      <div className="shrink-0">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-brand-400">
          Tentativas
        </p>
        <p className="text-xs font-semibold text-brand-700">
          {Math.min(extras?.attemptsCount ?? 0, MAX_ATTEMPTS)}/{MAX_ATTEMPTS}
        </p>
      </div>
      {lead.child_name && (
        <div className="min-w-0 shrink-0 max-w-36">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-brand-400">Aluno</p>
          <p className="truncate text-xs font-semibold text-brand-700">{lead.child_name}</p>
        </div>
      )}
      {onOpenPanel && (
        <button
          type="button"
          onClick={onOpenPanel}
          className="focus-ring ml-auto flex h-9 shrink-0 items-center gap-0.5 rounded-md px-2 text-xs font-medium text-emerald-700"
        >
          ver mais <ChevronRightIcon size={13} />
        </button>
      )}
    </div>
  );
}

export function ConversationView({
  conversation,
  instance,
  leadName,
  lead,
  leadExtras,
  stageName,
  messages,
  senders,
  templates,
  channelConfigured,
  sending,
  onSend,
  onSendTemplate,
  onSetStatus,
  onOpenLead,
  onOpenLeadPanel,
  onBack,
  onMessageResolved,
  onChanged,
}: ConversationViewProps) {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  // Emojis usados recentemente (persistidos no navegador) — viram a 1ª seção do picker.
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_EMOJIS_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setRecentEmojis(
          parsed.filter((e): e is string => typeof e === 'string').slice(0, RECENT_EMOJIS_MAX),
        );
      }
    } catch {
      // localStorage indisponível/corrompido: segue sem recentes.
    }
  }, []);

  function registerRecentEmoji(emoji: string) {
    setRecentEmojis((prev) => {
      const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, RECENT_EMOJIS_MAX);
      try {
        localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(next));
      } catch {
        // best-effort
      }
      return next;
    });
  }

  const emojiGroups = useMemo(
    () =>
      recentEmojis.length > 0
        ? [{ label: 'Recentes', emojis: recentEmojis }, ...EMOJI_GROUPS]
        : EMOJI_GROUPS,
    [recentEmojis],
  );
  // Picker de templates; 'followup' pré-filtra os templates de follow-up.
  const [templatePicker, setTemplatePicker] = useState<null | 'all' | 'followup'>(null);
  // Template com variáveis aguardando preenchimento (abre o TemplateSendModal).
  const [templateToSend, setTemplateToSend] = useState<MessageTemplate | null>(null);
  // Só os templates do canal desta conversa aparecem no picker.
  const channelTemplates = templates.filter((t) => t.channel === conversation.channel);
  const followupTemplates = channelTemplates.filter((t) =>
    `${t.name}`.toLowerCase().includes('follow'),
  );
  const [uploading, setUploading] = useState(false);
  // Percentual da conversão de vídeo → MP4 (null = nenhuma em andamento).
  const [convertingVideo, setConvertingVideo] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Gravação de mensagem de voz (MediaRecorder → chat-media → envio type=audio).
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recStreamRef = useRef<MediaStream | null>(null);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recCancelledRef = useRef(false);
  const recMimeRef = useRef<{ mime: string; ext: string }>({ mime: '', ext: 'webm' });

  // Encerra gravação pendente ao desmontar/trocar de conversa.
  useEffect(() => {
    return () => {
      recCancelledRef.current = true;
      try {
        if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
      } catch {
        /* noop */
      }
      recStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (recTimerRef.current) clearInterval(recTimerRef.current);
    };
  }, [conversation.id]);

  /** Caixa de texto cresce com o conteúdo (até ~8rem), como no WhatsApp. */
  function autoGrowTextarea() {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }

  // Modais das ações rápidas (pré-preenchidos com o lead da conversa).
  const [contactOpen, setContactOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);

  // Banner da IA SDR — estado local p/ sumir na hora ao assumir (realtime
  // sincroniza a lista; aqui refletimos imediatamente).
  const [aiActive, setAiActive] = useState(conversation.ai_active);
  const [assuming, setAssuming] = useState(false);
  useEffect(() => {
    setAiActive(conversation.ai_active);
  }, [conversation.id, conversation.ai_active]);

  async function handleAssume() {
    setAssuming(true);
    try {
      const res = await fetch('/api/ai-sdr/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversation.id }),
      });
      if (res.ok) {
        setAiActive(false);
        toast.success('Você assumiu a conversa. A IA SDR foi desativada.');
      } else {
        toast.error('Não foi possível assumir a conversa.');
      }
    } catch {
      toast.error('Falha ao assumir a conversa.');
    } finally {
      setAssuming(false);
    }
  }

  // Trava "IA não entra nesta conversa" (caso Lozany: humano negociando e a IA
  // entrou após 8min de silêncio). Mutar derruba a IA na hora e vale pra sempre
  // nesta conversa, até alguém liberar de novo.
  const [aiMuted, setAiMuted] = useState(conversation.ai_muted);
  const [mutingAi, setMutingAi] = useState(false);
  useEffect(() => {
    setAiMuted(conversation.ai_muted);
  }, [conversation.id, conversation.ai_muted]);

  async function handleToggleAiMuted() {
    setMutingAi(true);
    const next = !aiMuted;
    try {
      const res = await setConversationAiMuted(conversation.id, next);
      if (res.ok) {
        setAiMuted(next);
        if (next) setAiActive(false);
        toast.success(next ? 'IA bloqueada nesta conversa.' : 'IA liberada nesta conversa.');
      } else {
        toast.error(res.error);
      }
    } catch {
      toast.error('Falha ao alterar a trava da IA.');
    } finally {
      setMutingAi(false);
    }
  }

  // Status da cadência de follow-up (Cenário B) + pausa manual.
  const [followupStopped, setFollowupStopped] = useState(conversation.followup_stopped);
  const [stoppingFollowup, setStoppingFollowup] = useState(false);
  useEffect(() => {
    setFollowupStopped(conversation.followup_stopped);
  }, [conversation.id, conversation.followup_stopped]);

  async function handleStopFollowup() {
    setStoppingFollowup(true);
    try {
      const res = await fetch('/api/ai-sdr/stop-followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversation.id }),
      });
      if (res.ok) {
        setFollowupStopped(true);
        toast.success('Cadência de follow-up pausada.');
      } else {
        toast.error('Não foi possível pausar a cadência.');
      }
    } catch {
      toast.error('Falha ao pausar a cadência.');
    } finally {
      setStoppingFollowup(false);
    }
  }
  const channel = conversation.channel as ChatChannel;
  const channelMeta = CHAT_CHANNEL_META[channel];
  // Ligação só faz sentido no WhatsApp oficial e com lead vinculado.
  const canCall =
    channel === 'whatsapp' && instance?.provider === 'official' && Boolean(conversation.lead_id);
  // Instância UaZAPI desconectada: bloqueia envio e mostra banner (Correção 4b).
  const disconnected = isInstanceDisconnected(instance);
  // Reagir com emoji só existe no WhatsApp (oficial e UaZAPI), com número conectado.
  const canReact = channel === 'whatsapp' && !disconnected;

  /** Envia a reação e recarrega a thread (o emoji ancora na bolha alvo). */
  async function handleReact(message: Message, emoji: string) {
    const result = await reactToMessage(message.id, emoji);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    onChanged?.();
  }

  const displayName = leadName ?? conversation.contact_name ?? conversation.external_id;
  const timeline = useMemo(() => buildTimeline(messages), [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, conversation.id]);

  function submit() {
    if (!text.trim() || disconnected) return;
    onSend(text.trim(), 'text');
    setText('');
    // Volta a caixa à altura mínima após enviar.
    if (textRef.current) textRef.current.style.height = 'auto';
  }

  /** Reenvia uma mensagem que falhou (nova tentativa com o mesmo conteúdo). */
  function handleResend(message: Message) {
    if (disconnected) {
      toast.error('Número desconectado — reconecte antes de reenviar.');
      return;
    }
    const type = (message.type === 'template' ? 'text' : message.type) as MessageType;
    onSend(message.content ?? '', type, message.media_url);
  }

  /** Cria um lead a partir de um cartão de contato compartilhado na conversa. */
  async function handleCreateLeadFromContact(card: SharedContactCard) {
    const phone = card.phones[0] ?? '';
    const result = await createLeadFromSharedContact({ name: card.name, phone });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      result.data.duplicate
        ? `O contato ${card.name} já existia como lead — dados unificados.`
        : `Lead ${card.name} criado em Novo Lead.`,
    );
    onChanged?.();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // O que sobe pro storage (pode ser o arquivo original ou o vídeo convertido).
    let payload: { data: Blob; name: string; contentType: string } = {
      data: file,
      name: file.name,
      contentType: file.type,
    };
    // A Cloud API oficial tem formatos/tamanhos fechados — valida ANTES do
    // upload para o erro ser claro (a Meta só devolve "failed" genérico).
    if (channel === 'whatsapp' && instance?.provider === 'official') {
      const isVideo = file.type.startsWith('video/');
      const videoOk =
        OFFICIAL_MEDIA_RULES.video.mimes.has(file.type) &&
        file.size <= OFFICIAL_MEDIA_RULES.video.maxBytes;
      if (isVideo && !videoOk) {
        // Vídeo fora do padrão (.mov, WebM, MP4 grande…): converte para
        // MP4 H.264 ≤16MB no navegador antes de subir.
        setConvertingVideo(0);
        try {
          const { convertVideoForWhatsapp } = await import('@/lib/video/whatsapp-mp4');
          const blob = await convertVideoForWhatsapp(file, setConvertingVideo);
          payload = {
            data: blob,
            name: `${file.name.replace(/\.[^.]+$/, '')}.mp4`,
            contentType: 'video/mp4',
          };
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : 'Não consegui converter o vídeo para MP4.',
          );
          return;
        } finally {
          setConvertingVideo(null);
        }
      } else {
        const problema = validateOfficialMedia(file);
        if (problema) {
          toast.error(problema);
          return;
        }
      }
    }
    setUploading(true);
    try {
      const supabase = createClient();
      const path = `${conversation.id}/${Date.now()}-${payload.name.replace(/[^\w.-]/g, '_')}`;
      const { error } = await supabase.storage
        .from('chat-media')
        .upload(path, payload.data, { contentType: payload.contentType, upsert: false });
      if (error) {
        toast.error('Falha no upload do anexo');
        return;
      }
      const { data } = supabase.storage.from('chat-media').getPublicUrl(path);
      const type: MessageType = payload.contentType.startsWith('image/')
        ? 'image'
        : payload.contentType.startsWith('video/')
          ? 'video'
          : payload.contentType.startsWith('audio/')
            ? 'audio'
            : 'document';
      onSend(type === 'document' ? payload.name : '', type, data.publicUrl);
    } finally {
      setUploading(false);
    }
  }

  /**
   * Formato de gravação: prioriza os aceitos pela Cloud API oficial (m4a/AAC,
   * ogg/opus); webm/opus fica de último recurso (a UaZAPI converte, mas a API
   * oficial pode rejeitar o container).
   */
  function pickRecordingMime(): { mime: string; ext: string } {
    const candidates = [
      { mime: 'audio/mp4', ext: 'm4a' },
      { mime: 'audio/ogg;codecs=opus', ext: 'ogg' },
      { mime: 'audio/webm;codecs=opus', ext: 'webm' },
      { mime: 'audio/webm', ext: 'webm' },
    ];
    for (const c of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mime)) {
        return c;
      }
    }
    return { mime: '', ext: 'webm' };
  }

  async function startRecording() {
    if (recording || disconnected) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recStreamRef.current = stream;
      const picked = pickRecordingMime();
      recMimeRef.current = picked;
      const rec = picked.mime ? new MediaRecorder(stream, { mimeType: picked.mime }) : new MediaRecorder(stream);
      recRef.current = rec;
      recChunksRef.current = [];
      recCancelledRef.current = false;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) recChunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        recStreamRef.current = null;
        if (recTimerRef.current) clearInterval(recTimerRef.current);
        recTimerRef.current = null;
        setRecording(false);
        if (!recCancelledRef.current) void sendRecording();
        else recChunksRef.current = [];
      };
      rec.start(250);
      setRecSeconds(0);
      setRecording(true);
      recTimerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    } catch {
      toast.error('Permita o acesso ao microfone para gravar áudio.');
    }
  }

  async function sendRecording() {
    const chunks = recChunksRef.current;
    recChunksRef.current = [];
    if (chunks.length === 0) return;
    const { mime } = recMimeRef.current;
    const raw = new Blob(chunks, { type: mime || 'audio/webm' });
    // Gravação de <0,5s costuma ser clique acidental — descarta silencioso.
    if (raw.size < 2048) return;
    setUploading(true);
    try {
      // Preferência: OGG/Opus (remux sem re-codificar) — é o único formato que
      // o WhatsApp renderiza como mensagem de voz NATIVA (PTT com waveform).
      // Fallback: MP3 (chega como arquivo de áudio, mas sempre entrega —
      // o Chrome grava Opus até quando rotula o container de audio/mp4, e a
      // Cloud API rejeita esse mp4-opus).
      let blob: Blob;
      let ext: string;
      let contentType: string;
      try {
        const { recordingToOggOpus } = await import('@/lib/audio/voice-note');
        blob = await recordingToOggOpus(raw);
        ext = 'ogg';
        contentType = 'audio/ogg';
      } catch {
        const { recordingToMp3 } = await import('@/lib/audio/encode-mp3');
        blob = await recordingToMp3(raw);
        ext = 'mp3';
        contentType = 'audio/mpeg';
      }
      const supabase = createClient();
      const path = `${conversation.id}/voz-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from('chat-media')
        .upload(path, blob, { contentType, upsert: false });
      if (error) {
        toast.error('Falha ao enviar o áudio');
        return;
      }
      const { data } = supabase.storage.from('chat-media').getPublicUrl(path);
      onSend('', 'audio', data.publicUrl);
    } catch {
      toast.error('Falha ao converter o áudio — tente de novo.');
    } finally {
      setUploading(false);
    }
  }

  /** Para a gravação; send=false descarta (cancelar). */
  function stopRecording(send: boolean) {
    recCancelledRef.current = !send;
    try {
      if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
    } catch {
      setRecording(false);
    }
  }

  const pickerTemplates = templatePicker === 'followup' ? followupTemplates : channelTemplates;

  return (
    <div className="flex h-full flex-col bg-brand-50/40">
      {lead && (
        <>
          <RegisterContactModal
            open={contactOpen}
            onClose={() => {
              setContactOpen(false);
              onChanged?.();
            }}
            leadId={lead.id}
            leadName={lead.name}
            onSchedule={() => setScheduleOpen(true)}
          />
          <ScheduleHandoffModal
            open={scheduleOpen}
            onClose={() => {
              setScheduleOpen(false);
              onChanged?.();
            }}
            leadId={lead.id}
            leadName={lead.name}
          />
          <DealModal
            open={dealOpen}
            onClose={() => {
              setDealOpen(false);
              onChanged?.();
            }}
            leadId={lead.id}
            leadName={lead.name}
          />
        </>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-brand-100 bg-white px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="focus-ring -ml-1 flex h-10 w-10 items-center justify-center rounded-full text-brand-500 hover:bg-brand-100 sm:hidden"
              aria-label="Voltar para conversas"
            >
              <ChevronLeftIcon size={20} />
            </button>
          )}
          <ChatAvatar name={displayName} channel={channel} size={40} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-brand-700">{displayName}</p>
            <p className="flex items-center gap-1 truncate text-[11px] text-brand-400">
              {channel === 'whatsapp' && instance ? (
                <>
                  <span style={{ color: instance.color ?? '#22c55e' }} className="font-semibold">
                    {channelMeta?.label} · {instance.name}
                  </span>
                  <span className="hidden sm:inline">· {conversation.external_id}</span>
                </>
              ) : (
                <span>
                  {channelMeta?.label} · {conversation.external_id}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <select
            value={conversation.status}
            onChange={(e) => onSetStatus(e.target.value as ConversationStatus)}
            className="focus-ring hidden h-9 rounded-md border border-brand-200 bg-white px-2 text-xs text-brand-600 sm:block"
            aria-label="Status da conversa"
          >
            {CONVERSATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CONVERSATION_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {canCall && (
            <a
              href={`tel:${conversation.external_id}`}
              title="Ligar"
              aria-label="Ligar"
              className="focus-ring flex h-10 w-10 items-center justify-center rounded-full border border-brand-200 text-brand-600 hover:bg-brand-100 sm:h-9 sm:w-9"
            >
              <PhoneIcon size={17} />
            </a>
          )}
          {conversation.lead_id && (
            <button
              type="button"
              onClick={onOpenLead}
              title="Ver lead"
              aria-label="Ver lead"
              className="focus-ring hidden h-9 w-9 items-center justify-center rounded-full border border-brand-200 text-brand-600 hover:bg-brand-100 sm:flex"
            >
              <UserIcon size={17} />
            </button>
          )}
          {conversation.channel === 'whatsapp' && conversation.lead_id && (
            <button
              type="button"
              onClick={handleToggleAiMuted}
              disabled={mutingAi}
              title={
                aiMuted
                  ? 'A IA está bloqueada nesta conversa (não responde nem faz follow-up). Clique para liberar.'
                  : 'Bloquear a IA nesta conversa — ela não responde nem faz follow-up aqui.'
              }
              className={cn(
                'focus-ring hidden rounded-md border px-2 py-1.5 text-xs font-medium disabled:opacity-60 sm:block',
                aiMuted
                  ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
                  : 'border-brand-200 text-brand-600 hover:bg-brand-100',
              )}
            >
              {mutingAi ? '…' : aiMuted ? 'IA bloqueada' : 'Bloquear IA'}
            </button>
          )}
        </div>
      </div>

      {/* Faixa compacta do lead — mobile (substitui a 3ª coluna). */}
      <MobileLeadStrip
        lead={lead}
        extras={leadExtras}
        stageName={stageName}
        onOpenPanel={onOpenLeadPanel}
      />

      {aiActive && (
        <div className="flex items-center justify-between gap-2 border-b border-purple-200 bg-purple-50 px-4 py-2">
          <span className="flex items-center gap-2 text-sm text-purple-700">
            <span className="h-2 w-2 animate-pulse rounded-full bg-purple-500" aria-hidden="true" />
            <span className="font-medium">IA SDR está gerenciando esta conversa</span>
          </span>
          <button
            type="button"
            onClick={handleAssume}
            disabled={assuming}
            className="focus-ring rounded-md bg-purple-600 px-3 py-1 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-60"
          >
            {assuming ? 'Assumindo…' : 'Assumir agora'}
          </button>
        </div>
      )}

      {conversation.followup_last_sent_at && !followupStopped && (
        <div className="flex items-center justify-between gap-2 border-b border-brand-100 bg-brand-50 px-4 py-1.5 text-xs text-brand-600">
          <span>
            Cadência de follow-up:{' '}
            <span className="font-medium">
              {conversation.followup_day === 0
                ? 'aguardando D2'
                : `D${conversation.followup_day} enviado`}
            </span>
          </span>
          <button
            type="button"
            onClick={handleStopFollowup}
            disabled={stoppingFollowup}
            className="font-medium text-red-500 underline-offset-2 hover:text-red-700 hover:underline disabled:opacity-60"
          >
            {stoppingFollowup ? 'Pausando…' : 'Pausar cadência'}
          </button>
        </div>
      )}
      {followupStopped && conversation.followup_stop_reason && (
        <div className="border-b border-brand-100 bg-brand-50 px-4 py-1.5 text-xs text-brand-400">
          Cadência de follow-up encerrada —{' '}
          {STOP_REASON_LABEL[conversation.followup_stop_reason] ??
            conversation.followup_stop_reason}
        </div>
      )}

      {!channelConfigured && (
        <div className="flex items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-[11px] text-amber-800">
          {channelMeta?.label} não configurado — mensagens são salvas, mas não entregues.{' '}
          <a href="/integracoes/meta" className="font-medium underline">
            Configurar
          </a>
        </div>
      )}

      {disconnected && (
        <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          <span>
            Número <strong>{instance?.name}</strong> desconectado da API. Mensagens não estão sendo
            recebidas nem enviadas.{' '}
            <a href="/admin" className="font-medium underline">
              Reconecte em Admin → WhatsApp.
            </a>
          </span>
        </div>
      )}

      {/* Mensagens — fundo levemente pontilhado (estilo WhatsApp). */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-1.5 overflow-y-auto px-2 py-3 sm:p-4"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(120,113,98,0.10) 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      >
        {timeline.length === 0 ? (
          <p className="pt-10 text-center text-sm text-brand-400">
            Nenhuma mensagem ainda. Envie a primeira.
          </p>
        ) : (
          timeline.map((item) =>
            item.kind === 'separator' ? (
              <div key={`sep-${item.key}`} className="flex justify-center py-2">
                <span className="rounded-full border border-brand-100 bg-white px-3 py-1 text-[11px] font-medium text-brand-500 shadow-sm">
                  {item.label}
                </span>
              </div>
            ) : item.message.pending_approval ? (
              <PendingApprovalCard
                key={item.message.id}
                message={item.message}
                onResolved={() => onMessageResolved?.()}
              />
            ) : (
              <MessageBubble
                key={item.message.id}
                message={item.message}
                senderLabel={
                  item.message.sent_by ? (senders[item.message.sent_by] ?? null) : null
                }
                reactions={item.reactions}
                firstOfGroup={item.firstOfGroup}
                onResend={handleResend}
                onCreateLeadFromContact={handleCreateLeadFromContact}
                onReact={canReact ? handleReact : undefined}
              />
            ),
          )
        )}
      </div>

      {/* Ações rápidas + composer */}
      <div className="relative border-t border-brand-100 bg-white px-2 py-2 sm:px-3">
        {showEmoji && (
          <div className="absolute bottom-full left-3 z-10 mb-1 max-h-64 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-brand-100 bg-white p-2 shadow-lg">
            {emojiGroups.map((group) => (
              <div key={group.label}>
                <p className="px-1 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-brand-400 first:pt-0">
                  {group.label}
                </p>
                <div className="flex flex-wrap gap-0.5">
                  {group.emojis.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => {
                        setText((t) => t + e);
                        registerRecentEmoji(e);
                      }}
                      className="focus-ring rounded p-1 text-lg hover:bg-brand-100"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {templatePicker && (
          <div className="absolute bottom-full left-3 z-10 mb-1 max-h-48 w-72 overflow-y-auto rounded-md border border-brand-100 bg-white p-1 shadow-lg">
            {pickerTemplates.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-brand-400">
                Nenhum template cadastrado.
              </p>
            ) : (
              pickerTemplates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => {
                    // Template com variáveis abre o modal de preenchimento;
                    // sem variáveis, só cola o texto no composer (comportamento antigo).
                    if (tpl.variables.length > 0) setTemplateToSend(tpl);
                    else setText(tpl.content);
                    setTemplatePicker(null);
                  }}
                  className="focus-ring block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-brand-50"
                >
                  <span className="font-medium text-brand-700">{tpl.name}</span>
                  <span className="block truncate text-brand-400">{tpl.content}</span>
                </button>
              ))
            )}
          </div>
        )}

        {/* Barra de ações rápidas — no desktop QUEBRA LINHA quando não couber
            (mouse não rola scroll horizontal escondido — report Augusto/Bruna);
            no mobile segue rolável no toque. */}
        <div
          className="mb-2 flex items-center gap-1.5 overflow-x-auto pb-0.5 sm:flex-wrap sm:overflow-x-visible"
          style={{ scrollbarWidth: 'none' }}
        >
          <QuickAction
            icon={<SendIcon size={14} />}
            label="Primeiro contato"
            highlighted
            disabled={!lead}
            title={lead ? 'Registrar contato e mover o stage' : 'Conversa sem lead vinculado'}
            onClick={() => setContactOpen(true)}
          />
          <QuickAction
            icon={<RefreshIcon size={14} />}
            label="Follow-up"
            title="Templates de follow-up"
            onClick={() => {
              setTemplatePicker((v) => (v === 'followup' ? null : 'followup'));
              setShowEmoji(false);
            }}
          />
          <QuickAction
            icon={<CalendarIcon size={14} />}
            label="Agendar"
            disabled={!lead}
            title={lead ? 'Agendar reunião com closer' : 'Conversa sem lead vinculado'}
            onClick={() => setScheduleOpen(true)}
          />
          <QuickAction
            icon={<DollarCircleIcon size={14} />}
            label="Fechar venda"
            disabled={!lead}
            title={lead ? 'Registrar venda' : 'Conversa sem lead vinculado'}
            onClick={() => setDealOpen(true)}
          />
          <QuickAction
            icon={<FileTextIcon size={14} />}
            label="Templates"
            onClick={() => {
              setTemplatePicker((v) => (v === 'all' ? null : 'all'));
              setShowEmoji(false);
            }}
          />
        </div>

        {recording ? (
          /* Modo gravação: timer + cancelar (descarta) + enviar (para e envia). */
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => stopRecording(false)}
              className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-brand-500 hover:bg-brand-100 sm:h-10 sm:w-10"
              aria-label="Cancelar gravação"
            >
              <XIcon size={20} />
            </button>
            <div className="flex h-11 flex-1 items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 sm:h-10">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" aria-hidden="true" />
              <span className="text-sm font-medium text-red-700">
                Gravando… {Math.floor(recSeconds / 60)}:{(recSeconds % 60).toString().padStart(2, '0')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => stopRecording(true)}
              aria-label="Enviar áudio"
              className={cn(
                'focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white',
                'hover:bg-emerald-700 sm:h-10 sm:w-10',
              )}
            >
              <SendIcon size={18} />
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-1">
            <button
              type="button"
              onClick={() => {
                setShowEmoji((v) => !v);
                setTemplatePicker(null);
              }}
              className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-brand-500 hover:bg-brand-100 sm:h-10 sm:w-10"
              aria-label="Emoji"
            >
              <SmileIcon size={20} />
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || disconnected}
              className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-brand-500 hover:bg-brand-100 disabled:opacity-40 sm:h-10 sm:w-10"
              aria-label="Anexar arquivo"
            >
              <PaperclipIcon size={20} />
            </button>
            <textarea
              ref={textRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                autoGrowTextarea();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              disabled={disconnected}
              title={disconnected ? 'Número desconectado — reconecte em Admin → WhatsApp' : undefined}
              placeholder={
                disconnected ? 'Número desconectado — envio bloqueado' : 'Escreva uma mensagem…'
              }
              // text-base (16px) no mobile: legível e evita o zoom automático do
              // iOS ao focar; desktop volta ao text-sm.
              className="focus-ring max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-2xl border border-brand-200 px-3.5 py-2.5 text-base disabled:bg-brand-50 disabled:text-brand-400 sm:text-sm"
            />
            <button
              type="button"
              onClick={() => void startRecording()}
              disabled={uploading || disconnected}
              title={disconnected ? 'Número desconectado — reconecte em Admin → WhatsApp' : 'Gravar mensagem de voz'}
              className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-brand-500 hover:bg-brand-100 disabled:opacity-40 sm:h-10 sm:w-10"
              aria-label="Gravar áudio"
            >
              <MicIcon size={20} />
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={sending || uploading || !text.trim() || disconnected}
              title={disconnected ? 'Número desconectado — reconecte em Admin → WhatsApp' : undefined}
              aria-label="Enviar"
              className={cn(
                'focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white',
                'hover:bg-emerald-700 disabled:bg-brand-300 sm:h-10 sm:w-10',
              )}
            >
              <SendIcon size={18} />
            </button>
          </div>
        )}
        <input ref={fileRef} type="file" hidden onChange={handleFile} />
        {convertingVideo !== null && (
          <p className="mt-1 text-[11px] text-brand-400">
            Convertendo vídeo para MP4… {convertingVideo}%
          </p>
        )}
        {uploading && <p className="mt-1 text-[11px] text-brand-400">Enviando anexo…</p>}
      </div>

      <TemplateSendModal
        open={templateToSend !== null}
        onClose={() => setTemplateToSend(null)}
        template={templateToSend}
        leadName={leadName}
        isOfficial={instance?.provider === 'official'}
        onSend={onSendTemplate}
      />
    </div>
  );
}

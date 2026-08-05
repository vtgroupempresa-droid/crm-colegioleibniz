'use client';

import { useRef, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import {
  AlertCircleIcon,
  CheckCheckIcon,
  CheckIcon,
  DownloadIcon,
  MapPinIcon,
  MicIcon,
  RefreshIcon,
  ReplyIcon,
  UserPlusIcon,
} from '@/components/ui/icons';
import {
  parseMessageMetadata,
  type Message,
  type MessageStatus,
  type SharedContactCard,
} from '@/types/chat';

interface MessageBubbleProps {
  message: Message;
  /** "Bruna · SDR" — nome de quem enviou pelo CRM (sent_by); null = dispositivo. */
  senderLabel?: string | null;
  /** Emojis de reações recebidas ancoradas nesta mensagem. */
  reactions?: string[];
  /** Primeira bolha de um grupo consecutivo — ganha o "bico" no canto superior. */
  firstOfGroup?: boolean;
  /** Reenviar mensagem que falhou. */
  onResend?: (message: Message) => void;
  /** Criar lead a partir de um cartão de contato compartilhado. */
  onCreateLeadFromContact?: (card: SharedContactCard) => void;
  /** Reagir a esta mensagem com um emoji (WhatsApp). Ausente = sem botão. */
  onReact?: (message: Message, emoji: string) => void;
  /** Selecionar esta mensagem como citação da próxima resposta. */
  onReply?: (message: Message) => void;
  /** Navegar para a mensagem citada ao clicar no preview. */
  onJumpToMessage?: (messageId: string) => void;
  /** Destaque temporário ao navegar por uma citação. */
  highlighted?: boolean;
}

/** Paleta rápida de reações (mesma meia dúzia do WhatsApp + extras da casa). */
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉'];

/** Indicador de status estilo WhatsApp em SVG: ✓ enviado, ✓✓ entregue, ✓✓ azul lido. */
function StatusTicks({ status }: { status: MessageStatus }) {
  if (status === 'failed') {
    return <AlertCircleIcon size={13} className="text-red-500" />;
  }
  if (status === 'read') return <CheckCheckIcon size={14} className="text-sky-500" />;
  if (status === 'delivered') return <CheckCheckIcon size={14} className="text-brand-400" />;
  return <CheckIcon size={14} className="text-brand-400" />;
}

/** Hora local de São Paulo (mesmo fuso dos separadores de data). */
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

function formatBytes(bytes: number | null | undefined): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Cor do quadradinho do documento pela extensão (PDF vermelho, planilha verde…). */
function docExtStyle(name: string | null): { ext: string; className: string } {
  const ext = name?.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return { ext: 'PDF', className: 'bg-red-500' };
  if (['doc', 'docx'].includes(ext)) return { ext: 'DOC', className: 'bg-blue-500' };
  if (['xls', 'xlsx', 'csv'].includes(ext)) return { ext: 'XLS', className: 'bg-emerald-600' };
  if (['ppt', 'pptx'].includes(ext)) return { ext: 'PPT', className: 'bg-orange-500' };
  if (['zip', 'rar', '7z'].includes(ext)) return { ext: 'ZIP', className: 'bg-amber-600' };
  return { ext: ext ? ext.slice(0, 3).toUpperCase() : 'DOC', className: 'bg-brand-400' };
}

/** "Bico" do canto superior da bolha (primeira mensagem de um grupo). */
function BubbleTail({ outbound }: { outbound: boolean }) {
  return (
    <svg
      viewBox="0 0 8 13"
      width="8"
      height="13"
      className={cn(
        'absolute top-0',
        outbound ? '-right-[7px] text-[#d9fdd3]' : '-left-[7px] scale-x-[-1] text-white',
      )}
      aria-hidden="true"
    >
      <path d="M0 0h8L2.6 6.5C1.6 7.7 0 7 0 5.4V0Z" fill="currentColor" />
    </svg>
  );
}

/** Cartão de contato compartilhado (vCard) — nome, telefones e criar lead. */
function ContactCards({
  cards,
  outbound,
  onCreateLead,
}: {
  cards: SharedContactCard[];
  outbound: boolean;
  onCreateLead?: (card: SharedContactCard) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {cards.map((card, i) => (
        <div
          key={`${card.name}-${i}`}
          className={cn(
            'flex min-w-52 flex-col gap-1.5 rounded-lg border p-2.5',
            outbound ? 'border-emerald-300/60 bg-white/60' : 'border-brand-100 bg-brand-50',
          )}
        >
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-200 text-brand-600">
              <UserPlusIcon size={16} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-brand-700">{card.name}</p>
              {card.phones.length > 0 ? (
                <a
                  href={`tel:+${(card.phones[0] ?? '').replace(/\D/g, '')}`}
                  className="text-xs text-brand-500 underline-offset-2 hover:underline"
                >
                  {card.phones.join(' · ')}
                </a>
              ) : (
                <p className="text-xs text-brand-400">sem telefone</p>
              )}
              {card.org && <p className="truncate text-[11px] text-brand-400">{card.org}</p>}
            </div>
          </div>
          {onCreateLead && card.phones.length > 0 && (
            <button
              type="button"
              onClick={() => onCreateLead(card)}
              className="focus-ring flex h-8 items-center justify-center gap-1.5 rounded-md border border-emerald-500 px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
            >
              <UserPlusIcon size={14} /> Criar lead
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function MessageBubble({
  message,
  senderLabel,
  reactions,
  firstOfGroup = false,
  onResend,
  onCreateLeadFromContact,
  onReact,
  onReply,
  onJumpToMessage,
  highlighted = false,
}: MessageBubbleProps) {
  const outbound = message.direction === 'outbound';
  const meta = parseMessageMetadata(message.metadata);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [settlingSwipe, setSettlingSwipe] = useState(false);
  const swipeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    thresholdNotified: boolean;
    currentX: number;
  } | null>(null);

  // Só dá pra reagir a mensagem que existe no WhatsApp (tem id externo).
  const canReact =
    Boolean(onReact) &&
    Boolean(message.external_message_id) &&
    message.type !== 'reaction' &&
    message.status !== 'failed';
  const canReply =
    Boolean(onReply) &&
    Boolean(message.external_message_id) &&
    message.type !== 'reaction' &&
    message.status !== 'failed';

  function startSwipe(e: React.PointerEvent<HTMLDivElement>) {
    if (!canReply || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, audio, video, input, textarea')) return;
    swipeRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      active: true,
      thresholdNotified: false,
      currentX: 0,
    };
    setSettlingSwipe(false);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function moveSwipe(e: React.PointerEvent<HTMLDivElement>) {
    const swipe = swipeRef.current;
    if (!swipe?.active || swipe.pointerId !== e.pointerId) return;
    const dx = e.clientX - swipe.startX;
    const dy = e.clientY - swipe.startY;
    // Movimento vertical continua sendo scroll natural da conversa.
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
      swipe.active = false;
      setDragX(0);
      return;
    }
    if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    e.preventDefault();
    const resisted = Math.sign(dx) * Math.min(68, Math.abs(dx) * 0.72);
    swipe.currentX = resisted;
    setDragX(resisted);
    if (Math.abs(resisted) >= 52 && !swipe.thresholdNotified) {
      swipe.thresholdNotified = true;
      navigator.vibrate?.(8);
    }
  }

  function finishSwipe(e: React.PointerEvent<HTMLDivElement>) {
    const swipe = swipeRef.current;
    if (!swipe || swipe.pointerId !== e.pointerId) return;
    const shouldReply = swipe.active && Math.abs(swipe.currentX) >= 52;
    swipeRef.current = null;
    setSettlingSwipe(true);
    setDragX(0);
    if (shouldReply) onReply?.(message);
  }

  function cancelSwipe(e: React.PointerEvent<HTMLDivElement>) {
    const swipe = swipeRef.current;
    if (!swipe || swipe.pointerId !== e.pointerId) return;
    swipeRef.current = null;
    setSettlingSwipe(true);
    setDragX(0);
  }

  const swipeHandlers = canReply
    ? {
        onPointerDown: startSwipe,
        onPointerMove: moveSwipe,
        onPointerUp: finishSwipe,
        onPointerCancel: cancelSwipe,
      }
    : {};

  const swipeStyle = { transform: `translate3d(${dragX}px, 0, 0)` };

  // Botão "reagir" ao lado da bolha: aparece no hover (desktop) ou esmaecido
  // (touch); a paleta abre acima, alinhada ao lado da bolha.
  const reactTrigger = canReact ? (
    <div className="relative shrink-0 self-center">
      <button
        type="button"
        onClick={() => setReactOpen((v) => !v)}
        aria-label="Reagir com emoji"
        className={cn(
          'focus-ring rounded-full border border-brand-100 bg-white px-1.5 py-0.5 text-sm shadow-sm transition-opacity hover:opacity-100 group-hover/msg:opacity-100',
          reactOpen ? 'opacity-100' : 'opacity-40 sm:opacity-0',
        )}
      >
        🙂
      </button>
      {reactOpen && (
        <div
          className={cn(
            'absolute bottom-full z-20 mb-1 flex gap-0.5 rounded-full border border-brand-100 bg-white px-1.5 py-1 shadow-lg',
            outbound ? 'right-0' : 'left-0',
          )}
        >
          {REACTION_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                setReactOpen(false);
                onReact?.(message, e);
              }}
              className="focus-ring rounded-full p-0.5 text-base transition-transform hover:scale-125"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  ) : null;

  const isSticker = message.type === 'sticker' && Boolean(message.media_url);
  const failed = message.status === 'failed';

  // Figurinha: só a imagem, sem bolha (como no WhatsApp).
  if (isSticker) {
    return (
      <div
        id={`chat-message-${message.id}`}
        className={cn('group/msg flex gap-1.5', outbound ? 'justify-end' : 'justify-start')}
      >
        {outbound && reactTrigger}
        <div
          className={cn(
            'relative flex flex-col',
            outbound ? 'items-end' : 'items-start',
            highlighted && 'rounded-lg ring-2 ring-emerald-400 ring-offset-2',
          )}
        >
          {canReply && dragX !== 0 && (
            <span
              className={cn(
                'pointer-events-none absolute top-14 flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm',
                dragX > 0 ? '-left-1' : '-right-1',
              )}
              style={{ opacity: Math.min(1, Math.abs(dragX) / 52) }}
              aria-hidden="true"
            >
              <ReplyIcon size={17} />
            </span>
          )}
          <div
            {...swipeHandlers}
            style={swipeStyle}
            className={cn(
              'touch-pan-y',
              settlingSwipe
                ? 'transition-transform duration-200 ease-out'
                : 'will-change-transform',
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={message.media_url as string}
              alt="Figurinha"
              className="h-32 w-32 object-contain drop-shadow-sm"
            />
            <div className="flex items-center justify-end gap-1 pr-1 text-[10px] text-brand-400">
              {canReply && (
                <button
                  type="button"
                  onClick={() => onReply?.(message)}
                  title="Responder esta mensagem"
                  aria-label="Responder esta mensagem"
                  className="focus-ring mr-1 flex h-6 w-6 items-center justify-center rounded-full opacity-40 transition hover:bg-white hover:text-emerald-700 hover:opacity-100 sm:opacity-0 sm:group-hover/msg:opacity-60"
                >
                  <ReplyIcon size={13} />
                </button>
              )}
              <span>{timeLabel(message.created_at)}</span>
              {outbound && <StatusTicks status={message.status as MessageStatus} />}
              {reactions && reactions.length > 0 && (
                <span className="rounded-full border border-brand-100 bg-white px-1.5 text-xs shadow-sm">
                  {reactions.join(' ')}
                </span>
              )}
            </div>
          </div>
        </div>
        {!outbound && reactTrigger}
      </div>
    );
  }

  const location = meta.location;
  const mapsUrl =
    location && location.latitude != null && location.longitude != null
      ? `https://maps.google.com/?q=${location.latitude},${location.longitude}`
      : null;

  const fileSize = formatBytes(meta.file?.sizeBytes);
  const fileName = meta.file?.name ?? message.content ?? 'Documento';

  return (
    <div
      id={`chat-message-${message.id}`}
      className={cn('group/msg flex gap-1.5', outbound ? 'justify-end' : 'justify-start')}
    >
      {outbound && reactTrigger}
      <div
        className={cn(
          'relative flex min-w-0 max-w-[85%] flex-col sm:max-w-[65%]',
          outbound ? 'items-end' : 'items-start',
        )}
      >
        {canReply && dragX !== 0 && (
          <span
            className={cn(
              'pointer-events-none absolute top-1/2 z-0 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm',
              dragX > 0 ? 'left-1' : 'right-1',
            )}
            style={{ opacity: Math.min(1, Math.abs(dragX) / 52) }}
            aria-hidden="true"
          >
            <ReplyIcon size={17} />
          </span>
        )}
        <div
          {...swipeHandlers}
          style={swipeStyle}
          className={cn(
            // Mobile: bolha larga (85%) e fonte 15px, como no WhatsApp — o texto
            // longo precisa ser legível sem apertar; desktop volta ao compacto.
            'relative z-[1] max-w-full touch-pan-y rounded-lg px-2.5 py-1.5 text-[15px] leading-snug shadow-sm sm:px-3 sm:py-2 sm:text-sm',
            settlingSwipe ? 'transition-transform duration-200 ease-out' : 'will-change-transform',
            outbound ? 'bg-[#d9fdd3] text-brand-700' : 'bg-white text-brand-700',
            firstOfGroup && (outbound ? 'rounded-tr-none' : 'rounded-tl-none'),
            reactions && reactions.length > 0 && 'mb-3',
            highlighted && 'ring-2 ring-emerald-400 ring-offset-2',
          )}
        >
          {firstOfGroup && <BubbleTail outbound={outbound} />}

          {/* Quem enviou (usuário do CRM); mensagens do celular físico não têm rótulo. */}
          {outbound && senderLabel && (
            <p className="mb-0.5 text-[11px] font-semibold text-emerald-700">{senderLabel}</p>
          )}
          {outbound && message.sender_type === 'ai' && (
            <span className="mb-1 inline-block rounded-full bg-purple-200 px-2 py-0.5 text-[10px] font-semibold text-purple-800">
              IA SDR
            </span>
          )}

          {meta.reply && (
            <button
              type="button"
              onClick={() =>
                meta.reply?.targetMessageId && onJumpToMessage?.(meta.reply.targetMessageId)
              }
              disabled={!meta.reply.targetMessageId || !onJumpToMessage}
              className={cn(
                'focus-ring mb-1.5 block w-full min-w-40 overflow-hidden rounded-md border-l-[3px] px-2.5 py-1.5 text-left',
                outbound ? 'border-emerald-600 bg-white/65' : 'border-sky-500 bg-brand-50',
                meta.reply.targetMessageId && onJumpToMessage
                  ? 'cursor-pointer hover:bg-white/90'
                  : 'cursor-default',
              )}
              aria-label="Ir para a mensagem respondida"
            >
              <span className="block text-[11px] font-semibold text-emerald-700">
                {meta.reply.direction === 'inbound'
                  ? 'Família'
                  : meta.reply.direction === 'outbound'
                    ? 'Equipe Leibniz'
                    : 'Mensagem respondida'}
              </span>
              <span className="block truncate text-xs text-brand-500">{meta.reply.preview}</span>
            </button>
          )}

          {/* Imagem: preview clicável que abre em tamanho maior. */}
          {message.type === 'image' && message.media_url && (
            <>
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                className="focus-ring mb-1 block overflow-hidden rounded-md"
                aria-label="Ampliar imagem"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={message.media_url}
                  alt={message.content ?? 'Imagem'}
                  className="max-h-60 w-full object-cover"
                />
              </button>
              {lightboxOpen && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
                  onClick={() => setLightboxOpen(false)}
                  role="dialog"
                  aria-modal="true"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={message.media_url}
                    alt={message.content ?? 'Imagem'}
                    className="max-h-full max-w-full rounded-md object-contain"
                  />
                </div>
              )}
            </>
          )}

          {/* Vídeo: player inline (controles nativos incluem tela cheia). */}
          {message.type === 'video' && message.media_url && (
            <video
              controls
              preload="metadata"
              src={message.media_url}
              className="mb-1 max-h-60 rounded-md"
            />
          )}

          {/* Áudio / mensagem de voz. */}
          {message.type === 'audio' && message.media_url && (
            <div className="mb-1 flex items-center gap-2">
              {meta.audio?.ptt && <MicIcon size={16} className="shrink-0 text-brand-400" />}
              <audio
                controls
                preload="metadata"
                src={message.media_url}
                className="h-10 max-w-full"
              />
              {meta.audio?.seconds != null && meta.audio.seconds > 0 && (
                <span className="shrink-0 text-[11px] text-brand-400">
                  {Math.floor(meta.audio.seconds / 60)}:
                  {String(meta.audio.seconds % 60).padStart(2, '0')}
                </span>
              )}
            </div>
          )}

          {/* Documento: ícone por extensão + nome + tamanho + download. */}
          {message.type === 'document' && message.media_url && (
            <a
              href={message.media_url}
              target="_blank"
              rel="noreferrer"
              download
              className={cn(
                'mb-1 flex min-w-48 items-center gap-2.5 rounded-lg border p-2.5',
                outbound ? 'border-emerald-300/60 bg-white/60' : 'border-brand-100 bg-brand-50',
              )}
            >
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white',
                  docExtStyle(fileName).className,
                )}
              >
                {docExtStyle(fileName).ext}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-brand-700">
                  {fileName}
                </span>
                {fileSize && <span className="block text-[11px] text-brand-400">{fileSize}</span>}
              </span>
              <DownloadIcon size={16} className="shrink-0 text-brand-400" />
            </a>
          )}

          {/* Contato compartilhado (vCard). */}
          {message.type === 'contact' &&
            (meta.contacts && meta.contacts.length > 0 ? (
              <ContactCards
                cards={meta.contacts}
                outbound={outbound}
                onCreateLead={onCreateLeadFromContact}
              />
            ) : (
              <p className="whitespace-pre-wrap break-words">
                {message.content || 'Contato compartilhado'}
              </p>
            ))}

          {/* Localização: nome/endereço + coordenadas + abrir no mapa. */}
          {message.type === 'location' && (
            <div className="flex min-w-52 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
                  <MapPinIcon size={16} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-brand-700">
                    {location?.name ?? 'Localização'}
                  </p>
                  {location?.address && (
                    <p className="truncate text-xs text-brand-500">{location.address}</p>
                  )}
                  {location?.latitude != null && location?.longitude != null && (
                    <p className="text-[11px] text-brand-400">
                      {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
                    </p>
                  )}
                </div>
              </div>
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-sky-600 underline-offset-2 hover:underline"
                >
                  Abrir no Google Maps
                </a>
              )}
            </div>
          )}

          {/* Resposta interativa (botão/lista): opção escolhida em destaque. */}
          {message.type === 'interactive' && (
            <div className="flex flex-col gap-1">
              <span
                className={cn(
                  'inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-sm font-medium',
                  outbound
                    ? 'border-emerald-400 text-emerald-800'
                    : 'border-brand-200 bg-brand-50 text-brand-700',
                )}
              >
                {message.content || meta.interactive?.title || 'Opção selecionada'}
              </span>
              {meta.interactive?.description && (
                <span className="text-xs text-brand-500">{meta.interactive.description}</span>
              )}
              <span className="text-[10px] text-brand-400">resposta de botão</span>
            </div>
          )}

          {/* Reação órfã (mensagem original fora do histórico carregado). */}
          {message.type === 'reaction' && (
            <p className="text-xs italic text-brand-500">
              Reagiu com <span className="text-base not-italic">{message.content ?? '❓'}</span>
            </p>
          )}

          {/* Texto (e caption de mídia). */}
          {message.content &&
            !['document', 'contact', 'location', 'interactive', 'reaction'].includes(
              message.type,
            ) && <p className="whitespace-pre-wrap break-words">{message.content}</p>}

          {/* Tipo não suportado: fallback legível (o tipo cru fica no metadata/log). */}
          {!message.content && !message.media_url && meta.unsupportedType && (
            <p className="text-xs italic text-brand-400">Mensagem não suportada</p>
          )}

          <div
            className={cn('mt-1 flex items-center justify-end gap-1 text-[10px]', 'text-brand-400')}
          >
            {canReply && (
              <button
                type="button"
                onClick={() => onReply?.(message)}
                title="Responder esta mensagem"
                aria-label="Responder esta mensagem"
                className="focus-ring mr-auto flex h-6 w-6 items-center justify-center rounded-full text-brand-400 opacity-40 transition hover:bg-white/70 hover:text-emerald-700 hover:opacity-100 sm:opacity-0 sm:group-hover/msg:opacity-60"
              >
                <ReplyIcon size={13} />
              </button>
            )}
            <span>{timeLabel(message.created_at)}</span>
            {outbound && <StatusTicks status={message.status as MessageStatus} />}
          </div>

          {/* Falha de envio: alerta + reenviar. */}
          {failed && outbound && (
            <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-red-600">
              <span className="flex items-center gap-1">
                <AlertCircleIcon size={12} /> Não enviada
              </span>
              {onResend && (
                <button
                  type="button"
                  onClick={() => onResend(message)}
                  className="focus-ring flex items-center gap-1 rounded px-1 font-medium underline-offset-2 hover:underline"
                >
                  <RefreshIcon size={11} /> Reenviar
                </button>
              )}
            </div>
          )}

          {/* Reações ancoradas nesta bolha. */}
          {reactions && reactions.length > 0 && (
            <span
              className={cn(
                'absolute -bottom-3 rounded-full border border-brand-100 bg-white px-1.5 py-0.5 text-xs shadow-sm',
                outbound ? 'right-1' : 'left-1',
              )}
            >
              {reactions.join(' ')}
            </span>
          )}
        </div>
      </div>
      {!outbound && reactTrigger}
    </div>
  );
}

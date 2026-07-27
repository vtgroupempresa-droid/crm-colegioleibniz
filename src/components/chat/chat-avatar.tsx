'use client';

import { cn } from '@/lib/utils/cn';
import { ChannelBadge } from '@/components/ui/icons';
import type { ChatChannel } from '@/types/chat';

/** Iniciais (primeiro + último nome) — mesmo critério do InitialsAvatar. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]?.charAt(0) ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

interface ChatAvatarProps {
  name: string;
  /** Canal — badge sobreposto (bolinha verde WhatsApp / gradiente Instagram). */
  channel?: ChatChannel | null;
  /** Diâmetro em px (lista usa ~46, header ~40). */
  size?: number;
  className?: string;
}

/** Avatar redondo de iniciais com o indicador de canal sobreposto (mockup). */
export function ChatAvatar({ name, channel, size = 46, className }: ChatAvatarProps) {
  const badgeSize = Math.max(14, Math.round(size * 0.38));
  return (
    <span className={cn('relative inline-flex shrink-0', className)} style={{ width: size, height: size }}>
      <span
        className="flex h-full w-full items-center justify-center rounded-full bg-brand-100 font-bold text-brand-600"
        style={{ fontSize: Math.max(11, Math.round(size * 0.32)) }}
      >
        {initials(name)}
      </span>
      {channel && (
        <ChannelBadge
          channel={channel}
          size={badgeSize}
          className="absolute -bottom-0.5 -right-0.5 ring-2 ring-white"
        />
      )}
    </span>
  );
}

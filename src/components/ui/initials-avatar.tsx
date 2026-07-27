import { cn } from '@/lib/utils/cn';

/** Iniciais (primeiro + último nome) — mesmo critério da tabela de /leads. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]?.charAt(0) ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

interface InitialsAvatarProps {
  name: string;
  /** 'md' = 36px (tabelas de leads), 'sm' = 28px (linhas compactas). */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Avatar quadrado de iniciais com fundo cinza neutro — mesmo padrão visual já
 * usado em /leads e /financeiro/vendas, extraído para reuso nas tabelas do
 * dashboard (SDR/Closer e Top 10 por score).
 */
export function InitialsAvatar({ name, size = 'md', className }: InitialsAvatarProps) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-[9px] bg-brand-100 font-bold text-brand-600',
        size === 'md' ? 'h-9 w-9 text-xs' : 'h-7 w-7 text-[10px]',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

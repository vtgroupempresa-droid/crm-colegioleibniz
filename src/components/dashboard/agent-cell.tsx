import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { cn } from '@/lib/utils/cn';

const RANK_CLASSES: Record<number, string> = {
  1: 'bg-amber-100 text-amber-800',
  2: 'bg-brand-100 text-brand-600',
  3: 'bg-orange-100 text-orange-800',
};

/**
 * Nome + avatar quadrado (foto ou iniciais, padrão de /leads) com selo de
 * ranking opcional. Reutilizado nas tabelas de equipe e nas seções por pessoa.
 */
export function AgentCell({
  name,
  avatarUrl,
  rank,
}: {
  name: string;
  avatarUrl: string | null;
  rank?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      {rank !== undefined && (
        <span
          className={cn(
            'inline-flex h-5 w-5 flex-none items-center justify-center rounded-full text-[10px] font-bold',
            RANK_CLASSES[rank] ?? 'bg-brand-50 text-brand-400',
          )}
          title={`${rank}º no ranking`}
        >
          {rank}
        </span>
      )}
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="h-7 w-7 flex-none rounded-[9px] object-cover" />
      ) : (
        <InitialsAvatar name={name} size="sm" />
      )}
      <span className="font-medium text-brand-700">{name}</span>
    </div>
  );
}

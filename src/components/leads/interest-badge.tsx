import { cn } from '@/lib/utils/cn';
import { EDUCATION_LEVEL_LABELS, INTEREST_LEVEL_LABELS } from '@/types/lead';
import type { Lead } from '@/types/lead';

/**
 * Cores do nível de interesse — o "termômetro" do lead no card do Kanban.
 * Substitui o antigo score numérico: a equipe registra o interesse na conversa
 * (Baixo/Médio/Alto), não há cálculo automático.
 */
const INTEREST_CLASSES = {
  alto: 'bg-red-100 text-red-800',
  medio: 'bg-amber-100 text-amber-800',
  baixo: 'bg-brand-100 text-brand-500',
} as const;

const INTEREST_ICONS = {
  alto: '🔥',
  medio: '🌡️',
  baixo: '❄️',
} as const;

/** Badge do nível de interesse. Sem interesse registrado → não renderiza nada. */
export function InterestBadge({
  lead,
  size = 'sm',
  className,
}: {
  lead: Pick<Lead, 'interest_level'>;
  size?: 'sm' | 'xs';
  className?: string;
}) {
  const level = lead.interest_level;
  if (!level) return null;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full font-semibold leading-tight',
        size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]',
        INTEREST_CLASSES[level],
        className,
      )}
      title={`Nível de interesse: ${INTEREST_LEVEL_LABELS[level]}`}
    >
      <span aria-hidden>{INTEREST_ICONS[level]}</span>
      {INTEREST_LEVEL_LABELS[level]}
    </span>
  );
}

/**
 * Etiqueta do nível de ensino + ano escolar do aluno (ex.: "Fundamental I ·
 * 3º ano EF"). Sem nível registrado → não renderiza.
 */
export function EducationTag({
  lead,
  className,
}: {
  lead: Pick<Lead, 'education_level' | 'school_year'>;
  className?: string;
}) {
  if (!lead.education_level && !lead.school_year) return null;
  const parts = [
    lead.education_level ? EDUCATION_LEVEL_LABELS[lead.education_level] : null,
    lead.school_year,
  ].filter(Boolean);
  return (
    <span className={cn('truncate text-[11px] text-brand-500', className)}>{parts.join(' · ')}</span>
  );
}

import { cn } from '@/lib/utils/cn';
import { EDUCATION_LEVEL_LABELS, type Lead } from '@/types/lead';

type ChildProfileLead = Pick<
  Lead,
  'child_name' | 'child_age' | 'education_level' | 'school_year'
>;

/**
 * Dados que orientam a conversa comercial. Os rótulos permanecem visíveis
 * mesmo quando o cadastro ainda está incompleto, evitando suposições sobre o aluno.
 */
export function ChildProfileSummary({
  lead,
  compact = false,
  className,
}: {
  lead: ChildProfileLead;
  compact?: boolean;
  className?: string;
}) {
  const details = [
    ['Nome do filho', lead.child_name || 'Não informado'],
    ['Idade do filho', lead.child_age === null ? 'Não informada' : `${lead.child_age} anos`],
    [
      'Nível de ensino',
      lead.education_level ? EDUCATION_LEVEL_LABELS[lead.education_level] : 'Não informado',
    ],
    ['Ano escolar', lead.school_year || 'Não informado'],
  ] as const;

  return (
    <span
      className={cn(
        'grid grid-cols-2 gap-x-3 gap-y-1 text-left',
        compact ? 'mt-1 text-[10px] leading-tight' : 'mt-1.5 text-[11px] leading-tight',
        className,
      )}
    >
      {details.map(([label, value]) => (
        <span key={label} className="min-w-0 truncate text-brand-500" title={`${label}: ${value}`}>
          <span className="text-brand-400">{label}: </span>
          <span className="font-medium text-brand-600">{value}</span>
        </span>
      ))}
    </span>
  );
}

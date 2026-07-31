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

  if (compact) {
    const [child, age, education, schoolYear] = details;
    return (
      <span className={cn('mt-1 block min-w-0 text-[10px] leading-snug text-brand-500', className)}>
        <span className="block break-words">
          <span className="text-brand-400">{child[0]}: </span>
          <span className="font-medium text-brand-600">{child[1]}</span>
        </span>
        <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-brand-500">
          {[age, education, schoolYear].map(([label, value]) => (
            <span key={label} className="break-words" title={`${label}: ${value}`}>
              <span className="text-brand-400">{label}: </span>
              <span className="font-medium text-brand-600">{value}</span>
            </span>
          ))}
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        'mt-1.5 grid min-w-0 grid-cols-2 gap-1.5 text-left text-[11px] leading-tight',
        className,
      )}
    >
      {details.map(([label, value]) => (
        <span key={label} className="min-w-0 rounded-md bg-brand-50 px-1.5 py-1 text-brand-500" title={`${label}: ${value}`}>
          <span className="block text-[10px] text-brand-400">{label}</span>
          <span className="block break-words font-medium text-brand-600">{value}</span>
        </span>
      ))}
    </span>
  );
}

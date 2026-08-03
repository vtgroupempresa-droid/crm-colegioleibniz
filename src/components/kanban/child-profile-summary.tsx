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
      <span
        className={cn(
          'mt-2 block min-w-0 overflow-hidden rounded-lg border border-brand-100 bg-brand-50/70 px-2.5 py-2 text-left',
          className,
        )}
      >
        <span className="block min-w-0">
          <span className="block text-[10px] font-medium uppercase tracking-wide text-brand-400">
            {child[0]}
          </span>
          <span
            className="mt-0.5 block break-words text-xs font-semibold leading-snug text-brand-700 [overflow-wrap:anywhere]"
            title={`${child[0]}: ${child[1]}`}
          >
            {child[1]}
          </span>
        </span>
        <span className="mt-2 grid min-w-0 grid-cols-[0.8fr_1.35fr_1fr] gap-2 border-t border-brand-100 pt-1.5">
          {[age, education, schoolYear].map(([label, value]) => (
            <span key={label} className="min-w-0" title={`${label}: ${value}`}>
              <span className="block min-h-5 break-words text-[9px] font-medium uppercase leading-3 tracking-wide text-brand-400 [overflow-wrap:anywhere]">
                {label === 'Idade do filho' ? 'Idade' : label}
              </span>
              <span className="mt-0.5 block max-h-7 overflow-hidden break-words text-[11px] font-semibold leading-3.5 text-brand-600 [overflow-wrap:anywhere]">
                {value}
              </span>
            </span>
          ))}
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        'mt-2 block min-w-0 overflow-hidden rounded-lg border border-brand-100 bg-brand-50/70 px-2.5 py-2 text-left',
        className,
      )}
    >
      <span className="block min-w-0">
        <span className="block text-[10px] font-medium uppercase tracking-wide text-brand-400">
          {details[0][0]}
        </span>
        <span
          className="mt-0.5 block break-words text-xs font-semibold leading-snug text-brand-700 [overflow-wrap:anywhere]"
          title={`${details[0][0]}: ${details[0][1]}`}
        >
          {details[0][1]}
        </span>
      </span>
      <span className="mt-2 grid min-w-0 grid-cols-[0.8fr_1.35fr_1fr] gap-2 border-t border-brand-100 pt-1.5">
        {details.slice(1).map(([label, value]) => (
          <span key={label} className="min-w-0" title={`${label}: ${value}`}>
            <span className="block min-h-5 break-words text-[9px] font-medium uppercase leading-3 tracking-wide text-brand-400 [overflow-wrap:anywhere]">
              {label === 'Idade do filho' ? 'Idade' : label}
            </span>
            <span className="mt-0.5 block break-words text-[11px] font-semibold leading-tight text-brand-600 [overflow-wrap:anywhere]">
              {value}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}

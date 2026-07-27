import type { Lead } from '@/types/lead';

/**
 * Valida se um lead atende aos `required_fields` declarados pelo pipeline_stages.
 * Regras especiais:
 *  - `assigned_to` precisa ser não-nulo.
 *  - números: 0 é considerado preenchido (o produto distingue ausência de zero).
 */
export interface FieldValidationResult {
  ok: boolean;
  missing: readonly string[];
}

const ALWAYS_PRESENT: ReadonlySet<keyof Lead> = new Set([
  'pipeline',
  'stage',
  'is_archived',
  'is_no_show',
  'tags',
] as const satisfies readonly (keyof Lead)[]);

function isFieldFilled(lead: Pick<Lead, keyof Lead>, field: string): boolean {
  const value = (lead as Record<string, unknown>)[field];

  if (value === null || value === undefined) return false;

  if (typeof value === 'string') return value.trim().length > 0;

  if (typeof value === 'number') {
    // null representa "não informado"; 0 é um valor válido (ex.: idade em meses).
    return !Number.isNaN(value);
  }

  if (ALWAYS_PRESENT.has(field as keyof Lead)) return true;

  return true;
}

export function validateRequiredFields(
  lead: Lead,
  requiredFields: readonly string[],
): FieldValidationResult {
  const missing = requiredFields.filter((field) => !isFieldFilled(lead, field));
  return { ok: missing.length === 0, missing };
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Nome do responsável',
  phone: 'Telefone',
  email: 'Email',
  city: 'Cidade',
  interest_level: 'Nível de interesse',
  with_child: 'Entra com o filho',
  child_name: 'Nome do filho',
  child_age: 'Idade do filho',
  education_level: 'Nível de ensino',
  school_year: 'Ano escolar',
  source: 'Origem',
  assigned_to: 'Responsável pelo atendimento',
  lost_reason: 'Motivo da perda',
};

export function labelForField(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

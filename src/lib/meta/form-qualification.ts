import type { MetaFormAnswer } from '@/types/lead';
import type { Enums } from '@/types/database';

type EducationLevel = Enums<'education_level'>;

/**
 * Qualificação a partir das respostas do formulário Meta Lead Ads.
 *
 * Os field names da Meta vêm em snake_case do texto da pergunta e os valores em
 * snake_case do texto da opção. Formulários da escola costumam perguntar o nome
 * e a idade do filho, o nível de ensino / série desejada e o ano letivo.
 *
 * Este módulo é PURO (sem I/O) para ser testável e reusável no webhook leadgen.
 * Tudo aqui é best-effort: pergunta ausente → null (nada é obrigatório); as
 * respostas completas sempre ficam em leads.meta_form_answers de qualquer jeito.
 */

/** Normaliza para casar perguntas/respostas: sem acento, `_`→espaço, lowercase. */
function norm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .trim();
}

function findAnswer(answers: MetaFormAnswer[], keys: string[]): string | null {
  const f = answers.find((ans) => keys.some((k) => norm(ans.question).includes(k)));
  return f?.answer ?? null;
}

/** "nome do filho / do aluno / da criança" → texto. */
export function parseChildName(answers: MetaFormAnswer[]): string | null {
  const f = answers.find((ans) => {
    const q = norm(ans.question);
    return q.includes('nome') && /(filho|filha|alun|crianc|estudante)/.test(q);
  });
  return f?.answer?.trim() || null;
}

/** "idade do filho/aluno" → número inteiro (primeiro número da resposta). */
export function parseChildAge(answers: MetaFormAnswer[]): number | null {
  const raw = findAnswer(answers, ['idade']);
  if (!raw) return null;
  const n = Number((norm(raw).match(/\d{1,2}/) ?? [])[0]);
  return Number.isFinite(n) && n > 0 && n < 30 ? n : null;
}

/** Nível de ensino a partir de resposta livre ("fundamental 1", "ensino médio"…). */
export function parseEducationLevel(answers: MetaFormAnswer[]): EducationLevel | null {
  const raw = findAnswer(answers, ['nivel de ensino', 'nivel', 'segmento', 'ensino', 'serie']);
  if (!raw) return null;
  const a = norm(raw);
  if (/enem|pre enem|preparatorio/.test(a)) return 'pre_enem';
  if (/infantil|maternal|bercario|pre i|pre ii|creche/.test(a)) return 'infantil';
  if (/medio/.test(a)) return 'medio';
  if (/fundamental/.test(a)) {
    if (/(2|ii|anos finais|6|7|8|9)/.test(a)) return 'fundamental_2';
    return 'fundamental_1';
  }
  // Séries soltas: "3º ano" sem contexto → fundamental 1; "7º ano" → fundamental 2.
  const yearMatch = a.match(/(\d{1,2})\s*(?:º|o)?\s*ano/);
  if (yearMatch) {
    const y = Number(yearMatch[1]);
    if (y >= 1 && y <= 5) return 'fundamental_1';
    if (y >= 6 && y <= 9) return 'fundamental_2';
  }
  if (/(1|2|3)\s*(?:ª|a)?\s*serie/.test(a)) return 'medio';
  return null;
}

/** Ano escolar / série desejada como texto legível (ex.: "3º ano EF"). */
export function parseSchoolYear(answers: MetaFormAnswer[]): string | null {
  const raw = findAnswer(answers, ['ano escolar', 'serie', 'qual ano', 'turma']);
  return raw?.trim() || null;
}

/** "vai visitar com o filho?" / "entra com o filho?" → boolean. */
export function parseWithChild(answers: MetaFormAnswer[]): boolean | null {
  const f = answers.find((ans) => {
    const q = norm(ans.question);
    return /(com o filho|com a filha|com o aluno|com a crianca)/.test(q);
  });
  if (!f) return null;
  const a = norm(f.answer);
  if (/\bnao\b/.test(a) || /^no\b/.test(a)) return false;
  if (/\bsim\b/.test(a) || /^yes\b/.test(a)) return true;
  return null;
}

export interface SchoolFormFields {
  child_name?: string;
  child_age?: number;
  education_level?: EducationLevel;
  school_year?: string;
  with_child?: boolean;
}

/** Extrai todos os campos escolares reconhecidos do formulário de uma vez. */
export function parseSchoolFields(answers: MetaFormAnswer[]): SchoolFormFields {
  const childName = parseChildName(answers);
  const childAge = parseChildAge(answers);
  const educationLevel = parseEducationLevel(answers);
  const schoolYear = parseSchoolYear(answers);
  const withChild = parseWithChild(answers);
  return {
    ...(childName ? { child_name: childName } : {}),
    ...(childAge != null ? { child_age: childAge } : {}),
    ...(educationLevel ? { education_level: educationLevel } : {}),
    ...(schoolYear ? { school_year: schoolYear } : {}),
    ...(withChild != null ? { with_child: withChild } : {}),
  };
}

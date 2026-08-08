import type { Tables, TablesInsert, TablesUpdate, Enums } from './database';

export type Lead = Tables<'leads'>;
export type LeadInsert = TablesInsert<'leads'>;
export type LeadUpdate = TablesUpdate<'leads'>;

export type LeadSource = Enums<'lead_source'>;
export type InterestLevel = Enums<'interest_level'>;
export type EducationLevel = Enums<'education_level'>;

/**
 * Razões de perda do lead — enum FECHADO.
 *
 * Regra do produto:
 *  - NUNCA usar texto livre. Se uma razão nova for necessária, adicionar no enum
 *    do banco PRIMEIRO (migration), depois propagar para esse arquivo.
 *  - `numero_invalido` arquiva o lead (lixo, não reaproveita). Os demais motivos
 *    mantêm o lead disponível para campanhas de reativação/rematrícula.
 */
export type LostReason = Enums<'lost_reason'>;

export const INTEREST_LEVELS: readonly InterestLevel[] = ['baixo', 'medio', 'alto'] as const;

export const INTEREST_LEVEL_LABELS: Record<InterestLevel, string> = {
  baixo: 'Baixo',
  medio: 'Médio',
  alto: 'Alto',
};

/** Situação atual da conversa comercial, atualizada pelo drawer do lead. */
export const LEAD_QUALIFICATION_STATUSES = [
  'muito_interessado',
  'comparando_opcoes',
  'quer_agendar_visita',
  'duvida_valor_bolsa',
  'consultar_familia',
  'aguardando_retorno',
  'sem_resposta',
  'sem_interesse',
  'outro',
] as const;

export type LeadQualificationStatus = (typeof LEAD_QUALIFICATION_STATUSES)[number];

export const LEAD_QUALIFICATION_LABELS: Record<LeadQualificationStatus, string> = {
  muito_interessado: 'Gostou bastante',
  comparando_opcoes: 'Está comparando outras opções',
  quer_agendar_visita: 'Quer agendar visita',
  duvida_valor_bolsa: 'Tem dúvida sobre valor ou bolsa',
  consultar_familia: 'Precisa conversar com a família',
  aguardando_retorno: 'Aguardando retorno',
  sem_resposta: 'Sem resposta',
  sem_interesse: 'Não gostou ou sem interesse',
  outro: 'Outro',
};

export const LEAD_QUALIFICATION_NEXT_ACTIONS = [
  'retornar_contato',
  'enviar_proposta',
  'agendar_visita',
  'aguardar',
] as const;

export type LeadQualificationNextAction = (typeof LEAD_QUALIFICATION_NEXT_ACTIONS)[number];

export const LEAD_QUALIFICATION_NEXT_ACTION_LABELS: Record<LeadQualificationNextAction, string> = {
  retornar_contato: 'Retornar contato',
  enviar_proposta: 'Enviar proposta',
  agendar_visita: 'Agendar visita',
  aguardar: 'Aguardar',
};

export function isLeadQualificationStatus(value: string | null): value is LeadQualificationStatus {
  return !!value && (LEAD_QUALIFICATION_STATUSES as readonly string[]).includes(value);
}

export function isLeadQualificationNextAction(
  value: string | null,
): value is LeadQualificationNextAction {
  return !!value && (LEAD_QUALIFICATION_NEXT_ACTIONS as readonly string[]).includes(value);
}

export const EDUCATION_LEVELS: readonly EducationLevel[] = [
  'infantil',
  'fundamental_1',
  'fundamental_2',
  'medio',
  'pre_enem',
] as const;

export const EDUCATION_LEVEL_LABELS: Record<EducationLevel, string> = {
  infantil: 'Educação Infantil',
  fundamental_1: 'Fundamental I',
  fundamental_2: 'Fundamental II',
  medio: 'Ensino Médio',
  pre_enem: 'Preparatório ENEM',
};

/** Anos escolares por nível de ensino — usados nos selects de cadastro. */
export const SCHOOL_YEARS_BY_LEVEL: Record<EducationLevel, readonly string[]> = {
  infantil: ['Berçário', 'Maternal I', 'Maternal II', 'Pré I', 'Pré II'],
  fundamental_1: ['1º ano EF', '2º ano EF', '3º ano EF', '4º ano EF', '5º ano EF'],
  fundamental_2: ['6º ano EF', '7º ano EF', '8º ano EF', '9º ano EF'],
  medio: ['1ª série EM', '2ª série EM', '3ª série EM'],
  pre_enem: ['Pré-ENEM'],
};

export const LEAD_SOURCES: readonly LeadSource[] = [
  'meta_ads',
  'whatsapp',
  'instagram',
  'telefone',
  'presencial',
  'site',
  'indicacao',
  'organico',
  'evento',
  'reentrada',
  'outro',
] as const;

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  meta_ads: 'Meta Ads',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  telefone: 'Ligação',
  presencial: 'Presencial',
  site: 'Site',
  indicacao: 'Indicação',
  organico: 'Orgânico',
  evento: 'Evento',
  reentrada: 'Reentrada',
  outro: 'Outro',
};

/**
 * Resposta de uma pergunta do formulário Meta Lead Ads, gravada em
 * leads.meta_form_answers (jsonb). `question` vem do field name da Meta
 * (snake_case do texto da pergunta).
 */
export interface MetaFormAnswer {
  question: string;
  answer: string;
}

/**
 * Snapshot de UMA entrada de Meta Lead Ads (gravado em leads.meta_entries).
 * Append-only: a 1ª entrada (`first`) e cada reentrada (`reentry`) viram um item,
 * cada um com sua própria atribuição. Assim o painel "Origem do lead" mostra os
 * touchpoints separados.
 */
export interface MetaLeadEntry {
  /** Momento em que esta entrada foi processada (ISO). */
  at: string;
  kind: 'first' | 'reentry';
  /** leadgen_id da submissão — chave de dedup (o webhook pode reprocessar). */
  leadgenId: string | null;
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  adId: string | null;
  adName: string | null;
  formId: string | null;
  formName: string | null;
  formAnswers: MetaFormAnswer[];
}

/** Converte o jsonb cru em MetaLeadEntry[] validando o shape (zero `any`). */
export function parseMetaLeadEntries(raw: unknown): MetaLeadEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: MetaLeadEntry[] = [];
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.at !== 'string') continue;
    entries.push({
      at: r.at,
      kind: r.kind === 'reentry' ? 'reentry' : 'first',
      leadgenId: str(r.leadgenId),
      campaignId: str(r.campaignId),
      campaignName: str(r.campaignName),
      adsetId: str(r.adsetId),
      adsetName: str(r.adsetName),
      adId: str(r.adId),
      adName: str(r.adName),
      formId: str(r.formId),
      formName: str(r.formName),
      formAnswers: parseMetaFormAnswers(r.formAnswers),
    });
  }
  return entries;
}

/** Converte o jsonb cru em MetaFormAnswer[] validando o shape (zero `any`). */
export function parseMetaFormAnswers(raw: unknown): MetaFormAnswer[] {
  if (!Array.isArray(raw)) return [];
  const answers: MetaFormAnswer[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object' && 'question' in item && 'answer' in item) {
      const q = (item as Record<string, unknown>).question;
      const a = (item as Record<string, unknown>).answer;
      if (typeof q === 'string' && typeof a === 'string') {
        answers.push({ question: q, answer: a });
      }
    }
  }
  return answers;
}

/**
 * Fontes PAGAS (tráfego pago). Qualquer fonte fora desta lista é tratada como
 * ORGÂNICA no filtro de fontes do board (/oportunidades). Se um dia entrar
 * Google Ads etc., basta adicionar aqui.
 */
export const PAID_LEAD_SOURCES: readonly LeadSource[] = ['meta_ads'] as const;

/**
 * Filtro de fonte do board: grupo (pagas/orgânicas) ou uma fonte específica.
 * 'all' não filtra.
 */
export type SourceFilter = 'all' | 'pagas' | 'organicas' | LeadSource;

/** Valida o valor cru da query string (?fonte=) — desconhecido vira 'all'. */
export function parseSourceFilter(raw: string | undefined): SourceFilter {
  if (raw === 'pagas' || raw === 'organicas') return raw;
  if (raw && (LEAD_SOURCES as readonly string[]).includes(raw)) return raw as LeadSource;
  return 'all';
}

export const LOST_REASONS: readonly LostReason[] = [
  'preco',
  'momento',
  'distancia',
  'concorrente',
  'sem_vaga',
  'sem_resposta',
  'sem_interesse',
  'numero_invalido',
  'outro',
] as const;

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  preco: 'Preço',
  momento: 'Momento',
  distancia: 'Distância',
  concorrente: 'Outra escola',
  sem_vaga: 'Sem vaga na turma',
  sem_resposta: 'Parou de responder',
  sem_interesse: 'Sem interesse',
  numero_invalido: 'Número inválido',
  outro: 'Outro',
};

/**
 * Canais de tentativa de contato e desfechos — enums fechados.
 */
export type ContactChannel = Enums<'contact_channel'>;
export type ContactOutcome = Enums<'contact_outcome'>;

export const CONTACT_CHANNELS: readonly ContactChannel[] = [
  'whatsapp',
  'phone',
  'email',
  'instagram',
  'presencial',
] as const;

export const CONTACT_CHANNEL_LABELS: Record<ContactChannel, string> = {
  whatsapp: 'WhatsApp',
  phone: 'Telefone',
  email: 'Email',
  instagram: 'Instagram',
  presencial: 'Presencial',
};

export const CONTACT_OUTCOMES: readonly ContactOutcome[] = [
  'no_answer',
  'busy',
  'responded',
  'scheduled',
] as const;

export const CONTACT_OUTCOME_LABELS: Record<ContactOutcome, string> = {
  no_answer: 'Sem resposta',
  busy: 'Ocupado',
  responded: 'Respondeu',
  scheduled: 'Agendou',
};

export type Activity = Tables<'activities'>;
export type ContactAttempt = Tables<'contact_attempts'>;
export type Appointment = Tables<'appointments'>;
export type Deal = Tables<'deals'>;

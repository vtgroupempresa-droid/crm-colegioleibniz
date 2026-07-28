import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type DbClient = SupabaseClient<Database>;

/**
 * Detecção de leads duplicados em CAMADAS de confiança.
 *
 * Camada 1 — ALTA confiança (não vive aqui; intacta):
 *   phone_normalized ou email idênticos entre leads não arquivados. Coberta
 *   por findLeadByIdentity (unificação automática no ingest) e pela RPC
 *   duplicate_lead_groups (aba Unificar leads do /admin).
 *
 * Camada 2 — confiança MÉDIA (este módulo):
 *   nome normalizado (sem título dr./dra., sem acentos) com similaridade
 *   trigram >= limiar (default 0.85) E pelo menos UM sinal de apoio:
 *     - mesma cidade E mesmo estado preenchidos e iguais nos dois; OU
 *     - um dos leads é "casca vazia" (sem telefone E sem email, ou com menos
 *       de EMPTY_SHELL_MIN_ACTIVITIES activities — registro criado e nunca
 *       trabalhado); OU
 *     - created_at dos dois com diferença menor que 30 dias.
 *   Vira "forte candidato" na revisão — NUNCA unifica sozinho.
 *
 * Camada 3 — confiança BAIXA (este módulo):
 *   nome similar acima do limiar SEM nenhum sinal de apoio. Pode ser homônimo
 *   (duas médicas com o mesmo nome). Vira "possível duplicata, revisar com
 *   atenção" — destaque visual menor e aviso mais forte na tela.
 *
 * Camadas 2 e 3 apenas registram pares pendentes em duplicate_candidates para
 * revisão humana no /admin. A unificação em si continua passando SEMPRE pelo
 * mergeLeads com confirmação explícita.
 *
 * O lado SQL (migration name_similarity_duplicate_detection) espelha a mesma
 * normalização em public.normalize_lead_name + as RPCs find_name_duplicate_pairs
 * (varredura completa) e find_similar_leads_by_name (checagem de um lead novo).
 */

/** Limiar default de similaridade trigram (pg_trgm similarity()). */
export const DEFAULT_MIN_SIMILARITY = 0.85;

/**
 * "Casca vazia": lead com menos que este total de activities conta como
 * incompleto (todo lead ganha 1–2 activities de sistema ao ser criado; menos
 * que 2 significa que nunca foi trabalhado por ninguém).
 */
export const EMPTY_SHELL_MIN_ACTIVITIES = 2;

/** Janela (dias) para o sinal "criados próximos" da Camada 2. */
export const CREATED_CLOSE_WINDOW_DAYS = 30;

/** Janela (dias) da checagem contínua: lead novo × leads recentes. */
export const NEW_LEAD_SCAN_WINDOW_DAYS = 90;

export type SupportingSignal = 'mesma_cidade_estado' | 'lead_incompleto' | 'criados_proximos';

export const SUPPORTING_SIGNAL_LABELS: Record<SupportingSignal, string> = {
  mesma_cidade_estado: 'mesma cidade/UF',
  lead_incompleto: 'registro incompleto',
  criados_proximos: 'criados com menos de 30 dias de diferença',
};

export type ConfidenceLayer = 2 | 3;

/**
 * Normaliza um nome para comparação de similaridade — espelho EXATO da função
 * SQL public.normalize_lead_name:
 *   1. remove título no início (dr., dra., doutor, doutora — case insensitive)
 *   2. lowercase
 *   3. remove acentos (translitera para ASCII)
 *   4. colapsa espaços múltiplos + trim
 * Ex.: 'Dra. Gelvani Inês Fritzen' → 'gelvani ines fritzen'
 */
export function normalizeNameForComparison(name: string): string {
  return name
    .replace(/^\s*(doutora|doutor|dra|dr)[.\s]+/i, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Nome utilizável para matching de similaridade? Mesmos critérios do SQL:
 * >= 5 chars, contém letra, tem sobrenome (>= 2 palavras) e não é o
 * placeholder 'Lead sem nome'. Primeiro nome sozinho não identifica ninguém
 * ("maria" × "maria" quase sempre são pessoas diferentes).
 */
export function isNameUsableForMatching(name: string): boolean {
  const norm = normalizeNameForComparison(name);
  return (
    norm.length >= 5 && /[a-z]/.test(norm) && norm.includes(' ') && norm !== 'lead sem nome'
  );
}

/** Dados mínimos de um lado do par para classificar a camada de confiança. */
export interface PairSide {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  createdAt: string;
  activityCount: number;
}

export interface ClassifiedPair {
  /** Lado com o menor id (ordem canônica do par em duplicate_candidates). */
  a: PairSide;
  b: PairSide;
  nameSimilarity: number;
  confidenceLayer: ConfidenceLayer;
  supportingSignals: SupportingSignal[];
}

function normLoose(value: string | null): string | null {
  if (!value) return null;
  const v = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return v.length > 0 ? v : null;
}

function isEmptyShell(side: PairSide): boolean {
  return (!side.phone && !side.email) || side.activityCount < EMPTY_SHELL_MIN_ACTIVITIES;
}

/**
 * Classifica um par de nomes similares na Camada 2 (com sinais de apoio) ou
 * Camada 3 (sem nenhum sinal). Ver o cabeçalho do módulo para os critérios.
 */
export function classifyPair(
  a: PairSide,
  b: PairSide,
): { confidenceLayer: ConfidenceLayer; supportingSignals: SupportingSignal[] } {
  const signals: SupportingSignal[] = [];

  const cityA = normLoose(a.city);
  const cityB = normLoose(b.city);
  const stateA = normLoose(a.state);
  const stateB = normLoose(b.state);
  if (cityA && cityB && stateA && stateB && cityA === cityB && stateA === stateB) {
    signals.push('mesma_cidade_estado');
  }

  if (isEmptyShell(a) || isEmptyShell(b)) {
    signals.push('lead_incompleto');
  }

  const gapMs = Math.abs(new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  if (gapMs < CREATED_CLOSE_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
    signals.push('criados_proximos');
  }

  // A similaridade já passou do limiar para chegar aqui; a camada depende só dos sinais.
  return { confidenceLayer: signals.length > 0 ? 2 : 3, supportingSignals: signals };
}

/** Ordena o par pela ordem canônica (a.id < b.id, mesma ordenação do uuid no PG). */
function orderPair(x: PairSide, y: PairSide): { a: PairSide; b: PairSide } {
  return x.id < y.id ? { a: x, b: y } : { a: y, b: x };
}

/**
 * Varredura COMPLETA da base (auditoria): todos os pares de leads ativos com
 * nome normalizado similar acima do limiar, já classificados em Camada 2/3.
 * Pares cobertos pela Camada 1 (phone/email idênticos) ficam de fora — a
 * detecção automática existente já cuida deles.
 */
export async function scanNameDuplicatePairs(
  admin: DbClient,
  minSimilarity: number = DEFAULT_MIN_SIMILARITY,
): Promise<ClassifiedPair[]> {
  const { data, error } = await admin.rpc('find_name_duplicate_pairs', {
    min_sim: minSimilarity,
  });
  if (error) throw new Error(`find_name_duplicate_pairs falhou: ${error.message}`);

  return (data ?? []).map((row) => {
    const sideA: PairSide = {
      id: row.a_id,
      name: row.a_name,
      phone: row.a_phone,
      email: row.a_email,
      city: row.a_city,
      state: row.a_state,
      createdAt: row.a_created_at,
      activityCount: row.a_activity_count,
    };
    const sideB: PairSide = {
      id: row.b_id,
      name: row.b_name,
      phone: row.b_phone,
      email: row.b_email,
      city: row.b_city,
      state: row.b_state,
      createdAt: row.b_created_at,
      activityCount: row.b_activity_count,
    };
    const { a, b } = orderPair(sideA, sideB);
    const { confidenceLayer, supportingSignals } = classifyPair(a, b);
    return { a, b, nameSimilarity: row.name_similarity, confidenceLayer, supportingSignals };
  });
}

export interface UpsertCandidatesResult {
  inserted: number;
  alreadyKnown: number;
}

/**
 * Registra pares candidatos em duplicate_candidates. ON CONFLICT DO NOTHING
 * no par (lead_a_id, lead_b_id): um par já registrado — inclusive já revisado
 * como 'ignorado' — NÃO volta a ser inserido nem tem o status resetado.
 */
export async function upsertDuplicateCandidates(
  admin: DbClient,
  pairs: ClassifiedPair[],
): Promise<UpsertCandidatesResult> {
  if (pairs.length === 0) return { inserted: 0, alreadyKnown: 0 };

  const rows = pairs.map((p) => ({
    lead_a_id: p.a.id,
    lead_b_id: p.b.id,
    confidence_layer: p.confidenceLayer,
    name_similarity: p.nameSimilarity,
    supporting_signals: p.supportingSignals,
  }));

  const { data, error } = await admin
    .from('duplicate_candidates')
    .upsert(rows, { onConflict: 'lead_a_id,lead_b_id', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(`upsert em duplicate_candidates falhou: ${error.message}`);

  const inserted = (data ?? []).length;
  return { inserted, alreadyKnown: pairs.length - inserted };
}

/**
 * Checagem CONTÍNUA (Parte 6): roda após a criação de um lead novo que não
 * casou com nenhum lead existente pelas camadas de identidade (instagram/
 * facebook/phone/email). Compara o nome normalizado contra os leads criados
 * nos últimos 90 dias e registra APENAS candidatos de Camada 2 (a Camada 3,
 * mais fraca, geraria ruído demais no fluxo automático).
 *
 * Nunca lança: falha aqui não pode impedir a criação do lead — só loga.
 */
export async function checkNewLeadNameDuplicates(
  admin: DbClient,
  newLead: PairSide,
): Promise<number> {
  try {
    if (!isNameUsableForMatching(newLead.name)) return 0;

    const { data, error } = await admin.rpc('find_similar_leads_by_name', {
      p_lead_id: newLead.id,
      min_sim: DEFAULT_MIN_SIMILARITY,
      window_days: NEW_LEAD_SCAN_WINDOW_DAYS,
    });
    if (error) throw new Error(error.message);

    const layer2: ClassifiedPair[] = [];
    for (const row of data ?? []) {
      const other: PairSide = {
        id: row.b_id,
        name: row.b_name,
        phone: row.b_phone,
        email: row.b_email,
        city: row.b_city,
        state: row.b_state,
        createdAt: row.b_created_at,
        activityCount: row.b_activity_count,
      };
      const { a, b } = orderPair(newLead, other);
      const { confidenceLayer, supportingSignals } = classifyPair(a, b);
      if (confidenceLayer === 2) {
        layer2.push({
          a,
          b,
          nameSimilarity: row.name_similarity,
          confidenceLayer,
          supportingSignals,
        });
      }
    }

    if (layer2.length === 0) return 0;
    const { inserted } = await upsertDuplicateCandidates(admin, layer2);
    return inserted;
  } catch (err) {
    console.error('[duplicate-detection] checagem de nome do lead novo falhou:', err);
    return 0;
  }
}

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';

type DbClient = SupabaseClient<Database>;

/**
 * Identidade de lead e unificação cross-canal (Parte 4).
 *
 * Regra do produto: leads são únicos. O mesmo responsável contatando via
 * Instagram Direct e depois preenchendo um formulário Meta Ads (ou vice-versa)
 * DEVE virar o mesmo lead — nunca duplicar. Este módulo concentra a normalização
 * dos identificadores e o matching por prioridade usado no webhook unificado da Meta.
 */

/**
 * Identidade de telefone persistida no CRM.
 *
 * Além de remover a máscara, padroniza números brasileiros com DDI 55 e o
 * nono dígito de celular. Assim, o mesmo responsável não cria outro lead ao
 * chegar como `11999998888`, `5511999998888` ou `551199998888`.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  const national =
    (digits.length === 12 || digits.length === 13) && digits.startsWith('55')
      ? digits.slice(2)
      : digits;

  // Brasil: DDD (2) + telefone (8/9). Só acrescenta o 9 em números que
  // parecem celular; nunca altera linhas fixas ou números internacionais.
  if (national.length === 10 && /^[6-9]/.test(national.slice(2))) {
    return `55${national.slice(0, 2)}9${national.slice(2)}`;
  }
  if (national.length === 10 || national.length === 11) return `55${national}`;
  return digits;
}

/**
 * Variações normalizadas de um telefone, para casar registros gravados em
 * formatos diferentes. Cobre duas fontes de divergência no Brasil:
 *
 *  1. DDI 55 presente ou não — "+55 (11) 99999-8888" vs "11999998888".
 *  2. NONO DÍGITO do celular — o "9" depois do DDD existe em alguns cadastros e
 *     falta em outros (números antigos, exports diversos). "5511999998888"
 *     (com 9) e "551199998888" (sem 9) são a MESMA pessoa. Foi a causa de
 *     duplicatas: o lead vinha do Meta com 13 dígitos e respondia no WhatsApp
 *     com 12 (ou vice-versa), e o match por phone_normalized não fechava.
 *
 * Gera todas as combinações { com DDI, sem DDI } × { com 9, sem 9 } para a parte
 * nacional brasileira (10/11 dígitos). Só inventa o "9" quando o número parece
 * de celular (local começa em 6–9) — não transforma fixo em celular. Números
 * internacionais (não-55) ficam intactos.
 */
export function phoneCandidates(raw: string | null | undefined): string[] {
  const np = normalizePhone(raw);
  if (!np) return [];
  const set = new Set<string>([np]);

  // Parte nacional (sem DDI 55): 10 dígitos (DDD + 8) ou 11 (DDD + 9 + 8).
  let national: string | null = null;
  if ((np.length === 12 || np.length === 13) && np.startsWith('55')) {
    national = np.slice(2);
  } else if (np.length === 10 || np.length === 11) {
    national = np;
  }

  if (national && (national.length === 10 || national.length === 11)) {
    const ddd = national.slice(0, 2);
    const local = national.slice(2); // 8 (sem 9) ou 9 (com 9) dígitos

    // Variações do número local com e sem o nono dígito.
    const locals = new Set<string>([local]);
    if (local.length === 9 && local.startsWith('9')) {
      locals.add(local.slice(1)); // remove o 9 → variante antiga
    } else if (local.length === 8 && /^[6-9]/.test(local)) {
      locals.add(`9${local}`); // adiciona o 9 → variante atual (só celular)
    }

    for (const l of locals) {
      const nat = `${ddd}${l}`;
      set.add(nat); // sem DDI
      set.add(`55${nat}`); // com DDI
    }
  }

  return [...set];
}

/** Email canônico (lowercase + trim). */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  return e.length > 0 ? e : null;
}

export interface LeadIdentity {
  instagramUserId?: string | null;
  facebookUserId?: string | null;
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  city?: string | null;
}

export interface MatchedLead {
  id: string;
  assigned_to: string | null;
  tags: string[] | null;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  instagram_user_id: string | null;
  facebook_user_id: string | null;
  meta_entries: Json;
}

const MATCH_SELECT =
  'id, assigned_to, tags, phone, email, instagram, instagram_user_id, facebook_user_id, meta_entries';

export interface IdentityMatchOptions {
  /** Habilita o passo 5 (nome + cidade, match exato case-insensitive). */
  fuzzyNameCity?: boolean;
}

/**
 * Acha um lead existente por identidade, na ordem de prioridade da Parte 4:
 *  1. instagram_user_id (IGSID do remetente do Direct)
 *  2. facebook_user_id (quando o Lead Ads trouxer)
 *  3. telefone normalizado (ignora +55 e máscara)
 *  4. email (lowercase/trim)
 *  5. nome + cidade (exato, case-insensitive) — só com fuzzyNameCity
 *
 * Considera apenas leads não arquivados. Retorna null se nada casar.
 */
export async function findLeadByIdentity(
  admin: DbClient,
  id: LeadIdentity,
  options: IdentityMatchOptions = {},
): Promise<MatchedLead | null> {
  const base = () =>
    admin.from('leads').select(MATCH_SELECT).eq('is_archived', false).limit(1);

  if (id.instagramUserId) {
    const { data } = await base().eq('instagram_user_id', id.instagramUserId).maybeSingle();
    if (data) return data as MatchedLead;
  }
  if (id.facebookUserId) {
    const { data } = await base().eq('facebook_user_id', id.facebookUserId).maybeSingle();
    if (data) return data as MatchedLead;
  }
  const phones = phoneCandidates(id.phone);
  if (phones.length > 0) {
    const { data } = await base().in('phone_normalized', phones).maybeSingle();
    if (data) return data as MatchedLead;
  }
  const email = normalizeEmail(id.email);
  if (email) {
    const { data } = await base().ilike('email', email).maybeSingle();
    if (data) return data as MatchedLead;
  }
  if (options.fuzzyNameCity) {
    const name = id.name?.trim();
    const city = id.city?.trim();
    if (name && city) {
      const { data } = await base().ilike('name', name).ilike('city', city).maybeSingle();
      if (data) return data as MatchedLead;
    }
  }
  return null;
}

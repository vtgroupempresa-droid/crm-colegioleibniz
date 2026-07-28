import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assignLeadRoundRobin } from '@/lib/leads/distribution';
import { notifyLeadCreated } from '@/actions/notifications';
import {
  EDUCATION_LEVELS,
  INTEREST_LEVELS,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  PAID_LEAD_SOURCES,
  parseMetaLeadEntries,
  type EducationLevel,
  type InterestLevel,
  type Lead,
  type LeadInsert,
  type LeadSource,
  type MetaFormAnswer,
  type MetaLeadEntry,
} from '@/types/lead';
import type { Database, Json } from '@/types/database';
import type { PipelineKind } from '@/types/pipeline';
import type { MappableLeadField } from '@/types/webhooks';
import { findLeadByIdentity, normalizePhone, type LeadIdentity } from '@/lib/leads/identity';
import { checkNewLeadNameDuplicates } from '@/lib/leads/duplicate-detection';
import { reactivateLeadOnInbound } from '@/lib/leads/reactivation';
import { mergeTags } from './tag-rules';

type DbClient = SupabaseClient<Database>;

/**
 * Atribuição real de anúncios Meta (campos do payload leadgen + Graph API).
 * Fonte primária de atribuição — o campaign-parser virou fallback.
 */
export interface MetaAttribution {
  adId?: string | null;
  adName?: string | null;
  adsetId?: string | null;
  adsetName?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  formId?: string | null;
  formName?: string | null;
  /** Respostas completas do formulário (todas as perguntas, inclusive as de qualificação). */
  formAnswers?: MetaFormAnswer[] | null;
}

/** Colunas meta_* correspondentes — só as preenchidas (não apaga existentes). */
function attributionColumns(attr: MetaAttribution | undefined): Partial<LeadInsert> {
  if (!attr) return {};
  return {
    ...(attr.adId ? { meta_ad_id: attr.adId } : {}),
    ...(attr.adName ? { meta_ad_name: attr.adName } : {}),
    ...(attr.adsetId ? { meta_adset_id: attr.adsetId } : {}),
    ...(attr.adsetName ? { meta_adset_name: attr.adsetName } : {}),
    ...(attr.campaignId ? { meta_campaign_id: attr.campaignId } : {}),
    ...(attr.campaignName ? { meta_campaign_name: attr.campaignName } : {}),
    ...(attr.formId ? { meta_form_id: attr.formId } : {}),
    ...(attr.formName ? { meta_form_name: attr.formName } : {}),
    ...(attr.formAnswers && attr.formAnswers.length > 0
      ? { meta_form_answers: attr.formAnswers.map((a) => ({ ...a })) }
      : {}),
  };
}

export interface IngestInput {
  /** Campos texto resolvidos pelo field_mapping/parser. */
  values: Partial<Record<MappableLeadField, string>>;
  /** Campos numéricos resolvidos (child_age). */
  numbers: Partial<Record<MappableLeadField, number>>;
  /** Tags geradas (campaign-parser + tag_rules). */
  tags: string[];
  /** Origem default da fonte (usada se o mapeamento não trouxe `source`). */
  defaultSource: LeadSource;
  pipeline: PipelineKind;
  stage: string;
  /** Rótulo legível da fonte para activities/notificações. */
  sourceName: string;
  /** Identificadores cross-canal (IGSID / Facebook user id) p/ unificação. */
  identity?: LeadIdentity;
  /** Habilita matching fuzzy por nome+cidade (eventos Meta). Default false. */
  matchNameCity?: boolean;
  /** Atribuição real de anúncios Meta (leadgen) — colunas meta_*. */
  attribution?: MetaAttribution;
  /**
   * Snapshot desta entrada de Meta Lead Ads (append-only em leads.meta_entries).
   * Só o leadgen preenche. `kind` é definido aqui: 'first' no lead novo,
   * 'reentry' quando o lead já existe. Dedup por `leadgenId` (webhook reprocessa).
   * As colunas meta_* seguem guardando a ÚLTIMA entrada; o histórico fica aqui.
   */
  metaEntry?: MetaLeadEntry | null;
  /**
   * Reativação por contato espontâneo: rótulo do canal ("novo formulário",
   * "WhatsApp"...). Quando definido E o evento casa um lead já existente, o
   * lead volta para comercial/novo_lead. Só deve ser passado por callers em que
   * o LEAD iniciou o contato (form/inbound) — NUNCA em ações manuais do time
   * (ex.: converter conversa em lead).
   */
  reactivationChannel?: string;
  /**
   * Entrada DECLARADA: o evento é um formulário/webhook preenchido pelo lead
   * (site, Meta Lead Ads) — não uma mensagem. A reativação então IGNORA a
   * janela de 15 dias de silêncio e devolve o lead à fila de ENTRADA DA FONTE
   * (`pipeline`/`stage` deste input). Callers de mensagem inbound
   * (WhatsApp/Instagram) NÃO devem ligar isto.
   */
  reactivationDeclared?: boolean;
  /**
   * Responsável fixo para o lead NOVO, ignorando o round-robin.
   * `undefined` = distribuição normal; `null` = sem responsável de propósito.
   * Não reatribui leads já existentes (a unificação preserva o dono).
   */
  assignedToOverride?: string | null;
  /**
   * Campos tipados extras vindos de formulário: with_child, child_age,
   * education_level, interest_level etc. Aplicados no insert (lead novo) e no
   * update (lead existente).
   */
  extraFields?: Partial<LeadInsert>;
}

export interface IngestResult {
  leadId: string;
  assignedTo: string | null;
  duplicate: boolean;
}

function coerceEducationLevel(value: string | undefined): EducationLevel | null {
  if (value && (EDUCATION_LEVELS as readonly string[]).includes(value)) {
    return value as EducationLevel;
  }
  return null;
}

function coerceInterestLevel(value: string | undefined): InterestLevel | null {
  if (value && (INTEREST_LEVELS as readonly string[]).includes(value)) {
    return value as InterestLevel;
  }
  return null;
}

/** "sim"/"true"/"1" → true · "nao"/"não"/"false"/"0" → false · resto → null. */
function coerceBoolean(value: string | undefined): boolean | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (['sim', 'true', '1', 'yes'].includes(v)) return true;
  if (['nao', 'não', 'false', '0', 'no'].includes(v)) return false;
  return null;
}

function coerceSource(value: string | undefined, fallback: LeadSource): LeadSource {
  if (value && (LEAD_SOURCES as readonly string[]).includes(value)) {
    return value as LeadSource;
  }
  return fallback;
}

/**
 * Cria OU atualiza um lead a partir de dados já mapeados.
 *
 * Compartilhado pelo endpoint no-code (/api/webhooks/receive/[slug]) e pelo
 * Meta Lead Ads. Sempre produção (is_demo=false). Fluxo:
 *  - dedup por identidade (IG/FB/phone/email) entre leads não arquivados;
 *  - se existir → atualiza campos mapeados + merge de tags (duplicate=true);
 *  - se não → distribui por round-robin, insere, loga e notifica.
 */
export async function ingestLead(admin: DbClient, input: IngestInput): Promise<IngestResult> {
  const { values, numbers, tags, defaultSource, pipeline, stage, sourceName } = input;

  const phone = values.phone?.trim() || null;
  const email = values.email?.trim() || null;
  const name = values.name?.trim() || phone || email || 'Lead sem nome';
  const educationLevel = coerceEducationLevel(values.education_level);
  const interestLevel = coerceInterestLevel(values.interest_level);
  const withChild = coerceBoolean(values.with_child);
  const childAge = numbers.child_age != null ? Math.trunc(numbers.child_age) : null;
  const source = coerceSource(values.source, defaultSource);
  const igUserId = input.identity?.instagramUserId ?? null;
  const fbUserId = input.identity?.facebookUserId ?? null;

  // 1. Unificação por identidade cross-canal: instagram_user_id →
  //    facebook_user_id → phone normalizado → email → nome+cidade (opcional).
  const existing = await findLeadByIdentity(
    admin,
    {
      instagramUserId: igUserId,
      facebookUserId: fbUserId,
      phone,
      email,
      name,
      city: values.city ?? null,
    },
    { fuzzyNameCity: input.matchNameCity ?? false },
  );

  if (existing) {
    const mergedTags = mergeTags(existing.tags ?? [], tags);
    // Adicionou um identificador de canal que o lead ainda não tinha?
    const addedInstagram = Boolean(igUserId && !existing.instagram_user_id);
    const addedFacebook = Boolean(fbUserId && !existing.facebook_user_id);
    // Histórico de entradas Meta (append-only): a reentrada vira um snapshot
    // 'reentry'. Dedup por leadgenId (o webhook pode reprocessar o mesmo lead).
    const existingEntries = parseMetaLeadEntries(existing.meta_entries);
    const alreadyLogged = Boolean(
      input.metaEntry?.leadgenId &&
        existingEntries.some((e) => e.leadgenId === input.metaEntry!.leadgenId),
    );
    const appendEntry = Boolean(input.metaEntry) && !alreadyLogged;
    const nextEntries: MetaLeadEntry[] = appendEntry
      ? [...existingEntries, { ...input.metaEntry!, kind: 'reentry' }]
      : existingEntries;
    const update: Partial<LeadInsert> = {
      tags: mergedTags,
      ...(addedInstagram ? { instagram_user_id: igUserId } : {}),
      ...(addedFacebook ? { facebook_user_id: fbUserId } : {}),
      ...(values.instagram && !existing.instagram ? { instagram: values.instagram } : {}),
      ...(phone && !existing.phone ? { phone, phone_normalized: normalizePhone(phone) } : {}),
      ...(email && !existing.email ? { email } : {}),
      ...(values.city ? { city: values.city } : {}),
      ...(values.state ? { state: values.state } : {}),
      ...(values.ad_creative ? { ad_creative: values.ad_creative } : {}),
      ...(values.landing_page ? { landing_page: values.landing_page } : {}),
      ...(values.utm_source ? { utm_source: values.utm_source } : {}),
      ...(values.utm_medium ? { utm_medium: values.utm_medium } : {}),
      ...(values.utm_campaign ? { utm_campaign: values.utm_campaign } : {}),
      ...(values.utm_content ? { utm_content: values.utm_content } : {}),
      // Dados do aluno: novo formulário atualiza o que veio preenchido.
      ...(values.child_name ? { child_name: values.child_name } : {}),
      ...(childAge != null ? { child_age: childAge } : {}),
      ...(educationLevel ? { education_level: educationLevel } : {}),
      ...(values.school_year ? { school_year: values.school_year } : {}),
      ...(interestLevel ? { interest_level: interestLevel } : {}),
      ...(withChild != null ? { with_child: withChild } : {}),
      // Origem PROMOVIDA quando o lead reaparece por mídia paga (Meta Ads): um
      // lead antigo que preenche um novo Lead Ad passa a ser atribuído
      // corretamente à mídia paga que o retrouxe. Só sobrescreve para fontes
      // pagas (nunca "rebaixa" um lead pago para whatsapp/orgânico).
      ...(PAID_LEAD_SOURCES.includes(source) ? { source } : {}),
      ...(input.extraFields ?? {}),
      ...attributionColumns(input.attribution),
      // Reentrada Meta: acrescenta o snapshot ao histórico (não sobrescreve).
      ...(appendEntry ? { meta_entries: nextEntries as unknown as Json } : {}),
    };
    await admin.from('leads').update(update).eq('id', existing.id);

    const channelLabel = addedInstagram ? 'Instagram' : addedFacebook ? 'Facebook' : null;
    // Reentrada via Meta Ads: atribuição real chega no `attribution` (só o leadgen
    // preenche campaign/form) — registra uma activity específica e legível.
    const metaReentry = Boolean(input.attribution?.campaignName || input.attribution?.formName);
    const activityTitle = metaReentry
      ? 'Reativado via Meta Ads'
      : channelLabel
        ? 'Lead unificado'
        : 'Recebimento duplicado via webhook';
    const activityDescription = metaReentry
      ? `Reativado via Meta Ads — Campanha: ${input.attribution?.campaignName ?? '—'} · Formulário: ${input.attribution?.formName ?? '—'}`
      : channelLabel
        ? `Lead unificado: contato adicional via ${channelLabel} (${sourceName})`
        : `Fonte: ${sourceName} · lead já existente atualizado`;
    await admin.from('activities').insert({
      lead_id: existing.id,
      user_id: null,
      type: 'system',
      title: activityTitle,
      description: activityDescription,
      is_demo: false,
      metadata: {
        via: 'webhook',
        source,
        tags: mergedTags,
        unified_channel: channelLabel,
        meta_reentry: metaReentry,
      },
    });

    // Reativação por contato espontâneo: se o LEAD reapareceu por iniciativa
    // própria (form/inbound), volta para comercial/novo_lead mantendo todo o
    // histórico. `reactivationChannel` só vem de callers lead-initiated.
    if (input.reactivationChannel) {
      await reactivateLeadOnInbound(admin, existing.id, input.reactivationChannel, {
        // Entrada declarada: sem janela de silêncio e destino = fila da fonte.
        ...(input.reactivationDeclared
          ? { declaredEntry: true, entryPipeline: pipeline, entryStage: stage }
          : {}),
      });
    }

    return {
      leadId: existing.id,
      assignedTo: existing.assigned_to,
      duplicate: true,
    };
  }

  // 2. Distribuição. Precedência:
  //    a) assignedToOverride: responsável fixo, sem round-robin.
  //    b) Demais fontes — INCLUSIVE Meta Ads — seguem o round-robin por menor
  //       carga entre a equipe comercial.
  const hasOverride = input.assignedToOverride !== undefined;
  const assignment = hasOverride
    ? { assignedTo: input.assignedToOverride ?? null, assignedName: null }
    : await assignLeadRoundRobin(admin);

  const insert: LeadInsert = {
    name,
    phone,
    // A coluna crua não casa nada: findLeadByIdentity procura o lead por
    // phone_normalized. Sem preencher aqui, todo lead nascido de webhook
    // (WhatsApp, Instagram, Lead Ads) fica invisível para o match por telefone
    // e a mesma pessoa vira um lead novo a cada canal.
    phone_normalized: normalizePhone(phone),
    email,
    instagram: values.instagram ?? null,
    instagram_user_id: igUserId,
    facebook_user_id: fbUserId,
    city: values.city ?? null,
    state: values.state ?? null,
    child_name: values.child_name ?? null,
    child_age: childAge,
    education_level: educationLevel,
    school_year: values.school_year ?? null,
    interest_level: interestLevel,
    with_child: withChild,
    source,
    utm_source: values.utm_source ?? null,
    utm_medium: values.utm_medium ?? null,
    utm_campaign: values.utm_campaign ?? null,
    utm_content: values.utm_content ?? null,
    utm_term: values.utm_term ?? null,
    ad_creative: values.ad_creative ?? null,
    landing_page: values.landing_page ?? null,
    tags,
    pipeline,
    stage,
    assigned_to: assignment.assignedTo,
    is_demo: false,
    ...(input.extraFields ?? {}),
    ...attributionColumns(input.attribution),
    // 1ª entrada Meta: inicia o histórico append-only de meta_entries.
    ...(input.metaEntry
      ? { meta_entries: [{ ...input.metaEntry, kind: 'first' }] as unknown as Json }
      : {}),
  };

  const { data: created, error } = await admin
    .from('leads')
    .insert(insert)
    .select('id, name, assigned_to')
    .single();

  if (error || !created) {
    throw new Error(error?.message ?? 'Falha ao criar lead');
  }

  // 3. Activities de criação e distribuição.
  const sourceLabel = LEAD_SOURCE_LABELS[source];
  await admin.from('activities').insert([
    {
      lead_id: created.id,
      user_id: null,
      type: 'system',
      title: 'Lead criado via webhook',
      description: `Fonte: ${sourceName}${tags.length ? ` · Tags: ${tags.join(', ')}` : ''}`,
      is_demo: false,
      metadata: { via: 'webhook', source, tags },
    },
    {
      lead_id: created.id,
      user_id: null,
      type: 'system',
      title: hasOverride ? 'Responsável definido pela fonte' : 'Distribuição automática',
      description: hasOverride
        ? assignment.assignedTo
          ? `Responsável fixo definido pela fonte (${sourceName}).`
          : `Fonte sem responsável definido (${sourceName}).`
        : assignment.assignedName
          ? `Distribuído para ${assignment.assignedName} (round-robin por menor carga).`
          : 'Sem responsável — nenhum usuário disponível para distribuição.',
      is_demo: false,
      metadata: {
        assigned_to: assignment.assignedTo,
        auto_assign: !hasOverride,
      },
    },
  ]);

  // 4. Checagem contínua de duplicata por similaridade de NOME: o lead novo não
  //    casou com ninguém pelas camadas de identidade (instagram/facebook/phone/
  //    email), mas pode ser a mesma pessoa cadastrada com outro contato.
  //    Compara o nome normalizado contra os leads recentes e, se achar candidato
  //    (nome similar + sinal de apoio), registra par pendente em
  //    duplicate_candidates para revisão humana no /admin. Nunca bloqueia nem
  //    impede a criação (não lança). activityCount 2 = as duas activities de
  //    sistema recém-inseridas acima.
  await checkNewLeadNameDuplicates(admin, {
    id: created.id,
    name,
    phone,
    email,
    city: values.city ?? null,
    state: values.state ?? null,
    createdAt: new Date().toISOString(),
    activityCount: 2,
  });

  // 5. Notificações (responsável ou admins).
  await notifyLeadCreated({
    leadId: created.id,
    name: created.name,
    assignedTo: created.assigned_to,
    sourceLabel,
    isDemo: false,
  });

  return {
    leadId: created.id,
    assignedTo: created.assigned_to,
    duplicate: false,
  };
}

/** Reexport conveniente para o caller. */
export type { Lead };

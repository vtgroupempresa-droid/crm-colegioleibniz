import type { SupabaseClient } from '@supabase/supabase-js';
import { parseCampaignName, campaignAdCreative } from '@/lib/webhooks/campaign-parser';
import { mergeTags } from '@/lib/webhooks/tag-rules';
import { normalizePhone } from '@/lib/leads/identity';
import { getOrCreateMetaSource } from './source';
import {
  EDUCATION_LEVELS,
  LEAD_SOURCES,
  type EducationLevel,
  type LeadInsert,
  type LeadSource,
} from '@/types/lead';
import type { Database } from '@/types/database';
import type { PipelineKind } from '@/types/pipeline';
import type { MappableLeadField } from '@/types/webhooks';

type DbClient = SupabaseClient<Database>;

/**
 * Núcleo da importação histórica de Lead Ads do Meta.
 *
 * IMPORTANTE: este módulo é livre de Next (sem next/headers, sem 'server-only',
 * sem Server Actions) para poder rodar tanto num script CLI quanto na Server
 * Action da tela /integracoes. Recebe sempre um admin client já criado pelo
 * chamador.
 *
 * Diferente dos Lead Ads que chegam pelo webhook em tempo real (distribuídos
 * automaticamente), os leads HISTÓRICOS importados entram SEM responsável na
 * etapa de Follow-Up para a equipe requalificar (default configurável).
 */

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';
const IMPORT_TAG = 'importado-meta';

export interface ImportOptions {
  token: string;
  pageId: string;
  /** Importa apenas deste formulário. */
  formId?: string | null;
  /** Apenas leads criados a partir desta data (YYYY-MM-DD). */
  since?: string | null;
  /** Limita o total processado (para testes). */
  limit?: number | null;
  pipeline: PipelineKind;
  stage: string;
  /** Não grava nada — só simula e devolve o relatório. */
  dryRun: boolean;
}

export interface FormSummary {
  id: string;
  name: string;
  status: string;
  leadsCount: number | null;
  lastLeadAt: string | null;
}

export interface ImportFormReport {
  formId: string;
  formName: string;
  found: number;
  inserted: number;
  duplicates: number;
  errors: number;
}

export interface ImportError {
  leadName: string;
  formName: string;
  reason: string;
}

export interface ImportReport {
  totalFound: number;
  inserted: number;
  duplicates: number;
  errors: ImportError[];
  byForm: ImportFormReport[];
  dryRun: boolean;
}

export type ImportProgress = {
  processed: number;
  total: number;
  inserted: number;
  duplicates: number;
  errors: number;
  currentForm: string;
};

interface GraphLeadgenField {
  name: string;
  values?: string[];
}

interface GraphLead {
  id?: string;
  created_time?: string;
  ad_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  field_data?: GraphLeadgenField[];
}

interface GraphError {
  error?: { message?: string };
}

/** GET tipado na Graph API com tratamento de erro uniforme. */
async function graphGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = (await res.json().catch(() => ({}))) as T & GraphError;
  if (!res.ok) {
    throw new Error(json.error?.message ?? `Graph API HTTP ${res.status}`);
  }
  return json;
}

/**
 * Resolve o Page Access Token a partir do token fornecido.
 *
 * As edges leadgen_forms / leads exigem um Page Access Token (Graph #190).
 * O token configurado (INSTAGRAM_ACCESS_TOKEN) é um User Token de System User
 * com pages_show_list — então derivamos o page token via GET /{pageId}.
 * Se já for um page token (ou a derivação falhar), devolve o token original.
 */
async function resolvePageAccessToken(token: string, pageId: string): Promise<string> {
  try {
    const res = await graphGet<{ access_token?: string }>(
      `${GRAPH_BASE}/${pageId}?fields=access_token&access_token=${encodeURIComponent(token)}`,
    );
    return res.access_token ?? token;
  } catch {
    return token;
  }
}

function coerceEducationLevel(value: string | undefined): EducationLevel | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if ((EDUCATION_LEVELS as readonly string[]).includes(normalized)) {
    return normalized as EducationLevel;
  }
  // Formulários do Meta trazem o rótulo por extenso ("Ensino Médio") — mapeia
  // pelo texto para não perder a qualificação que a família já respondeu.
  if (normalized.includes('infantil')) return 'infantil';
  if (normalized.includes('fundamental')) {
    return /(6|7|8|9)|ii|2/.test(normalized) ? 'fundamental_2' : 'fundamental_1';
  }
  if (normalized.includes('médio') || normalized.includes('medio')) return 'medio';
  if (normalized.includes('enem') || normalized.includes('pré') || normalized.includes('pre'))
    return 'pre_enem';
  return null;
}

function coerceSource(value: string | undefined, fallback: LeadSource): LeadSource {
  if (value && (LEAD_SOURCES as readonly string[]).includes(value)) return value as LeadSource;
  return fallback;
}

/** Lista os formulários da página com contagem e data do último lead (UI). */
export async function listFormsWithCounts(token: string, pageId: string): Promise<FormSummary[]> {
  const pageToken = await resolvePageAccessToken(token, pageId);
  const formsUrl = `${GRAPH_BASE}/${pageId}/leadgen_forms?fields=id,name,status&limit=100&access_token=${encodeURIComponent(pageToken)}`;
  const formsRes = await graphGet<{ data?: { id: string; name: string; status?: string }[] }>(
    formsUrl,
  );
  const forms = formsRes.data ?? [];

  const summaries = await Promise.all(
    forms.map(async (form): Promise<FormSummary> => {
      try {
        const metaUrl = `${GRAPH_BASE}/${form.id}/leads?fields=created_time&limit=1&summary=true&access_token=${encodeURIComponent(pageToken)}`;
        const res = await graphGet<{
          data?: { created_time?: string }[];
          summary?: { total_count?: number };
        }>(metaUrl);
        return {
          id: form.id,
          name: form.name,
          status: form.status ?? 'UNKNOWN',
          leadsCount: res.summary?.total_count ?? null,
          lastLeadAt: res.data?.[0]?.created_time ?? null,
        };
      } catch {
        return {
          id: form.id,
          name: form.name,
          status: form.status ?? 'UNKNOWN',
          leadsCount: null,
          lastLeadAt: null,
        };
      }
    }),
  );

  return summaries;
}

/** Pagina os leads de um formulário, parando em `since` ou no `limit`. */
async function fetchFormLeads(
  token: string,
  formId: string,
  since: Date | null,
  remaining: number,
): Promise<GraphLead[]> {
  const fields = 'field_data,created_time,ad_id,campaign_id,campaign_name';
  let url: string | null = `${GRAPH_BASE}/${formId}/leads?fields=${fields}&limit=100&access_token=${encodeURIComponent(token)}`;
  const out: GraphLead[] = [];

  while (url && out.length < remaining) {
    const res: { data?: GraphLead[]; paging?: { next?: string } } = await graphGet<{
      data?: GraphLead[];
      paging?: { next?: string };
    }>(url);
    const batch = res.data ?? [];

    for (const lead of batch) {
      if (since && lead.created_time && new Date(lead.created_time) < since) {
        // Leads vêm do mais recente p/ o mais antigo — passou do corte, encerra.
        return out;
      }
      out.push(lead);
      if (out.length >= remaining) return out;
    }

    url = res.paging?.next ?? null;
  }

  return out;
}

/** Resolve o nome da campanha (cache por id) — usa campaign_name se já veio. */
async function resolveCampaignName(
  token: string,
  lead: GraphLead,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (lead.campaign_name) return lead.campaign_name;
  const id = lead.campaign_id;
  if (!id) return null;
  if (cache.has(id)) return cache.get(id) ?? null;

  try {
    const res = await graphGet<{ name?: string }>(
      `${GRAPH_BASE}/${id}?fields=name&access_token=${encodeURIComponent(token)}`,
    );
    const name = res.name ?? null;
    cache.set(id, name);
    return name;
  } catch {
    cache.set(id, null);
    return null;
  }
}

/** Mapeia field_data do Meta → campos do lead. */
function mapFieldData(fieldData: GraphLeadgenField[]): {
  values: Partial<Record<MappableLeadField, string>>;
  numbers: Partial<Record<MappableLeadField, number>>;
} {
  const values: Partial<Record<MappableLeadField, string>> = {};
  const numbers: Partial<Record<MappableLeadField, number>> = {};

  for (const field of fieldData) {
    const value = field.values?.[0];
    if (!value) continue;
    switch (field.name) {
      case 'full_name':
      case 'name':
        values.name = value;
        break;
      case 'phone_number':
      case 'phone':
        values.phone = value;
        break;
      case 'email':
        values.email = value;
        break;
      case 'city':
        values.city = value;
        break;
      case 'state':
        values.state = value;
        break;
      case 'company_name':
      case 'child_name':
      case 'nome_do_aluno':
        values.child_name = value;
        break;
      case 'education_level':
      case 'nivel_de_ensino':
        values.education_level = value;
        break;
      case 'school_year':
      case 'ano_escolar':
        values.school_year = value;
        break;
      default:
        break;
    }
  }

  return { values, numbers };
}

interface PersistResult {
  status: 'inserted' | 'duplicate' | 'error';
  reason?: string;
}

/** Cria o lead histórico (sem responsável) + activities + score + webhook_log. */
async function persistLead(
  admin: DbClient,
  sourceId: string,
  lead: GraphLead,
  formName: string,
  pipeline: PipelineKind,
  stage: string,
  campaignName: string | null,
): Promise<PersistResult> {
  const started = Date.now();
  const { values } = mapFieldData(lead.field_data ?? []);

  const parsed = parseCampaignName(campaignName);
  const adCreative = campaignAdCreative(parsed);
  if (adCreative) values.ad_creative = adCreative;
  if (parsed.campaign_theme) values.utm_campaign = parsed.campaign_theme;

  const tags = mergeTags(
    [IMPORT_TAG],
    parsed.raw_tags,
    parsed.campaign_theme ? [parsed.campaign_theme] : [],
  );

  const phone = values.phone?.trim() || null;
  const email = values.email?.trim() || null;
  const name = values.name?.trim() || phone || email || 'Lead importado';
  const educationLevel = coerceEducationLevel(values.education_level);
  const source = coerceSource(values.source, 'meta_ads');

  // Deduplicação por phone/email (leads não arquivados).
  const orFilters: string[] = [];
  if (phone) orFilters.push(`phone.eq.${phone}`);
  if (email) orFilters.push(`email.eq.${email}`);

  if (orFilters.length > 0) {
    const { data: existing } = await admin
      .from('leads')
      .select('id, tags')
      .eq('is_archived', false)
      .or(orFilters.join(','))
      .limit(1)
      .maybeSingle();

    if (existing) {
      const mergedTags = mergeTags(existing.tags ?? [], tags);
      await admin.from('leads').update({ tags: mergedTags }).eq('id', existing.id);
      await admin.from('webhook_logs').insert({
        source_id: sourceId,
        status: 'duplicate',
        lead_id: existing.id,
        processing_time_ms: Date.now() - started,
        payload: { via: 'import-meta', form: formName, leadgen_id: lead.id ?? null, name },
      });
      return { status: 'duplicate' };
    }
  }

  const insert: LeadInsert = {
    name,
    phone,
    // Mesma razão do ingest: o match por telefone lê phone_normalized.
    phone_normalized: normalizePhone(phone),
    email,
    child_name: values.child_name ?? null,
    education_level: educationLevel,
    school_year: values.school_year ?? null,
    city: values.city ?? null,
    state: values.state ?? null,
    source,
    utm_campaign: values.utm_campaign ?? null,
    ad_creative: values.ad_creative ?? null,
    tags,
    pipeline,
    stage,
    assigned_to: null,
    is_demo: false,
  };

  const { data: created, error } = await admin
    .from('leads')
    .insert(insert)
    .select('id')
    .single();

  if (error || !created) {
    await admin.from('webhook_logs').insert({
      source_id: sourceId,
      status: 'error',
      processing_time_ms: Date.now() - started,
      error_message: error?.message ?? 'Falha ao inserir lead',
      payload: { via: 'import-meta', form: formName, leadgen_id: lead.id ?? null, name },
    });
    return { status: 'error', reason: error?.message ?? 'Falha ao inserir lead' };
  }

  await admin.from('activities').insert({
    lead_id: created.id,
    user_id: null,
    type: 'system',
    title: 'Lead importado do Meta (histórico)',
    description: `Formulário: ${formName}${tags.length ? ` · Tags: ${tags.join(', ')}` : ''}`,
    is_demo: false,
    metadata: {
      via: 'import-meta',
      form: formName,
      leadgen_id: lead.id ?? null,
      created_time: lead.created_time ?? null,
      campaign: campaignName,
    },
  });

  await admin.from('webhook_logs').insert({
    source_id: sourceId,
    status: 'success',
    lead_id: created.id,
    processing_time_ms: Date.now() - started,
    payload: { via: 'import-meta', form: formName, leadgen_id: lead.id ?? null, name },
  });

  return { status: 'inserted' };
}

/**
 * Importa leads históricos do Meta Lead Ads. Em dry-run, apenas conta e
 * detecta duplicatas sem gravar. Chama `onProgress` a cada lead processado.
 */
export async function importMetaLeads(
  admin: DbClient,
  options: ImportOptions,
  onProgress?: (p: ImportProgress) => void | Promise<void>,
): Promise<ImportReport> {
  const { token, pageId, formId, since, limit, pipeline, stage, dryRun } = options;
  const sinceDate = since ? new Date(since) : null;
  const maxLeads = limit && limit > 0 ? limit : Number.POSITIVE_INFINITY;

  // As edges de página/formulário/leads exigem Page Access Token; o ads lookup
  // (resolveCampaignName) continua com o user token (ads_read).
  const pageToken = await resolvePageAccessToken(token, pageId);

  // 1. Resolve formulários a importar.
  let forms: { id: string; name: string }[];
  if (formId) {
    const res = await graphGet<{ id?: string; name?: string }>(
      `${GRAPH_BASE}/${formId}?fields=id,name&access_token=${encodeURIComponent(pageToken)}`,
    );
    forms = [{ id: res.id ?? formId, name: res.name ?? formId }];
  } else {
    const list = await graphGet<{ data?: { id: string; name: string }[] }>(
      `${GRAPH_BASE}/${pageId}/leadgen_forms?fields=id,name&limit=100&access_token=${encodeURIComponent(pageToken)}`,
    );
    forms = list.data ?? [];
  }

  // 2. Coleta os leads de cada formulário (respeitando since + limite global).
  const collected: { lead: GraphLead; formName: string }[] = [];
  for (const form of forms) {
    if (collected.length >= maxLeads) break;
    const remaining = maxLeads === Number.POSITIVE_INFINITY ? 1000 : maxLeads - collected.length;
    const leads = await fetchFormLeads(pageToken, form.id, sinceDate, remaining);
    for (const lead of leads) {
      if (collected.length >= maxLeads) break;
      collected.push({ lead, formName: form.name });
    }
  }

  // 3. Processa cada lead.
  const sourceId = dryRun ? '' : await getOrCreateMetaSource(admin);
  const campaignCache = new Map<string, string | null>();
  const byForm = new Map<string, ImportFormReport>();
  const errors: ImportError[] = [];
  let inserted = 0;
  let duplicates = 0;

  function formReport(name: string): ImportFormReport {
    let rep = byForm.get(name);
    if (!rep) {
      rep = { formId: '', formName: name, found: 0, inserted: 0, duplicates: 0, errors: 0 };
      byForm.set(name, rep);
    }
    return rep;
  }

  for (let i = 0; i < collected.length; i += 1) {
    const entry = collected[i];
    if (!entry) continue;
    const { lead, formName } = entry;
    const rep = formReport(formName);
    rep.found += 1;

    const campaignName = await resolveCampaignName(token, lead, campaignCache);
    const leadName =
      lead.field_data?.find((f) => f.name === 'full_name' || f.name === 'name')?.values?.[0] ??
      'Lead importado';

    try {
      if (dryRun) {
        // Em dry-run detectamos duplicatas mas não gravamos.
        const { values } = mapFieldData(lead.field_data ?? []);
        const phone = values.phone?.trim() || null;
        const email = values.email?.trim() || null;
        const orFilters: string[] = [];
        if (phone) orFilters.push(`phone.eq.${phone}`);
        if (email) orFilters.push(`email.eq.${email}`);
        let isDup = false;
        if (orFilters.length > 0) {
          const { data: existing } = await admin
            .from('leads')
            .select('id')
            .eq('is_archived', false)
            .or(orFilters.join(','))
            .limit(1)
            .maybeSingle();
          isDup = Boolean(existing);
        }
        if (isDup) {
          duplicates += 1;
          rep.duplicates += 1;
        } else {
          inserted += 1;
          rep.inserted += 1;
        }
      } else {
        const result = await persistLead(
          admin,
          sourceId,
          lead,
          formName,
          pipeline,
          stage,
          campaignName,
        );
        if (result.status === 'inserted') {
          inserted += 1;
          rep.inserted += 1;
        } else if (result.status === 'duplicate') {
          duplicates += 1;
          rep.duplicates += 1;
        } else {
          rep.errors += 1;
          errors.push({ leadName, formName, reason: result.reason ?? 'erro' });
        }
      }
    } catch (err) {
      rep.errors += 1;
      errors.push({
        leadName,
        formName,
        reason: err instanceof Error ? err.message : 'erro desconhecido',
      });
    }

    if (onProgress) {
      await onProgress({
        processed: i + 1,
        total: collected.length,
        inserted,
        duplicates,
        errors: errors.length,
        currentForm: formName,
      });
    }
  }

  return {
    totalFound: collected.length,
    inserted,
    duplicates,
    errors,
    byForm: [...byForm.values()],
    dryRun,
  };
}

import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { ResolvedPeriod } from '@/lib/dashboard/period';
import type { InterestLevel, LeadSource } from '@/types/lead';
import type { LeadAuditRow } from '@/types/dashboard';

/**
 * Rastreio lead a lead (/dashboard/leads-detalhado). Diferente das seções
 * agregadas, aqui a paginação/busca acontece no banco — a tela é uma auditoria
 * individual, não uma agregação em memória.
 */

export const LEADS_AUDIT_PAGE_SIZE = 50;

export interface LeadsAuditResult {
  rows: LeadAuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getLeadsAudit(opts: {
  isDemo?: boolean;
  period: ResolvedPeriod;
  search?: string;
  source?: LeadSource;
  page?: number;
}): Promise<LeadsAuditResult> {
  const supabase = createClient();
  const isDemo = opts.isDemo ?? false;
  const page = Math.max(1, opts.page ?? 1);
  const from = (page - 1) * LEADS_AUDIT_PAGE_SIZE;

  let query = supabase
    .from('leads')
    .select(
      'id, name, source, created_at, pipeline, stage, interest_level, assigned_to, meta_campaign_name, utm_source',
      { count: 'exact' },
    )
    .eq('is_demo', isDemo)
    .gte('created_at', opts.period.start.toISOString())
    .lt('created_at', opts.period.end.toISOString());

  if (opts.search) {
    // Escapa % e _ para a busca ser literal.
    const term = opts.search.replace(/[%_]/g, (c) => `\\${c}`);
    query = query.ilike('name', `%${term}%`);
  }
  if (opts.source) query = query.eq('source', opts.source);

  const { data, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + LEADS_AUDIT_PAGE_SIZE - 1);

  const leads = (data ?? []) as {
    id: string;
    name: string;
    source: LeadSource | null;
    created_at: string;
    pipeline: string;
    stage: string;
    interest_level: InterestLevel | null;
    assigned_to: string | null;
    meta_campaign_name: string | null;
    utm_source: string | null;
  }[];

  // Resolve nomes dos responsáveis numa query só.
  const assigneeIds = Array.from(new Set(leads.map((l) => l.assigned_to).filter((v): v is string => !!v)));
  const nameById = new Map<string, string>();
  if (assigneeIds.length > 0) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, name')
      .in('id', assigneeIds);
    for (const p of profiles ?? []) nameById.set(p.id, p.name);
  }

  const rows: LeadAuditRow[] = leads.map((l) => ({
    id: l.id,
    name: l.name,
    source: l.source,
    createdAt: l.created_at,
    pipeline: l.pipeline,
    stage: l.stage,
    interestLevel: l.interest_level,
    assignedName: l.assigned_to ? (nameById.get(l.assigned_to) ?? null) : null,
    channelDetail: l.meta_campaign_name ?? l.utm_source,
  }));

  return { rows, total: count ?? rows.length, page, pageSize: LEADS_AUDIT_PAGE_SIZE };
}

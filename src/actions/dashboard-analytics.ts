import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/fetch-all-rows';
import { monthsCovered, type ResolvedPeriod } from '@/lib/dashboard/period';
import { validateRequiredFields } from '@/lib/leads/validators';
import {
  EDUCATION_LEVELS,
  EDUCATION_LEVEL_LABELS,
  LEAD_SOURCES,
  type Lead,
} from '@/types/lead';
import type {
  CloserLostItem,
  CloserRow,
  DashboardConfig,
  DashboardData,
  EducationLevelRow,
  FunnelStage,
  HighInterestData,
  HighInterestLeadRow,
  KpiValue,
  LostReasonItem,
  SalesCycleData,
  SalesCycleLevelRow,
  SdrRow,
  SourceRow,
} from '@/types/dashboard';

/**
 * Queries analíticas do Dashboard.
 *
 * Estratégia: uma única rodada de SELECTs (filtrados por `is_demo`), e toda a
 * agregação acontece em TypeScript. O volume desse CRM (escola, praça única)
 * cabe tranquilamente em memória e isso mantém o código testável e a tipagem
 * forte, no mesmo estilo de `dashboard-queries.ts`.
 *
 * Atribuição de trabalho:
 *  - Atendimento → quem registrou a `contact_attempt` (`created_by`).
 *  - Fechamento → `assigned_to` em `appointments` / `closed_by` em `deals`.
 */

// ----------------------------------------------------------------------------
// Helpers numéricos
// ----------------------------------------------------------------------------

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

function avgOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Variação fracionária cur vs prev. null quando não comparável. */
function deltaPct(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev === 0) return null;
  return (cur - prev) / prev;
}

function inWin(ts: string | null | undefined, start: Date, end: Date): boolean {
  if (!ts) return false;
  const t = new Date(ts).getTime();
  return t >= start.getTime() && t < end.getTime();
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ----------------------------------------------------------------------------
// Tipos internos das linhas buscadas
// ----------------------------------------------------------------------------

type LeadRow = Pick<
  Lead,
  | 'id'
  | 'created_at'
  | 'updated_at'
  | 'last_entered_at'
  | 'education_level'
  | 'interest_level'
  | 'source'
  | 'pipeline'
  | 'stage'
  | 'assigned_to'
  | 'lost_reason'
  | 'is_archived'
  | 'phone'
  | 'name'
  | 'child_name'
>;

interface DealRow {
  id: string;
  lead_id: string;
  closed_by: string | null;
  contract_value: number;
  education_level: Lead['education_level'];
  signed_at: string;
  sale_status: string;
}

interface ApptRow {
  id: string;
  lead_id: string;
  assigned_to: string | null;
  scheduled_at: string;
  created_at: string;
  showed_up: boolean | null;
}

interface AttemptRow {
  id: string;
  lead_id: string;
  created_by: string | null;
  outcome: 'no_answer' | 'busy' | 'responded' | 'scheduled';
  attempted_at: string;
}

interface ProfileRow {
  id: string;
  name: string;
  avatar_url: string | null;
  role: string;
}

// ----------------------------------------------------------------------------
// Entrada principal
// ----------------------------------------------------------------------------

export async function getDashboardData(opts: {
  isDemo?: boolean;
  period: ResolvedPeriod;
}): Promise<DashboardData> {
  const supabase = createClient();
  const isDemo = opts.isDemo ?? false;
  const { period } = opts;

  const [leads, deals, appts, attempts, profilesRes, configsRes, visitaRes, stagesRes] =
    await Promise.all([
      fetchAllRows<LeadRow>((from, to) =>
        supabase
          .from('leads')
          .select(
            'id, name, child_name, phone, created_at, updated_at, last_entered_at, education_level, interest_level, source, pipeline, stage, assigned_to, lost_reason, is_archived',
          )
          .eq('is_demo', isDemo)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<DealRow>((from, to) =>
        supabase
          .from('deals')
          .select('id, lead_id, closed_by, contract_value, education_level, signed_at, sale_status')
          .eq('is_demo', isDemo)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<ApptRow>((from, to) =>
        supabase
          .from('appointments')
          .select('id, lead_id, assigned_to, scheduled_at, created_at, showed_up')
          .eq('is_demo', isDemo)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<AttemptRow>((from, to) =>
        supabase
          .from('contact_attempts')
          .select('id, lead_id, created_by, outcome, attempted_at')
          .eq('is_demo', isDemo)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      supabase.from('user_profiles').select('id, name, avatar_url, role'),
      supabase.from('dashboard_config').select('*'),
      supabase
        .from('pipeline_stages')
        .select('required_fields')
        .eq('pipeline', 'comercial')
        .eq('slug', 'visita_presencial')
        .maybeSingle(),
      supabase
        .from('pipeline_stages')
        .select('slug, name, is_terminal')
        .eq('pipeline', 'comercial'),
    ]);

  const profiles = (profilesRes.data ?? []) as ProfileRow[];
  const configs = (configsRes.data ?? []) as DashboardConfig[];
  const visitaRequired: readonly string[] = visitaRes.data?.required_fields ?? [];
  const stageMeta = (stagesRes.data ?? []) as { slug: string; name: string; is_terminal: boolean }[];

  const leadById = new Map<string, LeadRow>(leads.map((l) => [l.id, l]));
  const profileById = new Map<string, ProfileRow>(profiles.map((p) => [p.id, p]));

  // Matrículas ativas (canceladas ficam fora das métricas de conversão).
  const activeDeals = deals.filter((d) => d.sale_status !== 'cancelada');

  const ctx: Ctx = {
    period,
    leads,
    deals: activeDeals,
    appts,
    attempts,
    configs,
    visitaRequired,
    stageMeta,
    leadById,
    profileById,
  };

  return {
    periodLabel: period.label,
    macro: buildMacro(ctx),
    funnel: buildFunnel(ctx),
    sdr: buildSdr(ctx),
    closers: buildClosers(ctx),
    educationLevels: buildEducationLevels(ctx),
    sources: buildSources(ctx),
    closerFunnel: buildCloserFunnel(ctx),
    salesCycle: buildSalesCycle(ctx),
    lostReasons: buildLostReasons(ctx),
    highInterest: buildHighInterest(ctx),
  };
}

interface Ctx {
  period: ResolvedPeriod;
  leads: LeadRow[];
  deals: DealRow[];
  appts: ApptRow[];
  attempts: AttemptRow[];
  configs: DashboardConfig[];
  visitaRequired: readonly string[];
  stageMeta: { slug: string; name: string; is_terminal: boolean }[];
  leadById: Map<string, LeadRow>;
  profileById: Map<string, ProfileRow>;
}

// ----------------------------------------------------------------------------
// 1. KPIs macro
// ----------------------------------------------------------------------------

interface WindowAgg {
  leads: number;
  appts: number;
  apptsResolved: number;
  apptsShowed: number;
  deals: number;
  faturamento: number;
}

function aggregateWindow(ctx: Ctx, start: Date, end: Date): WindowAgg {
  const leads = ctx.leads.filter((l) => inWin(l.created_at, start, end)).length;

  let appts = 0;
  let apptsResolved = 0;
  let apptsShowed = 0;
  for (const a of ctx.appts) {
    if (!inWin(a.created_at, start, end)) continue;
    appts += 1;
    if (a.showed_up !== null) {
      apptsResolved += 1;
      if (a.showed_up === true) apptsShowed += 1;
    }
  }

  const signed = ctx.deals.filter((d) => inWin(d.signed_at, start, end));
  const faturamento = signed.reduce((acc, d) => acc + (d.contract_value ?? 0), 0);

  return { leads, appts, apptsResolved, apptsShowed, deals: signed.length, faturamento };
}

type ConfigNumericKey = 'meta_leads' | 'meta_agendamentos' | 'meta_vendas' | 'meta_faturamento';

function sumConfig(
  configs: DashboardConfig[],
  months: { mes: number; ano: number }[],
  key: ConfigNumericKey,
): number {
  return months.reduce((acc, { mes, ano }) => {
    const c = configs.find((cfg) => cfg.mes === mes && cfg.ano === ano);
    return acc + (c ? c[key] : 0);
  }, 0);
}

function buildMacro(ctx: Ctx): DashboardData['macro'] {
  const { period, configs } = ctx;
  const cur = aggregateWindow(ctx, period.start, period.end);
  const prev = aggregateWindow(ctx, period.prevStart, period.prevEnd);

  const curMonths = monthsCovered(period.start, period.end);
  const hasConfig = curMonths.some((m) =>
    configs.some((c) => c.mes === m.mes && c.ano === m.ano),
  );

  const metaLeads = sumConfig(configs, curMonths, 'meta_leads');
  const metaVisitas = sumConfig(configs, curMonths, 'meta_agendamentos');
  const metaMatriculas = sumConfig(configs, curMonths, 'meta_vendas');
  const metaFat = sumConfig(configs, curMonths, 'meta_faturamento');

  const showCur = ratio(cur.apptsShowed, cur.apptsResolved);
  const showPrev = ratio(prev.apptsShowed, prev.apptsResolved);
  const convCur = ratio(cur.deals, cur.leads);
  const convPrev = ratio(prev.deals, prev.leads);

  const target = (meta: number): number | null => (meta > 0 ? meta : null);
  const progress = (value: number, meta: number): number | null =>
    meta > 0 ? value / meta : null;

  const kpis: KpiValue[] = [
    {
      key: 'leads_captados',
      label: 'Leads captados',
      value: cur.leads,
      format: 'number',
      available: true,
      deltaPct: deltaPct(cur.leads, prev.leads),
      target: target(metaLeads),
      targetProgress: progress(cur.leads, metaLeads),
      hint: 'Leads criados no período',
    },
    {
      key: 'visitas',
      label: 'Visitas agendadas',
      value: cur.appts,
      format: 'number',
      available: true,
      deltaPct: deltaPct(cur.appts, prev.appts),
      target: target(metaVisitas),
      targetProgress: progress(cur.appts, metaVisitas),
      hint: 'Visitas presenciais marcadas no período',
    },
    {
      key: 'show_rate',
      label: 'Comparecimento',
      value: showCur ?? 0,
      format: 'percent',
      available: showCur !== null,
      deltaPct: deltaPct(showCur, showPrev),
      target: null,
      targetProgress: null,
      hint: 'Visitas realizadas ÷ visitas com desfecho',
    },
    {
      key: 'matriculas',
      label: 'Matrículas fechadas',
      value: cur.deals,
      format: 'number',
      available: true,
      deltaPct: deltaPct(cur.deals, prev.deals),
      target: target(metaMatriculas),
      targetProgress: progress(cur.deals, metaMatriculas),
      hint: 'Matrículas assinadas no período',
    },
    {
      key: 'faturamento',
      label: 'Faturamento',
      value: cur.faturamento,
      format: 'currency',
      available: true,
      deltaPct: deltaPct(cur.faturamento, prev.faturamento),
      target: target(metaFat),
      targetProgress: progress(cur.faturamento, metaFat),
      hint: 'Σ valor de contrato das matrículas no período',
    },
    {
      key: 'conversao',
      label: 'Conversão geral',
      value: convCur ?? 0,
      format: 'percent',
      available: convCur !== null,
      deltaPct: deltaPct(convCur, convPrev),
      target: null,
      targetProgress: null,
      hint: 'Matrículas ÷ leads captados',
    },
  ];

  // Breakdown por origem do card "Leads captados".
  const sourceCounts = new Map<string | null, number>();
  for (const l of ctx.leads) {
    if (!inWin(l.created_at, period.start, period.end)) continue;
    const key = l.source ?? null;
    sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
  }
  const leadsBySource = Array.from(sourceCounts.entries())
    .map(([source, count]) => ({ source: source as SourceRow['source'], count }))
    .sort((a, b) => b.count - a.count);

  return { kpis, leadsBySource, hasConfig };
}

// ----------------------------------------------------------------------------
// 2. Funil de conversão (operacional, por período)
// ----------------------------------------------------------------------------

/** Etapas que indicam negociação em andamento (ou além). */
const NEGOTIATION_STAGES = new Set(['em_negociacao', 'follow_up', 'cliente_fechado']);

function buildFunnel(ctx: Ctx): FunnelStage[] {
  const { period, leadById } = ctx;
  const { start, end } = period;

  // 1. Leads captados — criados no período.
  const captados = ctx.leads.filter((l) => inWin(l.created_at, start, end)).length;

  // 2. Contato realizado — leads distintos com tentativa de desfecho != no_answer.
  const contactLeads = new Set<string>();
  for (const a of ctx.attempts) {
    if (inWin(a.attempted_at, start, end) && a.outcome !== 'no_answer') contactLeads.add(a.lead_id);
  }

  // 3. Visita agendada — leads distintos com visita criada no período.
  const apptWindow = ctx.appts.filter((a) => inWin(a.created_at, start, end));
  const scheduledLeads = new Set(apptWindow.map((a) => a.lead_id));

  // 4. Visita realizada — leads distintos com comparecimento.
  const showedLeads = new Set(apptWindow.filter((a) => a.showed_up === true).map((a) => a.lead_id));

  // 5. Em negociação — leads agendados que chegaram a uma etapa de negociação ou já têm matrícula.
  const dealLeadIds = new Set(ctx.deals.map((d) => d.lead_id));
  let negociacao = 0;
  for (const id of scheduledLeads) {
    const l = leadById.get(id);
    const reached = !!l && NEGOTIATION_STAGES.has(l.stage);
    if (dealLeadIds.has(id) || reached) negociacao += 1;
  }

  // 6. Matrículas — leads distintos com matrícula assinada no período.
  const matriculaLeads = new Set(
    ctx.deals.filter((d) => inWin(d.signed_at, start, end)).map((d) => d.lead_id),
  );

  const raw = [
    { key: 'captados', label: 'Leads captados', count: captados },
    { key: 'contato', label: 'Contato realizado', count: contactLeads.size },
    { key: 'visita_agendada', label: 'Visita agendada', count: scheduledLeads.size },
    { key: 'visita_realizada', label: 'Visita realizada', count: showedLeads.size },
    { key: 'negociacao', label: 'Em negociação', count: negociacao },
    { key: 'matriculas', label: 'Matrículas fechadas', count: matriculaLeads.size },
  ];

  const top = raw[0]?.count ?? 0;
  return raw.map((stage, i) => {
    const prev = raw[i - 1];
    return {
      ...stage,
      pctOfPrev: prev ? ratio(stage.count, prev.count) : null,
      pctOfTop: ratio(stage.count, top),
    };
  });
}

// ----------------------------------------------------------------------------
// 3. Performance de atendimento (tentativas de contato)
// ----------------------------------------------------------------------------

interface SdrAcc {
  attempts: number;
  contacted: number;
  appointments: number;
  scheduledLeads: Set<string>;
  firstContactMins: number[];
}

function newSdrAcc(): SdrAcc {
  return {
    attempts: 0,
    contacted: 0,
    appointments: 0,
    scheduledLeads: new Set(),
    firstContactMins: [],
  };
}

function buildSdr(ctx: Ctx): SdrRow[] {
  const { period, leadById } = ctx;
  const { start, end } = period;
  const acc = new Map<string, SdrAcc>();
  const get = (id: string): SdrAcc => {
    let a = acc.get(id);
    if (!a) {
      a = newSdrAcc();
      acc.set(id, a);
    }
    return a;
  };

  // Tentativas no período, agrupadas por quem registrou.
  for (const at of ctx.attempts) {
    if (!at.created_by || !inWin(at.attempted_at, start, end)) continue;
    const a = get(at.created_by);
    a.attempts += 1;
    if (at.outcome === 'responded' || at.outcome === 'scheduled') a.contacted += 1;
    if (at.outcome === 'scheduled') {
      a.appointments += 1;
      a.scheduledLeads.add(at.lead_id);
    }
  }

  // Primeiro contato global por lead → SLA de 1º contato (leads criados no período).
  const firstAttemptByLead = new Map<string, AttemptRow>();
  for (const at of [...ctx.attempts].sort(
    (x, y) => new Date(x.attempted_at).getTime() - new Date(y.attempted_at).getTime(),
  )) {
    if (!firstAttemptByLead.has(at.lead_id)) firstAttemptByLead.set(at.lead_id, at);
  }
  for (const lead of ctx.leads) {
    if (!inWin(lead.created_at, start, end)) continue;
    const fa = firstAttemptByLead.get(lead.id);
    if (!fa || !fa.created_by) continue;
    const mins =
      (new Date(fa.attempted_at).getTime() - new Date(lead.created_at).getTime()) / 60000;
    if (mins < 0) continue;
    get(fa.created_by).firstContactMins.push(mins);
  }

  // Visitas por lead, para taxa de comparecimento dos leads que cada um agendou.
  const apptsByLead = new Map<string, ApptRow[]>();
  for (const ap of ctx.appts) {
    const list = apptsByLead.get(ap.lead_id);
    if (list) list.push(ap);
    else apptsByLead.set(ap.lead_id, [ap]);
  }

  const rows: Omit<SdrRow, 'rank'>[] = [];
  for (const [userId, a] of acc.entries()) {
    let resolved = 0;
    let showed = 0;
    let icpComplete = 0;
    let icpTotal = 0;
    for (const leadId of a.scheduledLeads) {
      for (const ap of apptsByLead.get(leadId) ?? []) {
        if (ap.showed_up === null) continue;
        resolved += 1;
        if (ap.showed_up === true) showed += 1;
      }
      const l = leadById.get(leadId);
      if (l) {
        icpTotal += 1;
        if (validateRequiredFields(l as unknown as Lead, ctx.visitaRequired).ok) icpComplete += 1;
      }
    }

    const profile = ctx.profileById.get(userId);
    rows.push({
      userId,
      name: profile?.name ?? 'Usuário',
      avatarUrl: profile?.avatar_url ?? null,
      attempts: a.attempts,
      contactRate: ratio(a.contacted, a.attempts) ?? 0,
      appointments: a.appointments,
      showRate: ratio(showed, resolved),
      avgFirstContactMin: avgOf(a.firstContactMins),
      icpCompleteRate: ratio(icpComplete, icpTotal),
    });
  }

  rows.sort((x, y) => y.appointments - x.appointments || y.attempts - x.attempts);
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

// ----------------------------------------------------------------------------
// 4. Performance de fechamento (visitas atendidas + matrículas)
// ----------------------------------------------------------------------------

interface CloserAcc {
  received: number;
  resolved: number;
  showed: number;
  noShow: number;
  ticketVals: number[];
  revenue: number;
  deals: number;
  lost: Map<string, number>;
}

function newCloserAcc(): CloserAcc {
  return {
    received: 0,
    resolved: 0,
    showed: 0,
    noShow: 0,
    ticketVals: [],
    revenue: 0,
    deals: 0,
    lost: new Map(),
  };
}

function buildClosers(ctx: Ctx): CloserRow[] {
  const { period } = ctx;
  const { start, end } = period;
  const acc = new Map<string, CloserAcc>();
  const get = (id: string): CloserAcc => {
    let a = acc.get(id);
    if (!a) {
      a = newCloserAcc();
      acc.set(id, a);
    }
    return a;
  };

  for (const ap of ctx.appts) {
    if (!ap.assigned_to || !inWin(ap.created_at, start, end)) continue;
    const a = get(ap.assigned_to);
    a.received += 1;
    if (ap.showed_up === null) continue;
    a.resolved += 1;
    if (ap.showed_up === true) a.showed += 1;
    else a.noShow += 1;
  }

  for (const d of ctx.deals) {
    if (!d.closed_by || !inWin(d.signed_at, start, end)) continue;
    const a = get(d.closed_by);
    a.deals += 1;
    a.revenue += d.contract_value ?? 0;
    a.ticketVals.push(d.contract_value ?? 0);
  }

  // Perdas atribuídas ao responsável (lost_reason setado, atualizado no período).
  for (const l of ctx.leads) {
    if (!l.lost_reason || !l.assigned_to) continue;
    if (!inWin(l.updated_at, start, end)) continue;
    const a = acc.get(l.assigned_to);
    if (!a) continue;
    a.lost.set(l.lost_reason, (a.lost.get(l.lost_reason) ?? 0) + 1);
  }

  const rows: Omit<CloserRow, 'rank'>[] = [];
  for (const [userId, a] of acc.entries()) {
    const profile = ctx.profileById.get(userId);
    const lostBreakdown: CloserLostItem[] = Array.from(a.lost.entries())
      .map(([reason, count]) => ({ reason: reason as CloserLostItem['reason'], count }))
      .sort((x, y) => y.count - x.count);
    rows.push({
      userId,
      name: profile?.name ?? 'Usuário',
      avatarUrl: profile?.avatar_url ?? null,
      calls: a.showed,
      conversionRate: ratio(a.deals, a.showed),
      avgTicket: avgOf(a.ticketVals),
      noShowRate: ratio(a.noShow, a.resolved),
      lostBreakdown,
      revenue: a.revenue,
    });
  }

  rows.sort((x, y) => y.revenue - x.revenue || y.calls - x.calls);
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

// ----------------------------------------------------------------------------
// 5. Performance por nível de ensino
// ----------------------------------------------------------------------------

function buildEducationLevels(ctx: Ctx): EducationLevelRow[] {
  const { period, leadById } = ctx;
  const { start, end } = period;
  const leadsCur = ctx.leads.filter((l) => inWin(l.created_at, start, end));
  const dealsSigned = ctx.deals.filter((d) => inWin(d.signed_at, start, end));

  const keys: EducationLevelRow['level'][] = [...EDUCATION_LEVELS, null];
  const rows: EducationLevelRow[] = [];

  for (const key of keys) {
    const leadCount = leadsCur.filter((l) => (l.education_level ?? null) === key).length;
    const levelDeals = dealsSigned.filter(
      (d) => (d.education_level ?? leadById.get(d.lead_id)?.education_level ?? null) === key,
    );
    if (leadCount === 0 && levelDeals.length === 0) continue;

    rows.push({
      level: key,
      leads: leadCount,
      conversionRate: ratio(levelDeals.length, leadCount),
      avgTicket: avgOf(levelDeals.map((d) => d.contract_value ?? 0)),
      enrollments: levelDeals.length,
    });
  }

  return rows.sort((a, b) => b.leads - a.leads);
}

// ----------------------------------------------------------------------------
// 6. Performance por origem
// ----------------------------------------------------------------------------

function buildSources(ctx: Ctx): SourceRow[] {
  const { period, leadById } = ctx;
  const { start, end } = period;
  const leadsCur = ctx.leads.filter((l) => inWin(l.created_at, start, end));
  const dealsSigned = ctx.deals.filter((d) => inWin(d.signed_at, start, end));

  const keys: SourceRow['source'][] = [...LEAD_SOURCES, null];
  const rows: SourceRow[] = [];

  for (const key of keys) {
    const srcLeads = leadsCur.filter((l) => (l.source ?? null) === key);
    const srcDeals = dealsSigned.filter((d) => (leadById.get(d.lead_id)?.source ?? null) === key);
    if (srcLeads.length === 0 && srcDeals.length === 0) continue;

    const cycleDays: number[] = [];
    for (const d of srcDeals) {
      const l = leadById.get(d.lead_id);
      if (!l) continue;
      const days = (new Date(d.signed_at).getTime() - new Date(l.created_at).getTime()) / MS_PER_DAY;
      if (days >= 0) cycleDays.push(days);
    }

    const highInterest = srcLeads.filter((l) => l.interest_level === 'alto').length;

    rows.push({
      source: key,
      leads: srcLeads.length,
      conversionRate: ratio(srcDeals.length, srcLeads.length),
      highInterestRate: ratio(highInterest, srcLeads.length),
      avgCycleDays: avgOf(cycleDays),
    });
  }

  return rows.sort((a, b) => b.leads - a.leads);
}

// ----------------------------------------------------------------------------
// 7. Funil de fechamento
// ----------------------------------------------------------------------------

/**
 * Funil específico do fechamento: Visitas agendadas → Compareceram →
 * Negociação → Matrícula. Leads distintos no período.
 */
function buildCloserFunnel(ctx: Ctx): FunnelStage[] {
  const { period, leadById } = ctx;
  const { start, end } = period;

  const apptWindow = ctx.appts.filter((a) => inWin(a.created_at, start, end));
  const scheduled = new Set(apptWindow.map((a) => a.lead_id));
  const showed = new Set(apptWindow.filter((a) => a.showed_up === true).map((a) => a.lead_id));

  const dealLeadIds = new Set(ctx.deals.map((d) => d.lead_id));
  let negociacao = 0;
  for (const id of scheduled) {
    const l = leadById.get(id);
    const reached = !!l && NEGOTIATION_STAGES.has(l.stage);
    if (dealLeadIds.has(id) || reached) negociacao += 1;
  }

  const vendas = new Set(
    ctx.deals.filter((d) => inWin(d.signed_at, start, end)).map((d) => d.lead_id),
  );

  const raw = [
    { key: 'visitas', label: 'Visitas agendadas', count: scheduled.size },
    { key: 'compareceram', label: 'Compareceram', count: showed.size },
    { key: 'negociacao', label: 'Em negociação', count: negociacao },
    { key: 'matricula', label: 'Matrícula fechada', count: vendas.size },
  ];
  const top = raw[0]?.count ?? 0;
  return raw.map((stage, i) => {
    const prev = raw[i - 1];
    return {
      ...stage,
      pctOfPrev: prev ? ratio(stage.count, prev.count) : null,
      pctOfTop: ratio(stage.count, top),
    };
  });
}

// ----------------------------------------------------------------------------
// 8. Ciclo de matrícula
// ----------------------------------------------------------------------------

/**
 * Dias entre a PRIMEIRA visita do lead (appointments.scheduled_at mais antiga)
 * e a assinatura da matrícula, para matrículas assinadas no período.
 * Segmentado por nível de ensino.
 */
function buildSalesCycle(ctx: Ctx): SalesCycleData {
  const { period, leadById } = ctx;
  const firstMeetingByLead = new Map<string, number>();
  for (const ap of ctx.appts) {
    const t = new Date(ap.scheduled_at).getTime();
    const cur = firstMeetingByLead.get(ap.lead_id);
    if (cur === undefined || t < cur) firstMeetingByLead.set(ap.lead_id, t);
  }

  const allDays: number[] = [];
  const byLevel = new Map<SalesCycleLevelRow['level'], number[]>();
  for (const d of ctx.deals) {
    if (!inWin(d.signed_at, period.start, period.end)) continue;
    const meeting = firstMeetingByLead.get(d.lead_id);
    if (meeting === undefined) continue;
    const days = (new Date(d.signed_at).getTime() - meeting) / MS_PER_DAY;
    if (days < 0) continue;
    allDays.push(days);

    const level = d.education_level ?? leadById.get(d.lead_id)?.education_level ?? null;
    const list = byLevel.get(level) ?? [];
    list.push(days);
    byLevel.set(level, list);
  }

  const byLevelRows: SalesCycleLevelRow[] = Array.from(byLevel.entries())
    .map(([level, days]) => ({
      level,
      levelLabel: level ? EDUCATION_LEVEL_LABELS[level] : 'Sem nível',
      deals: days.length,
      avgDays: avgOf(days),
    }))
    .sort((a, b) => b.deals - a.deals);

  return { avgDays: avgOf(allDays), deals: allDays.length, byLevel: byLevelRows };
}

// ----------------------------------------------------------------------------
// 9. Motivos de perda
// ----------------------------------------------------------------------------

/**
 * Perdas do período (lost_reason setado, updated_at na janela) como itens
 * individuais com o responsável — a visualização agrega e filtra no client.
 */
function buildLostReasons(ctx: Ctx): LostReasonItem[] {
  const { period } = ctx;
  const items: LostReasonItem[] = [];
  for (const l of ctx.leads) {
    if (!l.lost_reason || !inWin(l.updated_at, period.start, period.end)) continue;
    const closer = l.assigned_to ? ctx.profileById.get(l.assigned_to) : undefined;
    items.push({
      reason: l.lost_reason,
      closerId: l.assigned_to,
      closerName: closer?.name ?? null,
    });
  }
  return items;
}

// ----------------------------------------------------------------------------
// 10. Interesse alto × não fechou matrícula (requisito da reunião)
// ----------------------------------------------------------------------------

/**
 * Todos os leads com interesse ALTO (snapshot atual, não janela): quantos já
 * fecharam, quantos se perderam e — o foco — quantos seguem abertos, com a
 * lista priorizada por tempo parado na etapa.
 */
function buildHighInterest(ctx: Ctx): HighInterestData {
  const now = Date.now();
  const dealLeadIds = new Set(ctx.deals.map((d) => d.lead_id));
  const stageNameBySlug = new Map(ctx.stageMeta.map((s) => [s.slug, s.name]));

  let lost = 0;
  let converted = 0;
  const byStage = new Map<string, number>();
  const openLeads: HighInterestLeadRow[] = [];

  for (const l of ctx.leads) {
    if (l.interest_level !== 'alto' || l.is_archived) continue;
    if (dealLeadIds.has(l.id) || l.stage === 'cliente_fechado') {
      converted += 1;
      continue;
    }
    if (l.lost_reason !== null || l.stage === 'perdido') {
      lost += 1;
      continue;
    }
    byStage.set(l.stage, (byStage.get(l.stage) ?? 0) + 1);
    openLeads.push({
      id: l.id,
      name: l.name,
      childName: l.child_name,
      stage: l.stage,
      stageName: stageNameBySlug.get(l.stage) ?? l.stage,
      assignedName: l.assigned_to
        ? (ctx.profileById.get(l.assigned_to)?.name ?? null)
        : null,
      daysSinceEntered: Math.floor((now - new Date(l.last_entered_at).getTime()) / MS_PER_DAY),
      phone: l.phone,
    });
  }

  openLeads.sort((a, b) => b.daysSinceEntered - a.daysSinceEntered);

  return {
    open: openLeads.length,
    lost,
    converted,
    byStage: Array.from(byStage.entries())
      .map(([stage, count]) => ({
        stage,
        label: stageNameBySlug.get(stage) ?? stage,
        count,
      }))
      .sort((a, b) => b.count - a.count),
    leads: openLeads.slice(0, 30),
  };
}

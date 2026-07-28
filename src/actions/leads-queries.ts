import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { PAID_LEAD_SOURCES } from '@/types/lead';
import type {
  Activity,
  Appointment,
  ContactAttempt,
  EducationLevel,
  InterestLevel,
  Lead,
  LeadSource,
  SourceFilter,
} from '@/types/lead';
import { PIPELINES, type PipelineKind } from '@/types/pipeline';
import { resolvePeriod } from '@/lib/dashboard/period';

/**
 * Queries de leitura. Não precisam ser Server Actions (sem 'use server'),
 * apenas funções server-only invocadas a partir de Server Components.
 */

/** Resumo de uma matrícula (deal) para a seção "Matrículas" do lead. */
export interface LeadDealSummary {
  id: string;
  student_name: string | null;
  school_year: string | null;
  enrollment_year: string | null;
  contract_value: number;
  monthly_value: number | null;
  sale_status: string | null;
  signed_at: string;
  payment_method: string | null;
  closer_name: string | null;
  notes: string | null;
}

export interface LeadWithRelations {
  lead: Lead;
  activities: Activity[];
  contactAttempts: ContactAttempt[];
  appointments: Appointment[];
  /** Se já fechou ao menos uma matrícula — define se é "cliente". */
  hasDeal: boolean;
  /** Matrículas do lead — seção "Matrículas". */
  deals: LeadDealSummary[];
  /**
   * Mapa user_id → nome para os autores das activities (timeline mostra "quem
   * escreveu" nas notas). Resolvido via admin client para não depender da RLS
   * de user_profiles.
   */
  activityAuthors: Record<string, string>;
}

export async function getLeadById(
  id: string,
  opts: { isDemo?: boolean } = {},
): Promise<LeadWithRelations | null> {
  const supabase = createClient();
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', id)
    .eq('is_demo', opts.isDemo ?? false)
    .maybeSingle();
  if (!lead) return null;

  const [activitiesRes, attemptsRes, appointmentsRes, dealsRes] = await Promise.all([
    supabase
      .from('activities')
      .select('*')
      .eq('lead_id', id)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('contact_attempts')
      .select('*')
      .eq('lead_id', id)
      .order('attempt_number', { ascending: false }),
    supabase
      .from('appointments')
      .select('*')
      .eq('lead_id', id)
      .order('scheduled_at', { ascending: false }),
    supabase
      .from('deals')
      .select(
        'id, student_name, school_year, enrollment_year, contract_value, monthly_value, sale_status, signed_at, payment_method, closed_by, notes',
      )
      .eq('lead_id', id)
      .order('signed_at', { ascending: false }),
  ]);

  const dealRows = dealsRes.data ?? [];

  // Nomes dos autores das activities e de quem fechou as matrículas.
  const authorIds = [
    ...new Set([
      ...(activitiesRes.data ?? [])
        .map((a) => a.user_id)
        .filter((id): id is string => Boolean(id)),
      ...dealRows.map((d) => d.closed_by).filter((id): id is string => Boolean(id)),
    ]),
  ];
  const activityAuthors: Record<string, string> = {};
  if (authorIds.length > 0) {
    const admin = createAdminClient();
    const { data: authors } = await admin
      .from('user_profiles')
      .select('id, name')
      .in('id', authorIds);
    for (const a of authors ?? []) activityAuthors[a.id] = a.name;
  }

  const deals: LeadDealSummary[] = dealRows.map((d) => ({
    id: d.id,
    student_name: d.student_name,
    school_year: d.school_year,
    enrollment_year: d.enrollment_year,
    contract_value: d.contract_value,
    monthly_value: d.monthly_value,
    sale_status: d.sale_status,
    signed_at: d.signed_at,
    payment_method: d.payment_method,
    closer_name: d.closed_by ? (activityAuthors[d.closed_by] ?? null) : null,
    notes: d.notes,
  }));

  return {
    lead,
    activities: activitiesRes.data ?? [],
    contactAttempts: attemptsRes.data ?? [],
    appointments: appointmentsRes.data ?? [],
    hasDeal: dealRows.length > 0,
    deals,
    activityAuthors,
  };
}

export async function getLeadsByPipeline(
  pipeline: PipelineKind,
  opts: { isDemo?: boolean } = {},
): Promise<Lead[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('leads')
    .select('*')
    .eq('pipeline', pipeline)
    .eq('is_archived', false)
    .eq('is_demo', opts.isDemo ?? false)
    .order('last_entered_at', { ascending: false });
  return data ?? [];
}

export interface ListLeadsFilters {
  pipeline?: PipelineKind;
  stage?: string;
  interestLevel?: InterestLevel;
  educationLevel?: EducationLevel;
  assignedTo?: string;
  source?: LeadSource;
  createdFrom?: string;
  createdTo?: string;
  search?: string;
  sortBy?: 'created_at' | 'updated_at' | 'last_entered_at';
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  isDemo?: boolean;
  /** Chip "Sem responsável" — apenas leads com assigned_to nulo. */
  unassigned?: boolean;
  /** Chip "SLA vencido" — leads com tentativa estourada e ainda sem resposta. */
  slaBreached?: boolean;
  /** Chip "Visita hoje" — leads com visita agendada para o dia (BRT). */
  meetingToday?: boolean;
  /** Chip "Novos hoje" — leads criados hoje (BRT). */
  createdToday?: boolean;
}

export interface ListLeadsResult {
  leads: Lead[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Janela do dia atual no calendário de Brasília (ISO UTC). BRT é UTC-3 fixo
 * (sem horário de verão desde 2019), então somar 24h ao início do dia é seguro.
 */
function todayWindow(): { dayStart: string; dayEnd: string } {
  const start = resolvePeriod('today').start;
  return {
    dayStart: start.toISOString(),
    dayEnd: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export async function listLeads(filters: ListLeadsFilters = {}): Promise<ListLeadsResult> {
  const supabase = createClient();
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const sortBy = filters.sortBy ?? 'created_at';
  const sortDir = filters.sortDir ?? 'desc';

  // Os chips "SLA vencido" e "Visita hoje" filtram por tabelas relacionadas —
  // o embed !inner vira INNER JOIN no PostgREST e permite filtrar o pai.
  const select = [
    '*',
    filters.slaBreached ? 'contact_attempts!inner(id)' : null,
    filters.meetingToday ? 'appointments!inner(id)' : null,
  ]
    .filter(Boolean)
    .join(', ');

  let q = supabase
    .from('leads')
    .select(select, { count: 'exact' })
    .eq('is_archived', false)
    .eq('is_demo', filters.isDemo ?? false);

  if (filters.pipeline) q = q.eq('pipeline', filters.pipeline);
  if (filters.stage) q = q.eq('stage', filters.stage);
  if (filters.interestLevel) q = q.eq('interest_level', filters.interestLevel);
  if (filters.educationLevel) q = q.eq('education_level', filters.educationLevel);
  if (filters.assignedTo) q = q.eq('assigned_to', filters.assignedTo);
  if (filters.source) q = q.eq('source', filters.source);
  if (filters.createdFrom) q = q.gte('created_at', filters.createdFrom);
  if (filters.createdTo) q = q.lte('created_at', filters.createdTo);
  if (filters.unassigned) q = q.is('assigned_to', null);
  if (filters.slaBreached) {
    q = q
      .eq('contact_attempts.sla_breached', true)
      .in('contact_attempts.outcome', ['no_answer', 'busy']);
  }
  if (filters.meetingToday || filters.createdToday) {
    const { dayStart, dayEnd } = todayWindow();
    if (filters.meetingToday) {
      q = q
        .gte('appointments.scheduled_at', dayStart)
        .lt('appointments.scheduled_at', dayEnd);
    }
    if (filters.createdToday) q = q.gte('created_at', dayStart);
  }

  if (filters.search) {
    const term = filters.search.trim();
    if (term) {
      const escaped = term.replace(/[%,]/g, '\\$&');
      q = q.or(
        `name.ilike.%${escaped}%,phone.ilike.%${escaped}%,email.ilike.%${escaped}%,child_name.ilike.%${escaped}%`,
      );
    }
  }

  q = q.order(sortBy, { ascending: sortDir === 'asc' }).range(from, to);

  const { data, count } = await q;
  return {
    // O select dinâmico (embeds dos chips) perde a inferência do supabase-js —
    // as linhas continuam sendo leads (chaves extras dos embeds são ignoradas).
    leads: (data ?? []) as unknown as Lead[],
    total: count ?? 0,
    page,
    pageSize,
  };
}

// ============================================================================
// Mini-dashboard da página /leads (gauges + chips de atalho)
// ============================================================================

export interface LeadsPageStats {
  /** Base ativa: leads não arquivados. */
  totalLeads: number;
  /** Nível de interesse ALTO. */
  hotLeads: number;
  /** Nível de interesse MÉDIO. */
  warmLeads: number;
  /** Visitas com scheduled_at hoje (calendário BRT) — gauge. */
  meetingsToday: number;
  /** Leads com visita hoje — contagem do chip "Visita hoje". */
  meetingTodayLeads: number;
  /** Leads com tentativa sla_breached=true e ainda sem resposta. */
  slaBreachedLeads: number;
  /** Matrículas fechadas no mês corrente. */
  salesThisMonth: number;
  /** Matrículas na janela comparável anterior (mesmos N dias do mês passado). */
  salesPrevWindow: number;
  /** Leads criados nesta semana (desde segunda, BRT). */
  newThisWeek: number;
  /** Leads criados hoje (BRT). */
  newToday: number;
  /** Leads sem responsável (assigned_to nulo). */
  unassignedLeads: number;
}

/**
 * Contagens do mini-dashboard e dos chips de /leads. Só queries `head:true`
 * (count exato sem trazer linhas) — barato mesmo com dezenas de milhares de
 * leads. "Quente"/"morno" seguem o nível de interesse registrado pela equipe.
 */
export async function getLeadsPageStats(
  opts: { isDemo?: boolean } = {},
): Promise<LeadsPageStats> {
  const supabase = createClient();
  const isDemo = opts.isDemo ?? false;
  const { dayStart, dayEnd } = todayWindow();
  const week = resolvePeriod('this_week');
  const month = resolvePeriod('this_month');

  const activeLeads = () =>
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('is_archived', false)
      .eq('is_demo', isDemo);

  const [
    total,
    hot,
    warm,
    meetingsToday,
    meetingTodayLeads,
    slaBreached,
    salesThisMonth,
    salesPrevWindow,
    newThisWeek,
    newToday,
    unassigned,
  ] = await Promise.all([
    activeLeads(),
    activeLeads().eq('interest_level', 'alto'),
    activeLeads().eq('interest_level', 'medio'),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('is_demo', isDemo)
      .gte('scheduled_at', dayStart)
      .lt('scheduled_at', dayEnd),
    supabase
      .from('leads')
      .select('id, appointments!inner(id)', { count: 'exact', head: true })
      .eq('is_archived', false)
      .eq('is_demo', isDemo)
      .gte('appointments.scheduled_at', dayStart)
      .lt('appointments.scheduled_at', dayEnd),
    supabase
      .from('leads')
      .select('id, contact_attempts!inner(id)', { count: 'exact', head: true })
      .eq('is_archived', false)
      .eq('is_demo', isDemo)
      .eq('contact_attempts.sla_breached', true)
      .in('contact_attempts.outcome', ['no_answer', 'busy']),
    supabase
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('is_demo', isDemo)
      .gte('created_at', month.start.toISOString()),
    supabase
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('is_demo', isDemo)
      .gte('created_at', month.prevStart.toISOString())
      .lt('created_at', month.prevEnd.toISOString()),
    activeLeads().gte('created_at', week.start.toISOString()),
    activeLeads().gte('created_at', dayStart),
    activeLeads().is('assigned_to', null),
  ]);

  return {
    totalLeads: total.count ?? 0,
    hotLeads: hot.count ?? 0,
    warmLeads: warm.count ?? 0,
    meetingsToday: meetingsToday.count ?? 0,
    meetingTodayLeads: meetingTodayLeads.count ?? 0,
    slaBreachedLeads: slaBreached.count ?? 0,
    salesThisMonth: salesThisMonth.count ?? 0,
    salesPrevWindow: salesPrevWindow.count ?? 0,
    newThisWeek: newThisWeek.count ?? 0,
    newToday: newToday.count ?? 0,
    unassignedLeads: unassigned.count ?? 0,
  };
}

export interface StageWithCount {
  slug: string;
  name: string;
  position: number;
  color: string;
  is_terminal: boolean;
  required_fields: string[];
}

export async function getStagesForPipeline(pipeline: PipelineKind): Promise<StageWithCount[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('pipeline_stages')
    .select('slug, name, position, color, is_terminal, required_fields')
    .eq('pipeline', pipeline)
    .eq('is_active', true)
    .order('position');
  return data ?? [];
}

export interface PipelineStageOption {
  slug: string;
  name: string;
}

/**
 * Stages ativos de TODOS os pipelines, agrupados e ordenados por posição. Usado
 * pelo modal "Mover" do board para escolher pipeline + coluna de destino sem um
 * round-trip por pipeline.
 */
export async function getAllActivePipelineStages(): Promise<Record<string, PipelineStageOption[]>> {
  const supabase = createClient();
  const { data } = await supabase
    .from('pipeline_stages')
    .select('pipeline, slug, name, position')
    .eq('is_active', true)
    .order('position');
  const grouped: Record<string, PipelineStageOption[]> = {};
  for (const row of data ?? []) {
    (grouped[row.pipeline] ??= []).push({ slug: row.slug, name: row.name });
  }
  return grouped;
}

export interface CloserOption {
  id: string;
  name: string;
  avatar_url: string | null;
}

/**
 * RPC list_salespeople deduplicada por request (React cache). Via RPC SECURITY
 * DEFINER porque um SELECT direto em user_profiles pela RLS só devolve o que a
 * policy deixa. Sem o cache, um clique no board disparava a MESMA RPC 11+ vezes
 * (listAssignableUsers + uma por coluna no enrichLeads).
 */
const getSalespeople = cache(async () => {
  const supabase = createClient();
  const { data } = await supabase.rpc('list_salespeople');
  return data ?? [];
});

export async function listClosers(): Promise<CloserOption[]> {
  const people = await getSalespeople();
  return people
    .map((p) => ({ id: p.id, name: p.name, avatar_url: null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface AssignableUser {
  id: string;
  name: string;
  role: string;
}

/**
 * Usuários atribuíveis como responsável pelo lead (toda a equipe). Via RPC
 * `list_salespeople` (SECURITY DEFINER) para contornar a RLS de user_profiles.
 */
export async function listAssignableUsers(): Promise<AssignableUser[]> {
  const people = await getSalespeople();
  return people
    .map((p) => ({ id: p.id, name: p.name, role: p.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface KanbanLeadRow {
  lead: Lead;
  stageEnteredAt: string;
  nextSlaAt: string | null;
  attemptsCount: number;
  lastAttemptOutcome: string | null;
  nextAppointmentAt: string | null;
  nextAppointmentId: string | null;
  appointmentConfirmed: boolean;
  /** Nome de quem criou a próxima visita agendada. */
  appointmentCreatorName: string | null;
  /** Nome do responsável pela próxima visita agendada. */
  appointmentAssigneeName: string | null;
  /** Nome do responsável (assigned_to) — avatar no card. */
  assigneeName: string | null;
  /** Role do responsável — cor do avatar (admin/comercial). */
  assigneeRole: string | null;
  /**
   * O lead chegou nesta coluna por REATIVAÇÃO (voltou via novo formulário ou
   * mensagem espontânea)? O card então mostra "voltou há X" em vez de "na etapa
   * há X" — sem isso, um lead antigo reativado hoje parecia recém-criado.
   */
  reentered: boolean;
}

/**
 * Ordenação do board: por data ou por nível de interesse (alto primeiro).
 * O valor legado 'score' equivale a 'interesse'.
 */
export type BoardSort = 'data' | 'score';

/** Tamanho da página por coluna no board (e de cada "carregar mais"). */
export const KANBAN_PAGE_SIZE = 150;

/**
 * Filtro de responsável do board: 'all' não filtra, 'none' mostra só leads sem
 * responsável, qualquer outro valor é o uuid do usuário (assigned_to).
 */
export type AssignedFilter = string;

/**
 * Filtro de nível de interesse: 'all' não filtra, 'none' mostra só leads sem
 * interesse registrado, ou um valor do enum ('baixo' | 'medio' | 'alto').
 */
export type InterestFilter = string;

/** 'all' não filtra; 'none' mostra leads ainda sem resumo de atendimento. */
export type QualificationFilter = string;

export interface BoardFilterOpts {
  isDemo?: boolean;
  sourceFilter?: SourceFilter;
  assignedFilter?: AssignedFilter;
  interestFilter?: InterestFilter;
  qualificationFilter?: QualificationFilter;
}

/**
 * Aplica os filtros do board (fonte, responsável, interesse) numa query de
 * leads. Centralizado aqui porque as 4 queries do board (contagem, página,
 * busca e gauges) precisam aplicar EXATAMENTE os mesmos recortes — quando
 * divergem, o cabeçalho da coluna mostra um total que não bate com os cards.
 */
/**
 * Só os métodos de filtro que usamos. O builder do PostgREST tem sobrecargas
 * genéricas demais para inferir um `T extends ...` estrutural, então o corpo
 * opera sobre esta visão mínima e o genérico devolve o tipo exato do
 * call-site — a query segue encadeável (.order/.range/.gte) depois do helper.
 */
interface LeadQueryFilters {
  in(column: string, values: readonly string[]): LeadQueryFilters;
  or(filters: string): LeadQueryFilters;
  eq(column: string, value: string): LeadQueryFilters;
  is(column: string, value: null): LeadQueryFilters;
}

function applyBoardFilters<T>(query: T, opts: BoardFilterOpts): T {
  const sourceFilter = opts.sourceFilter ?? 'all';
  const assignedFilter = opts.assignedFilter ?? 'all';
  const interestFilter = opts.interestFilter ?? 'all';
  const qualificationFilter = opts.qualificationFilter ?? 'all';

  let q = query as LeadQueryFilters;
  if (sourceFilter === 'pagas') q = q.in('source', [...PAID_LEAD_SOURCES]);
  else if (sourceFilter === 'organicas')
    q = q.or(`source.is.null,source.not.in.(${PAID_LEAD_SOURCES.join(',')})`);
  else if (sourceFilter !== 'all') q = q.eq('source', sourceFilter);
  if (assignedFilter === 'none') q = q.is('assigned_to', null);
  else if (assignedFilter !== 'all') q = q.eq('assigned_to', assignedFilter);
  if (interestFilter === 'none') q = q.is('interest_level', null);
  else if (interestFilter !== 'all') q = q.eq('interest_level', interestFilter);
  if (qualificationFilter === 'none') q = q.is('qualification_status', null);
  else if (qualificationFilter !== 'all') q = q.eq('qualification_status', qualificationFilter);
  return q as T;
}

/**
 * Ordenação de uma coluna do board. A coluna de entrada "Novo Lead" é SEMPRE
 * por data (lead mais recente no topo — velocidade de atendimento), qualquer que
 * seja o toggle; as demais colunas seguem o Data/Interesse escolhido.
 *
 * Novo Lead ordena por `last_entered_at` (última ENTRADA, criação ou
 * reativação), não por `created_at`: um lead antigo que reentra por um novo
 * formulário precisa aparecer no TOPO da fila.
 */
function boardColumnSort(
  stage: string,
  sort: BoardSort,
): { column: 'created_at' | 'last_entered_at' | 'interest_level'; ascending: boolean } {
  if (stage === 'novo_lead') return { column: 'last_entered_at', ascending: false };
  if (sort === 'data') return { column: 'created_at', ascending: false };
  // 'score' → interesse: enum baixo<medio<alto; desc põe interesse alto no topo.
  return { column: 'interest_level', ascending: false };
}

/**
 * Enriquece um lote de leads JÁ carregado (uma página de coluna) com o que o
 * card do Kanban mostra: última troca de stage, SLA pendente, tentativas e
 * próxima visita. Como opera só sobre os leads recebidos (≤ KANBAN_PAGE_SIZE),
 * os `.in(ids)` nunca estouram o tamanho de URL nem o teto de linhas do
 * PostgREST.
 */
async function enrichLeads(
  supabase: ReturnType<typeof createClient>,
  leads: Lead[],
): Promise<KanbanLeadRow[]> {
  if (leads.length === 0) return [];

  const ids = leads.map((l) => l.id);

  const [{ data: stageChanges }, { data: attempts }, { data: allAttempts }, { data: appointments }] =
    await Promise.all([
      supabase
        .from('activities')
        .select('lead_id, created_at, metadata')
        .in('lead_id', ids)
        .eq('type', 'stage_change')
        .order('created_at', { ascending: false }),
      supabase
        .from('contact_attempts')
        .select('lead_id, sla_deadline, sla_breached')
        .in('lead_id', ids)
        .eq('sla_breached', false)
        .not('sla_deadline', 'is', null)
        .order('sla_deadline', { ascending: true }),
      supabase
        .from('contact_attempts')
        .select('lead_id, attempt_number, outcome, attempted_at')
        .in('lead_id', ids)
        .order('attempt_number', { ascending: false }),
      supabase
        .from('appointments')
        .select('id, lead_id, scheduled_at, confirmed, showed_up, created_by, assigned_to')
        .in('lead_id', ids)
        .is('showed_up', null)
        .gte('scheduled_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('scheduled_at', { ascending: true }),
    ]);

  // Última troca de stage por lead + se ela foi uma REATIVAÇÃO (lead voltou via
  // novo formulário/mensagem espontânea) — o card rotula "voltou" vs "na etapa".
  const lastChange = new Map<string, string>();
  const reenteredByLead = new Map<string, boolean>();
  for (const change of stageChanges ?? []) {
    if (!lastChange.has(change.lead_id)) {
      lastChange.set(change.lead_id, change.created_at);
      const meta = change.metadata;
      reenteredByLead.set(
        change.lead_id,
        typeof meta === 'object' &&
          meta !== null &&
          !Array.isArray(meta) &&
          (meta as Record<string, unknown>).reactivation === true,
      );
    }
  }
  const nextSla = new Map<string, string>();
  for (const a of attempts ?? []) {
    if (a.sla_deadline && !nextSla.has(a.lead_id)) {
      nextSla.set(a.lead_id, a.sla_deadline);
    }
  }

  // Conta tentativas + último outcome (já ordenado por attempt_number desc).
  const attemptsByLead = new Map<string, { count: number; lastOutcome: string | null }>();
  for (const att of allAttempts ?? []) {
    const cur = attemptsByLead.get(att.lead_id);
    if (!cur) {
      attemptsByLead.set(att.lead_id, { count: att.attempt_number, lastOutcome: att.outcome });
    }
  }

  // Próxima visita ativa (sem showed_up ainda) por lead.
  const nextApt = new Map<
    string,
    {
      id: string;
      scheduled_at: string;
      confirmed: boolean;
      created_by: string | null;
      assigned_to: string | null;
    }
  >();
  for (const apt of appointments ?? []) {
    if (!nextApt.has(apt.lead_id)) {
      nextApt.set(apt.lead_id, {
        id: apt.id,
        scheduled_at: apt.scheduled_at,
        confirmed: apt.confirmed,
        created_by: apt.created_by,
        assigned_to: apt.assigned_to,
      });
    }
  }

  // Nomes da equipe (RLS-safe via função SECURITY DEFINER).
  const personById = new Map<string, { name: string; role: string }>();
  const personIds = [
    ...new Set(
      [
        ...[...nextApt.values()].flatMap((a) => [a.created_by, a.assigned_to]),
        // Responsável do lead (assigned_to) → avatar no card.
        ...leads.map((l) => l.assigned_to),
      ].filter(Boolean),
    ),
  ];
  if (personIds.length > 0) {
    // Deduplicada por request via getSalespeople — o board chama enrichLeads
    // uma vez por coluna e todas compartilham o mesmo resultado da RPC.
    const people = await getSalespeople();
    for (const p of people) personById.set(p.id, { name: p.name, role: p.role });
  }

  return leads.map((lead) => {
    const attemptInfo = attemptsByLead.get(lead.id);
    const apt = nextApt.get(lead.id);
    return {
      lead,
      stageEnteredAt: lastChange.get(lead.id) ?? lead.created_at,
      nextSlaAt: nextSla.get(lead.id) ?? null,
      attemptsCount: attemptInfo?.count ?? 0,
      lastAttemptOutcome: attemptInfo?.lastOutcome ?? null,
      nextAppointmentAt: apt?.scheduled_at ?? null,
      nextAppointmentId: apt?.id ?? null,
      appointmentConfirmed: apt?.confirmed ?? false,
      appointmentCreatorName: apt?.created_by
        ? (personById.get(apt.created_by)?.name ?? null)
        : null,
      appointmentAssigneeName: apt?.assigned_to
        ? (personById.get(apt.assigned_to)?.name ?? null)
        : null,
      assigneeName: lead.assigned_to ? (personById.get(lead.assigned_to)?.name ?? null) : null,
      assigneeRole: lead.assigned_to ? (personById.get(lead.assigned_to)?.role ?? null) : null,
      reentered: reenteredByLead.get(lead.id) ?? false,
    };
  });
}

/**
 * Conta os leads reais de cada coluna do pipeline (respeita RLS + filtros). Uma
 * query `head:true` por stage — barata, e devolve o total verdadeiro pro
 * cabeçalho da coluna mesmo quando só a primeira página está carregada na tela.
 */
export async function getKanbanColumnCounts(
  pipeline: PipelineKind,
  stageSlugs: string[],
  opts: BoardFilterOpts = {},
): Promise<Record<string, number>> {
  const supabase = createClient();
  const isDemo = opts.isDemo ?? false;

  const pairs = await Promise.all(
    stageSlugs.map(async (slug) => {
      const q = applyBoardFilters(
        supabase
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('pipeline', pipeline)
          .eq('stage', slug)
          .eq('is_archived', false)
          .eq('is_demo', isDemo),
        opts,
      );
      const { count } = await q;
      return [slug, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(pairs);
}

/**
 * Uma página de leads de UMA coluna, ordenada por data ou interesse (Novo Lead
 * é sempre por data). `offset`/`limit` paginam o "carregar mais". Ordena também
 * por `id` como desempate — paginação estável.
 */
export async function getKanbanColumnPage(
  pipeline: PipelineKind,
  stage: string,
  opts: BoardFilterOpts & { sort?: BoardSort; offset?: number; limit?: number } = {},
): Promise<KanbanLeadRow[]> {
  const supabase = createClient();
  const isDemo = opts.isDemo ?? false;
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? KANBAN_PAGE_SIZE;
  const { column, ascending } = boardColumnSort(stage, opts.sort ?? 'data');

  const q = applyBoardFilters(
    supabase
      .from('leads')
      .select('*')
      .eq('pipeline', pipeline)
      .eq('stage', stage)
      .eq('is_archived', false)
      .eq('is_demo', isDemo),
    opts,
  );

  const { data: leads } = await q
    .order(column, { ascending, nullsFirst: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);

  return enrichLeads(supabase, leads ?? []);
}

/**
 * Busca leads no pipeline INTEIRO por nome/telefone/email/nome do filho (em
 * qualquer coluna). Limita a KANBAN_PAGE_SIZE resultados, mais recentes
 * primeiro. Usada pelo campo de busca do board (filtra os cards em tempo real)
 * — acha leads mesmo que estejam fora das páginas já carregadas das colunas.
 */
export async function searchKanbanLeads(
  pipeline: PipelineKind,
  term: string,
  opts: BoardFilterOpts = {},
): Promise<KanbanLeadRow[]> {
  const t = term.trim();
  if (t.length < 2) return [];
  const supabase = createClient();
  const isDemo = opts.isDemo ?? false;
  const escaped = t.replace(/[%,]/g, '\\$&');

  const q = applyBoardFilters(
    supabase
      .from('leads')
      .select('*')
      .eq('pipeline', pipeline)
      .eq('is_archived', false)
      .eq('is_demo', isDemo)
      .or(
        `name.ilike.%${escaped}%,phone.ilike.%${escaped}%,email.ilike.%${escaped}%,child_name.ilike.%${escaped}%`,
      ),
    opts,
  );

  const { data: leads } = await q.order('created_at', { ascending: false }).limit(KANBAN_PAGE_SIZE);
  return enrichLeads(supabase, leads ?? []);
}

// ============================================================================
// Mini-dashboard de gauges de /oportunidades (contextual ao pipeline ativo)
// ============================================================================

export interface PipelineBoardStats {
  /** Leads ativos no pipeline (respeita os filtros de fonte/responsável). */
  activeLeads: number;
  /** Entraram nas últimas 24h. */
  newToday: number;
  /** Entraram entre 48h e 24h atrás — base do pill "vs ontem". */
  newPrevDay: number;
  /** Leads sem responsável (assigned_to nulo). */
  unassigned: number;
  /** Nível de interesse ALTO. */
  hotLeads: number;
  /** Tentativas de contato registradas hoje em leads deste pipeline. */
  attemptsToday: number;
  /** Leads que responderam a um contato nesta semana. */
  respondedThisWeek: number;
  /** Leads com SLA estourado e ainda sem resposta. */
  slaBreached: number;
  /** Leads com SLA vencendo nas próximas 2h. */
  slaWarning: number;
  /** Visitas marcadas para hoje. */
  appointmentsToday: number;
  /** Visitas futuras ainda não confirmadas. */
  pendingConfirmations: number;
  /** Matrículas fechadas no mês corrente. */
  salesThisMonth: number;
  /** % de comparecimento nas visitas concluídas do mês (null sem dado). */
  showRateMonth: number | null;
}

/**
 * Métricas do dashboard de gauges de /oportunidades, escopadas ao pipeline da
 * aba ativa (recalcula ao trocar de aba). Só queries `head:true` — barato.
 * As contagens baseadas em leads respeitam os filtros de fonte/responsável do
 * board; as de atividade (tentativas/visitas/matrículas) são da equipe,
 * escopadas apenas ao pipeline.
 */
export async function getPipelineBoardStats(
  pipeline: PipelineKind,
  opts: BoardFilterOpts = {},
): Promise<PipelineBoardStats> {
  const supabase = createClient();
  const isDemo = opts.isDemo ?? false;

  const { dayStart, dayEnd } = todayWindow();
  const week = resolvePeriod('this_week');
  const month = resolvePeriod('this_month');
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const h24 = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const h48 = new Date(now - 48 * 60 * 60 * 1000).toISOString();
  const in2h = new Date(now + 2 * 60 * 60 * 1000).toISOString();

  const activeLeads = () =>
    applyBoardFilters(
      supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('pipeline', pipeline)
        .eq('is_archived', false)
        .eq('is_demo', isDemo),
      opts,
    );

  // Mesma base filtrada, com join em contact_attempts para as métricas de
  // SLA/resposta (conta LEADS, não tentativas — o embed !inner não duplica).
  const leadsWithAttempts = () =>
    applyBoardFilters(
      supabase
        .from('leads')
        .select('id, contact_attempts!inner(id)', { count: 'exact', head: true })
        .eq('pipeline', pipeline)
        .eq('is_archived', false)
        .eq('is_demo', isDemo),
      opts,
    );

  // No funil comercial todas as métricas se aplicam (a equipe faz o ciclo
  // completo: contato → visita → matrícula).
  const isComercial = pipeline === 'comercial';
  const zero = Promise.resolve({ count: 0 as number | null });

  const [
    active,
    newToday,
    newPrevDay,
    unassigned,
    hot,
    attemptsToday,
    responded,
    slaBreached,
    slaWarning,
    apptsToday,
    pendingConfirm,
    sales,
    shows,
    showsTotal,
  ] = await Promise.all([
    activeLeads(),
    activeLeads().gte('created_at', h24),
    activeLeads().gte('created_at', h48).lt('created_at', h24),
    activeLeads().is('assigned_to', null),
    activeLeads().eq('interest_level', 'alto'),
    supabase
      .from('contact_attempts')
      .select('id, leads!inner(id)', { count: 'exact', head: true })
      .gte('attempted_at', dayStart)
      .lt('attempted_at', dayEnd)
      .eq('leads.pipeline', pipeline)
      .eq('leads.is_archived', false)
      .eq('leads.is_demo', isDemo),
    leadsWithAttempts()
      .eq('contact_attempts.outcome', 'responded')
      .gte('contact_attempts.attempted_at', week.start.toISOString()),
    isComercial
      ? leadsWithAttempts()
          .eq('contact_attempts.sla_breached', true)
          .in('contact_attempts.outcome', ['no_answer', 'busy'])
      : zero,
    isComercial
      ? leadsWithAttempts()
          .eq('contact_attempts.sla_breached', false)
          .gte('contact_attempts.sla_deadline', nowIso)
          .lte('contact_attempts.sla_deadline', in2h)
      : zero,
    isComercial
      ? supabase
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('is_demo', isDemo)
          .gte('scheduled_at', dayStart)
          .lt('scheduled_at', dayEnd)
      : zero,
    isComercial
      ? supabase
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('is_demo', isDemo)
          .eq('confirmed', false)
          .is('showed_up', null)
          .gte('scheduled_at', nowIso)
      : zero,
    isComercial
      ? supabase
          .from('deals')
          .select('id', { count: 'exact', head: true })
          .eq('is_demo', isDemo)
          .gte('created_at', month.start.toISOString())
      : zero,
    isComercial
      ? supabase
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('is_demo', isDemo)
          .eq('showed_up', true)
          .gte('scheduled_at', month.start.toISOString())
      : zero,
    isComercial
      ? supabase
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('is_demo', isDemo)
          .not('showed_up', 'is', null)
          .gte('scheduled_at', month.start.toISOString())
      : zero,
  ]);

  const showsDone = showsTotal.count ?? 0;
  return {
    activeLeads: active.count ?? 0,
    newToday: newToday.count ?? 0,
    newPrevDay: newPrevDay.count ?? 0,
    unassigned: unassigned.count ?? 0,
    hotLeads: hot.count ?? 0,
    attemptsToday: attemptsToday.count ?? 0,
    respondedThisWeek: responded.count ?? 0,
    slaBreached: slaBreached.count ?? 0,
    slaWarning: slaWarning.count ?? 0,
    appointmentsToday: apptsToday.count ?? 0,
    pendingConfirmations: pendingConfirm.count ?? 0,
    salesThisMonth: sales.count ?? 0,
    showRateMonth:
      isComercial && showsDone > 0 ? Math.round((100 * (shows.count ?? 0)) / showsDone) : null,
  };
}

/**
 * Leads ativos por pipeline para os contadores das abas de /oportunidades.
 * Respeita os mesmos filtros de fonte/responsável do board — o número da aba
 * bate com o que o usuário verá ao trocar para ela.
 */
export async function getPipelineTabCounts(
  opts: BoardFilterOpts = {},
): Promise<Partial<Record<PipelineKind, number>>> {
  const supabase = createClient();
  const isDemo = opts.isDemo ?? false;

  const pairs = await Promise.all(
    PIPELINES.map(async (pipeline) => {
      const q = applyBoardFilters(
        supabase
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('pipeline', pipeline)
          .eq('is_archived', false)
          .eq('is_demo', isDemo),
        opts,
      );
      const { count } = await q;
      return [pipeline, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(pairs);
}

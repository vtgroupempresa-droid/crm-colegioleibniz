import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/fetch-all-rows';
import type { ResolvedPeriod } from '@/lib/dashboard/period';
import type {
  AgingOpportunityRow,
  ForecastWindow,
  PipelineForecastData,
  VelocityWeek,
  WeightedPipelineStageRow,
} from '@/types/dashboard';

/**
 * Pipeline e Forecast.
 *
 * Definições adotadas:
 *  - Pipeline ponderado: para cada lead ATIVO em etapa não-terminal do funil
 *    comercial, valor estimado = TICKET MÉDIO das matrículas dos últimos 90
 *    dias (não há tabela de preços; a anuidade média é a melhor referência)
 *    × probabilidade da etapa (`pipeline_stages.stage_win_probability`).
 *    Sem matrículas recentes, o forecast fica sem valor (leadsWithoutValue).
 *  - Velocity: entradas = leads criados na semana; saídas = matrículas
 *    fechadas + perdas registradas na semana.
 *  - Aging: dias na etapa atual via `leads.last_entered_at` (o trigger do banco
 *    atualiza a cada troca de etapa). Limiar via querystring (?aging=), padrão
 *    15 dias.
 *  - Previsão 30/60/90: pipeline ponderado × fator de janela
 *    min(1, N ÷ ciclo médio de matrícula dos últimos 90 dias). É uma
 *    ESTIMATIVA, nunca um compromisso — o componente deixa isso explícito.
 */

export const DEFAULT_AGING_THRESHOLD_DAYS = 15;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;
const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;
const VELOCITY_WEEKS = 8;
const HISTORY_DAYS = 90;

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

function avgOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

interface StageRow {
  slug: string;
  name: string;
  color: string;
  position: number;
  is_terminal: boolean;
  stage_win_probability: number;
}

interface ActiveLeadRow {
  id: string;
  name: string;
  stage: string;
  assigned_to: string | null;
  last_entered_at: string;
  created_at: string;
}

interface DealSlim {
  lead_id: string;
  signed_at: string;
  contract_value: number;
  sale_status: string;
}

interface ApptSlim {
  lead_id: string;
  created_at: string;
  scheduled_at: string;
  showed_up: boolean | null;
}

const DAY_LABEL = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

export async function getPipelineForecastData(opts: {
  isDemo?: boolean;
  period: ResolvedPeriod;
  agingThresholdDays?: number;
}): Promise<PipelineForecastData> {
  const supabase = createClient();
  const isDemo = opts.isDemo ?? false;
  const agingThresholdDays = opts.agingThresholdDays ?? DEFAULT_AGING_THRESHOLD_DAYS;
  const now = new Date();
  const historyStart = new Date(now.getTime() - HISTORY_DAYS * MS_PER_DAY);

  const [stagesRes, activeLeads, deals, appts, lostLeads, recentCreated, profilesRes] =
    await Promise.all([
      supabase
        .from('pipeline_stages')
        .select('slug, name, color, position, is_terminal, stage_win_probability')
        .eq('pipeline', 'comercial')
        .eq('is_active', true)
        .order('position', { ascending: true }),
      fetchAllRows<ActiveLeadRow>((from, to) =>
        supabase
          .from('leads')
          .select('id, name, stage, assigned_to, last_entered_at, created_at')
          .eq('is_demo', isDemo)
          .eq('pipeline', 'comercial')
          .eq('is_archived', false)
          .is('merged_into', null)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<DealSlim>((from, to) =>
        supabase
          .from('deals')
          .select('lead_id, signed_at, contract_value, sale_status')
          .eq('is_demo', isDemo)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<ApptSlim>((from, to) =>
        supabase
          .from('appointments')
          .select('lead_id, created_at, scheduled_at, showed_up')
          .eq('is_demo', isDemo)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<{ id: string; updated_at: string }>((from, to) =>
        supabase
          .from('leads')
          .select('id, updated_at')
          .eq('is_demo', isDemo)
          .not('lost_reason', 'is', null)
          .gte('updated_at', new Date(now.getTime() - VELOCITY_WEEKS * MS_PER_WEEK).toISOString())
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<{ id: string; created_at: string }>((from, to) =>
        supabase
          .from('leads')
          .select('id, created_at')
          .eq('is_demo', isDemo)
          .gte('created_at', new Date(now.getTime() - VELOCITY_WEEKS * MS_PER_WEEK).toISOString())
          .order('id', { ascending: true })
          .range(from, to),
      ),
      supabase.from('user_profiles').select('id, name'),
    ]);

  const stages = (stagesRes.data ?? []) as StageRow[];
  const profiles = (profilesRes.data ?? []) as { id: string; name: string }[];
  const profileNameById = new Map(profiles.map((p) => [p.id, p.name]));

  const activeSales = deals.filter((d) => d.sale_status !== 'cancelada');

  // Ticket médio de referência: matrículas dos últimos 90 dias.
  const recentTickets = activeSales
    .filter((d) => new Date(d.signed_at).getTime() >= historyStart.getTime())
    .map((d) => d.contract_value ?? 0)
    .filter((v) => v > 0);
  const referenceTicket = avgOf(recentTickets);

  const openStages = stages.filter((s) => !s.is_terminal);
  const openLeads = activeLeads.filter((l) => openStages.some((s) => s.slug === l.stage));

  // --- Pipeline ponderado por etapa -----------------------------------------
  let rawTotal = 0;
  let weightedTotal = 0;
  let leadsWithoutValue = 0;
  const stageRows: WeightedPipelineStageRow[] = openStages.map((stage) => {
    const stageLeads = openLeads.filter((l) => l.stage === stage.slug);
    const probability = stage.stage_win_probability / 100;
    let rawValue = 0;
    for (let i = 0; i < stageLeads.length; i += 1) {
      if (referenceTicket === null || referenceTicket <= 0) {
        leadsWithoutValue += 1;
        continue;
      }
      rawValue += referenceTicket;
    }
    const weightedValue = rawValue * probability;
    rawTotal += rawValue;
    weightedTotal += weightedValue;
    return {
      slug: stage.slug,
      name: stage.name,
      color: stage.color,
      probability,
      leads: stageLeads.length,
      rawValue,
      weightedValue,
    };
  });

  // --- Velocity semanal (últimas 8 semanas, semana inicia segunda BRT) --------
  const nowBrt = new Date(now.getTime() + BRT_OFFSET_MS);
  const daysFromMonday = (nowBrt.getUTCDay() + 6) % 7;
  const startOfWeek = new Date(
    Date.UTC(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), nowBrt.getUTCDate()) -
      daysFromMonday * MS_PER_DAY -
      BRT_OFFSET_MS,
  );
  const velocity: VelocityWeek[] = [];
  for (let i = VELOCITY_WEEKS - 1; i >= 0; i -= 1) {
    const weekStart = new Date(startOfWeek.getTime() - i * MS_PER_WEEK);
    const weekEnd = new Date(weekStart.getTime() + MS_PER_WEEK);
    const inWeek = (ts: string): boolean => {
      const t = new Date(ts).getTime();
      return t >= weekStart.getTime() && t < weekEnd.getTime();
    };
    velocity.push({
      label: DAY_LABEL.format(weekStart),
      entered: recentCreated.filter((l) => inWeek(l.created_at)).length,
      won: activeSales.filter((d) => inWeek(d.signed_at)).length,
      lost: lostLeads.filter((l) => inWeek(l.updated_at)).length,
    });
  }

  // --- Aging: tempo na etapa atual via last_entered_at ------------------------
  const stageNameBySlug = new Map(stages.map((s) => [s.slug, s.name]));
  const aging: AgingOpportunityRow[] = openLeads
    .map((lead) => {
      const enteredAt = lead.last_entered_at ?? lead.created_at;
      const daysInStage = (now.getTime() - new Date(enteredAt).getTime()) / MS_PER_DAY;
      return {
        leadId: lead.id,
        name: lead.name,
        stage: lead.stage,
        stageName: stageNameBySlug.get(lead.stage) ?? lead.stage,
        closerName: lead.assigned_to ? (profileNameById.get(lead.assigned_to) ?? null) : null,
        daysInStage: Math.floor(daysInStage),
        estimatedValue: referenceTicket,
      };
    })
    .filter((row) => row.daysInStage >= agingThresholdDays)
    .sort((a, b) => b.daysInStage - a.daysInStage);

  // --- Ciclo médio e conversão histórica (últimos 90 dias) --------------------
  const firstMeetingByLead = new Map<string, number>();
  for (const ap of appts) {
    const t = new Date(ap.scheduled_at).getTime();
    const cur = firstMeetingByLead.get(ap.lead_id);
    if (cur === undefined || t < cur) firstMeetingByLead.set(ap.lead_id, t);
  }
  const recentDeals = activeSales.filter(
    (d) => new Date(d.signed_at).getTime() >= historyStart.getTime(),
  );
  const cycleDays: number[] = [];
  for (const d of recentDeals) {
    const meeting = firstMeetingByLead.get(d.lead_id);
    if (meeting === undefined) continue;
    const days = (new Date(d.signed_at).getTime() - meeting) / MS_PER_DAY;
    if (days >= 0) cycleDays.push(days);
  }
  const avgCycleDays = avgOf(cycleDays);

  const showedLeads = new Set(
    appts
      .filter(
        (a) => a.showed_up === true && new Date(a.created_at).getTime() >= historyStart.getTime(),
      )
      .map((a) => a.lead_id),
  );
  const historicalConversion = ratio(recentDeals.length, showedLeads.size);

  // --- Previsão 30/60/90 -------------------------------------------------------
  const windowFactor = (days: number): number =>
    avgCycleDays !== null && avgCycleDays > 0 ? Math.min(1, days / avgCycleDays) : 1;
  const forecast: ForecastWindow[] = ([30, 60, 90] as const).map((days) => ({
    days,
    estimated: weightedTotal * windowFactor(days),
  }));

  return {
    periodLabel: opts.period.label,
    stages: stageRows,
    rawTotal,
    weightedTotal,
    activeLeads: openLeads.length,
    leadsWithoutValue,
    referenceTicket,
    velocity,
    aging,
    agingThresholdDays,
    avgCycleDays,
    forecast,
    historicalConversion,
  };
}

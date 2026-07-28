import type { Tables } from './database';
import type {
  ContactChannel,
  EducationLevel,
  InterestLevel,
  LeadSource,
  LostReason,
} from './lead';

/**
 * Tipos do Dashboard. As interfaces abaixo são o contrato entre as queries
 * server-side (`src/actions/dashboard-analytics.ts`) e os componentes de
 * apresentação (`src/components/dashboard/*`).
 */

export type DashboardConfig = Tables<'dashboard_config'>;

export type KpiFormat = 'number' | 'currency' | 'percent' | 'ratio';

export interface KpiValue {
  key: string;
  label: string;
  value: number;
  format: KpiFormat;
  /** false quando o KPI não é calculável no período. */
  available: boolean;
  /** Variação fracionária vs período anterior (0.12 = +12%). null = incomparável. */
  deltaPct: number | null;
  /** Meta do período (soma das metas mensais cobertas). null = sem meta definida. */
  target: number | null;
  /** Progresso relativo à meta (0..1+). null = sem meta. */
  targetProgress: number | null;
  /** Texto auxiliar curto (ex.: base de cálculo). */
  hint?: string;
}

export interface SourceBreakdownItem {
  source: LeadSource | null;
  count: number;
}

export interface MacroKpis {
  kpis: KpiValue[];
  /** Breakdown por origem do card "Leads captados". */
  leadsBySource: SourceBreakdownItem[];
  /** Sinaliza se há config de metas para o período. */
  hasConfig: boolean;
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  /** % (fração) relativo à etapa imediatamente anterior. null na 1ª etapa. */
  pctOfPrev: number | null;
  /** % (fração) relativo ao topo do funil. */
  pctOfTop: number | null;
}

/** Performance de atendimento por usuário (tentativas de contato). */
export interface SdrRow {
  userId: string;
  name: string;
  avatarUrl: string | null;
  attempts: number;
  contactRate: number; // 0..1 (respondeu/agendou ÷ tentativas)
  appointments: number; // visitas geradas (tentativas com outcome=scheduled)
  showRate: number | null; // 0..1 das visitas com desfecho conhecido
  avgFirstContactMin: number | null; // SLA médio de 1º contato, em minutos
  icpCompleteRate: number | null; // 0..1 dos leads agendados com cadastro completo
  rank: number; // ranking por visitas geradas
}

export interface CloserLostItem {
  reason: LostReason;
  count: number;
}

/** Performance de fechamento por usuário (visitas atendidas + matrículas). */
export interface CloserRow {
  userId: string;
  name: string;
  avatarUrl: string | null;
  calls: number; // visitas realizadas (appointments showed_up=true)
  conversionRate: number | null; // matrículas ÷ visitas realizadas
  avgTicket: number | null; // média de contract_value
  noShowRate: number | null; // no-shows ÷ visitas recebidas com desfecho
  lostBreakdown: CloserLostItem[];
  revenue: number; // faturamento gerado (Σ contract_value)
  rank: number; // ranking por matrículas
}

/** Performance por nível de ensino (Infantil, Fund. I/II, Médio, Pré-ENEM). */
export interface EducationLevelRow {
  level: EducationLevel | null;
  leads: number;
  conversionRate: number | null; // matrículas ÷ leads
  avgTicket: number | null;
  enrollments: number;
}

export interface SourceRow {
  source: LeadSource | null;
  leads: number;
  conversionRate: number | null; // matrículas ÷ leads
  highInterestRate: number | null; // fração de leads com interesse alto
  avgCycleDays: number | null; // dias entre created_at do lead e signed_at da matrícula
}

/** Lead de interesse alto que ainda não fechou matrícula (requisito da reunião). */
export interface HighInterestLeadRow {
  id: string;
  /** Nome do responsável (o lead). */
  name: string;
  /** Nome do aluno, quando já informado no cadastro. */
  childName: string | null;
  stage: string;
  stageName: string;
  assignedName: string | null;
  daysSinceEntered: number;
  phone: string | null;
}

export interface HighInterestData {
  /** Leads com interesse alto ainda em aberto (não fechados, não perdidos). */
  open: number;
  /** Leads com interesse alto marcados como perdidos. */
  lost: number;
  /** Leads com interesse alto que fecharam matrícula. */
  converted: number;
  byStage: { stage: string; label: string; count: number }[];
  leads: HighInterestLeadRow[];
}

export interface DashboardData {
  periodLabel: string;
  macro: MacroKpis;
  funnel: FunnelStage[];
  sdr: SdrRow[];
  closers: CloserRow[];
  educationLevels: EducationLevelRow[];
  sources: SourceRow[];
  /** Funil de fechamento (visita agendada → matrícula). */
  closerFunnel: FunnelStage[];
  /** Ciclo de matrícula (1ª visita → assinatura), geral e por nível. */
  salesCycle: SalesCycleData;
  /** Motivos de perda do período, com dimensões p/ filtro. */
  lostReasons: LostReasonItem[];
  /** Interesse alto × não fechou matrícula (requisito da reunião). */
  highInterest: HighInterestData;
}

// ----------------------------------------------------------------------------
// Topo de Funil (atendimento)
// ----------------------------------------------------------------------------

/** Granularidade temporal do gráfico "leads por canal". */
export type TimeGranularity = 'day' | 'week' | 'month';

/** Um bucket temporal (dia/semana/mês) com a contagem de leads por canal. */
export interface ChannelBucket {
  /** Rótulo do bucket ("13/07", "Sem 07/07", "jul/26"). */
  label: string;
  /** Contagem por canal — chave é o slug do source ('sem_canal' p/ null). */
  counts: Record<string, number>;
}

export interface ChannelTotal {
  source: LeadSource | null;
  count: number;
  /** Fração 0..1 do total do período. */
  share: number;
}

/**
 * Taxa de conexão: tentativas com resposta ÷ tentativas realizadas.
 * "Conectou" = outcome responded ou scheduled.
 */
export interface ConnectionRateRow {
  /** Dimensão: canal de contato ou usuário. */
  key: string;
  label: string;
  attempts: number;
  connected: number;
  rate: number | null;
}

/**
 * Funil de qualificação:
 *  - interessados = leads com nível de interesse preenchido (médio ou alto)
 *  - quentes = interesse ALTO
 *  - visita = lead com visita agendada
 */
export interface QualificationFunnel {
  total: number;
  interessados: number;
  quentes: number;
  agendado: number;
}

export interface AppointmentsSummary {
  /** Visitas criadas no período. */
  booked: number;
  /** Com comparecimento confirmado (showed_up=true). */
  showed: number;
  /** Com desfecho conhecido (showed_up não-nulo). */
  resolved: number;
  /** showed ÷ resolved. */
  showRate: number | null;
  /** no-shows ÷ resolved — métrica de destaque. */
  noShowRate: number | null;
}

export interface NoShowByPersonRow {
  userId: string;
  name: string;
  avatarUrl: string | null;
  appointments: number;
  resolved: number;
  noShows: number;
  noShowRate: number | null;
}

export interface FirstResponseRow {
  userId: string;
  name: string;
  avatarUrl: string | null;
  leads: number;
  avgMinutes: number | null;
  /** Fração dos leads contatados em até 5 minutos (janela ideal). */
  under5MinRate: number | null;
}

export interface SdrActivityRow {
  userId: string;
  name: string;
  avatarUrl: string | null;
  attemptsToday: number;
  attemptsWeek: number;
  attemptsPeriod: number;
  followUps: number;
  appointments: number;
  /**
   * Cadência cumprida: fração das tentativas do período registradas dentro do
   * SLA de follow-up (sla_breached=false). null sem tentativas.
   */
  cadenceRate: number | null;
}

export interface TopoFunilData {
  periodLabel: string;
  granularity: TimeGranularity;
  buckets: ChannelBucket[];
  /** Canais na ordem de volume (para cores/series estáveis). */
  channelTotals: ChannelTotal[];
  connectionByChannel: ConnectionRateRow[];
  connectionBySdr: ConnectionRateRow[];
  qualification: QualificationFunnel;
  appointments: AppointmentsSummary;
  noShowBySdr: NoShowByPersonRow[];
  noShowByCloser: NoShowByPersonRow[];
  firstResponse: {
    avgMinutes: number | null;
    under5MinRate: number | null;
    rows: FirstResponseRow[];
  };
  sdrActivity: SdrActivityRow[];
}

/** Linha do rastreio lead a lead (/dashboard/leads-detalhado). */
export interface LeadAuditRow {
  id: string;
  name: string;
  source: LeadSource | null;
  createdAt: string;
  pipeline: string;
  stage: string;
  interestLevel: InterestLevel | null;
  assignedName: string | null;
  channelDetail: string | null;
}

// ----------------------------------------------------------------------------
// Conversão e fechamento
// ----------------------------------------------------------------------------

export interface SalesCycleLevelRow {
  level: EducationLevel | null;
  levelLabel: string;
  deals: number;
  avgDays: number | null;
}

export interface SalesCycleData {
  /** Dias médios entre a 1ª visita (scheduled_at) e a assinatura da matrícula. */
  avgDays: number | null;
  deals: number;
  byLevel: SalesCycleLevelRow[];
}

/** Perda individual com dimensões — o client agrega/filtra por responsável. */
export interface LostReasonItem {
  reason: LostReason;
  closerId: string | null;
  closerName: string | null;
}

// ----------------------------------------------------------------------------
// Pipeline e Forecast
// ----------------------------------------------------------------------------

export interface WeightedPipelineStageRow {
  slug: string;
  name: string;
  color: string;
  /** Probabilidade de fechamento configurada (0..1). */
  probability: number;
  leads: number;
  /** Σ valor estimado (ticket médio das matrículas recentes) sem ponderação. */
  rawValue: number;
  /** Σ valor × probabilidade. */
  weightedValue: number;
}

export interface VelocityWeek {
  /** Rótulo da semana ("07/07"). */
  label: string;
  /** Entradas: leads criados na semana. */
  entered: number;
  /** Saídas: matrículas fechadas + perdas registradas. */
  won: number;
  lost: number;
}

export interface AgingOpportunityRow {
  leadId: string;
  name: string;
  stage: string;
  stageName: string;
  closerName: string | null;
  daysInStage: number;
  estimatedValue: number | null;
}

export interface ForecastWindow {
  days: 30 | 60 | 90;
  /** Receita estimada (pipeline ponderado × fator de janela pelo ciclo médio). */
  estimated: number;
}

export interface PipelineForecastData {
  periodLabel: string;
  stages: WeightedPipelineStageRow[];
  rawTotal: number;
  weightedTotal: number;
  /** Leads ativos considerados. */
  activeLeads: number;
  /** Leads fora da soma por não haver ticket médio de referência. */
  leadsWithoutValue: number;
  /** Ticket médio de referência usado no valor estimado (null sem matrículas). */
  referenceTicket: number | null;
  velocity: VelocityWeek[];
  aging: AgingOpportunityRow[];
  agingThresholdDays: number;
  /** Ciclo de matrícula médio (dias) usado no fator das janelas. */
  avgCycleDays: number | null;
  forecast: ForecastWindow[];
  /** Conversão histórica visita→matrícula dos últimos 90 dias (contexto). */
  historicalConversion: number | null;
}

// ----------------------------------------------------------------------------
// Performance Individual
// ----------------------------------------------------------------------------

export interface IndividualPerformanceRow {
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: 'admin' | 'comercial';
  /** Tentativas de contato registradas no período. */
  activity: number;
  /** Visitas geradas (tentativas com outcome=scheduled). */
  appointments: number;
  /** Matrículas fechadas (deals com closed_by = usuário). */
  conversions: number;
  conversionRate: number | null;
  /** Σ contract_value das matrículas fechadas. */
  revenue: number;
  /** Metas do mês corrente (user_goals) — null sem meta cadastrada. */
  goalConversions: number | null;
  goalRevenue: number | null;
  goalProgress: number | null;
}

/** Canais possíveis do breakdown de conexão. */
export type ConnectionChannel = ContactChannel;

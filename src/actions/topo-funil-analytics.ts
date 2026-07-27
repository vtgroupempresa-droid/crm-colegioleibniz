import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/fetch-all-rows';
import type { ResolvedPeriod } from '@/lib/dashboard/period';
import { CONTACT_CHANNEL_LABELS, type ContactChannel, type LeadSource } from '@/types/lead';
import type {
  AppointmentsSummary,
  ChannelBucket,
  ChannelTotal,
  ConnectionRateRow,
  FirstResponseRow,
  NoShowByPersonRow,
  QualificationFunnel,
  SdrActivityRow,
  TimeGranularity,
  TopoFunilData,
} from '@/types/dashboard';

/**
 * Queries da seção Topo de Funil (Categoria 1 — geração e qualificação SDR).
 *
 * Mesmo padrão de `dashboard-analytics.ts`: uma rodada de SELECTs paginados e
 * agregação em TypeScript.
 *
 * Definições adotadas (não são nativas do schema — documentadas aqui):
 *  - Taxa de conexão = tentativas com outcome responded/scheduled ÷ TODAS as
 *    tentativas registradas (todo registro tem outcome; não existe "pendente").
 *  - Interessados = leads com nível de interesse preenchido (médio ou alto).
 *  - Quentes = nível de interesse ALTO OU lead que já tem visita agendada
 *    (a visita é o sinal de qualificação mais forte).
 *  - Cadência cumprida = fração das tentativas do período registradas SEM
 *    estourar o SLA da cadência (`contact_attempts.sla_breached = false`;
 *    deadlines definidos em `src/lib/sla/rules.ts`).
 *  - SLA de 1º contato = leads.created_at → primeira contact_attempt do lead;
 *    janela ideal = 5 minutos (mesmo limiar da 1ª etapa da cadência).
 */

const IDEAL_FIRST_RESPONSE_MIN = 5;

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

function avgOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function inWin(ts: string | null | undefined, start: Date, end: Date): boolean {
  if (!ts) return false;
  const t = new Date(ts).getTime();
  return t >= start.getTime() && t < end.getTime();
}

// ----------------------------------------------------------------------------
// Buckets temporais (calendário BRT, como em lib/dashboard/period.ts)
// ----------------------------------------------------------------------------

const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Instante UTC → Date "deslocada" cujos getters UTC representam o relógio BRT. */
function toBrt(instant: Date): Date {
  return new Date(instant.getTime() + BRT_OFFSET_MS);
}

const MONTH_LABEL = new Intl.DateTimeFormat('pt-BR', {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});
const DAY_LABEL = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
});

/** Chave e rótulo do bucket de um instante, conforme a granularidade. */
function bucketOf(instant: Date, granularity: TimeGranularity): { key: string; label: string } {
  const brt = toBrt(instant);
  if (granularity === 'month') {
    const key = `${brt.getUTCFullYear()}-${String(brt.getUTCMonth() + 1).padStart(2, '0')}`;
    return { key, label: MONTH_LABEL.format(brt) };
  }
  if (granularity === 'week') {
    // Semana começa na segunda-feira (mesma regra do filtro "Esta semana").
    const daysFromMonday = (brt.getUTCDay() + 6) % 7;
    const monday = new Date(brt.getTime() - daysFromMonday * MS_PER_DAY);
    const key = monday.toISOString().slice(0, 10);
    return { key, label: `Sem ${DAY_LABEL.format(monday)}` };
  }
  const key = brt.toISOString().slice(0, 10);
  return { key, label: DAY_LABEL.format(brt) };
}

/** Gera todos os buckets entre start e end (inclusive), mesmo os vazios. */
function bucketRange(start: Date, end: Date, granularity: TimeGranularity): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const seen = new Set<string>();
  const stepMs = granularity === 'day' ? MS_PER_DAY : granularity === 'week' ? 7 * MS_PER_DAY : 0;
  let cursor = new Date(start.getTime());
  const endMs = Math.max(start.getTime(), end.getTime() - 1);
  // Mês não tem passo fixo — avança pelo calendário.
  for (let guard = 0; guard < 400; guard += 1) {
    const b = bucketOf(cursor, granularity);
    if (!seen.has(b.key)) {
      seen.add(b.key);
      out.push(b);
    }
    if (cursor.getTime() > endMs) break;
    if (granularity === 'month') {
      const brt = toBrt(cursor);
      cursor = new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth() + 1, 1) - BRT_OFFSET_MS);
    } else {
      cursor = new Date(cursor.getTime() + stepMs);
    }
  }
  // Garante que o último instante coberto está incluído.
  const lastBucket = bucketOf(new Date(endMs), granularity);
  if (!seen.has(lastBucket.key)) out.push(lastBucket);
  return out;
}

// ----------------------------------------------------------------------------
// Tipos internos das linhas buscadas
// ----------------------------------------------------------------------------

interface LeadRow {
  id: string;
  created_at: string;
  source: LeadSource | null;
  interest_level: 'baixo' | 'medio' | 'alto' | null;
  pipeline: string;
  stage: string;
}

interface AttemptRow {
  id: string;
  lead_id: string;
  created_by: string | null;
  attempt_number: number;
  channel: ContactChannel;
  outcome: 'no_answer' | 'busy' | 'responded' | 'scheduled';
  attempted_at: string;
  sla_breached: boolean;
}

interface ApptRow {
  id: string;
  lead_id: string;
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
  showed_up: boolean | null;
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

export async function getTopoFunilData(opts: {
  isDemo?: boolean;
  period: ResolvedPeriod;
  granularity: TimeGranularity;
}): Promise<TopoFunilData> {
  const supabase = createClient();
  const isDemo = opts.isDemo ?? false;
  const { period, granularity } = opts;
  const { start, end } = period;

  const [leads, attempts, appts, profilesRes] = await Promise.all([
    fetchAllRows<LeadRow>((from, to) =>
      supabase
        .from('leads')
        .select('id, created_at, source, interest_level, pipeline, stage')
        .eq('is_demo', isDemo)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    fetchAllRows<AttemptRow>((from, to) =>
      supabase
        .from('contact_attempts')
        .select('id, lead_id, created_by, attempt_number, channel, outcome, attempted_at, sla_breached')
        .eq('is_demo', isDemo)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    fetchAllRows<ApptRow>((from, to) =>
      supabase
        .from('appointments')
        .select('id, lead_id, assigned_to, created_by, created_at, showed_up')
        .eq('is_demo', isDemo)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    supabase.from('user_profiles').select('id, name, avatar_url, role'),
  ]);

  const profiles = (profilesRes.data ?? []) as ProfileRow[];
  const profileById = new Map<string, ProfileRow>(profiles.map((p) => [p.id, p]));
  const nameOf = (id: string): { name: string; avatarUrl: string | null } => {
    const p = profileById.get(id);
    return { name: p?.name ?? 'Usuário', avatarUrl: p?.avatar_url ?? null };
  };

  const leadsInWindow = leads.filter((l) => inWin(l.created_at, start, end));
  const attemptsInWindow = attempts.filter((a) => inWin(a.attempted_at, start, end));
  const apptsInWindow = appts.filter((a) => inWin(a.created_at, start, end));

  // --- Leads por canal, bucketizados ---------------------------------------
  const bucketDefs = bucketRange(start, end, granularity);
  const bucketByKey = new Map<string, ChannelBucket>(
    bucketDefs.map((b) => [b.key, { label: b.label, counts: {} }]),
  );
  const totalBySource = new Map<string, number>();
  for (const lead of leadsInWindow) {
    const channelKey = lead.source ?? 'sem_canal';
    totalBySource.set(channelKey, (totalBySource.get(channelKey) ?? 0) + 1);
    const bucket = bucketByKey.get(bucketOf(new Date(lead.created_at), granularity).key);
    if (bucket) bucket.counts[channelKey] = (bucket.counts[channelKey] ?? 0) + 1;
  }
  const channelTotals: ChannelTotal[] = Array.from(totalBySource.entries())
    .map(([key, count]) => ({
      source: key === 'sem_canal' ? null : (key as LeadSource),
      count,
      share: ratio(count, leadsInWindow.length) ?? 0,
    }))
    .sort((a, b) => b.count - a.count);

  // --- Taxa de conexão -------------------------------------------------------
  const connected = (a: AttemptRow): boolean => a.outcome === 'responded' || a.outcome === 'scheduled';

  const byChannel = new Map<ContactChannel, { attempts: number; connected: number }>();
  const bySdr = new Map<string, { attempts: number; connected: number }>();
  for (const a of attemptsInWindow) {
    const ch = byChannel.get(a.channel) ?? { attempts: 0, connected: 0 };
    ch.attempts += 1;
    if (connected(a)) ch.connected += 1;
    byChannel.set(a.channel, ch);
    if (a.created_by) {
      const s = bySdr.get(a.created_by) ?? { attempts: 0, connected: 0 };
      s.attempts += 1;
      if (connected(a)) s.connected += 1;
      bySdr.set(a.created_by, s);
    }
  }
  const connectionByChannel: ConnectionRateRow[] = Array.from(byChannel.entries())
    .map(([channel, v]) => ({
      key: channel,
      label: CONTACT_CHANNEL_LABELS[channel],
      attempts: v.attempts,
      connected: v.connected,
      rate: ratio(v.connected, v.attempts),
    }))
    .sort((a, b) => b.attempts - a.attempts);
  const connectionBySdr: ConnectionRateRow[] = Array.from(bySdr.entries())
    .map(([userId, v]) => ({
      key: userId,
      label: nameOf(userId).name,
      attempts: v.attempts,
      connected: v.connected,
      rate: ratio(v.connected, v.attempts),
    }))
    .sort((a, b) => b.attempts - a.attempts);

  // --- Funil de qualificação (interesse) ------------------------------------
  const apptLeadIds = new Set(appts.map((a) => a.lead_id));
  let interessados = 0;
  let quentes = 0;
  let agendado = 0;
  for (const lead of leadsInWindow) {
    const hasAppt = apptLeadIds.has(lead.id);
    const reachedVisit = hasAppt || lead.stage === 'visita_presencial';
    const isQuente = lead.interest_level === 'alto' || reachedVisit;
    // Interessado é superconjunto de quente para o funil ser monotônico.
    const isInteressado =
      lead.interest_level === 'medio' || lead.interest_level === 'alto' || isQuente;
    if (isInteressado) interessados += 1;
    if (isQuente) quentes += 1;
    if (hasAppt) agendado += 1;
  }
  const qualification: QualificationFunnel = {
    total: leadsInWindow.length,
    interessados,
    quentes,
    agendado,
  };

  // --- Agendamentos marcados vs realizados + no-show -------------------------
  let showed = 0;
  let resolved = 0;
  for (const a of apptsInWindow) {
    if (a.showed_up === null) continue;
    resolved += 1;
    if (a.showed_up) showed += 1;
  }
  const appointments: AppointmentsSummary = {
    booked: apptsInWindow.length,
    showed,
    resolved,
    showRate: ratio(showed, resolved),
    noShowRate: ratio(resolved - showed, resolved),
  };

  const noShowBy = (idOf: (a: ApptRow) => string | null): NoShowByPersonRow[] => {
    const acc = new Map<string, { appointments: number; resolved: number; noShows: number }>();
    for (const a of apptsInWindow) {
      const id = idOf(a);
      if (!id) continue;
      const v = acc.get(id) ?? { appointments: 0, resolved: 0, noShows: 0 };
      v.appointments += 1;
      if (a.showed_up !== null) {
        v.resolved += 1;
        if (a.showed_up === false) v.noShows += 1;
      }
      acc.set(id, v);
    }
    return Array.from(acc.entries())
      .map(([userId, v]) => ({
        userId,
        ...nameOf(userId),
        appointments: v.appointments,
        resolved: v.resolved,
        noShows: v.noShows,
        noShowRate: ratio(v.noShows, v.resolved),
      }))
      .sort((a, b) => b.appointments - a.appointments);
  };
  const noShowBySdr = noShowBy((a) => a.created_by);
  const noShowByCloser = noShowBy((a) => a.assigned_to);

  // --- SLA de 1º contato ------------------------------------------------------
  const firstAttemptByLead = new Map<string, AttemptRow>();
  for (const a of [...attempts].sort(
    (x, y) => new Date(x.attempted_at).getTime() - new Date(y.attempted_at).getTime(),
  )) {
    if (!firstAttemptByLead.has(a.lead_id)) firstAttemptByLead.set(a.lead_id, a);
  }
  const allMins: number[] = [];
  const frBySdr = new Map<string, number[]>();
  for (const lead of leadsInWindow) {
    const fa = firstAttemptByLead.get(lead.id);
    if (!fa) continue;
    const mins = (new Date(fa.attempted_at).getTime() - new Date(lead.created_at).getTime()) / 60000;
    if (mins < 0) continue;
    allMins.push(mins);
    if (fa.created_by) {
      const list = frBySdr.get(fa.created_by) ?? [];
      list.push(mins);
      frBySdr.set(fa.created_by, list);
    }
  }
  const under5 = (mins: number[]): number | null =>
    ratio(mins.filter((m) => m <= IDEAL_FIRST_RESPONSE_MIN).length, mins.length);
  const firstResponseRows: FirstResponseRow[] = Array.from(frBySdr.entries())
    .map(([userId, mins]) => ({
      userId,
      ...nameOf(userId),
      leads: mins.length,
      avgMinutes: avgOf(mins),
      under5MinRate: under5(mins),
    }))
    .sort((a, b) => b.leads - a.leads);

  // --- Atividades por SDR -----------------------------------------------------
  const now = new Date();
  const nowBrt = toBrt(now);
  const startOfTodayBrt = new Date(
    Date.UTC(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), nowBrt.getUTCDate()) - BRT_OFFSET_MS,
  );
  const daysFromMonday = (nowBrt.getUTCDay() + 6) % 7;
  const startOfWeekBrt = new Date(startOfTodayBrt.getTime() - daysFromMonday * MS_PER_DAY);

  interface ActAcc {
    attemptsToday: number;
    attemptsWeek: number;
    attemptsPeriod: number;
    followUps: number;
    appointments: number;
    onCadence: number;
  }
  const actAcc = new Map<string, ActAcc>();
  for (const a of attempts) {
    if (!a.created_by) continue;
    const inPeriod = inWin(a.attempted_at, start, end);
    const inToday = inWin(a.attempted_at, startOfTodayBrt, now);
    const inWeek = inWin(a.attempted_at, startOfWeekBrt, now);
    if (!inPeriod && !inToday && !inWeek) continue;
    let acc = actAcc.get(a.created_by);
    if (!acc) {
      acc = { attemptsToday: 0, attemptsWeek: 0, attemptsPeriod: 0, followUps: 0, appointments: 0, onCadence: 0 };
      actAcc.set(a.created_by, acc);
    }
    if (inToday) acc.attemptsToday += 1;
    if (inWeek) acc.attemptsWeek += 1;
    if (inPeriod) {
      acc.attemptsPeriod += 1;
      if (a.attempt_number >= 2) acc.followUps += 1;
      if (a.outcome === 'scheduled') acc.appointments += 1;
      if (!a.sla_breached) acc.onCadence += 1;
    }
  }
  const sdrActivity: SdrActivityRow[] = Array.from(actAcc.entries())
    .map(([userId, acc]) => ({
      userId,
      ...nameOf(userId),
      attemptsToday: acc.attemptsToday,
      attemptsWeek: acc.attemptsWeek,
      attemptsPeriod: acc.attemptsPeriod,
      followUps: acc.followUps,
      appointments: acc.appointments,
      cadenceRate: ratio(acc.onCadence, acc.attemptsPeriod),
    }))
    .sort((a, b) => b.attemptsPeriod - a.attemptsPeriod);

  const buckets = bucketDefs.map((b) => bucketByKey.get(b.key) ?? { label: b.label, counts: {} });

  return {
    periodLabel: period.label,
    granularity,
    buckets,
    channelTotals,
    connectionByChannel,
    connectionBySdr,
    qualification,
    appointments,
    noShowBySdr,
    noShowByCloser,
    firstResponse: { avgMinutes: avgOf(allMins), under5MinRate: under5(allMins), rows: firstResponseRows },
    sdrActivity,
  };
}

import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/fetch-all-rows';
import type { ResolvedPeriod } from '@/lib/dashboard/period';
import type { IndividualPerformanceRow } from '@/types/dashboard';

/**
 * Performance individual — ranking por TAXA de conversão, não só volume,
 * + metas individuais (user_goals) do mês corrente.
 *
 * No Leibniz toda a equipe (admin + comercial) atende e fecha:
 *  - atividade = tentativas de contato registradas;
 *  - visitas = tentativas com outcome=scheduled;
 *  - conversões = matrículas fechadas (deals.closed_by);
 *  - receita = Σ contract_value.
 *
 * Meta batida vs realizada usa a meta do MÊS CORRENTE (BRT), independente do
 * período selecionado — meta é mensal por definição.
 */

const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

function inWin(ts: string | null | undefined, start: Date, end: Date): boolean {
  if (!ts) return false;
  const t = new Date(ts).getTime();
  return t >= start.getTime() && t < end.getTime();
}

export async function getIndividualPerformance(opts: {
  isDemo?: boolean;
  period: ResolvedPeriod;
}): Promise<{ rows: IndividualPerformanceRow[]; goalMonthLabel: string }> {
  const supabase = createClient();
  const isDemo = opts.isDemo ?? false;
  const { start, end } = opts.period;

  const nowBrt = new Date(Date.now() + BRT_OFFSET_MS);
  const goalMes = nowBrt.getUTCMonth() + 1;
  const goalAno = nowBrt.getUTCFullYear();

  const [profilesRes, attempts, deals, goalsRes] = await Promise.all([
    supabase.from('user_profiles').select('id, name, avatar_url, role'),
    fetchAllRows<{ created_by: string | null; outcome: string; attempted_at: string }>(
      (from, to) =>
        supabase
          .from('contact_attempts')
          .select('created_by, outcome, attempted_at')
          .eq('is_demo', isDemo)
          .order('id', { ascending: true })
          .range(from, to),
    ),
    fetchAllRows<{
      closed_by: string | null;
      signed_at: string;
      contract_value: number;
      sale_status: string;
    }>((from, to) =>
      supabase
        .from('deals')
        .select('closed_by, signed_at, contract_value, sale_status')
        .eq('is_demo', isDemo)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    supabase.from('user_goals').select('*').eq('mes', goalMes).eq('ano', goalAno),
  ]);

  const profiles = (profilesRes.data ?? []) as {
    id: string;
    name: string;
    avatar_url: string | null;
    role: string;
  }[];
  const goals = (goalsRes.data ?? []) as {
    user_id: string;
    meta_vendas: number;
    meta_faturamento: number;
    meta_agendamentos: number;
  }[];
  const goalByUser = new Map(goals.map((g) => [g.user_id, g]));

  const rows: IndividualPerformanceRow[] = [];
  for (const profile of profiles) {
    if (profile.role !== 'admin' && profile.role !== 'comercial') continue;
    const goal = goalByUser.get(profile.id);

    let activity = 0;
    let appointments = 0;
    for (const a of attempts) {
      if (a.created_by !== profile.id || !inWin(a.attempted_at, start, end)) continue;
      activity += 1;
      if (a.outcome === 'scheduled') appointments += 1;
    }

    let conversions = 0;
    let revenue = 0;
    for (const d of deals) {
      if (d.closed_by !== profile.id || d.sale_status === 'cancelada') continue;
      if (!inWin(d.signed_at, start, end)) continue;
      conversions += 1;
      revenue += d.contract_value ?? 0;
    }

    const goalConversions = goal && goal.meta_vendas > 0 ? goal.meta_vendas : null;
    const goalRevenue = goal && goal.meta_faturamento > 0 ? goal.meta_faturamento : null;

    // Progresso: com meta de faturamento usa receita; senão, matrículas.
    const goalProgress =
      goalRevenue !== null
        ? revenue / goalRevenue
        : goalConversions !== null
          ? conversions / goalConversions
          : null;

    // Sem atividade, sem conversão e sem meta → linha não agrega nada.
    if (activity === 0 && conversions === 0 && goalProgress === null) continue;

    rows.push({
      userId: profile.id,
      name: profile.name,
      avatarUrl: profile.avatar_url,
      role: profile.role as 'admin' | 'comercial',
      activity,
      appointments,
      conversions,
      conversionRate: ratio(conversions, appointments),
      revenue,
      goalConversions,
      goalRevenue,
      goalProgress,
    });
  }

  rows.sort((a, b) => (b.conversionRate ?? -1) - (a.conversionRate ?? -1));

  const goalMonthLabel = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(goalAno, goalMes - 1, 1)));
  return { rows, goalMonthLabel };
}

import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Lead } from '@/types/lead';
import type { PipelineKind } from '@/types/pipeline';

/**
 * Queries de leitura simples do dashboard (métricas de visão geral).
 * Demo-aware via parâmetro `isDemo` (cookie lido na página).
 */

export interface DashboardMetrics {
  totalLeads: number;
  byPipeline: { pipeline: PipelineKind; count: number }[];
  hotLeads: number;
  dealsCount: number;
  totalContractValue: number;
  conversionRate: number;
  slaBreached: number;
  recentDeals: {
    id: string;
    leadName: string;
    studentName: string | null;
    contractValue: number;
    signedAt: string;
  }[];
}

export async function getDashboardMetrics(
  opts: { isDemo?: boolean } = {},
): Promise<DashboardMetrics> {
  const supabase = createClient();
  const isDemo = opts.isDemo ?? false;

  const [{ data: leads }, { data: deals }, { data: attempts }, { data: recent }] =
    await Promise.all([
      supabase
        .from('leads')
        .select('id, pipeline, interest_level, name')
        .eq('is_demo', isDemo)
        .eq('is_archived', false),
      supabase
        .from('deals')
        .select('contract_value, sale_status')
        .eq('is_demo', isDemo),
      supabase.from('contact_attempts').select('id').eq('is_demo', isDemo).eq('sla_breached', true),
      supabase
        .from('deals')
        .select('id, lead_id, student_name, contract_value, signed_at, leads!inner(name, is_demo)')
        .eq('is_demo', isDemo)
        .order('signed_at', { ascending: false })
        .limit(5),
    ]);

  const totalLeads = leads?.length ?? 0;
  const counts = new Map<PipelineKind, number>();
  let hotLeads = 0;
  for (const lead of leads ?? []) {
    counts.set(lead.pipeline, (counts.get(lead.pipeline) ?? 0) + 1);
    if (lead.interest_level === 'alto') hotLeads += 1;
  }
  const PIPELINES: PipelineKind[] = ['comercial', 'pos_matricula'];
  const byPipeline = PIPELINES.map((p) => ({ pipeline: p, count: counts.get(p) ?? 0 }));

  const activeDeals = (deals ?? []).filter((d) => d.sale_status !== 'cancelada');
  const dealsCount = activeDeals.length;
  const totalContractValue = activeDeals.reduce((a, d) => a + (d.contract_value ?? 0), 0);
  const conversionRate = totalLeads > 0 ? dealsCount / (dealsCount + totalLeads) : 0;

  type RecentDealRow = {
    id: string;
    student_name: string | null;
    contract_value: number;
    signed_at: string;
    leads: { name: string } | { name: string }[] | null;
  };

  const recentDeals = ((recent ?? []) as RecentDealRow[]).map((d) => {
    const leadField = d.leads;
    const leadName = Array.isArray(leadField)
      ? (leadField[0]?.name ?? 'Lead')
      : (leadField?.name ?? 'Lead');
    return {
      id: d.id,
      leadName,
      studentName: d.student_name,
      contractValue: d.contract_value,
      signedAt: d.signed_at,
    };
  });

  return {
    totalLeads,
    byPipeline,
    hotLeads,
    dealsCount,
    totalContractValue,
    conversionRate,
    slaBreached: attempts?.length ?? 0,
    recentDeals,
  };
}

// Re-exportamos `Lead` aqui para o /dashboard usar o tipo direto.
export type { Lead };

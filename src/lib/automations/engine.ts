import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Json, Tables } from '@/types/database';

type AutomationRule = Tables<'automation_rules'>;
type LeadRow = Pick<
  Tables<'leads'>,
  'id' | 'name' | 'child_name' | 'stage' | 'pipeline' | 'assigned_to' | 'last_entered_at'
>;

export interface AutomationRunResult {
  ruleId: string;
  ruleName: string;
  fired: number;
  skipped: number;
  errors: number;
}

/** Config do gatilho (jsonb) — todos os campos são opcionais por design. */
interface TriggerConfig {
  pipeline?: string;
  stage?: string;
  /** parado_na_etapa / sem_resposta: tempo mínimo parado, em minutos. */
  minutes?: number;
}

/** Config da ação (jsonb). */
interface ActionConfig {
  title?: string;
  body?: string;
  /** notificar: 'responsavel' | 'todos' | uuid de um usuário. */
  notify?: string;
  /** criar_tarefa: prazo em horas a partir do disparo. */
  due_hours?: number;
  /** criar_tarefa: 'responsavel' | uuid. */
  assign_to?: string;
}

function parseConfig<T>(raw: Json): T {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as T) : ({} as T);
}

/** Substitui {{placeholders}} pelo contexto do disparo. */
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

/** Janela de lookback: eventos mais antigos que isso não disparam mais (evita
 * rajada de notificações atrasadas se o cron ficar um tempo fora). */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * Motor das automações configuráveis (/admin/automacoes).
 * Roda via cron (/api/automations/run, a cada 5min) com service role.
 * Cada disparo é deduplicado por `automation_runs.dedupe_key` — a chave inclui
 * o "momento" do evento (ex.: last_entered_at), então um lead que REENTRA na
 * etapa volta a disparar, mas o mesmo evento nunca dispara duas vezes.
 */
export async function runAutomations(now = new Date()): Promise<AutomationRunResult[]> {
  const supabase = createAdminClient();
  const results: AutomationRunResult[] = [];

  const { data: rules } = await supabase
    .from('automation_rules')
    .select('*')
    .eq('is_active', true);

  for (const rule of rules ?? []) {
    const result: AutomationRunResult = {
      ruleId: rule.id,
      ruleName: rule.name,
      fired: 0,
      skipped: 0,
      errors: 0,
    };

    try {
      const candidates = await findCandidates(rule, now);
      for (const candidate of candidates) {
        const inserted = await claimRun(rule.id, candidate.dedupeKey, candidate.leadId);
        if (!inserted) {
          result.skipped += 1;
          continue;
        }
        try {
          await executeAction(rule, candidate);
          result.fired += 1;
        } catch (err) {
          result.errors += 1;
          await supabase
            .from('automation_runs')
            .update({ status: 'error', error: err instanceof Error ? err.message : String(err) })
            .eq('dedupe_key', candidate.dedupeKey);
        }
      }
      await supabase
        .from('automation_rules')
        .update({ last_run_at: now.toISOString() })
        .eq('id', rule.id);
    } catch (err) {
      result.errors += 1;
      console.error(`[automations] regra "${rule.name}" falhou:`, err);
    }

    results.push(result);
  }

  return results;
}

interface Candidate {
  dedupeKey: string;
  leadId: string | null;
  /** Responsável natural do disparo (lead.assigned_to ou appointment.assigned_to). */
  assignedTo: string | null;
  vars: Record<string, string>;
}

async function findCandidates(rule: AutomationRule, now: Date): Promise<Candidate[]> {
  const supabase = createAdminClient();
  const config = parseConfig<TriggerConfig>(rule.trigger_config);
  const lookbackIso = new Date(now.getTime() - LOOKBACK_MS).toISOString();

  const leadVars = (lead: LeadRow): Record<string, string> => ({
    lead_name: lead.name,
    child_name: lead.child_name ?? '',
    stage: lead.stage,
  });

  switch (rule.trigger_type) {
    case 'lead_criado': {
      let query = supabase
        .from('leads')
        .select('id, name, child_name, stage, pipeline, assigned_to, last_entered_at, created_at')
        .eq('is_archived', false)
        .eq('is_demo', false)
        .gte('created_at', lookbackIso);
      if (config.pipeline) query = query.eq('pipeline', config.pipeline as LeadRow['pipeline']);
      const { data } = await query;
      return (data ?? []).map((lead) => ({
        dedupeKey: `${rule.id}:lead_criado:${lead.id}`,
        leadId: lead.id,
        assignedTo: lead.assigned_to,
        vars: leadVars(lead),
      }));
    }

    case 'entrou_etapa': {
      if (!config.stage) return [];
      let query = supabase
        .from('leads')
        .select('id, name, child_name, stage, pipeline, assigned_to, last_entered_at')
        .eq('stage', config.stage)
        .eq('is_archived', false)
        .eq('is_demo', false)
        .gte('last_entered_at', lookbackIso);
      if (config.pipeline) query = query.eq('pipeline', config.pipeline as LeadRow['pipeline']);
      const { data } = await query;
      return (data ?? []).map((lead) => ({
        dedupeKey: `${rule.id}:entrou:${lead.id}:${lead.last_entered_at}`,
        leadId: lead.id,
        assignedTo: lead.assigned_to,
        vars: leadVars(lead),
      }));
    }

    case 'parado_na_etapa': {
      if (!config.stage || !config.minutes) return [];
      const threshold = new Date(now.getTime() - config.minutes * 60_000).toISOString();
      let query = supabase
        .from('leads')
        .select('id, name, child_name, stage, pipeline, assigned_to, last_entered_at')
        .eq('stage', config.stage)
        .eq('is_archived', false)
        .eq('is_demo', false)
        .lte('last_entered_at', threshold);
      if (config.pipeline) query = query.eq('pipeline', config.pipeline as LeadRow['pipeline']);
      const { data } = await query;
      return (data ?? []).map((lead) => ({
        dedupeKey: `${rule.id}:parado:${lead.id}:${lead.last_entered_at}`,
        leadId: lead.id,
        assignedTo: lead.assigned_to,
        vars: leadVars(lead),
      }));
    }

    case 'visita_amanha': {
      // "Amanhã" no fuso da escola (Rondonópolis-MT, America/Cuiaba = UTC-4).
      const tzOffsetMs = 4 * 60 * 60 * 1000;
      const local = new Date(now.getTime() - tzOffsetMs);
      const startLocal = new Date(local);
      startLocal.setUTCHours(0, 0, 0, 0);
      startLocal.setUTCDate(startLocal.getUTCDate() + 1);
      const endLocal = new Date(startLocal.getTime() + 24 * 60 * 60 * 1000);
      const startUtc = new Date(startLocal.getTime() + tzOffsetMs).toISOString();
      const endUtc = new Date(endLocal.getTime() + tzOffsetMs).toISOString();

      const { data } = await supabase
        .from('appointments')
        .select('id, lead_id, scheduled_at, assigned_to, status, leads (id, name, child_name)')
        .gte('scheduled_at', startUtc)
        .lt('scheduled_at', endUtc)
        .neq('status', 'canceled');
      return (data ?? []).map((appt) => {
        const lead = appt.leads as { id: string; name: string; child_name: string | null } | null;
        const time = new Date(new Date(appt.scheduled_at).getTime() - tzOffsetMs);
        const hh = String(time.getUTCHours()).padStart(2, '0');
        const mm = String(time.getUTCMinutes()).padStart(2, '0');
        return {
          dedupeKey: `${rule.id}:visita:${appt.id}`,
          leadId: appt.lead_id,
          assignedTo: appt.assigned_to,
          vars: {
            lead_name: lead?.name ?? 'Lead',
            child_name: lead?.child_name ?? '',
            visit_time: `${hh}:${mm}`,
            stage: '',
          },
        };
      });
    }

    case 'sem_resposta': {
      // Conversas cuja ÚLTIMA mensagem é do contato (direction 'in') há mais
      // de N minutos — a família está esperando resposta da equipe.
      const minutes = config.minutes ?? 30;
      const threshold = new Date(now.getTime() - minutes * 60_000).toISOString();
      const { data: convos } = await supabase
        .from('conversations')
        .select('id, lead_id, assigned_to, contact_name, last_message_at')
        .eq('status', 'open')
        .lte('last_message_at', threshold)
        .gte('last_message_at', lookbackIso);

      const candidates: Candidate[] = [];
      for (const convo of convos ?? []) {
        const { data: lastMsg } = await supabase
          .from('messages')
          .select('direction')
          .eq('conversation_id', convo.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastMsg?.direction !== 'in') continue;
        candidates.push({
          dedupeKey: `${rule.id}:semresp:${convo.id}:${convo.last_message_at}`,
          leadId: convo.lead_id,
          assignedTo: convo.assigned_to,
          vars: {
            lead_name: convo.contact_name ?? 'Contato',
            child_name: '',
            stage: '',
          },
        });
      }
      return candidates;
    }

    default:
      return [];
  }
}

/** Registra o run ANTES de executar (claim) — o unique em dedupe_key garante
 * exatamente-uma-vez mesmo com crons concorrentes. Retorna false se já existia. */
async function claimRun(ruleId: string, dedupeKey: string, leadId: string | null) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('automation_runs')
    .insert({ rule_id: ruleId, dedupe_key: dedupeKey, lead_id: leadId, status: 'ok' });
  if (error) {
    // 23505 = unique_violation → outro run já processou este evento.
    if (error.code === '23505') return false;
    throw new Error(error.message);
  }
  return true;
}

async function executeAction(rule: AutomationRule, candidate: Candidate): Promise<void> {
  const supabase = createAdminClient();
  const config = parseConfig<ActionConfig>(rule.action_config);
  const title = interpolate(config.title ?? rule.name, candidate.vars);
  const body = interpolate(config.body ?? '', candidate.vars);

  switch (rule.action_type) {
    case 'notificar': {
      const targets = await resolveNotifyTargets(config.notify, candidate.assignedTo);
      if (targets.length === 0) return;
      const type =
        rule.trigger_type === 'visita_amanha'
          ? 'lembrete'
          : rule.trigger_type === 'lead_criado'
            ? 'novo_lead'
            : rule.trigger_type === 'sem_resposta'
              ? 'sla_vencendo'
              : 'followup';
      const { error } = await supabase.from('notifications').insert(
        targets.map((userId) => ({
          user_id: userId,
          type: type as Tables<'notifications'>['type'],
          title,
          body,
          lead_id: candidate.leadId,
        })),
      );
      if (error) throw new Error(error.message);
      return;
    }

    case 'criar_tarefa': {
      const assignee =
        config.assign_to && config.assign_to !== 'responsavel'
          ? config.assign_to
          : candidate.assignedTo;
      const dueAt = new Date(Date.now() + (config.due_hours ?? 24) * 60 * 60 * 1000);
      const { error } = await supabase.from('tasks').insert({
        lead_id: candidate.leadId,
        assigned_to: assignee,
        title,
        description: body || null,
        due_at: dueAt.toISOString(),
      });
      if (error) throw new Error(error.message);
      return;
    }

    case 'enviar_whatsapp': {
      // Ativado quando a instância WABA oficial estiver conectada — por ora o
      // run fica registrado como 'skipped' para auditoria.
      await supabase
        .from('automation_runs')
        .update({ status: 'skipped', error: 'Envio automático aguarda instância WhatsApp oficial conectada.' })
        .eq('dedupe_key', candidate.dedupeKey);
      return;
    }
  }
}

async function resolveNotifyTargets(
  notify: string | undefined,
  assignedTo: string | null,
): Promise<string[]> {
  const supabase = createAdminClient();
  if (!notify || notify === 'todos') {
    const { data } = await supabase.from('user_profiles').select('id');
    return (data ?? []).map((u) => u.id);
  }
  if (notify === 'responsavel') {
    if (assignedTo) return [assignedTo];
    // Sem responsável definido → avisa os admins.
    const { data } = await supabase.from('user_profiles').select('id').eq('role', 'admin');
    return (data ?? []).map((u) => u.id);
  }
  return [notify];
}

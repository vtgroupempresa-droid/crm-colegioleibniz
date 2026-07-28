-- ============================================================
-- CRM Colégio Leibniz — schema inicial
-- Derivado da arquitetura do CRM SariDoctors, adaptado para escola:
-- pipeline comercial de matrículas, campos de responsável/aluno,
-- automações configuráveis e integrações Meta (Instagram/WhatsApp).
-- ============================================================

create extension if not exists pg_trgm;

-- ── Enums ───────────────────────────────────────────────────

create type user_role as enum ('admin', 'comercial');

create type pipeline_kind as enum ('comercial', 'pos_matricula');

create type lead_source as enum (
  'meta_ads', 'whatsapp', 'instagram', 'telefone', 'presencial',
  'site', 'indicacao', 'organico', 'evento', 'reentrada', 'outro'
);

create type lost_reason as enum (
  'preco', 'momento', 'distancia', 'concorrente', 'sem_vaga',
  'sem_resposta', 'sem_interesse', 'numero_invalido', 'outro'
);

create type interest_level as enum ('baixo', 'medio', 'alto');

create type education_level as enum (
  'infantil', 'fundamental_1', 'fundamental_2', 'medio', 'pre_enem'
);

create type activity_type as enum (
  'call', 'whatsapp', 'email', 'stage_change', 'appointment', 'note', 'system'
);

create type contact_channel as enum ('whatsapp', 'phone', 'email', 'instagram', 'presencial');

create type contact_outcome as enum ('no_answer', 'busy', 'responded', 'scheduled');

create type notification_type as enum (
  'novo_lead', 'sla_vencendo', 'no_show', 'matricula_fechada',
  'followup', 'lembrete', 'sistema'
);

create type automation_trigger as enum (
  'lead_criado', 'entrou_etapa', 'parado_na_etapa', 'visita_amanha', 'sem_resposta'
);

create type automation_action as enum ('notificar', 'criar_tarefa', 'enviar_whatsapp');

-- ── Funções utilitárias ─────────────────────────────────────

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ── user_profiles ───────────────────────────────────────────

create table user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  role user_role not null default 'comercial',
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_profiles_updated_at before update on user_profiles
  for each row execute function set_updated_at();

-- Papel do usuário logado; SECURITY DEFINER para uso dentro de policies
create or replace function auth_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from user_profiles where id = auth.uid();
$$;

-- Cria o profile automaticamente quando um usuário é criado no Auth
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into user_profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'comercial')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ── pipeline_stages ─────────────────────────────────────────

create table pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline pipeline_kind not null,
  slug text not null,
  name text not null,
  position int not null,
  color text not null default '#64748b',
  is_entry boolean not null default false,
  is_terminal boolean not null default false,
  is_active boolean not null default true,
  required_fields text[] not null default '{}',
  stage_win_probability numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (pipeline, slug)
);

-- ── whatsapp_instances ──────────────────────────────────────
-- Linhas de atendimento (WABA oficial; estrutura pronta para múltiplas linhas)

create table whatsapp_instances (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  label text,
  provider text not null default 'official',
  phone_number text,
  phone_number_id text,
  instance_token text,
  is_active boolean not null default true,
  is_connected boolean not null default false,
  last_connected_at timestamptz,
  last_disconnected_at timestamptz,
  color text,
  created_at timestamptz not null default now()
);

-- ── leads ───────────────────────────────────────────────────

create table leads (
  id uuid primary key default gen_random_uuid(),
  -- responsável (o lead é o pai/mãe/responsável)
  name text not null,
  email text,
  phone text,
  phone_normalized text,
  instagram text,
  instagram_user_id text,
  facebook_user_id text,
  city text,
  state text,
  -- qualificação escolar
  interest_level interest_level,
  with_child boolean,               -- "se entra com o filho"
  child_name text,
  child_age int,
  education_level education_level,  -- nível de ensino
  school_year text,                 -- ano escolar (ex.: "3º ano EF")
  -- funil
  pipeline pipeline_kind not null default 'comercial',
  stage text not null,
  last_entered_at timestamptz not null default now(),
  assigned_to uuid references user_profiles (id) on delete set null,
  tags text[] not null default '{}',
  lost_reason lost_reason,
  is_archived boolean not null default false,
  is_no_show boolean not null default false,
  merged_into uuid references leads (id) on delete set null,
  -- atribuição / origem
  source lead_source,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  landing_page text,
  ad_creative text,
  meta_campaign_id text,
  meta_campaign_name text,
  meta_adset_id text,
  meta_adset_name text,
  meta_ad_id text,
  meta_ad_name text,
  meta_form_id text,
  meta_form_name text,
  meta_form_answers jsonb,
  meta_entries jsonb not null default '[]',
  -- infra
  whatsapp_instance_id uuid references whatsapp_instances (id) on delete set null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_stage_idx on leads (pipeline, stage) where not is_archived;
create index leads_assigned_idx on leads (assigned_to);
create index leads_phone_idx on leads (phone_normalized);
create index leads_ig_user_idx on leads (instagram_user_id);
create index leads_created_idx on leads (created_at desc);
create index leads_name_trgm_idx on leads using gin (name gin_trgm_ops);

create trigger leads_updated_at before update on leads
  for each row execute function set_updated_at();

-- Atualiza last_entered_at quando o lead troca de etapa
create or replace function touch_lead_stage()
returns trigger language plpgsql as $$
begin
  if new.stage is distinct from old.stage or new.pipeline is distinct from old.pipeline then
    new.last_entered_at = now();
  end if;
  return new;
end $$;

create trigger leads_stage_touch before update on leads
  for each row execute function touch_lead_stage();

-- ── activities (timeline do lead) ───────────────────────────

create table activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  user_id uuid references user_profiles (id) on delete set null,
  type activity_type not null,
  title text not null,
  description text,
  metadata jsonb not null default '{}',
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create index activities_lead_idx on activities (lead_id, created_at desc);

-- ── tasks ───────────────────────────────────────────────────

create table tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads (id) on delete cascade,
  assigned_to uuid references user_profiles (id) on delete set null,
  created_by uuid references user_profiles (id) on delete set null,
  title text not null,
  description text,
  due_at timestamptz not null,
  duration_minutes int not null default 30,
  status text not null default 'pending',
  completed_at timestamptz,
  google_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_assigned_idx on tasks (assigned_to, status, due_at);

create trigger tasks_updated_at before update on tasks
  for each row execute function set_updated_at();

-- ── appointments (visitas presenciais) ──────────────────────

create table appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  created_by uuid references user_profiles (id) on delete set null,
  assigned_to uuid references user_profiles (id) on delete set null,
  scheduled_at timestamptz not null,
  duration_minutes int not null default 60,
  status text not null default 'scheduled',
  confirmed boolean not null default false,
  confirmed_at timestamptz,
  showed_up boolean,
  no_show_recovered boolean not null default false,
  meeting_link text,
  notes text,
  google_event_id text,
  google_sync_status text,
  google_synced_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index appointments_sched_idx on appointments (scheduled_at);
create index appointments_lead_idx on appointments (lead_id);

create trigger appointments_updated_at before update on appointments
  for each row execute function set_updated_at();

-- ── contact_attempts (cadência de contato / SLA) ────────────

create table contact_attempts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  attempt_number int not null,
  channel contact_channel not null,
  outcome contact_outcome not null,
  attempted_at timestamptz not null default now(),
  sla_deadline timestamptz,
  sla_breached boolean not null default false,
  notes text,
  created_by uuid references user_profiles (id) on delete set null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create index contact_attempts_lead_idx on contact_attempts (lead_id, attempt_number);

-- ── notifications ───────────────────────────────────────────

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles (id) on delete cascade,
  type notification_type not null,
  title text not null,
  body text not null,
  lead_id uuid references leads (id) on delete cascade,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on notifications (user_id, read, created_at desc);

-- ── invitations ─────────────────────────────────────────────

create table invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role user_role not null,
  token text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_user_id uuid references user_profiles (id) on delete set null,
  revoked_at timestamptz,
  created_by uuid references user_profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ── conversations / messages (inbox multicanal) ─────────────

create table conversations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads (id) on delete set null,
  channel text not null,                 -- 'whatsapp' | 'instagram'
  external_id text not null,             -- telefone (WA) ou IG user id
  contact_name text,
  status text not null default 'open',
  assigned_to uuid references user_profiles (id) on delete set null,
  last_message_at timestamptz,
  whatsapp_instance_id uuid references whatsapp_instances (id) on delete set null,
  waba_id text,
  -- campos de automação de follow-up (motor de automações)
  followup_day int not null default 0,
  followup_last_sent_at timestamptz,
  followup_stopped boolean not null default false,
  followup_stop_reason text,
  -- reservado para IA futura (mantido por compatibilidade da base)
  ai_active boolean not null default false,
  ai_muted boolean not null default false,
  ai_activated_at timestamptz,
  ai_deactivated_at timestamptz,
  shadow_mode boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, external_id, whatsapp_instance_id)
);

create index conversations_last_msg_idx on conversations (last_message_at desc nulls last);
create index conversations_lead_idx on conversations (lead_id);

create trigger conversations_updated_at before update on conversations
  for each row execute function set_updated_at();

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  direction text not null,               -- 'in' | 'out'
  sender_type text not null default 'contact',
  type text not null default 'text',
  content text,
  media_url text,
  media_mime_type text,
  external_message_id text,
  status text not null default 'received',
  sent_at timestamptz,
  sent_by uuid references user_profiles (id) on delete set null,
  metadata jsonb,
  pending_approval boolean not null default false,
  approved_at timestamptz,
  approved_by uuid references user_profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index messages_conversation_idx on messages (conversation_id, created_at);
create unique index messages_external_idx on messages (external_message_id) where external_message_id is not null;

-- ── message_templates ───────────────────────────────────────

create table message_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text not null,
  content text not null,
  variables text[] not null default '{}',
  meta_template_name text,
  meta_template_language text not null default 'pt_BR',
  is_active boolean not null default true,
  created_by uuid references user_profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ── deals (matrículas fechadas) ─────────────────────────────

create table deals (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  student_name text,
  education_level education_level,
  school_year text,
  enrollment_year text,                  -- ano letivo, ex.: "2027"
  contract_value numeric not null default 0,   -- valor total (anuidade)
  monthly_value numeric,
  discount_pct numeric,
  installments int,
  payment_method text,
  signed_at timestamptz not null default now(),
  sale_status text not null default 'ativa',   -- 'ativa' | 'cancelada'
  cancel_reason text,
  canceled_at timestamptz,
  closed_by uuid references user_profiles (id) on delete set null,
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index deals_signed_idx on deals (signed_at desc);
create index deals_lead_idx on deals (lead_id);

create trigger deals_updated_at before update on deals
  for each row execute function set_updated_at();

-- ── metas (dashboard) ───────────────────────────────────────

create table dashboard_config (
  id uuid primary key default gen_random_uuid(),
  mes int not null,
  ano int not null,
  meta_leads int not null default 0,
  meta_agendamentos int not null default 0,   -- meta de visitas
  meta_vendas int not null default 0,         -- meta de matrículas
  meta_faturamento numeric not null default 0,
  investimento_total_ads numeric not null default 0,
  investimento_por_canal jsonb not null default '{}',
  created_by uuid references user_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mes, ano)
);

create trigger dashboard_config_updated_at before update on dashboard_config
  for each row execute function set_updated_at();

create table user_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles (id) on delete cascade,
  mes int not null,
  ano int not null,
  meta_agendamentos int not null default 0,
  meta_vendas int not null default 0,
  meta_faturamento numeric not null default 0,
  created_by uuid references user_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, mes, ano)
);

create trigger user_goals_updated_at before update on user_goals
  for each row execute function set_updated_at();

-- ── webhooks genéricos (Traffic AI, site, etc.) ─────────────

create table webhook_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  secret text not null,
  is_active boolean not null default true,
  default_pipeline pipeline_kind not null default 'comercial',
  default_stage text not null default 'novo_lead',
  field_mapping jsonb not null default '{}',
  tag_rules jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table webhook_logs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references webhook_sources (id) on delete cascade,
  payload jsonb not null default '{}',
  status text not null default 'received',
  error_message text,
  lead_id uuid references leads (id) on delete set null,
  processing_time_ms int,
  received_at timestamptz not null default now()
);

create index webhook_logs_source_idx on webhook_logs (source_id, received_at desc);

-- ── tokens de integração (Meta/IG renovação, etc.) ──────────

create table integration_tokens (
  key text primary key,
  access_token text not null,
  expires_at timestamptz,
  refreshed_at timestamptz,
  updated_at timestamptz
);

-- ── Google Calendar (sync de visitas) ───────────────────────

create table google_calendar_tokens (
  id uuid primary key default gen_random_uuid(),
  calendar_id text not null default 'primary',
  connected_email text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  sync_token text,
  last_refreshed_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create table google_calendar_events (
  id uuid primary key default gen_random_uuid(),
  google_event_id text not null unique,
  calendar_id text not null default 'primary',
  appointment_id uuid references appointments (id) on delete set null,
  summary text,
  description text,
  start_at timestamptz,
  end_at timestamptz,
  all_day boolean not null default false,
  status text,
  html_link text,
  meet_link text,
  attendees jsonb,
  updated_at_google timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger google_calendar_events_updated_at before update on google_calendar_events
  for each row execute function set_updated_at();

-- ── deduplicação de leads ───────────────────────────────────

create table duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  lead_a_id uuid not null references leads (id) on delete cascade,
  lead_b_id uuid not null references leads (id) on delete cascade,
  confidence_layer int not null,
  name_similarity numeric not null,
  supporting_signals text[] not null default '{}',
  status text not null default 'pending',
  detected_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references user_profiles (id) on delete set null,
  unique (lead_a_id, lead_b_id)
);

-- ── automações (alertas, follow-ups, lembretes) ─────────────

create table automation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  trigger_type automation_trigger not null,
  trigger_config jsonb not null default '{}',  -- {stage, pipeline, hours, ...}
  action_type automation_action not null,
  action_config jsonb not null default '{}',   -- {title, body, template_id, assign_to, due_hours}
  last_run_at timestamptz,
  created_by uuid references user_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger automation_rules_updated_at before update on automation_rules
  for each row execute function set_updated_at();

create table automation_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references automation_rules (id) on delete cascade,
  lead_id uuid references leads (id) on delete cascade,
  dedupe_key text not null unique,
  status text not null default 'ok',
  error text,
  executed_at timestamptz not null default now()
);

create index automation_runs_rule_idx on automation_runs (rule_id, executed_at desc);

-- ── RPCs usadas pelo app ────────────────────────────────────

create or replace function list_salespeople()
returns table (id uuid, name text, role user_role)
language sql stable security definer set search_path = public as $$
  select id, name, role from user_profiles order by name;
$$;

create or replace function count_activities_for_leads(lead_ids uuid[])
returns table (lead_id uuid, activity_count bigint)
language sql stable set search_path = public as $$
  select a.lead_id, count(*) as activity_count
  from activities a
  where a.lead_id = any (lead_ids)
  group by a.lead_id;
$$;

create or replace function find_name_duplicate_pairs(min_sim numeric default 0.55)
returns table (
  a_id uuid, a_name text, a_phone text, a_email text, a_city text, a_state text,
  a_created_at timestamptz, a_activity_count bigint,
  b_id uuid, b_name text, b_phone text, b_email text, b_city text, b_state text,
  b_created_at timestamptz, b_activity_count bigint,
  name_similarity numeric
) language sql stable set search_path = public as $$
  with counts as (
    select lead_id, count(*) as cnt from activities group by lead_id
  )
  select
    a.id, a.name, a.phone, a.email, a.city, a.state, a.created_at,
    coalesce(ca.cnt, 0),
    b.id, b.name, b.phone, b.email, b.city, b.state, b.created_at,
    coalesce(cb.cnt, 0),
    similarity(a.name, b.name)::numeric
  from leads a
  join leads b on a.id < b.id
    and a.merged_into is null and b.merged_into is null
    and similarity(a.name, b.name) >= min_sim
  left join counts ca on ca.lead_id = a.id
  left join counts cb on cb.lead_id = b.id;
$$;

create or replace function find_similar_leads_by_name(
  p_lead_id uuid, min_sim numeric default 0.55, window_days int default 365
)
returns table (
  b_id uuid, b_name text, b_phone text, b_email text, b_city text, b_state text,
  b_created_at timestamptz, b_activity_count bigint, name_similarity numeric
) language sql stable set search_path = public as $$
  with target as (select id, name from leads where id = p_lead_id),
  counts as (select lead_id, count(*) as cnt from activities group by lead_id)
  select
    b.id, b.name, b.phone, b.email, b.city, b.state, b.created_at,
    coalesce(cb.cnt, 0), similarity(t.name, b.name)::numeric
  from leads b
  cross join target t
  left join counts cb on cb.lead_id = b.id
  where b.id <> t.id
    and b.merged_into is null
    and b.created_at >= now() - make_interval(days => window_days)
    and similarity(t.name, b.name) >= min_sim
  order by similarity(t.name, b.name) desc
  limit 20;
$$;

create or replace function duplicate_lead_groups()
returns table (match_key text, match_type text, members jsonb)
language sql stable set search_path = public as $$
  with dupes as (
    select phone_normalized as match_key, 'phone' as match_type,
      jsonb_agg(jsonb_build_object('id', id, 'name', name, 'created_at', created_at)) as members
    from leads
    where phone_normalized is not null and merged_into is null
    group by phone_normalized
    having count(*) > 1
    union all
    select lower(email), 'email',
      jsonb_agg(jsonb_build_object('id', id, 'name', name, 'created_at', created_at))
    from leads
    where email is not null and merged_into is null
    group by lower(email)
    having count(*) > 1
  )
  select * from dupes;
$$;

-- ── RLS ─────────────────────────────────────────────────────

alter table user_profiles enable row level security;
alter table pipeline_stages enable row level security;
alter table whatsapp_instances enable row level security;
alter table leads enable row level security;
alter table activities enable row level security;
alter table tasks enable row level security;
alter table appointments enable row level security;
alter table contact_attempts enable row level security;
alter table notifications enable row level security;
alter table invitations enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table message_templates enable row level security;
alter table deals enable row level security;
alter table dashboard_config enable row level security;
alter table user_goals enable row level security;
alter table webhook_sources enable row level security;
alter table webhook_logs enable row level security;
alter table integration_tokens enable row level security;
alter table google_calendar_tokens enable row level security;
alter table google_calendar_events enable row level security;
alter table duplicate_candidates enable row level security;
alter table automation_rules enable row level security;
alter table automation_runs enable row level security;

-- Equipe pequena que centraliza todas as linhas: comercial e admin
-- enxergam tudo; escrita liberada para a equipe; exclusão e
-- configuração são de admin. Webhooks/crons usam service role (bypass).

-- user_profiles: todos da equipe leem; cada um edita o próprio; admin tudo
create policy "team reads profiles" on user_profiles
  for select using (auth_role() is not null);
create policy "own profile update" on user_profiles
  for update using (id = auth.uid());
create policy "admin manages profiles" on user_profiles
  for all using (auth_role() = 'admin');

-- pipeline_stages: equipe lê; admin gerencia
create policy "team reads stages" on pipeline_stages
  for select using (auth_role() is not null);
create policy "admin manages stages" on pipeline_stages
  for all using (auth_role() = 'admin');

-- whatsapp_instances: equipe lê; admin gerencia
create policy "team reads instances" on whatsapp_instances
  for select using (auth_role() is not null);
create policy "admin manages instances" on whatsapp_instances
  for all using (auth_role() = 'admin');

-- operacionais: equipe lê/escreve; admin deleta
create policy "team reads leads" on leads for select using (auth_role() is not null);
create policy "team writes leads" on leads for insert with check (auth_role() is not null);
create policy "team updates leads" on leads for update using (auth_role() is not null);
create policy "admin deletes leads" on leads for delete using (auth_role() = 'admin');

create policy "team reads activities" on activities for select using (auth_role() is not null);
create policy "team writes activities" on activities for insert with check (auth_role() is not null);
create policy "admin deletes activities" on activities for delete using (auth_role() = 'admin');

create policy "team reads tasks" on tasks for select using (auth_role() is not null);
create policy "team writes tasks" on tasks for insert with check (auth_role() is not null);
create policy "team updates tasks" on tasks for update using (auth_role() is not null);
create policy "team deletes tasks" on tasks for delete using (auth_role() is not null);

create policy "team reads appointments" on appointments for select using (auth_role() is not null);
create policy "team writes appointments" on appointments for insert with check (auth_role() is not null);
create policy "team updates appointments" on appointments for update using (auth_role() is not null);
create policy "admin deletes appointments" on appointments for delete using (auth_role() = 'admin');

create policy "team reads attempts" on contact_attempts for select using (auth_role() is not null);
create policy "team writes attempts" on contact_attempts for insert with check (auth_role() is not null);
create policy "team updates attempts" on contact_attempts for update using (auth_role() is not null);
create policy "admin deletes attempts" on contact_attempts for delete using (auth_role() = 'admin');

-- notifications: cada um vê e atualiza as suas; equipe pode criar para colegas
create policy "own notifications" on notifications
  for select using (user_id = auth.uid());
create policy "own notifications update" on notifications
  for update using (user_id = auth.uid());
create policy "team creates notifications" on notifications
  for insert with check (auth_role() is not null);
create policy "own notifications delete" on notifications
  for delete using (user_id = auth.uid());

-- invitations: admin
create policy "admin manages invitations" on invitations
  for all using (auth_role() = 'admin');

create policy "team reads conversations" on conversations for select using (auth_role() is not null);
create policy "team writes conversations" on conversations for insert with check (auth_role() is not null);
create policy "team updates conversations" on conversations for update using (auth_role() is not null);
create policy "admin deletes conversations" on conversations for delete using (auth_role() = 'admin');

create policy "team reads messages" on messages for select using (auth_role() is not null);
create policy "team writes messages" on messages for insert with check (auth_role() is not null);
create policy "team updates messages" on messages for update using (auth_role() is not null);
create policy "admin deletes messages" on messages for delete using (auth_role() = 'admin');

create policy "team reads templates" on message_templates for select using (auth_role() is not null);
create policy "admin manages templates" on message_templates for all using (auth_role() = 'admin');

create policy "team reads deals" on deals for select using (auth_role() is not null);
create policy "team writes deals" on deals for insert with check (auth_role() is not null);
create policy "team updates deals" on deals for update using (auth_role() is not null);
create policy "admin deletes deals" on deals for delete using (auth_role() = 'admin');

create policy "team reads dashboard config" on dashboard_config for select using (auth_role() is not null);
create policy "admin manages dashboard config" on dashboard_config for all using (auth_role() = 'admin');

create policy "team reads goals" on user_goals for select using (auth_role() is not null);
create policy "admin manages goals" on user_goals for all using (auth_role() = 'admin');

create policy "admin manages webhook sources" on webhook_sources for all using (auth_role() = 'admin');
create policy "admin reads webhook logs" on webhook_logs for select using (auth_role() = 'admin');

-- integration/google tokens: sem policies de anon/auth — somente service role

create policy "team reads gcal events" on google_calendar_events
  for select using (auth_role() is not null);

create policy "team reads duplicates" on duplicate_candidates for select using (auth_role() is not null);
create policy "team updates duplicates" on duplicate_candidates for update using (auth_role() is not null);
create policy "admin deletes duplicates" on duplicate_candidates for delete using (auth_role() = 'admin');

create policy "team reads automations" on automation_rules for select using (auth_role() is not null);
create policy "admin manages automations" on automation_rules for all using (auth_role() = 'admin');
create policy "team reads automation runs" on automation_runs for select using (auth_role() is not null);

-- ── Realtime ────────────────────────────────────────────────

alter publication supabase_realtime add table conversations;
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table notifications;
alter publication supabase_realtime add table webhook_logs;

-- ── Storage buckets ─────────────────────────────────────────

insert into storage.buckets (id, name, public) values
  ('avatars', 'avatars', true),
  ('chat-media', 'chat-media', true)
on conflict (id) do nothing;

create policy "team uploads avatars" on storage.objects
  for insert with check (bucket_id = 'avatars' and auth.role() = 'authenticated');
create policy "team updates avatars" on storage.objects
  for update using (bucket_id = 'avatars' and auth.role() = 'authenticated');
create policy "public reads avatars" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "team uploads chat media" on storage.objects
  for insert with check (bucket_id = 'chat-media' and auth.role() = 'authenticated');
create policy "public reads chat media" on storage.objects
  for select using (bucket_id = 'chat-media');

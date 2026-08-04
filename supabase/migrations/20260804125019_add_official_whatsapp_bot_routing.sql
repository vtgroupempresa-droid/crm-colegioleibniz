alter table public.whatsapp_instances
  add column bot_enabled boolean not null default false;

create table public.conversation_bot_sessions (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  whatsapp_instance_id uuid references public.whatsapp_instances (id) on delete set null,
  selected_sector_id uuid references public.sectors (id) on delete set null,
  state text not null default 'awaiting_sector' check (
    state in (
      'awaiting_sector',
      'sales_awaiting_name',
      'sales_awaiting_interest',
      'sales_awaiting_segment',
      'sales_awaiting_age_or_grade',
      'sales_awaiting_next_step',
      'sales_awaiting_faq',
      'sales_awaiting_visit_availability',
      'sales_awaiting_student_data',
      'human_handoff',
      'completed'
    )
  ),
  context jsonb not null default '{}'::jsonb,
  fallback_count integer not null default 0 check (fallback_count between 0 and 10),
  last_bot_message_at timestamptz,
  routed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger conversation_bot_sessions_updated_at
  before update on public.conversation_bot_sessions
  for each row execute function public.set_updated_at();

create index conversation_bot_sessions_state_idx
  on public.conversation_bot_sessions (state, updated_at desc);

create table public.conversation_sector_transfers (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  from_sector_id uuid references public.sectors (id) on delete set null,
  to_sector_id uuid not null references public.sectors (id) on delete restrict,
  source text not null check (source in ('bot', 'user', 'system')),
  reason text,
  created_by uuid references public.user_profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index conversation_sector_transfers_conversation_idx
  on public.conversation_sector_transfers (conversation_id, created_at desc);

alter table public.conversation_bot_sessions enable row level security;
alter table public.conversation_sector_transfers enable row level security;

revoke all on table public.conversation_bot_sessions from public, anon, authenticated;
revoke all on table public.conversation_sector_transfers from public, anon, authenticated;
grant all on table public.conversation_bot_sessions to service_role;
grant all on table public.conversation_sector_transfers to service_role;
grant select on table public.conversation_sector_transfers to authenticated;

create policy "sector reads conversation transfers"
  on public.conversation_sector_transfers
  for select to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = conversation_sector_transfers.conversation_id
    )
  );

-- O projeto possui uma única linha oficial ativa. Novas linhas ficam com o
-- bot desligado até o admin ativar explicitamente no CRM.
update public.whatsapp_instances
set bot_enabled = true
where provider = 'official'
  and is_active = true;

comment on column public.whatsapp_instances.bot_enabled is
  'Ativa o bot institucional e o menu inicial de roteamento por setor nesta linha oficial.';
comment on table public.conversation_bot_sessions is
  'Estado privado do bot determinístico de atendimento do Colégio Leibniz.';
comment on table public.conversation_sector_transfers is
  'Auditoria das transferências de conversas entre setores.';

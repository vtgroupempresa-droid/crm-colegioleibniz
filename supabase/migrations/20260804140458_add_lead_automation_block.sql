alter table public.leads
  add column automations_blocked boolean not null default false,
  add column automations_blocked_at timestamptz,
  add column automations_blocked_by uuid references public.user_profiles (id) on delete set null;

create index leads_automations_blocked_by_idx
  on public.leads (automations_blocked_by)
  where automations_blocked_by is not null;

comment on column public.leads.automations_blocked is
  'Trava operacional: impede bot, IA e mensagens/follow-ups automáticos em todas as conversas do lead.';

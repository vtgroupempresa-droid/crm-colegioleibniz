alter table public.leads
  add column if not exists monthly_budget numeric(12, 2);

alter table public.leads
  drop constraint if exists leads_monthly_budget_non_negative;

alter table public.leads
  add constraint leads_monthly_budget_non_negative
  check (monthly_budget is null or monthly_budget >= 0);

comment on column public.leads.monthly_budget is
  'Orçamento mensal informado pela família para a mensalidade escolar.';

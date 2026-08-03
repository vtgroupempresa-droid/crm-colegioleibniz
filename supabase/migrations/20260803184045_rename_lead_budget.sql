alter table public.leads
  rename column monthly_budget to budget;

alter table public.leads
  rename constraint leads_monthly_budget_non_negative to leads_budget_non_negative;

comment on column public.leads.budget is
  'Orçamento informado pela família para a matrícula escolar.';

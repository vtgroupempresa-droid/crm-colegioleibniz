-- Resumo atual da qualificação: é pesquisável no funil e cada atualização
-- também gera uma activity imutável para preservar o histórico da conversa.
alter type public.activity_type add value if not exists 'qualification';

alter table public.leads
  add column if not exists qualification_status text,
  add column if not exists qualification_note text,
  add column if not exists qualification_next_action text,
  add column if not exists qualification_next_action_at timestamptz,
  add column if not exists qualification_updated_at timestamptz,
  add column if not exists qualification_updated_by uuid references public.user_profiles (id) on delete set null;

alter table public.leads
  drop constraint if exists leads_qualification_status_check,
  add constraint leads_qualification_status_check check (
    qualification_status is null or qualification_status in (
      'muito_interessado',
      'comparando_opcoes',
      'quer_agendar_visita',
      'duvida_valor_bolsa',
      'consultar_familia',
      'aguardando_retorno',
      'sem_resposta',
      'sem_interesse',
      'outro'
    )
  ),
  drop constraint if exists leads_qualification_next_action_check,
  add constraint leads_qualification_next_action_check check (
    qualification_next_action is null or qualification_next_action in (
      'retornar_contato',
      'enviar_proposta',
      'agendar_visita',
      'aguardar'
    )
  ),
  drop constraint if exists leads_qualification_note_length_check,
  add constraint leads_qualification_note_length_check check (
    qualification_note is null or char_length(qualification_note) <= 2000
  ),
  drop constraint if exists leads_qualification_next_action_at_check,
  add constraint leads_qualification_next_action_at_check check (
    qualification_next_action_at is null or qualification_next_action is not null
  );

create index if not exists leads_qualification_status_updated_idx
  on public.leads (qualification_status, qualification_updated_at desc)
  where not is_archived and qualification_status is not null;

create index if not exists leads_qualification_next_action_at_idx
  on public.leads (qualification_next_action_at)
  where not is_archived and qualification_next_action_at is not null;

-- A atualização do estado atual e o evento da timeline acontecem na mesma
-- transação. A função roda com as permissões do usuário autenticado (RLS), sem
-- privilégios elevados, e só é exposta à role authenticated.
create or replace function public.set_lead_qualification(
  p_lead_id uuid,
  p_status text,
  p_note text default null,
  p_next_action text default null,
  p_next_action_at timestamptz default null
)
returns public.leads
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lead public.leads;
  v_label text;
  v_note text;
  v_next_action_label text;
begin
  v_label := case p_status
    when 'muito_interessado' then 'Gostou bastante'
    when 'comparando_opcoes' then 'Está comparando outras opções'
    when 'quer_agendar_visita' then 'Quer agendar visita'
    when 'duvida_valor_bolsa' then 'Tem dúvida sobre valor ou bolsa'
    when 'consultar_familia' then 'Precisa conversar com a família'
    when 'aguardando_retorno' then 'Aguardando retorno'
    when 'sem_resposta' then 'Sem resposta'
    when 'sem_interesse' then 'Não gostou ou sem interesse'
    when 'outro' then 'Outro'
    else null
  end;

  if v_label is null then
    raise exception 'Situação de qualificação inválida';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if p_status = 'outro' and v_note is null then
    raise exception 'Descreva a situação ao escolher Outro';
  end if;
  v_note := coalesce(v_note, v_label);

  v_next_action_label := case p_next_action
    when 'retornar_contato' then 'Retornar contato'
    when 'enviar_proposta' then 'Enviar proposta'
    when 'agendar_visita' then 'Agendar visita'
    when 'aguardar' then 'Aguardar'
    when null then null
    else null
  end;

  if p_next_action is not null and v_next_action_label is null then
    raise exception 'Próximo passo inválido';
  end if;
  if p_next_action is null and p_next_action_at is not null then
    raise exception 'Defina o próximo passo antes de informar uma data';
  end if;

  update public.leads
  set qualification_status = p_status,
      qualification_note = v_note,
      qualification_next_action = p_next_action,
      qualification_next_action_at = p_next_action_at,
      qualification_updated_at = now(),
      qualification_updated_by = auth.uid()
  where id = p_lead_id
  returning * into v_lead;

  if not found then
    raise exception 'Lead não encontrado ou sem permissão para atualizar';
  end if;

  insert into public.activities (lead_id, user_id, type, title, description, metadata, is_demo)
  values (
    v_lead.id,
    auth.uid(),
    'qualification',
    'Qualificação: ' || v_label,
    v_note,
    jsonb_build_object(
      'qualification_status', p_status,
      'next_action', p_next_action,
      'next_action_label', v_next_action_label,
      'next_action_at', p_next_action_at
    ),
    v_lead.is_demo
  );

  return v_lead;
end;
$$;

revoke execute on function public.set_lead_qualification(uuid, text, text, text, timestamptz) from public;
grant execute on function public.set_lead_qualification(uuid, text, text, text, timestamptz) to authenticated;

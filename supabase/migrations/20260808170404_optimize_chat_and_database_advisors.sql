-- Remove o N+1 da caixa de entrada: a lista de até 200 conversas passa a buscar
-- a última mensagem e a quantidade de não lidas em uma única chamada/RPC.
create index if not exists messages_unread_conversation_idx
  on public.messages (conversation_id)
  where direction = 'inbound' and status in ('sent', 'delivered');

create or replace function public.get_conversation_list_stats(p_conversation_ids uuid[])
returns table (
  conversation_id uuid,
  last_content text,
  last_type text,
  last_direction text,
  unread_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with requested as (
    select distinct id
    from unnest(p_conversation_ids) as requested_ids(id)
  ),
  latest as (
    select
      requested.id as conversation_id,
      message.content as last_content,
      message.type as last_type,
      message.direction as last_direction
    from requested
    left join lateral (
      select m.content, m.type, m.direction
      from public.messages m
      where m.conversation_id = requested.id
      order by m.created_at desc
      limit 1
    ) as message on true
  ),
  unread as (
    select m.conversation_id, count(*) as unread_count
    from public.messages m
    where m.conversation_id = any(p_conversation_ids)
      and m.direction = 'inbound'
      and m.status in ('sent', 'delivered')
    group by m.conversation_id
  )
  select
    latest.conversation_id,
    latest.last_content,
    latest.last_type,
    latest.last_direction,
    coalesce(unread.unread_count, 0)::bigint
  from latest
  left join unread using (conversation_id);
$$;

revoke all on function public.get_conversation_list_stats(uuid[]) from public, anon;
grant execute on function public.get_conversation_list_stats(uuid[]) to authenticated;

-- Advisors de segurança: triggers com search_path fixo e RPCs sem privilégios
-- elevados expostos pela Data API.
alter function public.touch_lead_stage() set search_path = '';

revoke all on function public.auth_role() from public, anon, authenticated;
alter function public.auth_role() set schema private;
grant execute on function private.auth_role() to authenticated;

create or replace function public.list_salespeople()
returns table (id uuid, name text, role public.user_role)
language sql
stable
security invoker
set search_path = ''
as $$
  select profile.id, profile.name, profile.role
  from public.user_profiles as profile
  order by profile.name;
$$;

revoke all on function public.list_salespeople() from public, anon;
grant execute on function public.list_salespeople() to authenticated;

-- Mantém extensões fora do schema exposto e preserva as funções de detecção de
-- duplicados que usam similarity() sem qualificação.
create schema if not exists extensions;
alter extension pg_trgm set schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
alter function public.find_name_duplicate_pairs(numeric)
  set search_path = public, extensions;
alter function public.find_similar_leads_by_name(uuid, numeric, integer)
  set search_path = public, extensions;

-- Policies FOR ALL sobrepunham as policies de SELECT da equipe. Separar as
-- operações administrativas evita avaliações RLS duplicadas em toda leitura.
drop policy if exists "team reads profiles" on public.user_profiles;
drop policy if exists "own profile update" on public.user_profiles;
drop policy if exists "admin manages profiles" on public.user_profiles;
create policy "team reads profiles" on public.user_profiles
  for select to authenticated
  using ((select private.auth_role()) is not null);
create policy "team updates profiles" on public.user_profiles
  for update to authenticated
  using (
    id = (select auth.uid())
    or (select private.auth_role()) = 'admin'::public.user_role
  )
  with check (
    id = (select auth.uid())
    or (select private.auth_role()) = 'admin'::public.user_role
  );
create policy "admin creates profiles" on public.user_profiles
  for insert to authenticated
  with check ((select private.auth_role()) = 'admin'::public.user_role);
create policy "admin deletes profiles" on public.user_profiles
  for delete to authenticated
  using ((select private.auth_role()) = 'admin'::public.user_role);

drop policy if exists "team reads stages" on public.pipeline_stages;
drop policy if exists "admin manages stages" on public.pipeline_stages;
create policy "team reads stages" on public.pipeline_stages
  for select to authenticated
  using ((select private.auth_role()) is not null);
create policy "admin creates stages" on public.pipeline_stages
  for insert to authenticated
  with check ((select private.auth_role()) = 'admin'::public.user_role);
create policy "admin updates stages" on public.pipeline_stages
  for update to authenticated
  using ((select private.auth_role()) = 'admin'::public.user_role)
  with check ((select private.auth_role()) = 'admin'::public.user_role);
create policy "admin deletes stages" on public.pipeline_stages
  for delete to authenticated
  using ((select private.auth_role()) = 'admin'::public.user_role);

drop policy if exists "admin manages instances" on public.whatsapp_instances;
create policy "admin creates instances" on public.whatsapp_instances
  for insert to authenticated
  with check ((select private.auth_role()) = 'admin'::public.user_role);
create policy "admin updates instances" on public.whatsapp_instances
  for update to authenticated
  using ((select private.auth_role()) = 'admin'::public.user_role)
  with check ((select private.auth_role()) = 'admin'::public.user_role);
create policy "admin deletes instances" on public.whatsapp_instances
  for delete to authenticated
  using ((select private.auth_role()) = 'admin'::public.user_role);

drop policy if exists "team reads templates" on public.message_templates;
drop policy if exists "admin manages templates" on public.message_templates;
create policy "team reads templates" on public.message_templates
  for select to authenticated
  using ((select private.auth_role()) is not null);
create policy "admin creates templates" on public.message_templates
  for insert to authenticated
  with check ((select private.auth_role()) = 'admin'::public.user_role);
create policy "admin updates templates" on public.message_templates
  for update to authenticated
  using ((select private.auth_role()) = 'admin'::public.user_role)
  with check ((select private.auth_role()) = 'admin'::public.user_role);
create policy "admin deletes templates" on public.message_templates
  for delete to authenticated
  using ((select private.auth_role()) = 'admin'::public.user_role);

drop policy if exists "team reads dashboard config" on public.dashboard_config;
drop policy if exists "admin manages dashboard config" on public.dashboard_config;
create policy "team reads dashboard config" on public.dashboard_config
  for select to authenticated
  using ((select private.auth_role()) is not null);
create policy "admin creates dashboard config" on public.dashboard_config
  for insert to authenticated
  with check ((select private.auth_role()) = 'admin'::public.user_role);
create policy "admin updates dashboard config" on public.dashboard_config
  for update to authenticated
  using ((select private.auth_role()) = 'admin'::public.user_role)
  with check ((select private.auth_role()) = 'admin'::public.user_role);
create policy "admin deletes dashboard config" on public.dashboard_config
  for delete to authenticated
  using ((select private.auth_role()) = 'admin'::public.user_role);

drop policy if exists "team reads goals" on public.user_goals;
drop policy if exists "admin manages goals" on public.user_goals;
create policy "team reads goals" on public.user_goals
  for select to authenticated
  using ((select private.auth_role()) is not null);
create policy "admin creates goals" on public.user_goals
  for insert to authenticated
  with check ((select private.auth_role()) = 'admin'::public.user_role);
create policy "admin updates goals" on public.user_goals
  for update to authenticated
  using ((select private.auth_role()) = 'admin'::public.user_role)
  with check ((select private.auth_role()) = 'admin'::public.user_role);
create policy "admin deletes goals" on public.user_goals
  for delete to authenticated
  using ((select private.auth_role()) = 'admin'::public.user_role);

drop policy if exists "team reads automations" on public.automation_rules;
drop policy if exists "admin manages automations" on public.automation_rules;
create policy "team reads automations" on public.automation_rules
  for select to authenticated
  using ((select private.auth_role()) is not null);
create policy "admin creates automations" on public.automation_rules
  for insert to authenticated
  with check ((select private.auth_role()) = 'admin'::public.user_role);
create policy "admin updates automations" on public.automation_rules
  for update to authenticated
  using ((select private.auth_role()) = 'admin'::public.user_role)
  with check ((select private.auth_role()) = 'admin'::public.user_role);
create policy "admin deletes automations" on public.automation_rules
  for delete to authenticated
  using ((select private.auth_role()) = 'admin'::public.user_role);

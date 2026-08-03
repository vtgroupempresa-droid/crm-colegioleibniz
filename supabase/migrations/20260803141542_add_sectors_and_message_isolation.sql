-- Setores do Colégio Leibniz e isolamento real do inbox por setor.
-- Administradores mantêm visão global. Usuários operacionais só leem e
-- alteram conversas/mensagens vinculadas ao próprio setor.

create table public.sectors (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9_]+$'),
  name text not null unique,
  description text,
  color text not null default '#64748b',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger sectors_updated_at before update on public.sectors
  for each row execute function public.set_updated_at();

alter table public.sectors enable row level security;
grant select, insert, update, delete on table public.sectors to authenticated;

alter table public.user_profiles
  add column sector_id uuid references public.sectors (id) on delete set null,
  add column must_change_password boolean not null default false;

alter table public.invitations
  add column sector_id uuid references public.sectors (id) on delete restrict;

alter table public.whatsapp_instances
  add column sector_id uuid references public.sectors (id) on delete restrict;

alter table public.conversations
  add column sector_id uuid references public.sectors (id) on delete restrict;

create index user_profiles_sector_idx on public.user_profiles (sector_id);
create index whatsapp_instances_sector_idx on public.whatsapp_instances (sector_id);
create index conversations_sector_last_msg_idx
  on public.conversations (sector_id, last_message_at desc nulls last);

insert into public.sectors (slug, name, description, color)
values
  ('comercial', 'Comercial', 'Venda de cursos e atendimento comercial.', '#2563eb'),
  ('educacao_infantil', 'Coordenação — Educação Infantil', 'Atendimento da Educação Infantil.', '#ec4899'),
  ('fundamental_anos_iniciais', 'Coordenação — Fundamental Anos Iniciais', 'Atendimento do Ensino Fundamental I.', '#8b5cf6'),
  ('fundamental_anos_finais_medio', 'Coordenação — Fundamental Anos Finais e Médio', 'Atendimento do Ensino Fundamental II e Ensino Médio.', '#f59e0b'),
  ('secretaria', 'Secretaria', 'Atendimento da secretaria escolar.', '#0891b2'),
  ('financeiro', 'Financeiro', 'Atendimento financeiro.', '#16a34a'),
  ('marketing', 'Marketing', 'Atendimento de marketing e canais sociais.', '#dc2626');

-- A instalação atual possui somente a operação comercial. Preservamos todas
-- as conversas existentes nesse setor para que nenhuma mensagem desapareça.
update public.whatsapp_instances
set sector_id = (select id from public.sectors where slug = 'comercial')
where sector_id is null;

update public.conversations
set sector_id = coalesce(
  (
    select wi.sector_id
    from public.whatsapp_instances wi
    where wi.id = conversations.whatsapp_instance_id
  ),
  (select id from public.sectors where slug = 'comercial')
)
where sector_id is null;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.current_user_sector_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.sector_id
  from public.user_profiles p
  where p.id = (select auth.uid());
$$;

revoke all on function private.current_user_sector_id() from public;
grant execute on function private.current_user_sector_id() to authenticated;

-- Garante que conversas criadas por webhooks/service role já nasçam com o
-- setor da linha, do responsável ou, durante a implantação, do Comercial.
create or replace function private.set_conversation_sector()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_sector_id uuid;
begin
  if new.assigned_to is not null
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    select p.sector_id into resolved_sector_id
    from public.user_profiles p
    where p.id = new.assigned_to;

    if resolved_sector_id is not null then
      new.sector_id := resolved_sector_id;
      return new;
    end if;
  end if;

  if new.sector_id is null and new.whatsapp_instance_id is not null then
    select wi.sector_id into resolved_sector_id
    from public.whatsapp_instances wi
    where wi.id = new.whatsapp_instance_id;
    new.sector_id := resolved_sector_id;
  end if;

  if new.sector_id is null then
    select s.id into new.sector_id
    from public.sectors s
    where s.slug = 'comercial';
  end if;

  return new;
end;
$$;

revoke all on function private.set_conversation_sector() from public;

create trigger conversations_set_sector
  before insert or update of assigned_to, whatsapp_instance_id, sector_id
  on public.conversations
  for each row execute function private.set_conversation_sector();

-- Dados de autorização vêm de app_metadata (não editável pelo usuário).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, name, role, sector_id, must_change_password)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(
      (new.raw_app_meta_data ->> 'role')::public.user_role,
      (new.raw_user_meta_data ->> 'role')::public.user_role,
      'comercial'::public.user_role
    ),
    nullif(new.raw_app_meta_data ->> 'sector_id', '')::uuid,
    coalesce((new.raw_app_meta_data ->> 'must_change_password')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Impede que um usuário operacional eleve o próprio cargo, troque de setor
-- ou dispense a troca obrigatória de senha diretamente pela Data API.
create or replace function private.protect_profile_access_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'authenticated'
     and public.auth_role() <> 'admin'::public.user_role
     and (
       new.role is distinct from old.role
       or new.sector_id is distinct from old.sector_id
       or new.must_change_password is distinct from old.must_change_password
     ) then
    raise exception 'Campos de acesso só podem ser alterados por administradores.';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_profile_access_fields() from public;

create trigger user_profiles_protect_access
  before update on public.user_profiles
  for each row execute function private.protect_profile_access_fields();

create policy "team reads sectors" on public.sectors
  for select to authenticated
  using ((select public.auth_role()) is not null);

create policy "admin manages sectors" on public.sectors
  for all to authenticated
  using ((select public.auth_role()) = 'admin'::public.user_role)
  with check ((select public.auth_role()) = 'admin'::public.user_role);

drop policy if exists "own profile update" on public.user_profiles;
create policy "own profile update" on public.user_profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "team reads instances" on public.whatsapp_instances;
create policy "sector reads instances" on public.whatsapp_instances
  for select to authenticated
  using (
    (select public.auth_role()) = 'admin'::public.user_role
    or sector_id = (select private.current_user_sector_id())
  );

drop policy if exists "team reads conversations" on public.conversations;
drop policy if exists "team writes conversations" on public.conversations;
drop policy if exists "team updates conversations" on public.conversations;

create policy "sector reads conversations" on public.conversations
  for select to authenticated
  using (
    (select public.auth_role()) = 'admin'::public.user_role
    or sector_id = (select private.current_user_sector_id())
  );

create policy "sector writes conversations" on public.conversations
  for insert to authenticated
  with check (
    (select public.auth_role()) = 'admin'::public.user_role
    or sector_id = (select private.current_user_sector_id())
  );

create policy "sector updates conversations" on public.conversations
  for update to authenticated
  using (
    (select public.auth_role()) = 'admin'::public.user_role
    or sector_id = (select private.current_user_sector_id())
  )
  with check (
    (select public.auth_role()) = 'admin'::public.user_role
    or sector_id = (select private.current_user_sector_id())
  );

drop policy if exists "team reads messages" on public.messages;
drop policy if exists "team writes messages" on public.messages;
drop policy if exists "team updates messages" on public.messages;

create policy "sector reads messages" on public.messages
  for select to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
    )
  );

create policy "sector writes messages" on public.messages
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
    )
  );

create policy "sector updates messages" on public.messages
  for update to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
    )
  )
  with check (
    exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
    )
  );

comment on table public.sectors is 'Setores operacionais do Colégio Leibniz.';
comment on column public.user_profiles.sector_id is 'Setor principal que delimita o inbox do usuário.';
comment on column public.conversations.sector_id is 'Setor proprietário da conversa; usado nas políticas RLS.';
comment on column public.user_profiles.must_change_password is 'Exige troca da senha temporária no próximo acesso.';

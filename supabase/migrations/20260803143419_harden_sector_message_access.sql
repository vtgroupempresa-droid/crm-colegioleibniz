-- Hardening derivado dos advisors do Supabase após a criação dos setores.

alter function public.set_updated_at() set search_path = '';

-- Funções de trigger não são endpoints RPC. O trigger continua funcionando
-- sem conceder EXECUTE às roles da Data API.
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- auth_role é usada pelas policies, mas não precisa ser pública para anônimos.
revoke all on function public.auth_role() from public, anon;
grant execute on function public.auth_role() to authenticated;

-- Lista de responsáveis é um RPC interno da equipe, nunca anônimo.
revoke all on function public.list_salespeople() from public, anon;
grant execute on function public.list_salespeople() to authenticated;

create index if not exists conversations_assigned_to_idx
  on public.conversations (assigned_to);
create index if not exists conversations_whatsapp_instance_idx
  on public.conversations (whatsapp_instance_id);

-- Evita duas policies permissivas de SELECT na tabela criada nesta migration.
drop policy if exists "admin manages sectors" on public.sectors;
create policy "admin creates sectors" on public.sectors
  for insert to authenticated
  with check ((select public.auth_role()) = 'admin'::public.user_role);
create policy "admin updates sectors" on public.sectors
  for update to authenticated
  using ((select public.auth_role()) = 'admin'::public.user_role)
  with check ((select public.auth_role()) = 'admin'::public.user_role);
create policy "admin deletes sectors" on public.sectors
  for delete to authenticated
  using ((select public.auth_role()) = 'admin'::public.user_role);

-- O bucket continua público para que URLs já gravadas não quebrem, mas não
-- permite mais listar todos os anexos. Upload/update exige que o primeiro
-- diretório seja uma conversa visível ao setor do usuário.
drop policy if exists "public reads chat media" on storage.objects;
drop policy if exists "team uploads chat media" on storage.objects;
drop policy if exists "team updates chat media" on storage.objects;

create policy "sector uploads chat media" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and exists (
      select 1
      from public.conversations c
      where c.id::text = (storage.foldername(name))[1]
    )
  );

create policy "sector updates chat media" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'chat-media'
    and exists (
      select 1
      from public.conversations c
      where c.id::text = (storage.foldername(name))[1]
    )
  )
  with check (
    bucket_id = 'chat-media'
    and exists (
      select 1
      from public.conversations c
      where c.id::text = (storage.foldername(name))[1]
    )
  );

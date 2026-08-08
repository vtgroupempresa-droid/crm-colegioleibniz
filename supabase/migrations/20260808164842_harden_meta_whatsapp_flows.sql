-- Segurança e consistência dos fluxos Meta Lead Ads + WhatsApp multi-linha.

-- ── Credenciais das linhas fora da tabela exposta à equipe ────────────────

create table public.whatsapp_instance_credentials (
  whatsapp_instance_id uuid primary key
    references public.whatsapp_instances (id) on delete cascade,
  access_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger whatsapp_instance_credentials_updated_at
  before update on public.whatsapp_instance_credentials
  for each row execute function public.set_updated_at();

alter table public.whatsapp_instance_credentials enable row level security;
revoke all on table public.whatsapp_instance_credentials from public, anon, authenticated;
grant all on table public.whatsapp_instance_credentials to service_role;

insert into public.whatsapp_instance_credentials (whatsapp_instance_id, access_token)
select id, instance_token
from public.whatsapp_instances
where instance_token is not null and btrim(instance_token) <> ''
on conflict (whatsapp_instance_id) do update
set access_token = excluded.access_token;

alter table public.whatsapp_instances drop column instance_token;

-- Uma linha precisa pertencer a um setor e o ID oficial não pode se repetir.
update public.whatsapp_instances
set sector_id = (select id from public.sectors where slug = 'comercial')
where sector_id is null;

alter table public.whatsapp_instances
  alter column sector_id set not null;

create unique index whatsapp_instances_phone_number_id_key
  on public.whatsapp_instances (phone_number_id)
  where phone_number_id is not null;

-- ── Conversas distintas para a mesma família em números diferentes ───────

alter table public.conversations
  drop constraint if exists conversations_channel_external_id_key;

alter table public.conversations
  add constraint conversations_channel_external_instance_key
  unique nulls not distinct (channel, external_id, whatsapp_instance_id);

-- ── Uma linha por submissão Meta (respostas e atribuição imutáveis) ───────

create table public.meta_lead_submissions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  leadgen_id text not null unique,
  entry_kind text not null check (entry_kind in ('first', 'reentry')),
  submitted_at timestamptz not null,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  form_id text,
  form_name text,
  form_answers jsonb not null default '[]'::jsonb
    check (jsonb_typeof(form_answers) = 'array'),
  created_at timestamptz not null default now()
);

create index meta_lead_submissions_lead_idx
  on public.meta_lead_submissions (lead_id, submitted_at desc);

alter table public.meta_lead_submissions enable row level security;
revoke all on table public.meta_lead_submissions from anon, authenticated;
grant select on table public.meta_lead_submissions to authenticated;
grant all on table public.meta_lead_submissions to service_role;

create policy "team reads meta submissions"
  on public.meta_lead_submissions
  for select to authenticated
  using ((select public.auth_role()) is not null);

-- Backfill do JSON legado. Novas gravações usam a tabela normalizada também.
insert into public.meta_lead_submissions (
  lead_id,
  leadgen_id,
  entry_kind,
  submitted_at,
  campaign_id,
  campaign_name,
  adset_id,
  adset_name,
  ad_id,
  ad_name,
  form_id,
  form_name,
  form_answers
)
select
  l.id,
  entry ->> 'leadgenId',
  case when entry ->> 'kind' = 'reentry' then 'reentry' else 'first' end,
  coalesce((entry ->> 'at')::timestamptz, l.created_at),
  entry ->> 'campaignId',
  entry ->> 'campaignName',
  entry ->> 'adsetId',
  entry ->> 'adsetName',
  entry ->> 'adId',
  entry ->> 'adName',
  entry ->> 'formId',
  entry ->> 'formName',
  coalesce(entry -> 'formAnswers', '[]'::jsonb)
from public.leads l
cross join lateral jsonb_array_elements(l.meta_entries) entry
where entry ->> 'leadgenId' is not null
on conflict (leadgen_id) do nothing;

-- ── Mídias do chat privadas e liberadas apenas pelo setor da conversa ─────

update storage.buckets set public = false where id = 'chat-media';

update public.messages
set media_url = regexp_replace(
  media_url,
  '^https?://[^/]+/storage/v1/object/public/chat-media/',
  ''
)
where media_url ~ '^https?://[^/]+/storage/v1/object/public/chat-media/';

drop policy if exists "public reads chat media" on storage.objects;
drop policy if exists "sector reads chat media" on storage.objects;
create policy "sector reads chat media" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-media'
    and exists (
      select 1
      from public.conversations c
      where c.id::text = (storage.foldername(name))[1]
    )
  );

-- Nunca deriva autorização de raw_user_meta_data, que o próprio usuário edita.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (id, name, role, sector_id, must_change_password)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(
      (new.raw_app_meta_data ->> 'role')::public.user_role,
      'comercial'::public.user_role
    ),
    nullif(new.raw_app_meta_data ->> 'sector_id', '')::uuid,
    coalesce((new.raw_app_meta_data ->> 'must_change_password')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

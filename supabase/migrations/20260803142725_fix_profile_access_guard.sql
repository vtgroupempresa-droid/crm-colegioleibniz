-- auth.jwt() lê as claims da requisição mesmo dentro de SECURITY DEFINER.
-- O setting legado request.jwt.claim.role não está presente no PostgREST atual.
create or replace function private.protect_profile_access_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
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

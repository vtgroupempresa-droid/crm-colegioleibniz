-- Acelera a listagem e manutenção de convites vinculados a um setor.
create index if not exists invitations_sector_id_idx
  on public.invitations (sector_id);

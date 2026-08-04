create index if not exists conversation_bot_sessions_instance_idx
  on public.conversation_bot_sessions (whatsapp_instance_id);

create index if not exists conversation_bot_sessions_selected_sector_idx
  on public.conversation_bot_sessions (selected_sector_id);

create index if not exists conversation_sector_transfers_from_sector_idx
  on public.conversation_sector_transfers (from_sector_id);

create index if not exists conversation_sector_transfers_to_sector_idx
  on public.conversation_sector_transfers (to_sector_id);

create index if not exists conversation_sector_transfers_created_by_idx
  on public.conversation_sector_transfers (created_by);

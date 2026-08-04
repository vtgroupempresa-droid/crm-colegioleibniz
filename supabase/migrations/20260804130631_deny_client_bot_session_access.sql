create policy "clients cannot access bot sessions"
  on public.conversation_bot_sessions
  for all to authenticated
  using (false)
  with check (false);

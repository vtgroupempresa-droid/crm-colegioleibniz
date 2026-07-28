-- Fila operacional do Funil: a primeira versão usava o default em inglês
-- ('pending'), enquanto a interface e as regras trabalham com 'pendente'.
-- Normaliza somente tarefas ainda abertas e melhora a leitura por responsável.

update public.tasks
set status = 'pendente'
where status = 'pending';

alter table public.tasks
  alter column status set default 'pendente';

create index if not exists tasks_open_queue_idx
  on public.tasks (assigned_to, due_at asc)
  where status = 'pendente';

-- Alertas internos de alta prioridade. Não envia mensagens automáticas à família.
-- O alerta de 30 min já existente permanece como escalonamento da equipe.

insert into public.automation_rules
  (name, description, is_active, trigger_type, trigger_config, action_type, action_config)
select
  'Prioridade: primeiro contato em 5 minutos',
  'Avisa o responsável quando um novo lead ainda não recebeu primeiro contato em 5 minutos.',
  true,
  'parado_na_etapa',
  '{"pipeline":"comercial","stage":"novo_lead","minutes":5}'::jsonb,
  'notificar',
  '{"title":"Atender agora: {{lead_name}}","body":"Novo lead aguardando primeiro contato há 5 minutos.","notify":"responsavel"}'::jsonb
where not exists (
  select 1 from public.automation_rules where name = 'Prioridade: primeiro contato em 5 minutos'
);

insert into public.automation_rules
  (name, description, is_active, trigger_type, trigger_config, action_type, action_config)
select
  'Prioridade: família aguardando resposta',
  'Avisa o responsável quando a última mensagem da conversa é da família e não houve resposta em 5 minutos.',
  true,
  'sem_resposta',
  '{"minutes":5}'::jsonb,
  'notificar',
  '{"title":"Responder agora: {{lead_name}}","body":"A família está aguardando resposta no chat há 5 minutos.","notify":"responsavel"}'::jsonb
where not exists (
  select 1 from public.automation_rules where name = 'Prioridade: família aguardando resposta'
);

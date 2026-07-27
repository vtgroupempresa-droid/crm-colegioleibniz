-- ============================================================
-- CRM Colégio Leibniz — seed inicial
-- Pipeline comercial mapeado na reunião, nesta ordem:
-- Novo Lead → Primeiro Contato → Visita Presencial → Em Negociação
--   → Cliente Fechado → Follow-Up (+ Perdido)
--
-- Follow-Up vem DEPOIS de Cliente Fechado de propósito: é a coluna de
-- retomada das famílias que não decidiram na hora, não uma etapa que o
-- lead percorre antes de fechar.
--
-- Pipeline pós-matrícula: terreno para integração EasySchool.
-- ============================================================

insert into pipeline_stages
  (pipeline, slug, name, position, color, is_entry, is_terminal, stage_win_probability)
values
  ('comercial', 'novo_lead',         'Novo Lead',         1, '#3b82f6', true,  false, 5),
  ('comercial', 'primeiro_contato',  'Primeiro Contato',  2, '#6366f1', false, false, 15),
  ('comercial', 'visita_presencial', 'Visita Presencial', 3, '#8b5cf6', false, false, 45),
  ('comercial', 'em_negociacao',     'Em Negociação',     4, '#f59e0b', false, false, 70),
  ('comercial', 'cliente_fechado',   'Cliente Fechado',   5, '#16a34a', false, true,  100),
  ('comercial', 'follow_up',         'Follow-Up',         6, '#0ea5e9', false, false, 40),
  ('comercial', 'perdido',           'Perdido',           7, '#dc2626', false, true,  0);

insert into pipeline_stages
  (pipeline, slug, name, position, color, is_entry, is_terminal, stage_win_probability)
values
  ('pos_matricula', 'matriculado',          'Matriculado',          1, '#16a34a', true,  false, 100),
  ('pos_matricula', 'rematricula_pendente', 'Rematrícula Pendente', 2, '#f59e0b', false, false, 60),
  ('pos_matricula', 'rematriculado',        'Rematriculado',        3, '#15803d', false, true,  100),
  ('pos_matricula', 'nao_renovou',          'Não Renovou',          4, '#dc2626', false, true,  0);

-- Automações de exemplo (editáveis em /admin/automacoes)
insert into automation_rules
  (name, description, is_active, trigger_type, trigger_config, action_type, action_config)
values
  (
    'Alerta: lead novo sem atendimento',
    'Notifica a equipe quando um lead está há mais de 30 minutos em Novo Lead sem primeiro contato.',
    true,
    'parado_na_etapa',
    '{"pipeline": "comercial", "stage": "novo_lead", "minutes": 30}',
    'notificar',
    '{"title": "Lead aguardando primeiro contato", "body": "{{lead_name}} entrou há mais de 30 minutos e ainda não foi atendido.", "notify": "todos"}'
  ),
  (
    'Lembrete: visita amanhã',
    'Lembra o responsável (e permite confirmar com a família) um dia antes da visita presencial.',
    true,
    'visita_amanha',
    '{}',
    'notificar',
    '{"title": "Visita amanhã", "body": "Visita de {{lead_name}} amanhã às {{visit_time}}. Confirme com a família.", "notify": "responsavel"}'
  ),
  (
    'Follow-up: negociação parada',
    'Cria tarefa de follow-up quando o lead fica 3 dias parado em Em Negociação.',
    true,
    'parado_na_etapa',
    '{"pipeline": "comercial", "stage": "em_negociacao", "minutes": 4320}',
    'criar_tarefa',
    '{"title": "Follow-up com {{lead_name}}", "body": "Lead parado em negociação há 3 dias. Retomar conversa.", "due_hours": 4, "assign_to": "responsavel"}'
  );

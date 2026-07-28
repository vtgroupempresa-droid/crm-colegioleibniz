# Plano de migração do Digisac

## Objetivo

Trazer ao CRM do Colégio Leibniz o histórico operacional do Digisac sem perder
vínculo entre responsável, linha de atendimento, ticket, mensagens, anexos,
atendente e data original. Ao final, o CRM deve poder operar a linha Digisac
em tempo real (mensagens, HSM e webhooks), caso essa seja a decisão de corte.

O escopo mínimo é: conexões, contatos, tags, campos personalizados, usuários,
chamados/tickets, mensagens e arquivos. Campanhas, agendamentos, cards de
funil e respostas rápidas são importações opcionais, pois não têm equivalência
direta e não devem entrar sem uma regra aprovada.

Referências fornecidas:

- [Coleção da API Digisac](https://documenter.getpostman.com/view/24605757/2sA3BhfaDg)
- [Playlist de tutoriais](https://www.youtube.com/playlist?list=PLUIYkpGLM2dMQID8fzPu_mmQEk_fyBBLP)

## Decisões que precisam ser aprovadas antes da carga

1. **Data de corte e convivência.** Definir se o Digisac deixa de receber
   mensagens no corte, ou se coexistirá temporariamente com o CRM. A segunda
   opção requer webhooks desde o início e uma carga delta no dia da virada.
2. **Tickets no histórico.** O CRM atual tem uma conversa contínua por
   contato/linha; o Digisac pode ter vários tickets para o mesmo contato.
   Recomendo manter uma conversa única e registrar abertura, transferência e
   fechamento de cada ticket como eventos na timeline. Se a separação visual de
   cada ticket for indispensável, será necessário evoluir o modelo e a tela de
   chat antes da importação.
3. **Linhas, grupos e canais incluídos.** Confirmar cada `service` Digisac que
   será migrado, se grupos de WhatsApp entram e se Instagram/outros canais
   ficam fora. Grupos não devem ser tratados como leads automaticamente.
4. **Dados comerciais.** Confirmar a regra que converte tags, campos
   personalizados, pipelines/cards e departamentos em etapa, responsável e
   campos escolares do CRM. Nenhuma etapa comercial será inferida apenas pelo
   nome de uma tag.
5. **Retenção e privacidade.** Definir período de histórico, destino dos
   anexos e quem pode acessá-los. Por conter dados de responsáveis e alunos, os
   arquivos devem ficar em bucket privado, com URLs assinadas, e não em links
   públicos ou temporários do Digisac.

## Mapeamento para o CRM atual

| Digisac | Destino no CRM | Regra |
| --- | --- | --- |
| `services` | `whatsapp_instances` | Uma instância por linha migrada, com `provider = 'digisac'`, nome, número e identificador da origem. |
| `contacts` | `leads` + `conversations` | Deduplicar primeiro por telefone normalizado; criar/atualizar o lead e abrir uma conversa WhatsApp por contato e linha. |
| Tags e campos personalizados | `leads.tags` e campos do lead | Mapear campos aprovados; preservar os demais em `metadata` de origem para consulta. |
| `users` | `user_profiles` / `messages.sent_by` | Vincular por e-mail confirmado. Atendentes sem usuário no CRM ficam preservados nominalmente no metadado, sem criar conta de acesso. |
| `tickets` e transferências | conversa + `activities` | Preservar protocolo, departamento, atendente, abertura/fechamento e motivo em eventos de sistema. |
| `messages` | `messages` | Converter direção, tipo, texto, status, data original e ID de origem; manter `ticketId`, `serviceId`, usuário e payload relevante no metadado. |
| Arquivos de mensagem | Supabase Storage + `messages.media_url` | Copiar o binário, validar tamanho/hash e gravar uma referência privada estável. |
| Templates WhatsApp Business | `message_templates` | Importar nome, idioma, conteúdo, status e identificador do template do provedor. |
| Webhooks Digisac | rota dedicada + log de eventos | Validar assinatura, registrar primeiro e processar de modo idempotente. |

## Arquitetura proposta

### 1. Camada de importação e rastreabilidade

Criar tabelas internas, não expostas ao cliente, para que a carga possa ser
retomada e auditada sem duplicar dados:

- `digisac_import_runs`: versão do importador, recorte temporal, contagens,
  estado, erros e responsável pela execução.
- `digisac_id_map`: chave composta por tipo e ID Digisac, ID local criado,
  `import_run_id` e hash do payload. Ela resolve reexecução idempotente e
  rollback seletivo.
- `digisac_webhook_events`: ID do evento, cabeçalhos mínimos, payload,
  recebimento, processamento e erro. O ID da origem deve ter unicidade.

Também acrescentar identificadores de provedor ao modelo de mensagens ou
centralizá-los no mapa. O índice atual de `messages.external_message_id` é
global; usar diretamente um ID do Digisac pode colidir com outro provedor. A
regra segura é uma chave composta lógica `digisac:<serviceId>:<messageId>` ou
um campo de provedor/ID de origem com índice único composto.

Cada registro importado terá `metadata.source = 'digisac'` e
`metadata.import_run_id`. Isso permite auditoria e remoção somente do lote
testado, sem tocar nos dados nativos do CRM.

### 2. Adaptador de canal Digisac

O chat atual já conhece a noção de instância de WhatsApp, mas o envio está
orientado ao provedor oficial Meta. Implementar um adaptador por provedor:

`conversa → instancia.provider → Meta oficial | Digisac`.

O adaptador Digisac encapsulará token, envio de texto/mídia, HSM/template,
reação, leitura e normalização de status. Os tutoriais e a coleção indicam
rotas para mensagens, arquivos, templates, conexões e webhooks; credenciais
ficam somente no ambiente do servidor, nunca em variáveis `NEXT_PUBLIC_`.

## Execução em etapas

### Fase 0 — Inventário e acesso controlado

- Criar um token de leitura, se a conta permitir, e guardá-lo no cofre de
  segredos da Vercel/Supabase; nunca em `.env` versionado.
- Consultar `services`, usuários, departamentos, tags, campos personalizados,
  templates, contatos, tickets e mensagens. A API documenta, entre outras,
  rotas para `/api/v1/services`, `/contacts`, `/tickets`, `/messages`,
  `/whatsapp-business-templates` e `/me/webhooks`.
- Medir volume: contatos únicos, mensagens por período, anexos por tipo/tamanho,
  tickets abertos e fechados e taxa de contatos sem telefone.
- Gerar export de contingência no Digisac e registrar contagens-base. O Digisac
  continua sendo somente leitura durante a migração histórica.

**Saída:** inventário assinado e planilha de mapeamento de campos/usuários/
departamentos/etapas.

### Fase 1 — Preparar o CRM

- Criar as migrações de esquema, bucket privado de mídia e políticas de acesso.
- Criar uma instância Digisac de teste, sem ativar envio em produção.
- Implementar o importador como processo de servidor com paginação, limites de
  concorrência, tentativas com espera progressiva e checkpoints por página.
- Suspender automações de envio durante a carga ou excluir explicitamente
  registros `source = digisac` delas. Mensagens históricas não podem disparar
  follow-up, tarefas, notificações ou avanço de etapa.
- Instrumentar métricas: lidos, criados, atualizados, ignorados, duplicados,
  falhas e duração por recurso.

**Saída:** ambiente de homologação apto a importar e remover um lote inteiro de
teste por `import_run_id`.

### Fase 2 — Carga-piloto e homologação

- Importar uma linha e um intervalo recente representativo, incluindo texto,
  imagem, PDF, áudio, vídeo, ticket transferido e HSM.
- Normalizar telefone para E.164/DDD brasileiro e aplicar a deduplicação do CRM
  antes de criar qualquer lead. Casos ambíguos entram em fila de revisão, não
  são unidos automaticamente.
- Baixar anexos para o bucket privado, conferindo MIME, tamanho e hash. Não
  depender de URLs temporárias da origem.
- Validar no chat, na ficha do lead e na timeline a ordem cronológica, autor,
  direção, anexos e eventos de ticket.

**Critério de aceite:** 100% das contagens do recorte conciliadas, 100% dos
anexos da amostra abrindo e nenhuma automação/enviou disparada pelo lote.

### Fase 3 — Carga histórica completa

Ordem recomendada: instâncias → usuários e mapa de responsáveis → contatos e
tags → leads/conversas → tickets/eventos → mensagens → anexos → templates.

O importador grava somente em lotes pequenos e confirmados. O estado de cada
página deve ser persistido; em falha, retoma do checkpoint, sem reimportar
mensagens já mapeadas. Arquivos recebem fila separada para não bloquear texto
por uma mídia grande ou indisponível.

**Conciliações obrigatórias:**

- contatos por serviço e total de leads criados, atualizados e em revisão;
- tickets por status e departamento, comparados com eventos gravados;
- mensagens por direção, tipo e dia, comparadas com a origem;
- quantidade, tamanho e hash de anexos; e
- amostra manual de conversas longas, contatos duplicados e tickets reatribuídos.

### Fase 4 — Integração ao vivo e virada

- Publicar `/api/digisac/webhook`, validar assinatura/segredo e responder rápido
  ao Digisac; o processamento ocorre de modo idempotente após o registro do
  evento bruto.
- Cobrir ao menos entrada, saída, atualização de status, criação/fechamento/
  transferência de ticket e mídia. Eventos desconhecidos permanecem registrados
  para diagnóstico, sem derrubar o endpoint.
- Validar envio de texto, arquivo e HSM com uma conversa de teste. O envio só
  passa a estar habilitado na instância aprovada.
- Na data de corte, executar uma carga delta até o último watermark, ativar os
  webhooks, conferir os primeiros eventos e só então liberar a equipe.

**Plano de reversão:** desativar o adaptador e os webhooks Digisac, manter a
origem operacional e remover apenas os registros marcados pelo `import_run_id`
da execução com problema. Não apagar dados nativos nem usar exclusões amplas.

### Fase 5 — Estabilização

- Acompanhar por 7 dias erros de webhook, atraso, duplicação, anexos quebrados,
  contagens e falhas de envio/HSM.
- Comparar diariamente a origem e o CRM até a reconciliação ficar estável.
- Documentar credenciais, runbook de reprocessamento, responsável e política de
retenção; depois decidir se o Digisac permanece como contingência ou é
desativado.

## Otimizações recomendadas

1. **Outbox de envio.** Em vez de enviar dentro da ação da interface, gravar a
   intenção em uma fila/outbox e registrar tentativas, resposta do provedor e
   idempotência. Evita duplicidade ao recarregar a página ou em timeout.
2. **Inbox de eventos.** Manter o webhook bruto antes de processá-lo evita perda
   e permite reprocessar uma mensagem sem pedir reenvio ao Digisac.
3. **Mídia privada e deduplicada.** Usar hash de conteúdo no Storage reduz custo
   e elimina links expirados; servir anexos por URL assinada de curta duração.
4. **Identidade de contato unificada.** Centralizar telefone normalizado,
   Instagram e IDs dos provedores em uma tabela de identidades. Isso melhora a
   deduplicação quando um responsável aparece em mais de uma linha/canal.
5. **Observabilidade de integração.** Dashboard com atraso do último webhook,
   taxa de erro, eventos pendentes, mensagens duplicadas e anexos falhos.
6. **Separar histórico de automação.** Marcar a origem do dado e fazer as regras
   de follow-up considerarem apenas conversas ativas posteriores ao corte.
   Histórico importado é consulta, não gatilho comercial.
7. **Templates independentes do provedor.** Guardar um ID/nome de template por
   provedor, em vez de tratar todo HSM como template Meta. Isso preserva a troca
   de provedor e evita envio pelo canal errado.

## Estimativa de esforço

Sem o inventário de volume, a estimativa responsável é por fase: 1–2 dias para
inventário e decisões, 2–4 dias para esquema/importador, 1–2 dias para piloto,
1–3 dias para carga e correções, e 2–4 dias para adaptador/webhook/cutover. A
duração de download de mídia e a quantidade de exceções de contatos determinam
o calendário final.

## Próximo passo prático

Solicitar ao administrador do Digisac um token de API com leitura e criação de
webhook, a lista das linhas que entram no corte e uma exportação de contingência.
Com isso, executamos a Fase 0, fechamos a matriz de mapeamento e só então
implementamos a carga-piloto em homologação.

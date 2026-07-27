-- ============================================================
-- Corrige a constraint única de `conversations`.
--
-- O schema inicial criou unique (channel, external_id, whatsapp_instance_id),
-- mas os 8 pontos do app que abrem/reabrem conversa fazem
-- `upsert(..., { onConflict: 'channel,external_id' })`. O PostgREST exige uma
-- constraint que case EXATAMENTE com as colunas do ON CONFLICT, então todo
-- evento de entrada falhava com:
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
-- O webhook respondia 200 (por design, para a Meta não reenfileirar) e a
-- mensagem era descartada silenciosamente — DMs do Instagram, mensagens do
-- WhatsApp e o primeiro contato automático nunca chegavam ao /chat.
--
-- Além disso a constraint antiga não funcionaria nem para WhatsApp: como
-- whatsapp_instance_id é NULL nas conversas de Instagram e o Postgres trata
-- NULLs como distintos, ela não impedia duplicatas justamente onde importa.
--
-- Uma conversa passa a ser identificada por canal + id externo (telefone no
-- WhatsApp, IGSID no Instagram), que é o que o produto assume.
-- ============================================================

alter table conversations
  drop constraint if exists conversations_channel_external_id_whatsapp_instance_id_key;

-- Deduplica antes de criar a constraint nova (mantém a conversa mais antiga
-- e reaponta as mensagens das demais). Em base nova não há o que mesclar.
with ranked as (
  select id, channel, external_id,
         row_number() over (partition by channel, external_id order by created_at) as rn
  from conversations
),
duplicadas as (
  select r.id, primeira.id as manter
  from ranked r
  join ranked primeira
    on primeira.channel = r.channel
   and primeira.external_id = r.external_id
   and primeira.rn = 1
  where r.rn > 1
)
update messages m
   set conversation_id = d.manter
  from duplicadas d
 where m.conversation_id = d.id;

delete from conversations c
 where exists (
   select 1 from conversations outra
    where outra.channel = c.channel
      and outra.external_id = c.external_id
      and outra.created_at < c.created_at
 );

alter table conversations
  add constraint conversations_channel_external_id_key unique (channel, external_id);

-- Histórico de entradas do Meta Lead Ads por lead (1ª entrada + reentradas).
-- Cada item do array é um snapshot da atribuição no momento da entrada, para o
-- painel "Origem do lead" mostrar os touchpoints SEPARADOS (sem misturar o
-- criativo da reentrada com o produto da primeira entrada).
--
-- Shape de cada item (ver types/lead.ts → MetaLeadEntry):
--   { at, kind: 'first'|'reentry', leadgenId, campaignId, campaignName,
--     adsetId, adsetName, adId, adName, formId, formName, productId, productCode }
--
-- Append-only: o ingest do leadgen adiciona um item a cada formulário preenchido
-- (dedup por leadgenId). As colunas meta_* continuam guardando a ÚLTIMA entrada
-- (usadas pela atribuição do dashboard); o histórico completo vive aqui.

alter table leads
  add column if not exists meta_entries jsonb not null default '[]'::jsonb;

comment on column leads.meta_entries is
  'Histórico append-only de entradas Meta Lead Ads (1ª entrada + reentradas), um snapshot por formulário preenchido. Ver types/lead.ts → MetaLeadEntry.';

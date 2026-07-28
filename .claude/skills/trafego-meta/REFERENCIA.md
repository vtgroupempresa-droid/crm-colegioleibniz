# Referência técnica — consultas e API

## SQL prontos (Supabase, MCP `execute_sql`)

### Desempenho por campanha + CPL do CRM (trocar as datas)
```sql
with ins as (
  select campaign_id, max(campaign_name) as campanha,
         round(sum(spend)::numeric,2) as gasto_usd, sum(impressions) as imp, sum(clicks) as cliques
  from meta_ad_insights
  where is_demo=false and date between '2026-06-01' and '2026-07-11'
  group by campaign_id
),
ld as (
  select meta_campaign_id, count(*) as leads
  from leads
  where created_at >= '2026-06-01' and meta_campaign_id is not null
  group by meta_campaign_id
)
select i.campanha, i.gasto_usd, coalesce(l.leads,0) as leads_crm,
       case when coalesce(l.leads,0)>0 then round(i.gasto_usd/l.leads,2) end as cpl_usd
from ins i left join ld l on l.meta_campaign_id = i.campaign_id
order by i.gasto_usd desc;
```

### Funil completo (lead → agendamento → venda) por campanha
```sql
select l.meta_campaign_name, count(*) as leads,
       count(*) filter (where exists (select 1 from appointments a where a.lead_id=l.id)) as agendamentos,
       count(*) filter (where exists (select 1 from deals d where d.lead_id=l.id
                        and d.signed_at >= l.created_at)) as vendas_reais,
       count(*) filter (where l.stage='novo_lead') as parados_novo_lead
from leads l
where l.source='meta_ads' and l.created_at >= '2026-06-01'
group by 1 order by 2 desc;
```
(`d.signed_at >= l.created_at` evita contar vendas antigas ligadas a leads reimportados.)

### Top anúncios (criativo campeão / kill list)
```sql
with ins as (
  select ad_id, max(ad_name) as anuncio, max(campaign_name) as campanha,
         round(sum(spend)::numeric,2) as gasto
  from meta_ad_insights where is_demo=false and date >= '2026-06-01' group by ad_id
), ld as (
  select meta_ad_id, count(*) as leads from leads
  where created_at >= '2026-06-01' and meta_ad_id is not null group by meta_ad_id
)
select i.anuncio, i.campanha, i.gasto, coalesce(l.leads,0) as leads,
       case when coalesce(l.leads,0)>0 then round(i.gasto/l.leads,2) end as cpl
from ins i left join ld l on l.meta_ad_id = i.ad_id
where i.gasto > 20 order by i.gasto desc;
```

### Gasto diário (detecta escala/queda)
```sql
select date, round(sum(spend)::numeric,2) as gasto
from meta_ad_insights where is_demo=false and date >= current_date - 21
group by date order by date;
```

## Marketing API ao vivo (Node)

Padrão testado (2026-07-11) — ler `INSTAGRAM_ACCESS_TOKEN` do `.env.local`, descobrir a conta
por uma campanha conhecida, nunca imprimir o token:

```js
const BASE = 'https://graph.facebook.com/v19.0';
// account id: GET `${BASE}/120246631784530336?fields=account_id` → `act_${account_id}`

// Configurações
// GET /act_X/campaigns?fields=id,name,objective,status,effective_status,buying_type,
//     bid_strategy,daily_budget,lifetime_budget,created_time,start_time
// GET /act_X/adsets?fields=id,name,status,effective_status,campaign_id,daily_budget,
//     optimization_goal,billing_event,destination_type,targeting,promoted_object

// Desempenho com leads OFICIAIS da Meta (fonte da verdade p/ CPL)
// GET /act_X/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,
//     clicks,ctr,cpm,frequency,actions&time_range={"since":"...","until":"..."}
// leads = actions[].find(a => a.action_type === 'lead').value

// Mensal: level=account & time_increment=monthly
// Posicionamento: level=account & breakdowns=publisher_platform,platform_position
```

- `daily_budget`/`lifetime_budget` vêm em **centavos de USD** (50000 = $500/dia).
- Janela grande com `time_increment=1` em level=ad quebra ("unknown error") → fatiar em 30 dias.
- Targeting: cargos ficam em `flexible_spec[].work_positions/education_majors`; exclusões em
  `excluded_custom_audiences`; Advantage+ audience em `targeting_automation.advantage_audience`.

## Reconciliação e fluxo MasterClass (2026-07-11)

- `src/lib/meta/reconcile.ts`: busca leadgen de TODOS os forms da página na Graph API
  (`/{form_id}/leads` + filtering time_created), compara com `webhook_logs.payload->>leadgen_id`
  (via='meta-leadgen') e importa os que faltam por `processLeadgen` (idempotente). Corre no cron
  `/api/meta-ads/sync` (diário, 3d) e no botão da aba Tráfego (30d). Parâmetros do endpoint:
  `?only=reconcile&days=N` (Bearer CRON_SECRET). Execuções ficam em webhook_logs
  (payload->>via='meta-reconcile'). PEGADINHA: a coluna de data de webhook_logs é `received_at`.
- `/{page_id}/leadgen_forms` exige PAGE token (#190 com token de usuário). O da Vercel é Page
  token; o do `.env.local` local não é — derive com `GET /{page_id}?fields=access_token`.
- Leads MasterClass: `products.meta_entry_stage='grupo_masterclass'` → processLeadgen roteia
  para o stage oculto `sdr/grupo_masterclass` (migration masterclass_group_flow; 343 movidos no
  backfill), sem responsável e sem reativação. LP MasterClass (rota landing-page-masterclass) é
  OUTRO fluxo (isca da Imersão ISDO — continua novo_lead).

## Gestor IA — agrupamento de criativos por produto

- O ranking (`src/lib/traffic-ai/product-ranking.ts`) agrupa criativos pelos LEADS
  (leads.product_id + meta_ad_id). Reentrada cruzada (lead do produto A preenche form do
  produto B) mantém o product_id antigo mas carrega a atribuição nova — sem a guarda, o
  criativo vazava para o card do produto errado (caso real: AD da Imersão no card Método
  Sari). A guarda resolve o produto pelos NOMES (resolveProductForMeta com form + campanha +
  conjunto + anúncio) e expulsa o anúncio do ranking quando resolve para outro produto.
- resolveProductForMeta também casa código com sufixo de data colado ("isdo0926" → ISDO).
- O product_id do lead NUNCA é sobrescrito em reentrada (regra de negócio) — leads de
  reentrada cruzada aparecem na consulta: produto do lead ≠ produto do código do form.

## Estado da conta (snapshot 2026-07-11)

- 7 campanhas ativas: M.CLASS JUN26 + JUL26 ($500/dia cada, escaladas em 10/07), IMERSÃO SET26
  ($55/dia), POS vídeos ($30/dia) + POS estáticos ($20/dia), Seguidores ($10/dia), Reconhecimento ($6/dia).
- Tudo `OUTCOME_LEADS` + `LOWEST_COST_WITHOUT_CAP` (volume máximo, sem teto de custo), formulários
  nativos (`destination ON_AD`), ABO.
- Públicos: cargos médicos, BR, 18/25–65, Instagram (M.CLASS JUL26 também Facebook);
  exclusões de quem preencheu form (90d/20d/15d); Advantage audience ON nas campanhas novas.
- Time: gestora de tráfego nova desde junho/2026; antes outro gestor (nomenclatura `[SD]...`, leads via LP).

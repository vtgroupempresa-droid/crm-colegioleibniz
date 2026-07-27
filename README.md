# CRM Colégio Leibniz

CRM comercial do Colégio Leibniz (Rondonópolis-MT): gestão de leads, funil de
matrículas, atendimento multicanal (Instagram Direct + WhatsApp oficial),
visitas presenciais, automações e dashboard.

Derivado da arquitetura do CRM SariDoctors, adaptado para o processo da escola.

## Stack

- **Next.js 14** (App Router) + React 18 + TypeScript estrito
- **Supabase** (Postgres + Auth + Realtime + Storage) via `@supabase/ssr`
- **Tailwind CSS** — paleta azul Leibniz em `tailwind.config.ts`
- **dnd-kit** (kanban), **Recharts** (dashboard), **sonner** (toasts)
- Deploy: **Vercel** (crons em `vercel.json`)

## Funil comercial

`Novo Lead → Primeiro Contato → Visita Presencial → Em Negociação → Follow-Up → Cliente Fechado` (+ `Perdido`).
Etapas são linhas de `pipeline_stages` — editáveis em **/admin** sem deploy.
Pipeline `pos_matricula` fica pronto para a futura integração EasySchool.

## Módulos

| Rota | O que faz |
|---|---|
| `/leads` | Todos os leads (responsáveis) com filtros e CSV |
| `/oportunidades` | Funil kanban com arrastar-e-soltar |
| `/calendario` | Visitas presenciais (+ sync Google Calendar opcional) |
| `/chat` | Inbox Instagram Direct + WhatsApp (realtime) |
| `/disparos` | Mensagens em massa via linha oficial |
| `/dashboard` | Matrículas fechadas, interesse alto x não fechou, metas |
| `/relatorios` | Relatórios filtráveis com exportação |
| `/admin` | Usuários/convites, etapas, metas, templates |
| `/admin/automacoes` | Automações: alertas, follow-ups e lembretes editáveis |
| `/integracoes` | Meta (webhook/import) e webhooks genéricos (Traffic AI) |

## Cargos

- **admin** (Dércio, Alisson): acesso total.
- **comercial** (Lorraine, Lucília, Núbia): leads, funil, chat, calendário, disparos.

## Rodando local

```bash
npm install
cp .env.example .env.local   # e preencha
npm run dev
```

## Banco

Migrations em `supabase/migrations/` (schema completo + seed do funil).
Aplicar via Supabase MCP, SQL Editor ou `supabase db push`.

## Integração Meta

Webhook unificado em `/api/meta/webhook` (GET verify + POST com assinatura
X-Hub-Signature-256): Instagram Direct → chat; Lead Ads → leads (base para a
integração Traffic AI); WhatsApp Cloud → chat (quando a WABA for ativada).

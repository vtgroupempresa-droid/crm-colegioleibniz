'use client';

import { Fragment, useState } from 'react';
import { LeadAdCreative } from '@/components/leads/lead-ad-creative';
import { Badge } from '@/components/ui/badge';
import {
  LEAD_SOURCE_LABELS,
  PAID_LEAD_SOURCES,
  parseMetaFormAnswers,
  type Activity,
  type Lead,
  type MetaFormAnswer,
  type MetaLeadEntry,
} from '@/types/lead';

interface LeadOriginSectionProps {
  lead: Lead;
  /** Histórico de entradas Meta (1ª entrada + reentradas), ordem cronológica. */
  entries?: readonly MetaLeadEntry[];
  /** Activities do lead (ordem desc) — detectam reentrada/reativação p/ "Voltou em". */
  activities?: readonly Activity[];
}

interface ReentryInfo {
  at: string;
  channel: string | null;
}

/**
 * Última REENTRADA do lead: reativação (voltou pra sdr/novo_lead por contato
 * espontâneo/novo formulário) ou novo Lead Ad do Meta em lead já existente.
 * Sem isso o drawer só mostrava o `created_at` (primeira entrada — ex.: fevereiro
 * via GHL) e um lead que voltou HOJE parecia ter data errada.
 */
function lastReentry(activities: readonly Activity[]): ReentryInfo | null {
  for (const a of activities) {
    if (a.type !== 'system') continue;
    const meta = a.metadata;
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) continue;
    const rec = meta as Record<string, unknown>;
    if (rec.via === 'reactivation') {
      return { at: a.created_at, channel: typeof rec.channel === 'string' ? rec.channel : null };
    }
    if (rec.meta_reentry === true) {
      return { at: a.created_at, channel: 'novo formulário (Meta Lead Ads)' };
    }
  }
  return null;
}

/** "qual_o_seu_faturamento_mensal?" → "Qual o seu faturamento mensal?" */
function humanizeQuestion(raw: string): string {
  const text = raw.replace(/_/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A Meta grava opções de múltipla escolha em snake_case ("de_r$10.000_a_r$20.000").
 * Troca underscore por espaço, exceto em emails (underscore pode ser literal).
 */
function humanizeAnswer(raw: string): string {
  return raw.includes('@') ? raw : raw.replace(/_/g, ' ');
}

/** "08/07/2026 às 23:03" */
function formatDateTime(value: string): string {
  const d = new Date(value);
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${date} às ${time}`;
}

/** Comparações sem acento/caixa (perguntas do formulário variam a grafia). */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function isYes(answer: string): boolean {
  return normalize(humanizeAnswer(answer)).trim().startsWith('sim');
}

function isNo(answer: string): boolean {
  return normalize(humanizeAnswer(answer)).trim().startsWith('nao');
}

/**
 * "R$ 10.000 a R$ 20.000" → "R$ 10–20 mil/mês". Só compacta faixas com dois
 * valores redondos em milhar; qualquer outro formato mantém o texto original.
 */
function compactRevenue(answer: string): string {
  const text = humanizeAnswer(answer);
  const nums = (text.match(/\d{1,3}(?:[.,]\d{3})+|\d+/g) ?? []).map((n) =>
    parseInt(n.replace(/[.,]/g, ''), 10),
  );
  const [a, b] = nums;
  if (nums.length !== 2 || a === undefined || b === undefined) return text;
  if (a < 1000 || b < 1000 || a % 1000 !== 0 || b % 1000 !== 0) return text;
  return `R$ ${a / 1000}–${b / 1000} mil/mês`;
}

/** "+5531993762509" → "+55 31 99376-2509" (fora do padrão BR, mantém como veio). */
function formatPhone(answer: string): string {
  const digits = answer.replace(/\D/g, '');
  if (!digits.startsWith('55') || digits.length < 12 || digits.length > 13) return answer;
  const dd = digits.slice(2, 4);
  const rest = digits.slice(4);
  const split = rest.length - 4;
  return `+55 ${dd} ${rest.slice(0, split)}-${rest.slice(split)}`;
}

type QaKind = 'name' | 'phone' | 'email' | 'other';

function classifyQuestion(question: string, answer: string): QaKind {
  const q = normalize(humanizeQuestion(question));
  if (q.includes('nome')) return 'name';
  if (q.includes('whatsapp') || q.includes('telefone') || q.includes('celular')) return 'phone';
  if (q.includes('mail') || answer.includes('@')) return 'email';
  return 'other';
}

/* ── Chips de qualificação (derivados das respostas do formulário) ── */

type ChipTone = 'ok' | 'warn' | 'accent' | 'neutral';

const CHIP_TONE_CLASSES: Record<ChipTone, string> = {
  ok: 'border-[#CBE8D6] bg-[#EAF6EF] text-[#1A7F4B]',
  warn: 'border-[#F3E2C4] bg-[#FFF7EC] text-[#92610E]',
  accent: 'border-[#F0DCDF] bg-[#FBF1F2] text-[#8B2635]',
  neutral: 'border-[#E7E5E4] bg-[#FAFAF9] text-[#57534E]',
};

interface QualChip {
  label: string;
  tone: ChipTone;
}

function buildQualChips(answers: readonly MetaFormAnswer[]): QualChip[] {
  const chips: QualChip[] = [];
  for (const { question, answer } of answers) {
    const q = normalize(humanizeQuestion(question));
    if (q.includes('crm')) {
      if (isYes(answer)) chips.push({ label: '✓ Médico com CRM', tone: 'ok' });
      else if (isNo(answer)) chips.push({ label: 'Não inscrito no CRM', tone: 'warn' });
    } else if (q.includes('especialidade')) {
      chips.push({ label: humanizeAnswer(answer), tone: 'accent' });
    } else if (q.includes('clinica')) {
      if (isNo(answer)) chips.push({ label: 'Sem clínica própria', tone: 'warn' });
      else if (isYes(answer)) chips.push({ label: 'Clínica própria', tone: 'ok' });
    } else if (q.includes('faturamento')) {
      chips.push({ label: compactRevenue(answer), tone: 'neutral' });
    }
  }
  return chips;
}

/* ── Blocos visuais ── */

/** Valor com os pipes da nomenclatura trocados por separadores "·" em cinza. */
function PipeValue({ value }: { value: string }) {
  const parts = value
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={`${part}-${i}`}>
          {i > 0 && <span className="text-[#A8A29E]"> · </span>}
          {part}
        </Fragment>
      ))}
    </>
  );
}

interface HierarchyItem {
  label: string;
  value: string;
}

/** Campanha → conjunto → formulário: linhas conectadas por dots vinho. */
function Hierarchy({ items }: { items: HierarchyItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      {items.map((item, i) => (
        <div
          key={item.label}
          className={`relative grid grid-cols-[22px_130px_1fr] items-start gap-x-2.5 py-2 max-[520px]:grid-cols-[22px_1fr] ${
            i > 0 ? 'border-t border-dashed border-[#E7E5E4]' : ''
          }`}
        >
          <span className="mt-1.5 h-2 w-2 justify-self-center rounded-full bg-[#8B2635] max-[520px]:row-span-2" />
          {i < items.length - 1 && (
            <span
              aria-hidden
              className="absolute bottom-[-9px] left-[10.5px] top-[18px] w-px bg-[#E7E5E4]"
            />
          )}
          <span className="pt-0.5 text-xs text-[#A8A29E] max-[520px]:col-start-2">
            {item.label}
          </span>
          <span className="break-words text-[12.5px] leading-normal text-[#1C1917] max-[520px]:col-start-2">
            <PipeValue value={item.value} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Linha "Entrou em" / "Voltou em" / UTM no rodapé da hierarquia. */
function FooterRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs text-[#A8A29E]">
      <span className="shrink-0">{label}</span>
      <strong className="break-all text-right font-medium text-[#57534E]">{value}</strong>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="focus-ring float-right rounded-md border border-[#E7E5E4] bg-transparent px-2 py-0.5 text-[11px] text-[#A8A29E] transition-colors hover:border-[#8B2635] hover:text-[#8B2635]"
    >
      {copied ? 'copiado!' : 'copiar'}
    </button>
  );
}

/** Uma célula da grade de respostas. Campo vazio não renderiza. */
function QaCell({ question, answer }: MetaFormAnswer) {
  if (!answer.trim()) return null;
  const kind = classifyQuestion(question, answer);
  const label = humanizeQuestion(question);
  const full = kind === 'name';
  return (
    <div className={`bg-white px-3.5 py-3 ${full ? 'col-span-full' : ''}`}>
      <div className="mb-1 text-[11.5px] text-[#A8A29E]">
        {label}
        {kind === 'phone' && <CopyButton value={answer.trim()} />}
        {kind === 'email' && <CopyButton value={answer.trim()} />}
      </div>
      {kind === 'email' ? (
        <a
          href={`mailto:${answer.trim()}`}
          className="focus-ring break-words text-[13px] font-medium text-[#8B2635] hover:underline"
        >
          {answer.trim()}
        </a>
      ) : (
        <div
          className={`break-words text-[#1C1917] ${
            kind === 'phone' ? 'text-[13px] font-medium' : 'text-sm font-semibold'
          }`}
        >
          {kind === 'phone' ? formatPhone(answer) : humanizeAnswer(answer)}
        </div>
      )}
    </div>
  );
}

/**
 * UMA entrada Meta (1ª entrada ou reentrada): criativo em destaque + hierarquia
 * campanha → conjunto → formulário + produto do anúncio DAQUELE momento. Cada
 * entrada é isolada — o criativo/produto de uma reentrada nunca se mistura com
 * os da primeira entrada. `framed=true` (histórico com reentradas) envolve o
 * bloco em borda própria com badge de tipo + data.
 */
function EntryView({ entry, framed }: { entry: MetaLeadEntry; framed: boolean }) {
  const campaign = entry.campaignName ?? entry.campaignId;
  const ad = entry.adName ?? entry.adId;
  const items: HierarchyItem[] = [];
  if (campaign) items.push({ label: 'Campanha', value: campaign });
  if (entry.adsetName) items.push({ label: 'Conjunto de anúncios', value: entry.adsetName });
  // Com criativo, o nome do anúncio já aparece no card; sem adId, vira linha.
  if (!entry.adId && ad) items.push({ label: 'Anúncio', value: ad });
  if (entry.formName) items.push({ label: 'Formulário', value: entry.formName });

  const body = (
    <>
      {framed && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <Badge tone={entry.kind === 'first' ? 'neutral' : 'warning'}>
            {entry.kind === 'first' ? '1ª entrada' : 'Reentrada'}
          </Badge>
          <span className="text-[11px] text-[#A8A29E]">{formatDateTime(entry.at)}</span>
        </div>
      )}
      {entry.adId && (
        <div className={items.length > 0 ? 'mb-3' : ''}>
          <LeadAdCreative adId={entry.adId} adName={entry.adName} />
        </div>
      )}
      <Hierarchy items={items} />
      {entry.adId && (
        <a
          href={`https://www.facebook.com/adsmanager/manage/ads?selected_ad_ids=${encodeURIComponent(entry.adId)}`}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex text-xs font-medium text-[#1877F2] hover:underline"
        >
          Abrir anúncio no Gerenciador de Anúncios ↗
        </a>
      )}
      {(entry.leadgenId || entry.formId) && (
        <div className="mt-3 flex flex-col gap-1 border-t border-[#E7E5E4] pt-3">
          <FooterRow label="Leadgen ID" value={entry.leadgenId} />
          <FooterRow label="Form ID" value={entry.formId} />
        </div>
      )}
      {entry.formAnswers.length > 0 && (
        <div className="mt-3 border-t border-[#E7E5E4] pt-3">
          <h5 className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#57534E]">
            Respostas desta entrada
          </h5>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-[#E7E5E4] bg-[#E7E5E4] max-[520px]:grid-cols-1">
            {entry.formAnswers.map((answer, index) => (
              <QaCell
                key={`${answer.question}-${index}`}
                question={answer.question}
                answer={answer.answer}
              />
            ))}
          </div>
        </div>
      )}
      {!framed && (
        <div className="mt-3 border-t border-[#E7E5E4] pt-3">
          <FooterRow label="Entrou em" value={formatDateTime(entry.at)} />
        </div>
      )}
    </>
  );

  if (!framed) return <div className="border-b border-[#E7E5E4] px-4 py-4">{body}</div>;
  return <div className="rounded-xl border border-[#E7E5E4] p-3.5">{body}</div>;
}

/**
 * Seção "Origem do lead" do drawer: conta a história de onde o lead veio —
 * fonte (paga/orgânica), e os touchpoints Meta SEPARADOS (1ª entrada + cada
 * reentrada), cada um com seu criativo/campanha/formulário e o produto do
 * anúncio daquele momento. O "Produto da negociação" (o que o time está
 * vendendo) aparece à parte, no topo, para não se confundir com o produto do
 * anúncio de reentrada. UTMs/landing e respostas do formulário são do lead.
 * Visual do protótipo origem-do-lead-card.html (tokens vinho #8B2635).
 */
export function LeadOriginSection({ lead, entries = [], activities = [] }: LeadOriginSectionProps) {
  const isPaid = lead.source ? PAID_LEAD_SOURCES.includes(lead.source) : false;
  const isMeta = lead.source === 'meta_ads';
  const answers = parseMetaFormAnswers(lead.meta_form_answers);
  const chips = buildQualChips(answers);

  // Histórico estruturado (leads.meta_entries) é a fonte preferida. Leads antigos
  // sem histórico caem no fallback com as colunas meta_* (última atribuição).
  const hasHistory = entries.length > 0;
  const reentry = lastReentry(activities);
  const hasReentry = hasHistory ? entries.some((e) => e.kind === 'reentry') : Boolean(reentry);
  // Entrada única = layout limpo do protótipo; com reentradas, blocos com badge.
  const framedEntries = entries.length > 1;

  // Fallback (legado) — colunas meta_*, a última atribuição gravada.
  const campaign = lead.meta_campaign_name ?? lead.utm_campaign;
  const ad = lead.meta_ad_name ?? lead.utm_content ?? lead.ad_creative;
  const fallbackItems: HierarchyItem[] = [];
  if (!hasHistory) {
    if (campaign) fallbackItems.push({ label: 'Campanha', value: campaign });
    if (lead.meta_adset_name)
      fallbackItems.push({ label: 'Conjunto de anúncios', value: lead.meta_adset_name });
    if (!lead.meta_ad_id && ad) fallbackItems.push({ label: 'Anúncio', value: ad });
    if (lead.meta_form_name)
      fallbackItems.push({ label: 'Formulário', value: lead.meta_form_name });
  }

  const utm =
    lead.utm_source || lead.utm_medium
      ? `${lead.utm_source ?? '—'} / ${lead.utm_medium ?? '—'}`
      : null;

  // INTERESSE ORIGINAL de lead que reentrou: em leads criados antes do
  // meta_entries a atribuição Meta da 1ª entrada foi sobrescrita pela reentrada —
  // o que sobrou dela são created_at e as UTMs (reentrada Meta não escreve UTM).
  // "via Lista de Hormônios Online" muda a abertura da conversa do SDR.
  const hasFirstEntry = entries.some((e) => e.kind === 'first');
  const showFirstContext = hasReentry && !hasFirstEntry;
  const firstEntryValue =
    formatDateTime(lead.created_at) +
    (showFirstContext && lead.utm_source ? ` · via ${lead.utm_source}` : '');
  // Se a UTM source já aparece no "Primeira entrada" e não há medium, a linha
  // "UTM source / medium" ficaria redundante — some.
  const utmRedundant = showFirstContext && Boolean(lead.utm_source) && !lead.utm_medium;
  const hasUtmRows = Boolean((utm && !utmRedundant) || lead.landing_page);

  return (
    <section className="overflow-hidden rounded-2xl border border-[#E7E5E4] bg-white">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-[#E7E5E4] px-4 py-3.5">
        <h4 className="text-[13px] font-bold uppercase tracking-[0.08em] text-[#57534E]">
          Origem do Lead
        </h4>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {hasReentry && <Badge tone="warning">Reentrada</Badge>}
          {isMeta ? (
            <>
              <span className="whitespace-nowrap rounded-full bg-[#1C1917] px-2.5 py-1 text-xs font-semibold text-white">
                Meta Ads
              </span>
              <span className="whitespace-nowrap rounded-full bg-[#EDF4FF] px-2.5 py-1 text-xs font-semibold text-[#1877F2]">
                Tráfego pago
              </span>
            </>
          ) : (
            lead.source && (
              <>
                <Badge tone="neutral">{LEAD_SOURCE_LABELS[lead.source]}</Badge>
                <Badge tone={isPaid ? 'info' : 'success'}>
                  {isPaid ? 'Tráfego pago' : 'Orgânico'}
                </Badge>
              </>
            )
          )}
        </div>
      </div>

      {hasHistory ? (
        <>
          {/* Lead antigo cujo histórico só tem reentradas: a 1ª entrada real é
              anterior ao meta_entries — mostra o contexto que sobrou dela. */}
          {showFirstContext && (
            <div className="border-b border-[#E7E5E4] bg-[#FAFAF9] px-4 py-3">
              <FooterRow label="Primeira entrada" value={firstEntryValue} />
            </div>
          )}
          {/* Timeline de entradas Meta, cada uma isolada (1ª entrada → reentradas). */}
          {framedEntries ? (
            <div className="flex flex-col gap-3 border-b border-[#E7E5E4] px-4 py-4">
              {entries.map((entry, i) => (
                <EntryView
                  key={`${entry.leadgenId ?? 'entry'}-${entry.at}-${i}`}
                  entry={entry}
                  framed
                />
              ))}
            </div>
          ) : (
            entries[0] && <EntryView entry={entries[0]} framed={false} />
          )}
          {/* UTM/landing são do lead (não por entrada). */}
          {hasUtmRows && (
            <div className="flex flex-col gap-1.5 border-b border-[#E7E5E4] px-4 py-3">
              {!utmRedundant && <FooterRow label="UTM source / medium" value={utm} />}
              <FooterRow label="Landing page" value={lead.landing_page} />
            </div>
          )}
        </>
      ) : (
        /* Fallback legado: lead sem histórico estruturado — última atribuição. */
        <div className="border-b border-[#E7E5E4] px-4 py-4">
          {lead.meta_ad_id && (
            <div className={fallbackItems.length > 0 ? 'mb-3' : ''}>
              <LeadAdCreative adId={lead.meta_ad_id} adName={ad} />
            </div>
          )}
          <Hierarchy items={fallbackItems} />
          <div
            className={`flex flex-col gap-1.5 ${
              fallbackItems.length > 0 || lead.meta_ad_id
                ? 'mt-3 border-t border-[#E7E5E4] pt-3'
                : ''
            }`}
          >
            <FooterRow label={reentry ? 'Primeira entrada' : 'Entrou em'} value={firstEntryValue} />
            {reentry && (
              <FooterRow
                label="Voltou em"
                value={
                  formatDateTime(reentry.at) + (reentry.channel ? ` · ${reentry.channel}` : '')
                }
              />
            )}
            {!utmRedundant && <FooterRow label="UTM source / medium" value={utm} />}
            <FooterRow label="Landing page" value={lead.landing_page} />
          </div>
        </div>
      )}

      {/* Respostas do formulário */}
      {!hasHistory && answers.length > 0 && (
        <div className="px-4 pb-4 pt-4">
          <h5 className="mb-3.5 text-[13px] font-bold uppercase tracking-[0.08em] text-[#57534E]">
            Respostas do formulário {hasReentry ? '(última entrada)' : ''}
          </h5>
          {chips.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {chips.map((chip) => (
                <span
                  key={chip.label}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold ${CHIP_TONE_CLASSES[chip.tone]}`}
                >
                  {chip.label}
                </span>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-[#E7E5E4] bg-[#E7E5E4] max-[520px]:grid-cols-1">
            {answers.map((a, i) => (
              <QaCell key={`${a.question}-${i}`} question={a.question} answer={a.answer} />
            ))}
          </div>
        </div>
      )}

      {lead.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-[#E7E5E4] px-4 py-3">
          {lead.tags.map((t) => (
            <Badge key={t} tone="info">
              {t}
            </Badge>
          ))}
        </div>
      )}
    </section>
  );
}

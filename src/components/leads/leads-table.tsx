'use client';

import { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { GaugeCard, type GaugeColor, type GaugePillTone } from './gauge-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { LeadDrawer } from './lead-drawer';
import { LeadCreateModal } from './lead-create-modal';
import { formatDate, formatRelativeCompact } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import type { LeadsPageStats } from '@/actions/leads-queries';
import {
  EDUCATION_LEVELS,
  EDUCATION_LEVEL_LABELS,
  INTEREST_LEVELS,
  INTEREST_LEVEL_LABELS,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  type EducationLevel,
  type InterestLevel,
  type Lead,
  type LeadSource,
} from '@/types/lead';
import { PIPELINES, PIPELINE_LABELS, type PipelineKind } from '@/types/pipeline';
import { PERIOD_KINDS, PERIOD_LABELS, type PeriodKind } from '@/lib/dashboard/period';

// ============================================================================
// Helpers visuais da tabela
// ============================================================================

/** Iniciais do lead (primeiro + último nome) para o quadrado avatar. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]?.charAt(0) ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

/** Fallback quando o slug do stage não está no mapa vindo do banco. */
function humanizeStage(slug: string): string {
  return slug
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Cores das pills de origem (sem ícone/emoji). Fontes não mapeadas caem no
 * cinza neutro — mesma cor de "Reentrada".
 */
const SOURCE_PILL_CLASSES: Partial<Record<LeadSource, string>> = {
  meta_ads: 'bg-sky-100 text-sky-800',
  whatsapp: 'bg-emerald-100 text-emerald-800',
  instagram: 'bg-pink-100 text-pink-800',
  organico: 'bg-violet-100 text-violet-800',
};
const SOURCE_PILL_DEFAULT = 'bg-brand-100 text-brand-600';

function SourcePill({ source }: { source: LeadSource | null }) {
  if (!source) return <span className="text-xs text-brand-300">—</span>;
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-tight',
        SOURCE_PILL_CLASSES[source] ?? SOURCE_PILL_DEFAULT,
      )}
    >
      {LEAD_SOURCE_LABELS[source]}
    </span>
  );
}

/** Cápsula "cadeia" pipeline → stage (nome amigável do stage em badge azul). */
function PipelineChain({
  pipeline,
  stage,
  stageLabels,
}: {
  pipeline: PipelineKind;
  stage: string;
  stageLabels: Record<string, string>;
}) {
  const stageName = stageLabels[`${pipeline}:${stage}`] ?? humanizeStage(stage);
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-brand-100 bg-brand-50 py-0.5 pl-2.5 pr-0.5">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-brand-400">
        {PIPELINE_LABELS[pipeline]}
      </span>
      <span className="truncate rounded-full bg-sky-600 px-2 py-0.5 text-[11px] font-medium leading-tight text-white">
        {stageName}
      </span>
    </span>
  );
}

/** Badge do nível de interesse (substitui o score do CRM original). */
const INTEREST_PILL_CLASSES: Record<InterestLevel, string> = {
  alto: 'bg-red-100 text-red-700',
  medio: 'bg-amber-100 text-amber-700',
  baixo: 'bg-brand-100 text-brand-500',
};

function InterestPill({ level }: { level: InterestLevel | null }) {
  if (!level) return <span className="text-xs text-brand-300">—</span>;
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold leading-tight',
        INTEREST_PILL_CLASSES[level],
      )}
    >
      {INTEREST_LEVEL_LABELS[level]}
    </span>
  );
}

// ============================================================================
// Filtros + chips de atalho
// ============================================================================

interface FiltersState {
  search: string;
  pipeline: PipelineKind | '';
  educationLevel: EducationLevel | '';
  source: LeadSource | '';
  /** Período de criação do lead ('' = todo o período). */
  period: PeriodKind | '';
  /** Datas (yyyy-mm-dd) usadas quando period === 'custom'. */
  periodFrom: string;
  periodTo: string;
  interest: InterestLevel | '';
  sortBy: 'created_at' | 'updated_at';
  sortDir: 'asc' | 'desc';
  unassigned: boolean;
  sla: boolean;
  meetingToday: boolean;
  newToday: boolean;
}

const EMPTY_FILTERS: FiltersState = {
  search: '',
  pipeline: '',
  educationLevel: '',
  source: '',
  period: '',
  periodFrom: '',
  periodTo: '',
  interest: '',
  sortBy: 'created_at',
  sortDir: 'desc',
  unassigned: false,
  sla: false,
  meetingToday: false,
  newToday: false,
};

function buildParams(filters: FiltersState, nextPage: number): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.pipeline) params.set('pipeline', filters.pipeline);
  if (filters.educationLevel) params.set('educationLevel', filters.educationLevel);
  if (filters.source) params.set('source', filters.source);
  if (filters.period) {
    params.set('period', filters.period);
    if (filters.period === 'custom' && filters.periodFrom && filters.periodTo) {
      params.set('from', filters.periodFrom);
      params.set('to', filters.periodTo);
    }
  }
  if (filters.interest) params.set('interest', filters.interest);
  if (filters.sortBy !== 'created_at') params.set('sortBy', filters.sortBy);
  if (filters.sortDir !== 'desc') params.set('sortDir', filters.sortDir);
  if (filters.unassigned) params.set('unassigned', '1');
  if (filters.sla) params.set('sla', '1');
  if (filters.meetingToday) params.set('meetingToday', '1');
  if (filters.newToday) params.set('newToday', '1');
  if (nextPage > 1) params.set('page', String(nextPage));
  return params;
}

type ChipKey = 'todos' | 'unassigned' | 'sla' | 'interesseAlto' | 'meetingToday' | 'newToday';

interface ChipDef {
  key: ChipKey;
  label: string;
  count: number;
  /** Estado de filtros aplicado ao clicar (chips limpam os demais filtros). */
  next: FiltersState;
  isActive: (f: FiltersState) => boolean;
  /** SLA vencido ganha destaque vermelho quando ativo. */
  danger?: boolean;
}

// ============================================================================
// Componente principal
// ============================================================================

interface LeadsTableProps {
  leads: readonly Lead[];
  total: number;
  page: number;
  pageSize: number;
  stats: LeadsPageStats;
  /** Nome amigável de cada stage, chaveado por `${pipeline}:${slug}`. */
  stageLabels: Record<string, string>;
}

export function LeadsTable({ leads, total, page, pageSize, stats, stageLabels }: LeadsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  // ?lead=<id> abre a ficha direto — usado pelos links do dashboard (ex.: a
  // lista de resgate "interesse alto x não fechou").
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(
    () => searchParams.get('lead') ?? null,
  );
  const [createOpen, setCreateOpen] = useState(false);

  const [filters, setFilters] = useState<FiltersState>({
    search: searchParams.get('search') ?? '',
    pipeline: (searchParams.get('pipeline') ?? '') as PipelineKind | '',
    educationLevel: (searchParams.get('educationLevel') ?? '') as EducationLevel | '',
    source: (searchParams.get('source') ?? '') as LeadSource | '',
    period: (searchParams.get('period') ?? '') as PeriodKind | '',
    periodFrom: searchParams.get('from') ?? '',
    periodTo: searchParams.get('to') ?? '',
    interest: (searchParams.get('interest') ?? '') as InterestLevel | '',
    sortBy: (searchParams.get('sortBy') ?? 'created_at') as FiltersState['sortBy'],
    sortDir: (searchParams.get('sortDir') ?? 'desc') as FiltersState['sortDir'],
    unassigned: searchParams.get('unassigned') === '1',
    sla: searchParams.get('sla') === '1',
    meetingToday: searchParams.get('meetingToday') === '1',
    newToday: searchParams.get('newToday') === '1',
  });
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(filters.educationLevel || filters.interest),
  );

  function pushFilters(next: FiltersState, nextPage = 1) {
    const params = buildParams(next, nextPage);
    startTransition(() => {
      router.push(`/leads${params.toString() ? `?${params.toString()}` : ''}`);
    });
  }

  function applyFilters(nextPage = 1) {
    pushFilters(filters, nextPage);
  }

  function applyChip(chip: ChipDef) {
    // Chip ativo funciona como toggle — clicar de novo volta para "Todos".
    const next = chip.isActive(filters) ? EMPTY_FILTERS : chip.next;
    setFilters(next);
    pushFilters(next);
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    startTransition(() => router.push('/leads'));
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // --------------------------------------------------------------------------
  // Mini-dashboard de gauges
  // --------------------------------------------------------------------------
  const base = Math.max(1, stats.totalLeads);
  const pctOfBase = (n: number) => `${Math.round((100 * n) / base)}% da base ativa`;
  const salesDelta = stats.salesThisMonth - stats.salesPrevWindow;
  const gauges: {
    value: number;
    max: number;
    color: GaugeColor;
    label: string;
    description: string;
    pill: { text: string; tone: GaugePillTone };
  }[] = [
    {
      value: stats.totalLeads,
      max: base,
      color: 'blue',
      label: 'Total de leads',
      description: 'Leads na base ativa (não arquivados)',
      pill:
        stats.newThisWeek > 0
          ? { text: `↑ ${stats.newThisWeek} esta semana`, tone: 'up' }
          : { text: 'estável na semana', tone: 'neutral' },
    },
    {
      value: stats.hotLeads,
      max: base,
      color: 'red',
      label: 'Interesse alto',
      description: 'Leads com nível de interesse alto',
      pill: { text: pctOfBase(stats.hotLeads), tone: 'neutral' },
    },
    {
      value: stats.warmLeads,
      max: base,
      color: 'amber',
      label: 'Interesse médio',
      description: 'Leads com nível de interesse médio',
      pill: { text: pctOfBase(stats.warmLeads), tone: 'neutral' },
    },
    {
      value: stats.meetingsToday,
      max: Math.max(8, stats.meetingsToday),
      color: 'green',
      label: 'Visitas hoje',
      description: 'Visitas presenciais agendadas para hoje',
      pill:
        stats.meetingsToday > 0
          ? { text: 'agenda do dia', tone: 'up' }
          : { text: 'nenhuma hoje', tone: 'neutral' },
    },
    {
      value: stats.slaBreachedLeads,
      max: Math.max(25, stats.slaBreachedLeads),
      color: 'red',
      label: 'SLA vencido',
      description: 'Tentativa de contato atrasada, sem resposta',
      pill:
        stats.slaBreachedLeads > 0
          ? { text: '⚠ precisa de ação', tone: 'alert' }
          : { text: 'tudo em dia', tone: 'up' },
    },
    {
      value: stats.salesThisMonth,
      max: Math.max(10, stats.salesThisMonth, stats.salesPrevWindow),
      color: 'purple',
      label: 'Matrículas no mês',
      description: 'Matrículas fechadas no mês corrente',
      pill:
        salesDelta > 0
          ? { text: `↑ ${salesDelta} vs mês anterior`, tone: 'up' }
          : salesDelta < 0
            ? { text: `↓ ${Math.abs(salesDelta)} vs mês anterior`, tone: 'down' }
            : { text: 'estável no mês', tone: 'neutral' },
    },
  ];

  // --------------------------------------------------------------------------
  // Chips de atalho rápido
  // --------------------------------------------------------------------------
  const noChipActive =
    !filters.unassigned &&
    !filters.sla &&
    !filters.meetingToday &&
    !filters.newToday &&
    filters.interest !== 'alto';
  const chips: ChipDef[] = [
    {
      key: 'todos',
      label: 'Todos',
      count: stats.totalLeads,
      next: EMPTY_FILTERS,
      isActive: () => noChipActive,
    },
    {
      key: 'unassigned',
      label: 'Sem responsável',
      count: stats.unassignedLeads,
      next: { ...EMPTY_FILTERS, unassigned: true },
      isActive: (f) => f.unassigned,
    },
    {
      key: 'sla',
      label: 'SLA vencido',
      count: stats.slaBreachedLeads,
      next: { ...EMPTY_FILTERS, sla: true },
      isActive: (f) => f.sla,
      danger: true,
    },
    {
      key: 'interesseAlto',
      label: 'Interesse alto',
      count: stats.hotLeads,
      next: { ...EMPTY_FILTERS, interest: 'alto' },
      isActive: (f) =>
        f.interest === 'alto' && !f.unassigned && !f.sla && !f.meetingToday && !f.newToday,
    },
    {
      key: 'meetingToday',
      label: 'Visita hoje',
      count: stats.meetingTodayLeads,
      next: { ...EMPTY_FILTERS, meetingToday: true },
      isActive: (f) => f.meetingToday,
    },
    {
      key: 'newToday',
      label: 'Novos hoje',
      count: stats.newToday,
      next: { ...EMPTY_FILTERS, newToday: true },
      isActive: (f) => f.newToday,
    },
  ];

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-brand-700">Todos os Leads</h2>
          <p className="text-sm text-brand-500">
            {total} {total === 1 ? 'lead' : 'leads'} · página {page}/{totalPages}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ Novo lead</Button>
      </header>

      {/* 1. Mini-dashboard de gauges — scroll horizontal no mobile, grid no resto */}
      <div className="grid grid-flow-col auto-cols-[minmax(150px,1fr)] gap-3 overflow-x-auto pb-1 sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-3 sm:overflow-visible sm:pb-0 xl:grid-cols-6">
        {gauges.map((g) => (
          <GaugeCard key={g.label} {...g} />
        ))}
      </div>

      {/* 2. Chips de atalho rápido */}
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => {
          const active = chip.isActive(filters);
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => applyChip(chip)}
              disabled={isPending}
              className={cn(
                'focus-ring inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                active
                  ? chip.danger
                    ? 'border-red-600 bg-red-600 text-white'
                    : 'border-brand-700 bg-brand-700 text-canvas'
                  : 'border-brand-200 bg-white text-brand-600 hover:bg-brand-50',
              )}
            >
              {chip.label}
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none',
                  active ? 'bg-white/20' : 'bg-brand-100 text-brand-500',
                )}
              >
                {chip.count.toLocaleString('pt-BR')}
              </span>
            </button>
          );
        })}
      </div>

      {/* 3. Barra de filtros com labels */}
      <div className="rounded-lg border border-brand-100 bg-white p-4">
        <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-3 xl:grid-cols-7">
          <div className="md:col-span-2">
            <Input
              label="Buscar lead"
              placeholder="Nome do responsável, do aluno, telefone ou e-mail"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyFilters();
              }}
            />
          </div>
          <Select
            label="Pipeline"
            value={filters.pipeline}
            onChange={(e) =>
              setFilters((f) => ({ ...f, pipeline: e.target.value as PipelineKind | '' }))
            }
          >
            <option value="">Todos</option>
            {PIPELINES.map((p) => (
              <option key={p} value={p}>
                {PIPELINE_LABELS[p]}
              </option>
            ))}
          </Select>
          <Select
            label="Origem do lead"
            value={filters.source}
            onChange={(e) =>
              setFilters((f) => ({ ...f, source: e.target.value as LeadSource | '' }))
            }
          >
            <option value="">Todas</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {LEAD_SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select
            label="Período"
            value={filters.period}
            onChange={(e) =>
              setFilters((f) => ({ ...f, period: e.target.value as PeriodKind | '' }))
            }
          >
            <option value="">Todo o período</option>
            {PERIOD_KINDS.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </Select>
          <Select
            label="Ordenar por"
            value={filters.sortBy}
            onChange={(e) =>
              setFilters((f) => ({ ...f, sortBy: e.target.value as FiltersState['sortBy'] }))
            }
          >
            <option value="created_at">Criado em</option>
            <option value="updated_at">Atualizado em</option>
          </Select>
          <Button
            variant="secondary"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
          >
            ⚙ Mais filtros
          </Button>
        </div>

        {filters.period === 'custom' && (
          <div className="mt-3 grid grid-cols-1 gap-3 border-t border-brand-100 pt-3 md:grid-cols-4">
            <Input
              label="Criado de"
              type="date"
              value={filters.periodFrom}
              onChange={(e) => setFilters((f) => ({ ...f, periodFrom: e.target.value }))}
            />
            <Input
              label="Criado até"
              type="date"
              value={filters.periodTo}
              onChange={(e) => setFilters((f) => ({ ...f, periodTo: e.target.value }))}
            />
          </div>
        )}

        {showAdvanced && (
          <div className="mt-3 grid grid-cols-1 gap-3 border-t border-brand-100 pt-3 md:grid-cols-4">
            <Select
              label="Nível de ensino"
              value={filters.educationLevel}
              onChange={(e) =>
                setFilters((f) => ({ ...f, educationLevel: e.target.value as EducationLevel | '' }))
              }
            >
              <option value="">Todos</option>
              {EDUCATION_LEVELS.map((s) => (
                <option key={s} value={s}>
                  {EDUCATION_LEVEL_LABELS[s]}
                </option>
              ))}
            </Select>
            <Select
              label="Nível de interesse"
              value={filters.interest}
              onChange={(e) =>
                setFilters((f) => ({ ...f, interest: e.target.value as InterestLevel | '' }))
              }
            >
              <option value="">Todos</option>
              {INTEREST_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {INTEREST_LEVEL_LABELS[l]}
                </option>
              ))}
            </Select>
            <Select
              label="Direção"
              value={filters.sortDir}
              onChange={(e) =>
                setFilters((f) => ({ ...f, sortDir: e.target.value as FiltersState['sortDir'] }))
              }
            >
              <option value="desc">Descendente</option>
              <option value="asc">Ascendente</option>
            </Select>
          </div>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={resetFilters} disabled={isPending}>
            Limpar
          </Button>
          <Button size="sm" onClick={() => applyFilters()} disabled={isPending}>
            {isPending ? 'Filtrando...' : 'Aplicar filtros'}
          </Button>
        </div>
      </div>

      {/* 4. Tabela — apenas em telas sm+. No mobile vira lista de cards (abaixo). */}
      <div className="hidden overflow-hidden rounded-lg border border-brand-100 bg-white sm:block">
        <table className="w-full text-sm">
          <thead className="bg-brand-50 text-left text-xs uppercase tracking-wide text-brand-500">
            <tr>
              <th className="px-3 py-2">Lead</th>
              <th className="px-3 py-2">Pipeline</th>
              <th className="px-3 py-2">Origem</th>
              <th className="px-3 py-2">Interesse</th>
              <th className="px-3 py-2">Criado</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-brand-400">
                  Nenhum lead encontrado com esses filtros.
                </td>
              </tr>
            )}
            {leads.map((lead) => (
              <tr
                key={lead.id}
                onClick={() => setDrawerLeadId(lead.id)}
                className="cursor-pointer border-t border-brand-100 hover:bg-brand-50"
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-brand-100 text-xs font-bold text-brand-600">
                      {initials(lead.name)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-bold text-brand-700">{lead.name}</p>
                      <p className="truncate text-xs text-brand-300">{lead.phone ?? '—'}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <PipelineChain
                    pipeline={lead.pipeline}
                    stage={lead.stage}
                    stageLabels={stageLabels}
                  />
                </td>
                <td className="px-3 py-2">
                  <SourcePill source={lead.source} />
                </td>
                <td className="px-3 py-2">
                  <InterestPill level={lead.interest_level} />
                </td>
                <td className="px-3 py-2">
                  <p className="text-xs text-brand-500">{formatDate(lead.created_at)}</p>
                  <span className="mt-0.5 inline-flex rounded bg-brand-50 px-1.5 py-0.5 text-[10px] text-brand-400">
                    {formatRelativeCompact(lead.created_at)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Lista de cards — apenas no mobile. */}
      <div className="flex flex-col gap-2 sm:hidden">
        {leads.length === 0 && (
          <p className="rounded-lg border border-brand-100 bg-white px-4 py-6 text-center text-sm text-brand-400">
            Nenhum lead encontrado com esses filtros.
          </p>
        )}
        {leads.map((lead) => (
          <button
            key={lead.id}
            type="button"
            onClick={() => setDrawerLeadId(lead.id)}
            className="focus-ring flex flex-col gap-2 rounded-lg border border-brand-100 bg-white p-3 text-left active:bg-brand-50"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-brand-100 text-xs font-bold text-brand-600">
                  {initials(lead.name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-bold text-brand-700">{lead.name}</p>
                  <p className="truncate text-xs text-brand-300">{lead.phone ?? '—'}</p>
                </div>
              </div>
              <InterestPill level={lead.interest_level} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <PipelineChain
                pipeline={lead.pipeline}
                stage={lead.stage}
                stageLabels={stageLabels}
              />
              <SourcePill source={lead.source} />
            </div>
            <p className="text-[11px] text-brand-300">
              {formatDate(lead.created_at)} · {formatRelativeCompact(lead.created_at)}
            </p>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-brand-500">
        <span>
          Página {page} de {totalPages}
        </span>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1 || isPending}
            onClick={() => applyFilters(page - 1)}
          >
            ← Anterior
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= totalPages || isPending}
            onClick={() => applyFilters(page + 1)}
          >
            Próxima →
          </Button>
        </div>
      </div>

      <LeadDrawer
        leadId={drawerLeadId}
        open={drawerLeadId !== null}
        onClose={() => {
          setDrawerLeadId(null);
          // Limpa o ?lead= da URL para que voltar/atualizar não reabra a ficha.
          if (searchParams.get('lead')) {
            const params = new URLSearchParams(searchParams.toString());
            params.delete('lead');
            const qs = params.toString();
            router.replace(qs ? `/leads?${qs}` : '/leads');
          }
        }}
      />
      <LeadCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </section>
  );
}

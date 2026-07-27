'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { useBoardSearchTerm } from './board-search-context';
import type { AssignableUser } from '@/actions/leads-queries';
import {
  INTEREST_LEVELS,
  INTEREST_LEVEL_LABELS,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  type InterestLevel,
  type SourceFilter,
} from '@/types/lead';

interface FilterOption {
  value: string;
  label: string;
  /** Desenha uma linha separadora ACIMA desta opção (grupos → fontes específicas). */
  dividerBefore?: boolean;
}

interface FilterDropdownProps {
  label: string;
  options: FilterOption[];
  /** Valor ativo — 'all' significa "sem filtro" (dropdown sem destaque). */
  active: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
}

/**
 * Botão dropdown compacto de filtro: destaque azul + badge de contagem quando
 * há seleção ativa. Fecha em clique fora ou Escape. Single-select — escolher
 * uma opção substitui a anterior e fecha o painel.
 */
function FilterDropdown({ label, options, active, onSelect, disabled }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const hasSelection = active !== 'all';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'focus-ring flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
          hasSelection
            ? 'border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100'
            : 'border-brand-200 bg-white text-brand-600 hover:bg-brand-50',
        )}
      >
        {label}
        {hasSelection && (
          <span className="rounded-full bg-sky-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
            1
          </span>
        )}
        <span aria-hidden className="text-[10px] text-current opacity-60">
          ▾
        </span>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-20 mt-1 max-h-72 w-60 overflow-y-auto rounded-lg border border-brand-200 bg-white p-1 shadow-lg"
        >
          {options.map((opt) => {
            const isActive = opt.value === active;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  setOpen(false);
                  onSelect(opt.value);
                }}
                className={cn(
                  'focus-ring flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors',
                  opt.dividerBefore && 'mt-1 border-t border-brand-100 pt-2',
                  isActive
                    ? 'bg-sky-50 font-semibold text-sky-800'
                    : 'text-brand-600 hover:bg-brand-50',
                )}
              >
                <span className="truncate">{opt.label}</span>
                {isActive && <span aria-hidden>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface BoardFilterBarProps {
  users: AssignableUser[];
  /** 'all' | 'none' | 'baixo' | 'medio' | 'alto'. */
  interestFilter: string;
  sourceFilter: SourceFilter;
  /** 'all' | 'none' | uuid do responsável. */
  assignedFilter: string;
}

/**
 * Bloco de filtros de /oportunidades: Interesse, Fonte e Responsável em
 * dropdowns compactos numa linha só, com busca inline e "Limpar filtros". Os
 * filtros ativos aparecem como chips removíveis numa faixa abaixo — o card
 * fica enxuto sem filtro algum. Filtragem por query string
 * (?interesse/?fonte/?responsavel).
 */
export function BoardFilterBar({
  users,
  interestFilter,
  sourceFilter,
  assignedFilter,
}: BoardFilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Busca compartilhada com o board (mesma do campo secundário do sub-header).
  const shared = useBoardSearchTerm();
  const local = useState('');
  const [term, setTerm] = shared ?? local;

  function push(params: URLSearchParams) {
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/oportunidades?${qs}` : '/oportunidades');
    });
  }

  function setParam(key: 'interesse' | 'fonte' | 'responsavel', value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'all') params.delete(key);
    else params.set(key, value);
    push(params);
  }

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('interesse');
    params.delete('fonte');
    params.delete('responsavel');
    setTerm('');
    push(params);
  }

  const interestOptions: FilterOption[] = [
    { value: 'all', label: 'Todos os níveis' },
    ...INTEREST_LEVELS.map((level) => ({
      value: level,
      label: INTEREST_LEVEL_LABELS[level],
    })),
    { value: 'none', label: 'Sem interesse registrado', dividerBefore: true },
  ];
  const sourceOptions: FilterOption[] = [
    { value: 'all', label: 'Todas as fontes' },
    { value: 'pagas', label: 'Pagas' },
    { value: 'organicas', label: 'Orgânicas' },
    ...LEAD_SOURCES.map((s, i) => ({
      value: s,
      label: LEAD_SOURCE_LABELS[s],
      dividerBefore: i === 0,
    })),
  ];
  const assigneeOptions: FilterOption[] = [
    { value: 'all', label: 'Todos' },
    { value: 'none', label: 'Sem responsável' },
    ...users.map((u) => ({ value: u.id, label: u.name })),
  ];

  // Chips dos filtros ativos (faixa removível abaixo da linha de dropdowns).
  const activeChips: { key: 'interesse' | 'fonte' | 'responsavel'; label: string }[] = [];
  if (interestFilter !== 'all') {
    activeChips.push({
      key: 'interesse',
      label:
        interestFilter === 'none'
          ? 'Sem interesse registrado'
          : `Interesse ${(INTEREST_LEVEL_LABELS[interestFilter as InterestLevel] ?? interestFilter).toLowerCase()}`,
    });
  }
  if (sourceFilter !== 'all') {
    activeChips.push({
      key: 'fonte',
      label:
        sourceFilter === 'pagas'
          ? 'Pagas'
          : sourceFilter === 'organicas'
            ? 'Orgânicas'
            : LEAD_SOURCE_LABELS[sourceFilter],
    });
  }
  if (assignedFilter !== 'all') {
    activeChips.push({
      key: 'responsavel',
      label:
        assignedFilter === 'none'
          ? 'Sem responsável'
          : (users.find((u) => u.id === assignedFilter)?.name ?? 'Responsável'),
    });
  }

  return (
    <div className="rounded-lg border border-brand-100 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterDropdown
          label="Interesse"
          options={interestOptions}
          active={interestFilter}
          onSelect={(v) => setParam('interesse', v)}
          disabled={isPending}
        />
        <FilterDropdown
          label="Fonte"
          options={sourceOptions}
          active={sourceFilter}
          onSelect={(v) => setParam('fonte', v)}
          disabled={isPending}
        />
        <FilterDropdown
          label="Responsável"
          options={assigneeOptions}
          active={assignedFilter}
          onSelect={(v) => setParam('responsavel', v)}
          disabled={isPending}
        />
        <div className="relative min-w-[12rem] flex-1">
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand-300"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3.5 3.5" />
          </svg>
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar lead nesta visão..."
            className="w-full rounded-full border border-brand-200 bg-white py-1.5 pl-9 pr-3 text-xs text-brand-700 placeholder:text-brand-300 focus:border-brand-400 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={clearAll}
          disabled={isPending}
          className="focus-ring shrink-0 text-xs font-medium text-red-600 underline-offset-2 hover:underline"
        >
          Limpar filtros
        </button>
      </div>

      {activeChips.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-brand-100 pt-2.5">
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setParam(chip.key, 'all')}
              disabled={isPending}
              title="Remover filtro"
              className="focus-ring flex items-center gap-1.5 rounded-full bg-brand-100 px-2.5 py-1 text-[11px] font-medium text-brand-600 transition-colors hover:bg-brand-200"
            >
              {chip.label}
              <span aria-hidden className="text-brand-400">
                ✕
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

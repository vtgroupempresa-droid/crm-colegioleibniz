'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DropAnimation,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { confirmAppointment } from '@/actions/appointments';
import { moveLeadStage, moveLeadsStage, moveLeadsToPipeline } from '@/actions/leads';
import { openConversationForLead } from '@/actions/conversations';
import { loadKanbanColumn } from '@/actions/kanban';
import { LeadDrawer } from '@/components/leads/lead-drawer';
import { LeadCreateModal } from '@/components/leads/lead-create-modal';
import { cn } from '@/lib/utils/cn';
import { validateRequiredFields } from '@/lib/leads/validators';
import { slaStatusFor } from '@/lib/sla/rules';
import { CallResultModal } from './call-result-modal';
import { CloserSummaryBar } from './closer-summary-bar';
import { ContactAttemptModal } from './contact-attempt-modal';
import { RegisterContactModal } from './register-contact-modal';
import { DealModal } from './deal-modal';
import { AppointmentEditModal } from './appointment-edit-modal';
import { ActionQueue } from './action-queue';
import { BoardToolbar, type BoardSearchState } from './board-toolbar';
import { MoveLeadsModal } from './move-leads-modal';
import { MoveLeadStageModal } from './move-lead-stage-modal';
import { KanbanCard } from './kanban-card';
import { KanbanCardCompact, SLA_DOT_CLASSES, SLA_DOT_LABELS } from './kanban-card-compact';
import { KanbanCardOverlay } from './kanban-card-overlay';
import { KanbanColumn } from './kanban-column';
import { useBoardDensity } from './use-board-density';
import { LostReasonModal } from './lost-reason-modal';
import { PipelineEmptyState } from './pipeline-empty-state';
import { RequiredFieldsModal } from './required-fields-modal';
import { ScheduleHandoffModal } from './schedule-handoff-modal';
import { SlaStatusBar } from './sla-status-bar';
import { SoftBlockModal } from './soft-block-modal';
import type {
  AssignedFilter,
  BoardSort,
  InterestFilter,
  KanbanLeadRow,
  PipelineStageOption,
  QualificationFilter,
} from '@/actions/leads-queries';
import type { Lead, SourceFilter } from '@/types/lead';
import type { PipelineKind } from '@/types/pipeline';

export interface KanbanStage {
  slug: string;
  name: string;
  position: number;
  color: string;
  is_terminal: boolean;
  required_fields: string[];
}

/**
 * Card do board. É exatamente o que `getKanbanColumnPage` devolve — manter como
 * alias evita que a UI e a query divirjam silenciosamente quando um campo é
 * adicionado ou renomeado no servidor.
 */
export type KanbanLeadEntry = KanbanLeadRow;

interface KanbanBoardProps {
  pipeline: PipelineKind;
  /** Título do pipeline para o sub-header em linha única da toolbar. */
  boardTitle: string;
  /** Total real de leads ativos (soma das colunas, com filtros aplicados). */
  totalCount: number;
  stages: readonly KanbanStage[];
  /** Total real de leads por coluna (slug do stage → contagem). */
  counts: Record<string, number>;
  /** Primeira página de cada coluna, concatenada (já ordenada no servidor). */
  initialEntries: readonly KanbanLeadEntry[];
  sort: BoardSort;
  isDemo: boolean;
  interestFilter: InterestFilter;
  sourceFilter: SourceFilter;
  assignedFilter: AssignedFilter;
  qualificationFilter: QualificationFilter;
  /** Stages ativos de todos os pipelines, para o modal "Mover". */
  stagesByPipeline: Record<string, PipelineStageOption[]>;
}

const HARD_BLOCK_FIELDS: ReadonlySet<string> = new Set(['lost_reason']);

/**
 * Sentinela em required_fields que torna o agendamento OBRIGATÓRIO: mover para o
 * stage abre o ScheduleHandoffModal e o lead só avança após salvar o appointment.
 * Tratado ANTES da validação de ICP — não é um campo do lead.
 */
const APPOINTMENT_REQUIRED = 'appointment_required';

/** Dica por coluna (tooltip no header do funil comercial). */
const STAGE_HEADER_HINTS: Record<string, string> = {
  novo_lead: 'Lead recém-chegado — responder rápido (SLA da 1ª tentativa: 5 min).',
  primeiro_contato: 'Já houve contato — qualificar interesse e convidar para a visita.',
  visita_presencial: 'Visita agendada ou realizada — registrar o resultado no card.',
  em_negociacao: 'Proposta apresentada — acompanhar até a decisão da família.',
  follow_up: 'Sem resposta ou decisão adiada — retomar no momento combinado.',
};

/**
 * Quantos cards uma coluna RENDERIZA por vez (o servidor pagina em lotes
 * maiores — KANBAN_PAGE_SIZE). O "Mostrar mais" revela +50 e, quando os já
 * carregados acabam, busca a próxima página.
 */
const COLUMN_RENDER_PAGE = 50;

/** Mantém o card original invisível até o drop animation terminar. */
const DROP_ANIMATION: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: { opacity: '0' },
    },
  }),
};

/**
 * Board principal do Kanban. Controla:
 *  - DnD com validação de required_fields no destino (soft block para campos
 *    do cadastro, hard block para campos terminais como lost_reason).
 *  - Barra de SLA + ação rápida "registrar tentativa" + abertura automática do
 *    agendamento de visita quando a tentativa tem desfecho "Agendou".
 *  - Confirmação D-1/D-0 da visita inline no card.
 */
export function KanbanBoard({
  pipeline,
  boardTitle,
  totalCount,
  stages,
  counts,
  initialEntries,
  sort,
  isDemo,
  interestFilter,
  sourceFilter,
  assignedFilter,
  qualificationFilter,
  stagesByPipeline,
}: KanbanBoardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);
  // Densidade dos cards (Compacto | Confortável) — persiste no localStorage.
  const [density, setDensity] = useBoardDensity();
  // Busca em tempo real reportada pela toolbar (filtra os cards do board).
  const [search, setSearch] = useState<BoardSearchState>({
    term: '',
    results: null,
    searching: false,
  });
  // Modal "Novo lead" direto no board.
  const [createOpen, setCreateOpen] = useState(false);

  // Leads carregados (1ª página de cada coluna + o que o "carregar mais" trouxe).
  // Ressincroniza quando o servidor re-renderiza (após mover card/router.refresh
  // ou troca de filtro/ordenação) — aí a paginação volta às primeiras páginas.
  const [entries, setEntries] = useState<KanbanLeadEntry[]>(() => [...initialEntries]);
  // Coluna que está buscando a próxima página (desabilita o botão "mostrar mais").
  const [loadingStage, setLoadingStage] = useState<string | null>(null);
  // Quantos cards cada coluna RENDERIZA (paginação incremental client-side).
  const [renderLimits, setRenderLimits] = useState<Record<string, number>>({});

  useEffect(() => {
    setEntries([...initialEntries]);
  }, [initialEntries]);

  function handleLoadMore(stage: string) {
    const loaded = entries.filter((e) => e.lead.stage === stage).length;
    setLoadingStage(stage);
    startTransition(async () => {
      const rows = await loadKanbanColumn({
        pipeline,
        stage,
        sort,
        offset: loaded,
        interestFilter,
        sourceFilter,
        assignedFilter,
        qualificationFilter,
        isDemo,
      });
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.lead.id));
        const fresh = rows.filter((r) => !seen.has(r.lead.id));
        return [...prev, ...fresh];
      });
      setLoadingStage(null);
    });
  }

  /**
   * "Mostrar mais N leads": revela mais COLUMN_RENDER_PAGE cards da coluna e,
   * se os já carregados do servidor não bastarem, dispara a próxima página.
   */
  function handleShowMore(stage: string, visibleNow: number, loadedCount: number, total: number) {
    const next = visibleNow + COLUMN_RENDER_PAGE;
    setRenderLimits((prev) => ({ ...prev, [stage]: next }));
    if (!searchActive && next > loadedCount && loadedCount < total) {
      handleLoadMore(stage);
    }
  }

  // Modal de campos obrigatórios estruturais (lost_reason, churn_reason, NPS).
  const [requiredModal, setRequiredModal] = useState<{
    lead: Lead;
    targetStage: KanbanStage;
    missing: readonly string[];
  } | null>(null);

  // Soft block: campos de ICP pendentes — usuário pode forçar.
  const [softBlock, setSoftBlock] = useState<{
    lead: Lead;
    targetStage: KanbanStage;
    missing: readonly string[];
  } | null>(null);

  // Mini-modal de tentativa rápida (apenas pipeline SDR).
  const [attemptModal, setAttemptModal] = useState<KanbanLeadEntry | null>(null);
  // Mini-modal "Registrar contato" (captação + SDR).
  const [contactModal, setContactModal] = useState<{ id: string; name: string } | null>(null);

  // Handoff modal (criado após outcome=scheduled).
  const [handoffLead, setHandoffLead] = useState<{ id: string; name: string } | null>(null);

  // Modais do closer.
  const [callModal, setCallModal] = useState<{
    leadId: string;
    leadName: string;
    appointmentId: string;
  } | null>(null);
  const [dealModal, setDealModal] = useState<{ id: string; name: string } | null>(null);
  const [lostModal, setLostModal] = useState<{ id: string; name: string } | null>(null);
  const [editApptId, setEditApptId] = useState<string | null>(null);

  // Filtro SLA (apenas pipeline SDR).
  const [slaFilter, setSlaFilter] = useState<'breached' | 'warning' | null>(null);

  // ID do lead em arrasto — driver do DragOverlay.
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const activeEntry = useMemo(() => {
    if (!activeLeadId) return null;
    const source = search.term.length >= 2 ? (search.results ?? []) : entries;
    return source.find((entry) => entry.lead.id === activeLeadId) ?? null;
  }, [activeLeadId, entries, search.results, search.term]);

  // Seleção múltipla: arrastar qualquer card selecionado move todos juntos.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Modal "Mover" (selecionados → pipeline/coluna escolhidos, inclusive cross-pipeline).
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  // Movimento individual por painel: essencial no celular e útil como alternativa
  // explícita ao drag em qualquer tela.
  const [moveLead, setMoveLead] = useState<KanbanLeadEntry | null>(null);
  const [movingLeadIds, setMovingLeadIds] = useState<Set<string>>(new Set());
  const isGroupDragging =
    activeLeadId !== null && selectedIds.has(activeLeadId) && selectedIds.size > 1;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function performBulkMove(ids: string[], newStage: string) {
    startTransition(async () => {
      const result = await moveLeadsStage(ids, newStage, true);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { moved, skipped } = result.data;
      if (moved > 0) toast.success(`${moved} ${moved === 1 ? 'lead movido' : 'leads movidos'}`);
      if (skipped.length > 0) {
        const names = skipped
          .slice(0, 3)
          .map((s) => s.name)
          .join(', ');
        toast.warning(
          `${skipped.length} não ${skipped.length === 1 ? 'movido' : 'movidos'} (precisam de ajuste individual): ${names}${skipped.length > 3 ? '…' : ''}`,
        );
      }
      setSelectedIds(new Set());
      router.refresh();
    });
  }

  function performMoveToPipeline(targetPipeline: PipelineKind, targetStage: string) {
    const ids = [...selectedIds];
    startTransition(async () => {
      const result = await moveLeadsToPipeline(ids, targetPipeline, targetStage, true);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { moved, skipped } = result.data;
      if (moved > 0) toast.success(`${moved} ${moved === 1 ? 'lead movido' : 'leads movidos'}`);
      if (skipped.length > 0) {
        const names = skipped
          .slice(0, 3)
          .map((s) => s.name)
          .join(', ');
        toast.warning(
          `${skipped.length} não ${skipped.length === 1 ? 'movido' : 'movidos'} (precisam de ajuste individual): ${names}${skipped.length > 3 ? '…' : ''}`,
        );
      }
      setSelectedIds(new Set());
      setMoveModalOpen(false);
      router.refresh();
    });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Navegação horizontal do board (desktop):
  //  - roda do mouse (vertical) → rola lateralmente;
  //  - "pegar e arrastar" o fundo do board → pan horizontal.
  // O arrasto de CARDS continua pela alça ⋮⋮ (única com listeners do dnd-kit);
  // por isso só iniciamos o pan quando o ponteiro NÃO está sobre um controle
  // interativo (botão/link/input), evitando conflito com cliques e drag de card.
  const scrollRef = useRef<HTMLDivElement>(null);
  const pan = useRef({ active: false, pointerId: -1, startX: 0, startScroll: 0 });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!el) return;
      if (el.scrollWidth <= el.clientWidth) return; // sem overflow horizontal (mobile)
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // já é gesto horizontal

      // Deslize VERTICAL sobre uma coluna: se a lista da coluna sob o cursor
      // ainda pode rolar na direção do gesto, deixa ela rolar os leads (não
      // converte para movimento lateral do board).
      const colScroll = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        '[data-kanban-column-scroll]',
      );
      if (colScroll && colScroll.scrollHeight > colScroll.clientHeight + 1) {
        const atTop = colScroll.scrollTop <= 0;
        const atBottom = colScroll.scrollTop + colScroll.clientHeight >= colScroll.scrollHeight - 1;
        if ((e.deltaY > 0 && !atBottom) || (e.deltaY < 0 && !atTop)) {
          return; // a coluna absorve o scroll vertical
        }
      }

      // Se a PÁGINA ainda pode rolar na direção do gesto, deixa rolar (revela o
      // board / traz os filtros de volta). Só converte o deslize vertical em
      // navegação horizontal quando a página já está no fim e o board preenche
      // a tela — assim dá pra "arrastar a tela pra baixo" até o pipeline encher.
      const page = el.closest<HTMLElement>('main');
      if (page && page.scrollHeight > page.clientHeight + 1) {
        const atTop = page.scrollTop <= 0;
        const atBottom = page.scrollTop + page.clientHeight >= page.scrollHeight - 1;
        if ((e.deltaY > 0 && !atBottom) || (e.deltaY < 0 && !atTop)) {
          return; // deixa a página rolar
        }
      }

      el.scrollLeft += e.deltaY;
      e.preventDefault();
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function handlePanStart(e: React.PointerEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, [role="button"]')) return;
    pan.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startScroll: el.scrollLeft,
    };
    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';
    el.style.userSelect = 'none';
  }

  function handlePanMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    if (!el || !pan.current.active) return;
    el.scrollLeft = pan.current.startScroll - (e.clientX - pan.current.startX);
  }

  function handlePanEnd() {
    const el = scrollRef.current;
    if (!el || !pan.current.active) return;
    if (el.hasPointerCapture(pan.current.pointerId)) {
      el.releasePointerCapture(pan.current.pointerId);
    }
    pan.current.active = false;
    el.style.cursor = '';
    el.style.userSelect = '';
  }

  // Funil único: cadência de contato, visita e fechamento convivem no mesmo
  // board — os recursos que antes eram exclusivos de SDR ou Closer valem todos
  // aqui. O pipeline pos_matricula (rematrícula) não usa nenhum deles.
  const isComercial = pipeline === 'comercial';

  // Busca ativa (≥2 chars): os cards do board passam a ser os resultados da
  // busca server-side (já combinados com os filtros de produto/fonte), não as
  // páginas carregadas das colunas — assim os filtros e a busca se somam.
  const searchActive = search.term.length >= 2;
  const baseEntries = useMemo<KanbanLeadEntry[]>(
    () => (searchActive ? (search.results ?? []) : entries),
    [searchActive, search.results, entries],
  );

  const visibleEntries = useMemo(() => {
    if (!isComercial || !slaFilter) return baseEntries;
    return baseEntries.filter((e) => slaStatusFor(e.nextSlaAt).status === slaFilter);
  }, [baseEntries, isComercial, slaFilter]);

  const byStage = useMemo(() => {
    const map = new Map<string, KanbanLeadEntry[]>();
    for (const stage of stages) map.set(stage.slug, []);
    // Preserva a ordem em que vieram do servidor: cada coluna já chega ordenada
    // por Data ou Score (Novo Lead sempre por Data), e cada "carregar mais" é
    // anexado no fim mantendo a sequência. Por isso não reordenamos aqui.
    for (const entry of visibleEntries) {
      const list = map.get(entry.lead.stage);
      if (list) list.push(entry);
    }
    return map;
  }, [stages, visibleEntries]);

  // SLA vencido por coluna (destaque vermelho no header). Mesma fonte dos dots:
  // as entries carregadas — nenhuma query adicional.
  const breachedByStage = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of baseEntries) {
      if (slaStatusFor(entry.nextSlaAt).status !== 'breached') continue;
      map.set(entry.lead.stage, (map.get(entry.lead.stage) ?? 0) + 1);
    }
    return map;
  }, [baseEntries]);

  function nextStageOf(currentSlug: string): KanbanStage | null {
    const sorted = [...stages].sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex((s) => s.slug === currentSlug);
    if (idx < 0 || idx === sorted.length - 1) return null;
    const next = sorted[idx + 1];
    return next ?? null;
  }

  function missingForNext(lead: Lead): string[] {
    const next = nextStageOf(lead.stage);
    if (!next) return [];
    // O sentinela de agendamento não é um campo "para preencher" no drawer —
    // não entra no badge de pendências de ICP do card.
    return [...validateRequiredFields(lead, next.required_fields).missing].filter(
      (f) => f !== APPOINTMENT_REQUIRED,
    );
  }

  function performMove(leadId: string, newStage: string, force = false) {
    if (movingLeadIds.has(leadId)) return;

    const previousEntry =
      entries.find((entry) => entry.lead.id === leadId) ??
      search.results?.find((entry) => entry.lead.id === leadId) ??
      null;
    if (!previousEntry) {
      toast.error('Não foi possível localizar esta família no funil. Atualize a tela e tente novamente.');
      return;
    }

    const previousStage = previousEntry.lead.stage;
    const targetStageName = stages.find((stage) => stage.slug === newStage)?.name ?? newStage;
    const patchStage = (entry: KanbanLeadEntry) =>
      entry.lead.id === leadId ? { ...entry, lead: { ...entry.lead, stage: newStage } } : entry;

    // O card troca de coluna imediatamente. Se o servidor recusar, o rollback
    // restaura a etapa anterior e mantém a operação confiável.
    setEntries((current) => current.map(patchStage));
    setSearch((current) =>
      current.results ? { ...current, results: current.results.map(patchStage) } : current,
    );
    setMovingLeadIds((current) => new Set(current).add(leadId));

    startTransition(async () => {
      const result = await moveLeadStage(leadId, newStage, force);
      if (!result.ok) {
        const rollback = (entry: KanbanLeadEntry) =>
          entry.lead.id === leadId
            ? { ...entry, lead: { ...entry.lead, stage: previousStage } }
            : entry;
        setEntries((current) => current.map(rollback));
        setSearch((current) =>
          current.results ? { ...current, results: current.results.map(rollback) } : current,
        );
        toast.error(result.error);
      } else {
        toast.success(`Movido para ${targetStageName}`);
        router.refresh();
      }
      setMovingLeadIds((current) => {
        const next = new Set(current);
        next.delete(leadId);
        return next;
      });
    });
  }

  /** Mesmas regras para o arraste e o painel de mudança de etapa. */
  function requestSingleMove(lead: Lead, targetStageSlug: string) {
    if (targetStageSlug === lead.stage) return;
    const targetStage = stages.find((stage) => stage.slug === targetStageSlug);
    if (!targetStage) return;

    if (targetStage.required_fields.includes(APPOINTMENT_REQUIRED)) {
      setHandoffLead({ id: lead.id, name: lead.name });
      return;
    }

    const { ok, missing } = validateRequiredFields(lead, targetStage.required_fields);
    if (!ok) {
      if (missing.includes('lost_reason')) {
        setLostModal({ id: lead.id, name: lead.name });
        return;
      }
      const hardMissing = missing.filter((field) => HARD_BLOCK_FIELDS.has(field));
      if (hardMissing.length > 0) {
        setRequiredModal({ lead, targetStage, missing: hardMissing });
      } else {
        setSoftBlock({ lead, targetStage, missing });
      }
      return;
    }

    performMove(lead.id, targetStageSlug);
  }

  function handleOpenChat(leadId: string) {
    startTransition(async () => {
      const result = await openConversationForLead(leadId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.push(`/chat?c=${result.data.conversationId}`);
    });
  }

  function handleConfirmAppointment(appointmentId: string) {
    startTransition(async () => {
      const result = await confirmAppointment(appointmentId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Agendamento confirmado');
      router.refresh();
    });
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveLeadId(String(event.active.id));
  }

  function handleDragCancel() {
    setActiveLeadId(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveLeadId(null);
    const { active, over } = event;
    if (!over) return;

    const leadId = String(active.id);

    let targetStageSlug: string | null = null;
    const overData = over.data.current;
    if (overData?.type === 'stage') {
      targetStageSlug = String(over.id);
    } else if (overData?.type === 'lead') {
      // Em busca, os cards podem não estar na página inicial de `entries`.
      // `baseEntries` é a fonte exibida, logo também é a fonte do drop.
      const overLead = baseEntries.find((e) => e.lead.id === String(over.id))?.lead;
      targetStageSlug = overLead?.stage ?? null;
    }
    if (!targetStageSlug) return;

    const targetStage = stages.find((s) => s.slug === targetStageSlug);
    if (!targetStage) return;

    // Stage que exige agendamento: não dá para abrir um modal por lead em lote.
    if (targetStage.required_fields.includes(APPOINTMENT_REQUIRED)) {
      if (selectedIds.has(leadId) && selectedIds.size > 1) {
        toast.warning('Agende cada lead individualmente para enviar ao Closer');
        return;
      }
    }

    // Arrasto EM GRUPO: move todos os selecionados para a coluna destino. A
    // action de lote força pendências de ICP e pula (reportando) os que exigem
    // campo estrutural — sem abrir modal por lead.
    if (selectedIds.has(leadId) && selectedIds.size > 1) {
      performBulkMove([...selectedIds], targetStageSlug);
      return;
    }

    const lead = baseEntries.find((e) => e.lead.id === leadId)?.lead;
    if (!lead) return;
    requestSingleMove(lead, targetStageSlug);
  }

  return (
    <>
      <ActionQueue onOpenLead={setDrawerLeadId} />
      <BoardToolbar
        pipeline={pipeline}
        title={boardTitle}
        totalCount={totalCount}
        sort={sort}
        interestFilter={interestFilter}
        sourceFilter={sourceFilter}
        assignedFilter={assignedFilter}
        qualificationFilter={qualificationFilter}
        isDemo={isDemo}
        density={density}
        onDensityChange={setDensity}
        onSearch={setSearch}
        onNewLead={() => setCreateOpen(true)}
      />

      {density === 'compact' && isComercial && (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-brand-400">
          {(['breached', 'warning', 'ok', 'none'] as const).map((status) => (
            <span key={status} className="flex items-center gap-1">
              <span
                className={cn('h-2 w-2 rounded-full', SLA_DOT_CLASSES[status])}
                aria-hidden
              />
              {SLA_DOT_LABELS[status]}
            </span>
          ))}
        </div>
      )}

      {searchActive && (
        <div className="mb-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs text-brand-600">
          {search.searching
            ? 'Buscando…'
            : `${search.results?.length ?? 0} ${
                (search.results?.length ?? 0) === 1 ? 'resultado' : 'resultados'
              } para “${search.term}” — filtrando os cards do board`}
        </div>
      )}

      {isComercial && (
        <SlaStatusBar entries={entries} activeFilter={slaFilter} onFilterChange={setSlaFilter} />
      )}

      {isComercial && <CloserSummaryBar entries={entries} />}

      {selectedIds.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-3 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
          <span className="font-medium text-brand-700">
            {selectedIds.size} {selectedIds.size === 1 ? 'lead selecionado' : 'leads selecionados'}
          </span>
          <span className="text-xs text-brand-400">
            Arraste pela alça ⋮⋮ para mover na coluna, ou use “Mover” para outro pipeline
          </span>
          <button
            type="button"
            onClick={() => setMoveModalOpen(true)}
            className="ml-auto rounded-md bg-brand-700 px-3 py-1 text-xs font-medium text-canvas hover:bg-brand-800"
          >
            Mover…
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-xs font-medium text-brand-600 underline-offset-2 hover:underline"
          >
            Limpar seleção
          </button>
        </div>
      )}

      {!searchActive && entries.length === 0 ? (
        <div className="flex-1 rounded-lg border border-dashed border-brand-200 bg-white/40">
          <PipelineEmptyState pipeline={pipeline} />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div
            ref={scrollRef}
            onPointerDown={handlePanStart}
            onPointerMove={handlePanMove}
            onPointerUp={handlePanEnd}
            onPointerCancel={handlePanEnd}
            className="kanban-scroll flex h-full flex-col gap-3 overflow-y-auto pb-2 sm:flex-row sm:overflow-x-auto sm:overflow-y-hidden sm:[cursor:grab]"
          >
            {stages.map((stage) => {
              const list = byStage.get(stage.slug) ?? [];
              // Durante a busca, o cabeçalho mostra os resultados da coluna; sem
              // busca, o total real da coluna (mesmo com só a 1ª página na tela).
              const total = searchActive ? list.length : (counts[stage.slug] ?? list.length);
              const loadedCount = entries.filter((e) => e.lead.stage === stage.slug).length;
              // Paginação incremental: a coluna renderiza só os primeiros N da
              // lista (já ordenada); "Mostrar mais" revela o próximo lote.
              const renderLimit = renderLimits[stage.slug] ?? COLUMN_RENDER_PAGE;
              const shown = list.slice(0, renderLimit);
              // "Restantes" a revelar: com busca ou filtro de SLA ativos, só o
              // que já está na lista filtrada; sem eles, o total real da coluna.
              const filteredView = searchActive || (isComercial && slaFilter !== null);
              const remaining = (filteredView ? list.length : total) - shown.length;
              return (
                <KanbanColumn
                  key={stage.slug}
                  id={stage.slug}
                  title={stage.name}
                  count={total}
                  breachedCount={breachedByStage.get(stage.slug) ?? 0}
                  accentColor={stage.color}
                  itemIds={shown.map((e) => e.lead.id)}
                  headerHint={isComercial ? STAGE_HEADER_HINTS[stage.slug] : undefined}
                  banner={
                    isComercial && stage.slug === 'visita_presencial' ? (
                      <p className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] font-medium text-emerald-800">
                        ✅ Leads aqui têm reunião confirmada com um Closer
                      </p>
                    ) : undefined
                  }
                >
                  {list.length === 0 && <p className="px-1 py-2 text-xs text-brand-300">Vazio</p>}
                  {shown.map((entry) =>
                    density === 'compact' ? (
                      <KanbanCardCompact
                        key={entry.lead.id}
                        lead={entry.lead}
                        pipeline={pipeline}
                        stageEnteredAt={entry.stageEnteredAt}
                        reentered={entry.reentered}
                        nextSlaAt={entry.nextSlaAt}
                        attemptsCount={entry.attemptsCount}
                        nextAppointmentAt={entry.nextAppointmentAt}
                        appointmentConfirmed={entry.appointmentConfirmed}
                        assigneeName={entry.assigneeName}
                        assigneeRole={entry.assigneeRole}
                        missingFieldsToAdvance={missingForNext(entry.lead)}
                        selected={selectedIds.has(entry.lead.id)}
                        onToggleSelect={toggleSelect}
                        groupDragging={isGroupDragging}
                        onOpen={(id) => setDrawerLeadId(id)}
                        onMove={() => setMoveLead(entry)}
                        onOpenChat={handleOpenChat}
                        onQuickAttempt={isComercial ? () => setAttemptModal(entry) : undefined}
                        onRegisterContact={
                          isComercial
                            ? () => setContactModal({ id: entry.lead.id, name: entry.lead.name })
                            : undefined
                        }
                        nextAppointmentId={entry.nextAppointmentId}
                        onRegisterCall={
                          isComercial
                            ? (leadId, aptId) =>
                                setCallModal({
                                  leadId,
                                  leadName: entry.lead.name,
                                  appointmentId: aptId,
                                })
                            : undefined
                        }
                        onCloseDeal={
                          isComercial
                            ? () => setDealModal({ id: entry.lead.id, name: entry.lead.name })
                            : undefined
                        }
                        onMarkLost={
                          isComercial
                            ? () => setLostModal({ id: entry.lead.id, name: entry.lead.name })
                            : undefined
                        }
                      />
                    ) : (
                      <KanbanCard
                        key={entry.lead.id}
                        lead={entry.lead}
                        pipeline={pipeline}
                        stageEnteredAt={entry.stageEnteredAt}
                        reentered={entry.reentered}
                        nextSlaAt={entry.nextSlaAt}
                        attemptsCount={entry.attemptsCount}
                        nextAppointmentAt={entry.nextAppointmentAt}
                        nextAppointmentId={entry.nextAppointmentId}
                        appointmentConfirmed={entry.appointmentConfirmed}
                        appointmentCreatorName={entry.appointmentCreatorName}
                        appointmentAssigneeName={entry.appointmentAssigneeName}
                        assigneeName={entry.assigneeName}
                        assigneeRole={entry.assigneeRole}
                        onEditAppointment={isComercial ? (aptId) => setEditApptId(aptId) : undefined}
                        missingFieldsToAdvance={missingForNext(entry.lead)}
                        selected={selectedIds.has(entry.lead.id)}
                        onToggleSelect={toggleSelect}
                        groupDragging={isGroupDragging}
                        onOpen={(id) => setDrawerLeadId(id)}
                        onMove={() => setMoveLead(entry)}
                        onOpenChat={handleOpenChat}
                        onQuickAttempt={isComercial ? () => setAttemptModal(entry) : undefined}
                        onRegisterContact={
                          isComercial
                            ? () => setContactModal({ id: entry.lead.id, name: entry.lead.name })
                            : undefined
                        }
                        onConfirmAppointment={handleConfirmAppointment}
                        onRegisterCall={
                          isComercial
                            ? (leadId, aptId) =>
                                setCallModal({
                                  leadId,
                                  leadName: entry.lead.name,
                                  appointmentId: aptId,
                                })
                            : undefined
                        }
                        onCloseDeal={
                          isComercial
                            ? () => setDealModal({ id: entry.lead.id, name: entry.lead.name })
                            : undefined
                        }
                        onMarkLost={
                          isComercial
                            ? () => setLostModal({ id: entry.lead.id, name: entry.lead.name })
                            : undefined
                        }
                      />
                    ),
                  )}
                  {remaining > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        handleShowMore(stage.slug, shown.length, loadedCount, total)
                      }
                      disabled={loadingStage === stage.slug}
                      className="mt-1 w-full rounded-md border border-brand-200 bg-white px-2 py-1.5 text-center text-xs font-medium text-brand-600 hover:bg-brand-50 disabled:opacity-60"
                    >
                      {loadingStage === stage.slug
                        ? 'Carregando…'
                        : `Mostrar mais ${Math.min(COLUMN_RENDER_PAGE, remaining)} leads ↓`}
                    </button>
                  )}
                </KanbanColumn>
              );
            })}
          </div>

          <DragOverlay dropAnimation={DROP_ANIMATION}>
            {activeEntry ? (
              isGroupDragging ? (
                <div className="rounded-md border border-brand-300 bg-white px-3 py-2 shadow-lg">
                  <p className="text-sm font-semibold text-brand-700">
                    {selectedIds.size} leads selecionados
                  </p>
                  <p className="text-xs text-brand-400">Solte numa coluna para mover todos</p>
                </div>
              ) : (
                <KanbanCardOverlay
                  lead={activeEntry.lead}
                  pipeline={pipeline}
                  nextSlaAt={activeEntry.nextSlaAt}
                  density={density}
                  stageEnteredAt={activeEntry.stageEnteredAt}
                  assigneeName={activeEntry.assigneeName}
                  assigneeRole={activeEntry.assigneeRole}
                />
              )
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <RequiredFieldsModal
        open={requiredModal !== null}
        onClose={() => setRequiredModal(null)}
        lead={requiredModal?.lead ?? null}
        missing={requiredModal?.missing ?? []}
        targetStageName={requiredModal?.targetStage.name ?? ''}
        onCompleted={() => {
          if (requiredModal) {
            performMove(requiredModal.lead.id, requiredModal.targetStage.slug);
          }
          setRequiredModal(null);
        }}
      />

      <SoftBlockModal
        open={softBlock !== null}
        onClose={() => setSoftBlock(null)}
        targetStageName={softBlock?.targetStage.name ?? ''}
        missing={softBlock?.missing ?? []}
        isPending={isPending}
        onFillNow={() => {
          if (softBlock) setDrawerLeadId(softBlock.lead.id);
          setSoftBlock(null);
        }}
        onAdvanceAnyway={() => {
          if (softBlock) {
            performMove(softBlock.lead.id, softBlock.targetStage.slug, true);
          }
          setSoftBlock(null);
        }}
      />

      {attemptModal && (
        <ContactAttemptModal
          open={attemptModal !== null}
          onClose={() => setAttemptModal(null)}
          leadId={attemptModal.lead.id}
          leadName={attemptModal.lead.name}
          currentAttemptCount={attemptModal.attemptsCount}
          onScheduledOutcome={() => {
            setHandoffLead({ id: attemptModal.lead.id, name: attemptModal.lead.name });
          }}
        />
      )}

      {contactModal && (
        <RegisterContactModal
          open={contactModal !== null}
          onClose={() => setContactModal(null)}
          leadId={contactModal.id}
          leadName={contactModal.name}
          onSchedule={() => setHandoffLead({ id: contactModal.id, name: contactModal.name })}
        />
      )}

      <ScheduleHandoffModal
        open={handoffLead !== null}
        onClose={() => setHandoffLead(null)}
        onCancel={() => toast.message('Cadastre o agendamento para mover o lead para o Closer')}
        leadId={handoffLead?.id ?? ''}
        leadName={handoffLead?.name ?? ''}
      />

      {callModal && (
        <CallResultModal
          open={callModal !== null}
          onClose={() => setCallModal(null)}
          leadName={callModal.leadName}
          appointmentId={callModal.appointmentId}
          onCloseNow={() => {
            setDealModal({ id: callModal.leadId, name: callModal.leadName });
          }}
        />
      )}

      <DealModal
        open={dealModal !== null}
        onClose={() => setDealModal(null)}
        leadId={dealModal?.id ?? ''}
        leadName={dealModal?.name ?? ''}
      />

      <LostReasonModal
        open={lostModal !== null}
        onClose={() => setLostModal(null)}
        leadId={lostModal?.id ?? ''}
        leadName={lostModal?.name ?? ''}
      />

      <AppointmentEditModal
        open={editApptId !== null}
        onClose={() => setEditApptId(null)}
        appointmentId={editApptId}
      />

      {moveModalOpen && (
        <MoveLeadsModal
          open
          onClose={() => setMoveModalOpen(false)}
          count={selectedIds.size}
          defaultPipeline={pipeline}
          stagesByPipeline={stagesByPipeline}
          isPending={isPending}
          onConfirm={performMoveToPipeline}
        />
      )}

      <MoveLeadStageModal
        open={moveLead !== null}
        onClose={() => setMoveLead(null)}
        leadName={moveLead?.lead.name ?? ''}
        currentStage={moveLead?.lead.stage ?? ''}
        stages={stages}
        isPending={isPending}
        onConfirm={(targetStage) => {
          if (!moveLead) return;
          const lead = moveLead.lead;
          setMoveLead(null);
          requestSingleMove(lead, targetStage);
        }}
      />

      <LeadDrawer
        leadId={drawerLeadId}
        open={drawerLeadId !== null}
        onClose={() => setDrawerLeadId(null)}
        pipeline={pipeline}
      />

      <LeadCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />

      {isPending && (
        <p className="pointer-events-none fixed bottom-4 right-4 z-50 rounded-md bg-brand-700 px-3 py-1.5 text-xs text-canvas shadow-lg">
          Salvando…
        </p>
      )}
    </>
  );
}

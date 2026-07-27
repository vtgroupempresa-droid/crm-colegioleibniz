'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { moveLeadStage } from '@/actions/leads';
import { Drawer } from '@/components/ui/drawer';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { LostReasonModal } from '@/components/kanban/lost-reason-modal';
import { SoftBlockModal } from '@/components/kanban/soft-block-modal';
import { labelForField, validateRequiredFields } from '@/lib/leads/validators';
import type { Activity, Appointment, ContactAttempt, Lead } from '@/types/lead';
import type { PipelineKind } from '@/types/pipeline';
import type { LeadDealSummary, StageWithCount } from '@/actions/leads-queries';
import { LeadDataTab } from './lead-data-tab';
import { LeadTimelineTab } from './lead-timeline-tab';
import { LeadAppointmentsTab } from './lead-appointments-tab';
import { LeadConversationsTab } from './lead-conversations-tab';
import { LeadTasksTab } from './lead-tasks-tab';
import { LeadNotesTab } from './lead-notes-tab';
import { LeadQualificationPanel } from './lead-qualification-panel';
import { LeadDrawerSkeleton } from './lead-drawer-skeleton';

interface LeadPayload {
  lead: Lead;
  /** Colunas do pipeline atual do lead — alimenta o "Mover etapa" do drawer. */
  stages: StageWithCount[];
  activities: Activity[];
  contactAttempts: ContactAttempt[];
  appointments: Appointment[];
  hasDeal: boolean;
  deals?: LeadDealSummary[];
  /** Mapa user_id → nome dos autores das activities (timeline mostra autor). */
  activityAuthors: Record<string, string>;
  /** Usuário atual (libera edição de nota só ao autor) — do endpoint. */
  viewerId: string | null;
  viewerIsAdmin: boolean;
  /** Papel do usuário atual — libera o editor de composição de pagamento. */
  viewerRole: string | null;
  /** Conversa mais recente do lead visível ao usuário — botão "Ir para o chat". */
  conversationId: string | null;
}

interface LeadDrawerProps {
  leadId: string | null;
  open: boolean;
  onClose: () => void;
  pipeline?: PipelineKind;
}

// Mesmas regras do board (kanban-board.tsx): campos estruturais bloqueiam hard;
// o sentinela de agendamento só é alcançável criando a reunião.
const HARD_BLOCK_FIELDS: ReadonlySet<string> = new Set(['lost_reason']);
const APPOINTMENT_REQUIRED = 'appointment_required';

/**
 * Drawer com 5 abas: Dados / Timeline / Agendamentos / Conversas / Notas.
 * Busca os dados do lead via endpoint REST (`/api/leads/:id`) sempre que abre,
 * pra garantir que mostra estado atual após mutações.
 */
export function LeadDrawer({ leadId, open, onClose }: LeadDrawerProps) {
  const router = useRouter();
  const [payload, setPayload] = useState<LeadPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lostOpen, setLostOpen] = useState(false);
  // "Mover etapa" dentro do pipeline atual (mesmo fluxo do drag do board).
  const [targetStage, setTargetStage] = useState('');
  const [softMissing, setSoftMissing] = useState<readonly string[] | null>(null);
  const [isMoving, startMove] = useTransition();

  // Recarrega o lead silenciosamente (sem piscar o skeleton). Usado após
  // mutações dentro do drawer — ex.: adicionar/editar nota — para o conteúdo
  // novo aparecer na hora. `cache: 'no-store'` evita o navegador devolver um
  // payload antigo (era a causa de a nota "sumir depois de um tempo").
  const reload = useCallback(async () => {
    if (!leadId) return;
    try {
      const res = await fetch(`/api/leads/${leadId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPayload((await res.json()) as LeadPayload);
    } catch {
      // Reload é best-effort: em falha mantém o conteúdo já carregado.
    }
  }, [leadId]);

  // Sincroniza o select de etapa com o stage atual sempre que o payload muda
  // (abertura do drawer e reload pós-mutação).
  useEffect(() => {
    if (payload) setTargetStage(payload.lead.stage);
  }, [payload]);

  useEffect(() => {
    if (!open || !leadId) {
      setPayload(null);
      setLostOpen(false);
      setSoftMissing(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/leads/${leadId}`, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<LeadPayload>;
      })
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar lead');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, leadId]);

  function performMove(force: boolean) {
    if (!payload) return;
    const stageName =
      payload.stages.find((s) => s.slug === targetStage)?.name ?? targetStage;
    startMove(async () => {
      const result = await moveLeadStage(payload.lead.id, targetStage, force);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSoftMissing(null);
      toast.success(`Movido para ${stageName}`);
      await reload();
      router.refresh();
    });
  }

  // Espelha o drag do board: agendamento é hard block (a reunião cria o move),
  // lost_reason abre o modal de motivo, ICP incompleto vira confirmação soft.
  function handleMove() {
    if (!payload) return;
    const lead = payload.lead;
    const target = payload.stages.find((s) => s.slug === targetStage);
    if (!target || target.slug === lead.stage) return;

    if (target.required_fields.includes(APPOINTMENT_REQUIRED)) {
      toast.warning(
        'Este estágio exige reunião: crie o agendamento na aba "Agendamentos" — o lead avança automaticamente ao salvar.',
      );
      return;
    }

    const { ok, missing } = validateRequiredFields(lead, target.required_fields);
    if (!ok) {
      if (missing.includes('lost_reason')) {
        setLostOpen(true);
        return;
      }
      const hard = missing.filter((m) => HARD_BLOCK_FIELDS.has(m));
      if (hard.length > 0) {
        toast.error(`Campos obrigatórios em falta: ${hard.map(labelForField).join(', ')}`);
        return;
      }
      setSoftMissing(missing);
      return;
    }

    performMove(false);
  }

  const tabs: TabItem[] = payload
    ? [
        {
          id: 'dados',
          label: 'Dados',
          content: (
            <LeadDataTab
              lead={payload.lead}
              activities={payload.activities}
              appointments={payload.appointments}
              hasDeal={payload.hasDeal}
              deals={payload.deals ?? []}
              viewerRole={payload.viewerRole}
              onMutated={reload}
            />
          ),
        },
        {
          id: 'timeline',
          label: `Timeline (${payload.activities.filter((a) => a.type !== 'note').length})`,
          content: (
            <LeadTimelineTab
              leadId={payload.lead.id}
              activities={payload.activities}
              activityAuthors={payload.activityAuthors}
              viewerId={payload.viewerId}
              viewerIsAdmin={payload.viewerIsAdmin}
              onMutated={reload}
            />
          ),
        },
        {
          id: 'agendamentos',
          label: `Agendamentos (${payload.appointments.length})`,
          content: (
            <LeadAppointmentsTab
              leadId={payload.lead.id}
              appointments={payload.appointments}
              onMutated={reload}
            />
          ),
        },
        {
          id: 'conversas',
          label: 'Conversas',
          content: <LeadConversationsTab leadId={payload.lead.id} />,
        },
        {
          id: 'tarefas',
          label: 'Tarefas',
          content: <LeadTasksTab leadId={payload.lead.id} />,
        },
        {
          id: 'notas',
          label: `Notas (${payload.activities.filter((a) => a.type === 'note').length})`,
          content: (
            <LeadNotesTab
              leadId={payload.lead.id}
              activities={payload.activities}
              activityAuthors={payload.activityAuthors}
              viewerId={payload.viewerId}
              viewerIsAdmin={payload.viewerIsAdmin}
              onMutated={reload}
            />
          ),
        },
      ]
    : [];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        payload ? (
          <div className="flex items-center gap-2">
            <p className="truncate text-lg font-semibold text-brand-700">{payload.lead.name}</p>
            <Badge tone="neutral">{payload.lead.pipeline}</Badge>
            <Badge tone="brand">{payload.lead.stage}</Badge>
          </div>
        ) : (
          <p className="text-sm text-brand-400">Carregando...</p>
        )
      }
    >
      {loading && <LeadDrawerSkeleton />}
      {error && <p className="text-sm text-red-600">Erro: {error}</p>}
      {payload && (
        <div className="flex flex-col gap-3">
          {/* Mover de etapa dentro do pipeline atual (mesmas regras do drag do
              board) + marcar como perdido manual (abre o LostReasonModal;
              escondido se já está arquivado/perdido ou é cliente pós-venda). */}
          <div className="flex flex-wrap items-end justify-between gap-2 rounded-md border border-brand-100 bg-white px-3 py-2">
            <div className="flex flex-1 items-end gap-2">
              <div className="min-w-44 flex-1">
                <Select
                  label="Mover para etapa"
                  value={targetStage}
                  onChange={(e) => setTargetStage(e.target.value)}
                >
                  {payload.stages.map((s) => (
                    <option key={s.slug} value={s.slug}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                variant="secondary"
                className="h-10"
                disabled={isMoving || targetStage === payload.lead.stage}
                onClick={handleMove}
              >
                {isMoving ? 'Movendo…' : 'Mover'}
              </Button>
            </div>
            <div className="flex items-end gap-2">
              {/* Atalho pro /chat na conversa do lead — só quando ela existe e
                  é visível ao usuário (o endpoint resolve com RLS). */}
              {payload.conversationId && (
                <Link
                  href={`/chat?c=${payload.conversationId}`}
                  className="focus-ring flex h-10 items-center gap-1.5 rounded-md bg-brand-700 px-3 text-sm font-medium text-canvas hover:bg-brand-800"
                >
                  <span aria-hidden="true">💬</span> Ir para o chat
                </Link>
              )}
              {!payload.lead.is_archived &&
                !payload.lead.lost_reason &&
                payload.lead.pipeline !== 'pos_matricula' && (
                  <Button
                    variant="danger"
                    className="h-10"
                    onClick={() => setLostOpen(true)}
                  >
                    Marcar como perdido
                  </Button>
                )}
            </div>
          </div>
          <LeadQualificationPanel lead={payload.lead} onMutated={reload} />
          <Tabs items={tabs} />
        </div>
      )}
      {payload && softMissing && (
        <SoftBlockModal
          open
          onClose={() => setSoftMissing(null)}
          targetStageName={
            payload.stages.find((s) => s.slug === targetStage)?.name ?? targetStage
          }
          missing={softMissing}
          onFillNow={() => setSoftMissing(null)}
          onAdvanceAnyway={() => performMove(true)}
          isPending={isMoving}
        />
      )}
      {payload && (
        <LostReasonModal
          open={lostOpen}
          onClose={() => setLostOpen(false)}
          onSuccess={onClose}
          leadId={payload.lead.id}
          leadName={payload.lead.name}
        />
      )}
    </Drawer>
  );
}

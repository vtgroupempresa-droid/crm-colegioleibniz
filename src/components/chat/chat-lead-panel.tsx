'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { InterestBadge } from '@/components/leads/interest-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CalendarIcon, SendIcon, UserIcon } from '@/components/ui/icons';
import { RegisterContactModal } from '@/components/kanban/register-contact-modal';
import { ScheduleHandoffModal } from '@/components/kanban/schedule-handoff-modal';
import { ChatAvatar } from './chat-avatar';
import { moveLeadStage } from '@/actions/leads';
import { createLeadFromConversation, type ThreadLeadExtras } from '@/actions/conversations';
import { MAX_ATTEMPTS } from '@/lib/sla/rules';
import { PIPELINE_LABELS, type PipelineKind } from '@/types/pipeline';
import { EDUCATION_LEVEL_LABELS, LEAD_SOURCE_LABELS, type LeadSource } from '@/types/lead';
import type { Activity, Lead } from '@/types/lead';
import type { Conversation } from '@/types/chat';
import type { ChatStageOption } from './chat-layout';

interface ChatLeadPanelProps {
  lead: Lead | null;
  /** Produto/responsável/tentativas já resolvidos pela thread. */
  leadExtras: ThreadLeadExtras | null;
  /** Conversa selecionada — usada na triagem (conversa sem lead, Fase 16). */
  conversation: Conversation | null;
  activities: Activity[];
  stages: ChatStageOption[];
  onOpenLead: (leadId: string) => void;
  onChanged: () => void;
}

/**
 * Painel de triagem: conversa de Instagram sem lead (nenhuma keyword de
 * produto casou). O time escolhe o produto de interesse (opcional) e converte
 * em lead manualmente.
 */
function TriagePanel({
  conversation,
  onChanged,
}: {
  conversation: Conversation;
  onChanged: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  function handleCreate() {
    startTransition(async () => {
      const result = await createLeadFromConversation(conversation.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Lead criado e vinculado à conversa');
      onChanged();
    });
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div>
        <p className="font-semibold text-brand-700">Conversa em triagem</p>
        <p className="mt-1 text-xs text-brand-500">
          Esta conversa ainda não virou lead. Crie o lead quando a família demonstrar interesse
          em matrícula — os dados do aluno podem ser preenchidos na ficha depois.
        </p>
      </div>
      <div className="flex flex-col gap-2 rounded-md border border-brand-100 p-3">
        <Button size="sm" disabled={isPending} onClick={handleCreate}>
          {isPending ? 'Criando…' : 'Criar lead no funil'}
        </Button>
      </div>
    </div>
  );
}

/** Linha rótulo → valor das seções Situação/Perfil (mockup da 3ª coluna). */
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-brand-400">{label}</span>
      <span className="min-w-0 truncate text-right font-semibold text-brand-700">{value}</span>
    </div>
  );
}

export function ChatLeadPanel({
  lead,
  leadExtras,
  conversation,
  activities,
  stages,
  onOpenLead,
  onChanged,
}: ChatLeadPanelProps) {
  const [targetStage, setTargetStage] = useState('');
  const [isPending, startTransition] = useTransition();
  const [contactOpen, setContactOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const pipelineStages = useMemo(
    () => (lead ? stages.filter((s) => s.pipeline === lead.pipeline) : []),
    [stages, lead],
  );

  useEffect(() => {
    if (lead) setTargetStage(lead.stage);
  }, [lead]);

  if (!lead) {
    if (conversation) {
      return <TriagePanel conversation={conversation} onChanged={onChanged} />;
    }
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-brand-400">
        Selecione uma conversa para ver os dados do lead.
      </div>
    );
  }

  const stageName = pipelineStages.find((s) => s.slug === lead.stage)?.name ?? lead.stage;

  function handleMove() {
    if (!lead || !targetStage || targetStage === lead.stage) return;
    startTransition(async () => {
      const result = await moveLeadStage(lead.id, targetStage, true);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Movido para ${targetStage}`);
      onChanged();
    });
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <RegisterContactModal
        open={contactOpen}
        onClose={() => {
          setContactOpen(false);
          onChanged();
        }}
        leadId={lead.id}
        leadName={lead.name}
        onSchedule={() => setScheduleOpen(true)}
      />
      <ScheduleHandoffModal
        open={scheduleOpen}
        onClose={() => {
          setScheduleOpen(false);
          onChanged();
        }}
        leadId={lead.id}
        leadName={lead.name}
      />

      {/* Cabeçalho: avatar + nome + telefone + score. */}
      <div className="flex flex-col items-center gap-1.5 pt-1 text-center">
        <ChatAvatar name={lead.name} size={64} />
        <p className="max-w-full truncate text-base font-bold text-brand-700">{lead.name}</p>
        {lead.phone && <p className="text-xs text-brand-400">{lead.phone}</p>}
        <InterestBadge lead={lead} className="mt-1" />
      </div>

      {/* Situação */}
      <div className="flex flex-col gap-2 rounded-md border border-brand-100 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">
          Situação
        </p>
        <InfoRow
          label="Pipeline"
          value={
            <span className="inline-flex items-center gap-1">
              <Badge tone="neutral">{PIPELINE_LABELS[lead.pipeline as PipelineKind]}</Badge>
              <Badge tone="brand">{stageName}</Badge>
            </span>
          }
        />
        {leadExtras?.assignedName && (
          <InfoRow label="Responsável" value={leadExtras.assignedName} />
        )}
        <InfoRow
          label="Tentativas"
          value={`${Math.min(leadExtras?.attemptsCount ?? 0, MAX_ATTEMPTS)} / ${MAX_ATTEMPTS}`}
        />
      </div>

      {/* Perfil */}
      <div className="flex flex-col gap-2 rounded-md border border-brand-100 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Perfil</p>
        <InfoRow label="Aluno" value={lead.child_name ?? '—'} />
        <InfoRow
          label="Idade"
          value={lead.child_age ? `${lead.child_age} anos` : '—'}
        />
        <InfoRow
          label="Nível de ensino"
          value={lead.education_level ? EDUCATION_LEVEL_LABELS[lead.education_level] : '—'}
        />
        <InfoRow label="Ano escolar" value={lead.school_year ?? '—'} />
        <InfoRow label="Cidade" value={lead.city ?? '—'} />
        <InfoRow
          label="Origem"
          value={LEAD_SOURCE_LABELS[lead.source as LeadSource] ?? lead.source}
        />
        {lead.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {lead.tags.map((t) => (
              <Badge key={t} tone="info">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Ações */}
      <div className="flex flex-col gap-2">
        <Button size="sm" onClick={() => setScheduleOpen(true)} className="justify-center gap-1.5">
          <CalendarIcon size={15} /> Agendar reunião
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setContactOpen(true)}
          className="justify-center gap-1.5"
        >
          <SendIcon size={15} /> Registrar contato
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onOpenLead(lead.id)}
          className="justify-center gap-1.5"
        >
          <UserIcon size={15} /> Ver ficha completa
        </Button>
      </div>

      {/* Atalho: mover etapa. */}
      <div className="flex items-end gap-2 rounded-md border border-brand-100 p-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[11px] text-brand-500">Mover etapa</span>
          <select
            value={targetStage}
            onChange={(e) => setTargetStage(e.target.value)}
            className="focus-ring h-8 rounded-md border border-brand-200 bg-white px-2 text-xs text-brand-700"
          >
            {pipelineStages.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          variant="secondary"
          disabled={isPending || targetStage === lead.stage}
          onClick={handleMove}
        >
          Mover
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">
          Últimas atividades
        </p>
        {activities.length === 0 ? (
          <p className="text-xs text-brand-400">Nenhuma atividade ainda.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {activities.map((a) => (
              <li key={a.id} className="rounded-md bg-brand-50 px-2 py-1.5">
                <p className="text-xs font-medium text-brand-700">{a.title}</p>
                {a.description && (
                  <p className="mt-0.5 text-[11px] text-brand-500">{a.description}</p>
                )}
                <p className="mt-0.5 text-[10px] text-brand-300">
                  {new Date(a.created_at).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'America/Sao_Paulo',
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

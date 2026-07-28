'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  addStage,
  reorderStages,
  setStageActive,
  updateStage,
  type PipelineGroup,
} from '@/actions/pipeline-stages';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PIPELINE_LABELS, type PipelineKind, type PipelineStage } from '@/types/pipeline';

interface DraftEdit {
  name: string;
  color: string;
  isEntry: boolean;
  isTerminal: boolean;
  requiredFields: string;
  /** Probabilidade de fechamento 0-100 (%) — alimenta o Pipeline Ponderado. */
  winProbability: string;
}

function SortableRow({
  stage,
  onEdit,
  onToggleActive,
  busy,
}: {
  stage: PipelineStage;
  onEdit: (stage: PipelineStage) => void;
  onToggleActive: (stage: PipelineStage) => void;
  busy: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stage.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md border border-brand-100 bg-white px-2 py-2"
    >
      <button
        type="button"
        className="cursor-grab px-1 text-brand-400 hover:text-brand-700"
        aria-label="Arrastar para reordenar"
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>
      <span
        className="h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: stage.color }}
        aria-hidden
      />
      <span className="flex-1 truncate text-sm text-brand-700">
        {stage.name}
        <span className="ml-2 text-xs text-brand-400">{stage.slug}</span>
      </span>
      {stage.is_entry && <Badge tone="neutral">entrada</Badge>}
      {stage.is_terminal && <Badge tone="neutral">terminal</Badge>}
      {!stage.is_active && <Badge tone="neutral">inativo</Badge>}
      <Button type="button" size="sm" variant="ghost" onClick={() => onEdit(stage)} disabled={busy}>
        Editar
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => onToggleActive(stage)}
        disabled={busy}
      >
        {stage.is_active ? 'Desativar' : 'Reativar'}
      </Button>
    </div>
  );
}

function PipelineEditor({ group, busy, onChanged }: { group: PipelineGroup; busy: boolean; onChanged: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [stages, setStages] = useState<PipelineStage[]>(group.stages);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftEdit | null>(null);
  const [newName, setNewName] = useState('');
  const [newEntry, setNewEntry] = useState(false);
  const [newTerminal, setNewTerminal] = useState(false);
  const [newRequired, setNewRequired] = useState('');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const working = busy || isPending;

  function parseFields(raw: string): string[] {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = stages.findIndex((s) => s.id === active.id);
    const newIndex = stages.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(stages, oldIndex, newIndex);
    setStages(reordered);
    startTransition(async () => {
      const result = await reorderStages({
        pipeline: group.pipeline,
        orderedIds: reordered.map((s) => s.id),
      });
      if (!result.ok) {
        toast.error(result.error);
        setStages(group.stages); // reverte
        return;
      }
      toast.success('Ordem atualizada');
      onChanged();
    });
  }

  function openEdit(stage: PipelineStage) {
    setEditingId(stage.id);
    setDraft({
      name: stage.name,
      color: stage.color,
      isEntry: stage.is_entry,
      isTerminal: stage.is_terminal,
      requiredFields: (stage.required_fields ?? []).join(', '),
      winProbability: String(stage.stage_win_probability ?? 0),
    });
  }

  function saveEdit() {
    if (!editingId || !draft) return;
    const winProbability = Number(draft.winProbability);
    if (!Number.isFinite(winProbability) || winProbability < 0 || winProbability > 100) {
      toast.error('Probabilidade deve ser um número entre 0 e 100');
      return;
    }
    startTransition(async () => {
      const result = await updateStage({
        id: editingId,
        name: draft.name,
        color: draft.color,
        isEntry: draft.isEntry,
        isTerminal: draft.isTerminal,
        requiredFields: parseFields(draft.requiredFields),
        winProbability,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Stage atualizado');
      setEditingId(null);
      setDraft(null);
      onChanged();
    });
  }

  function toggleActive(stage: PipelineStage) {
    startTransition(async () => {
      const result = await setStageActive({ id: stage.id, active: !stage.is_active });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(stage.is_active ? 'Stage desativado' : 'Stage reativado');
      onChanged();
    });
  }

  function addNew() {
    if (!newName.trim()) {
      toast.error('Informe o nome do stage');
      return;
    }
    startTransition(async () => {
      const result = await addStage({
        pipeline: group.pipeline,
        name: newName.trim(),
        isEntry: newEntry,
        isTerminal: newTerminal,
        requiredFields: parseFields(newRequired),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Stage adicionado');
      setNewName('');
      setNewEntry(false);
      setNewTerminal(false);
      setNewRequired('');
      onChanged();
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-1.5">
            {stages.map((stage) => (
              <div key={stage.id}>
                <SortableRow
                  stage={stage}
                  onEdit={openEdit}
                  onToggleActive={toggleActive}
                  busy={working}
                />
                {editingId === stage.id && draft && (
                  <div className="ml-8 mt-1 flex flex-col gap-2 rounded-md border border-brand-100 bg-brand-50 p-3">
                    <label className="text-xs text-brand-500">
                      Nome
                      <input
                        className="mt-1 w-full rounded border border-brand-200 px-2 py-1 text-sm"
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-4">
                      <label className="flex items-center gap-2 text-xs text-brand-500">
                        Cor
                        <input
                          type="color"
                          value={/^#[0-9a-fA-F]{6}$/.test(draft.color) ? draft.color : '#94a3b8'}
                          onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs text-brand-600">
                        <input
                          type="checkbox"
                          checked={draft.isEntry}
                          onChange={(e) => setDraft({ ...draft, isEntry: e.target.checked })}
                        />
                        Entrada
                      </label>
                      <label className="flex items-center gap-2 text-xs text-brand-600">
                        <input
                          type="checkbox"
                          checked={draft.isTerminal}
                          onChange={(e) => setDraft({ ...draft, isTerminal: e.target.checked })}
                        />
                        Terminal
                      </label>
                      <label className="flex items-center gap-2 text-xs text-brand-500">
                        Prob. de fechamento (%)
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={5}
                          className="w-20 rounded border border-brand-200 px-2 py-1 text-sm"
                          value={draft.winProbability}
                          onChange={(e) => setDraft({ ...draft, winProbability: e.target.value })}
                          title="Usada no Pipeline Ponderado (Dashboard › Pipeline & Forecast)"
                        />
                      </label>
                    </div>
                    <label className="text-xs text-brand-500">
                      Campos obrigatórios (separados por vírgula)
                      <input
                        className="mt-1 w-full rounded border border-brand-200 px-2 py-1 text-sm"
                        value={draft.requiredFields}
                        onChange={(e) => setDraft({ ...draft, requiredFields: e.target.value })}
                        placeholder="specialty, city, monthly_revenue"
                      />
                    </label>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={saveEdit} disabled={working}>
                        Salvar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(null);
                          setDraft(null);
                        }}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="rounded-md border border-dashed border-brand-200 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-500">Adicionar stage</p>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="text-xs text-brand-500">
            Nome
            <input
              className="mt-1 block w-48 rounded border border-brand-200 px-2 py-1 text-sm"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Novo stage"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-brand-600">
            <input type="checkbox" checked={newEntry} onChange={(e) => setNewEntry(e.target.checked)} />
            Entrada
          </label>
          <label className="flex items-center gap-2 text-xs text-brand-600">
            <input
              type="checkbox"
              checked={newTerminal}
              onChange={(e) => setNewTerminal(e.target.checked)}
            />
            Terminal
          </label>
          <label className="text-xs text-brand-500">
            Campos obrigatórios
            <input
              className="mt-1 block w-56 rounded border border-brand-200 px-2 py-1 text-sm"
              value={newRequired}
              onChange={(e) => setNewRequired(e.target.value)}
              placeholder="separados por vírgula"
            />
          </label>
          <Button type="button" size="sm" onClick={addNew} disabled={working}>
            Adicionar
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Editor de pipelines e stages no /admin (Fase 14). Lista os 5 pipelines; ao
 * expandir, permite reordenar (drag), editar (nome/cor/flags/required_fields),
 * adicionar e desativar stages (desativar exige stage vazio).
 */
export function PipelinesManager({ groups }: { groups: PipelineGroup[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<PipelineKind | null>(null);

  function onChanged() {
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      {groups.map((group) => {
        const isOpen = open === group.pipeline;
        const activeCount = group.stages.filter((s) => s.is_active).length;
        return (
          <div key={group.pipeline} className="rounded-md border border-brand-100">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : group.pipeline)}
              className="focus-ring flex w-full items-center justify-between px-3 py-2.5 text-left"
            >
              <span className="font-medium text-brand-700">
                {PIPELINE_LABELS[group.pipeline]}
                <span className="ml-2 text-xs font-normal text-brand-400">
                  {activeCount} stage{activeCount === 1 ? '' : 's'} ativo{activeCount === 1 ? '' : 's'}
                  {group.stages.length !== activeCount
                    ? ` · ${group.stages.length - activeCount} inativo(s)`
                    : ''}
                </span>
              </span>
              <span className="text-sm text-brand-500">{isOpen ? 'Fechar' : 'Editar stages'}</span>
            </button>
            {isOpen && (
              <div className="border-t border-brand-100 px-3 pb-3">
                <PipelineEditor group={group} busy={false} onChanged={onChanged} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

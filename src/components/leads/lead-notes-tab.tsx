'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { addNote, updateNote } from '@/actions/activities';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatDateTime, formatRelative } from '@/lib/utils/format';
import type { Activity } from '@/types/lead';

/** Ícone lápis (sem dependência externa) para a edição inline das notas. */
function PencilIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden
    >
      <path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z" />
    </svg>
  );
}

/** Inicial do autor para o avatar; "?" quando o autor é desconhecido/sistema. */
function initialOf(name: string | null): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

interface LeadNotesTabProps {
  leadId: string;
  /** Todas as activities do lead — filtramos só as notas (type='note'). */
  activities: readonly Activity[];
  /** Mapa user_id → nome para mostrar o autor de cada nota. */
  activityAuthors: Record<string, string>;
  /** Usuário atual: só o autor (ou admin) pode editar a nota. */
  viewerId: string | null;
  viewerIsAdmin: boolean;
  /** Recarrega o lead no drawer após salvar/editar (nota aparece na hora). */
  onMutated?: () => void | Promise<void>;
}

/**
 * Aba "Notas" do LeadDrawer: adicionar e consultar as notas manuais do lead.
 * As notas são persistidas na tabela `activities` (type='note'), vinculadas ao
 * lead pelo `lead_id` — garantindo o mapeamento por lead. A criação/edição vive
 * só aqui (a Timeline não exibe mais notas).
 */
export function LeadNotesTab({
  leadId,
  activities,
  activityAuthors,
  viewerId,
  viewerIsAdmin,
  onMutated,
}: LeadNotesTabProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState('');
  // Edição inline: id da nota em edição + rascunho do texto.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  // Só notas, da mais recente para a mais antiga.
  const notes = activities
    .filter((a) => a.type === 'note')
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  function handleAddNote(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!note.trim()) return;
    startTransition(async () => {
      const result = await addNote({ leadId, text: note });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setNote('');
      toast.success('Nota adicionada');
      // Recarrega o drawer (a nota nova aparece na hora) + atualiza o board atrás.
      await onMutated?.();
      router.refresh();
    });
  }

  function startEdit(activity: Activity) {
    setEditingId(activity.id);
    setEditText(activity.description ?? '');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText('');
  }

  function saveEdit(activityId: string) {
    const text = editText.trim();
    if (!text) return;
    startTransition(async () => {
      const result = await updateNote({ activityId, text });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setEditingId(null);
      setEditText('');
      toast.success('Nota atualizada');
      await onMutated?.();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Card de nova nota */}
      <form
        onSubmit={handleAddNote}
        className="flex flex-col gap-2 rounded-md border border-brand-100 bg-white p-4"
      >
        <Textarea
          label="Nova nota"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Resumo da última conversa, próximos passos..."
          rows={3}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={isPending || !note.trim()}>
            {isPending ? 'Salvando...' : 'Adicionar nota'}
          </Button>
        </div>
      </form>

      {/* Lista de notas registradas */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
            Notas registradas
          </h4>
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-600">
            {notes.length}
          </span>
        </div>

        {notes.length === 0 ? (
          <div className="rounded-md border border-dashed border-brand-200 bg-brand-50 px-4 py-8 text-center">
            <p className="text-2xl" aria-hidden>
              📝
            </p>
            <p className="mt-1 text-sm text-brand-500">Nenhuma nota registrada ainda.</p>
            <p className="text-xs text-brand-400">Use o campo acima para adicionar a primeira.</p>
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            {notes.map((activity) => {
              const authorName = activity.user_id
                ? (activityAuthors[activity.user_id] ?? null)
                : null;
              const displayAuthor = authorName ?? 'Sistema';
              // Edição só do autor da nota (ou admin).
              const canEdit = viewerIsAdmin || (!!viewerId && activity.user_id === viewerId);
              const isEditing = editingId === activity.id;
              return (
                <li
                  key={activity.id}
                  className="group flex gap-3 rounded-md border border-brand-100 bg-white p-3 shadow-sm"
                >
                  {/* Avatar com a inicial do autor */}
                  <span
                    aria-hidden
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm font-semibold text-amber-700"
                  >
                    {initialOf(authorName)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-brand-700">
                          {displayAuthor}
                        </p>
                        <p
                          className="text-[11px] text-brand-400"
                          title={formatDateTime(activity.created_at)}
                        >
                          {formatRelative(activity.created_at)} · {formatDateTime(activity.created_at)}
                        </p>
                      </div>
                      {canEdit && !isEditing && (
                        <button
                          type="button"
                          onClick={() => startEdit(activity)}
                          className="rounded p-1 text-brand-400 opacity-0 transition-opacity hover:bg-brand-50 hover:text-brand-600 focus:opacity-100 group-hover:opacity-100"
                          aria-label="Editar nota"
                          title="Editar nota"
                        >
                          <PencilIcon />
                        </button>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="mt-2 flex flex-col gap-2">
                        <Textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          rows={3}
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={cancelEdit}
                            disabled={isPending}
                          >
                            Cancelar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => saveEdit(activity.id)}
                            disabled={isPending || !editText.trim()}
                          >
                            {isPending ? 'Salvando...' : 'Salvar'}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      activity.description && (
                        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-brand-600">
                          {activity.description}
                        </p>
                      )
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

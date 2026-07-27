'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  cancelTask,
  completeTask,
  createTask,
  getTasksForLead,
  type TaskItem,
} from '@/actions/tasks';
import { getGoogleCalendarStatus } from '@/actions/google-calendar';
import { listAssignableUsers } from '@/actions/leads';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatDateTime, formatRelative } from '@/lib/utils/format';

/**
 * Aba "Tarefas" do lead drawer: lembretes/follow-ups com data, responsável e
 * espelho opcional na agenda Google da escola (via integração Google Calendar).
 */

interface LeadTasksTabProps {
  leadId: string;
}

export function LeadTasksTab({ leadId }: LeadTasksTabProps) {
  const [tasks, setTasks] = useState<TaskItem[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    dueAt: '',
    assignedTo: '',
    addToCalendar: true,
  });

  const reload = useCallback(() => {
    getTasksForLead(leadId)
      .then(setTasks)
      .catch(() => setTasks([]));
  }, [leadId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!showForm) return;
    listAssignableUsers()
      .then((p) => setPeople(p.map(({ id, name }) => ({ id, name }))))
      .catch(() => setPeople([]));
    getGoogleCalendarStatus()
      .then((s) => setGoogleConnected(s.connected))
      .catch(() => setGoogleConnected(false));
  }, [showForm]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('Informe o título da tarefa');
      return;
    }
    if (!form.dueAt) {
      toast.error('Informe a data e hora');
      return;
    }
    startTransition(async () => {
      const result = await createTask({
        leadId,
        title: form.title.trim(),
        description: form.description.trim() || null,
        dueAt: new Date(form.dueAt).toISOString(),
        assignedTo: form.assignedTo || null,
        addToCalendar: googleConnected && form.addToCalendar,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.googleEventId ? 'Tarefa criada e adicionada à agenda' : 'Tarefa criada',
      );
      setForm({ title: '', description: '', dueAt: '', assignedTo: '', addToCalendar: true });
      setShowForm(false);
      reload();
    });
  }

  function handleClose(taskId: string, done: boolean) {
    startTransition(async () => {
      const result = done ? await completeTask(taskId) : await cancelTask(taskId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(done ? 'Tarefa concluída' : 'Tarefa cancelada');
      reload();
    });
  }

  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const pending = (tasks ?? []).filter((t) => t.status === 'pendente');
  const closed = (tasks ?? []).filter((t) => t.status !== 'pendente');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant={showForm ? 'ghost' : 'primary'}
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? 'Cancelar' : 'Nova tarefa'}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 rounded-md border border-brand-100 bg-white p-3"
        >
          <Input
            label="Título"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Ex.: Ligar para o lead, enviar proposta…"
            required
          />
          <Input
            label="Data e hora"
            type="datetime-local"
            value={form.dueAt}
            onChange={(e) => setForm((f) => ({ ...f, dueAt: e.target.value }))}
            required
          />
          <Select
            label="Responsável"
            value={form.assignedTo}
            onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value }))}
          >
            <option value="">Eu mesmo</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Textarea
            label="Descrição (opcional)"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={2}
          />
          {googleConnected && (
            <label className="flex items-center gap-2 text-sm text-brand-600">
              <input
                type="checkbox"
                checked={form.addToCalendar}
                onChange={(e) => setForm((f) => ({ ...f, addToCalendar: e.target.checked }))}
                className="h-4 w-4 rounded border-brand-300"
              />
              Adicionar à agenda Google
            </label>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </form>
      )}

      {tasks === null && <p className="text-sm text-brand-400">Carregando…</p>}
      {tasks !== null && tasks.length === 0 && (
        <p className="text-sm text-brand-400">Sem tarefas para este lead.</p>
      )}

      {pending.length > 0 && (
        <ul className="flex flex-col gap-2">
          {pending.map((t) => {
            const overdue = new Date(t.dueAt).getTime() < Date.now();
            return (
              <li key={t.id} className="rounded-md border border-brand-100 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-brand-700">{t.title}</p>
                  <span
                    className={
                      overdue
                        ? 'shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[11px] text-red-700'
                        : 'shrink-0 text-[11px] text-brand-400'
                    }
                  >
                    {formatRelative(t.dueAt)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-brand-500">
                  {formatDateTime(t.dueAt)}
                  {t.assignedTo && nameById.has(t.assignedTo) && (
                    <> · {nameById.get(t.assignedTo)}</>
                  )}
                  {t.googleEventId && ' · 📅 na agenda'}
                </p>
                {t.description && <p className="mt-1 text-xs text-brand-500">{t.description}</p>}
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleClose(t.id, true)}
                    disabled={isPending}
                  >
                    Concluir
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleClose(t.id, false)}
                    disabled={isPending}
                  >
                    Cancelar tarefa
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {closed.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-brand-400">
            {closed.length} tarefa(s) concluída(s)/cancelada(s)
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {closed.map((t) => (
              <li
                key={t.id}
                className="rounded-md border border-brand-50 bg-brand-50/50 p-2 text-xs text-brand-400"
              >
                <span className={t.status === 'concluida' ? 'line-through' : ''}>{t.title}</span> ·{' '}
                {formatDateTime(t.dueAt)} · {t.status === 'concluida' ? 'concluída' : 'cancelada'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

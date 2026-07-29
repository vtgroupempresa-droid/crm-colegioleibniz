'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { completeTask, getMyActionQueue, snoozeTask, type ActionQueueItem } from '@/actions/tasks';
import { cn } from '@/lib/utils/cn';
import { formatRelative } from '@/lib/utils/format';

interface ActionQueueProps {
  onOpenLead: (leadId: string) => void;
}

type QueueKind = 'overdue' | 'now' | 'today' | 'upcoming';

function classify(dueAt: string): QueueKind {
  const due = new Date(dueAt).getTime();
  const now = Date.now();
  if (due < now) return 'overdue';
  if (due <= now + 60 * 60 * 1000) return 'now';
  const endToday = new Date();
  endToday.setHours(23, 59, 59, 999);
  return due <= endToday.getTime() ? 'today' : 'upcoming';
}

const META: Record<QueueKind, { label: string; className: string }> = {
  overdue: { label: 'Atrasadas', className: 'border-red-200 bg-red-50 text-red-800' },
  now: { label: 'Para agora', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  today: { label: 'Hoje', className: 'border-sky-200 bg-sky-50 text-sky-800' },
  upcoming: { label: 'Próximas 48h', className: 'border-brand-200 bg-brand-50 text-brand-600' },
};

/** Fila de trabalho dentro do Funil — não exige procurar alertas no sino. */
export function ActionQueue({ onOpenLead }: ActionQueueProps) {
  const [items, setItems] = useState<ActionQueueItem[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();

  const reload = useCallback(() => {
    getMyActionQueue().then(setItems).catch(() => setItems([]));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const groups = useMemo(() => {
    const next: Record<QueueKind, ActionQueueItem[]> = { overdue: [], now: [], today: [], upcoming: [] };
    for (const item of items) next[classify(item.dueAt)].push(item);
    return next;
  }, [items]);

  function complete(item: ActionQueueItem) {
    startTransition(async () => {
      const result = await completeTask(item.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Ação concluída');
      reload();
    });
  }

  function snooze(item: ActionQueueItem) {
    const next = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    startTransition(async () => {
      const result = await snoozeTask(item.id, next);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Lembrete adiado por 2 horas');
      reload();
    });
  }

  if (items.length === 0) return null;
  const visibleGroups = expanded ? (Object.keys(META) as QueueKind[]) : (['overdue', 'now', 'today'] as QueueKind[]);

  return (
    <section className="mb-3 rounded-xl border border-brand-100 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-brand-700">Minha fila de ação</h3>
          <p className="text-[11px] text-brand-400">Conclua ou adie; nenhuma família fica sem próximo passo.</p>
        </div>
        <button type="button" onClick={() => setExpanded((value) => !value)} className="focus-ring text-xs font-semibold text-brand-600 hover:underline">
          {expanded ? 'Ver menos' : `Ver ${items.length} ações`}
        </button>
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-3">
        {visibleGroups.map((kind) => {
          const group = groups[kind];
          if (group.length === 0) return null;
          const meta = META[kind];
          return (
            <div key={kind} className={cn('rounded-lg border p-2', meta.className)}>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide">{meta.label} · {group.length}</p>
              <ul className="space-y-1.5">
                {group.slice(0, expanded ? 8 : 3).map((item) => (
                  <li key={item.id} className="rounded-md bg-white/85 p-2 shadow-sm">
                    <button type="button" onClick={() => item.leadId && onOpenLead(item.leadId)} className="focus-ring block w-full truncate rounded text-left text-xs font-semibold text-brand-700 hover:underline">
                      {item.leadName ?? item.title}
                    </button>
                    <p className="mt-0.5 truncate text-[11px] text-brand-500">{item.title} · {formatRelative(item.dueAt)}</p>
                    <div className="mt-1.5 flex gap-2">
                      <button type="button" disabled={isPending} onClick={() => complete(item)} className="focus-ring text-[11px] font-semibold text-emerald-700 hover:underline">Concluir</button>
                      <button type="button" disabled={isPending} onClick={() => snooze(item)} className="focus-ring text-[11px] font-semibold text-brand-500 hover:underline">Adiar 2h</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

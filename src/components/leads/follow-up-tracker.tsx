'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { recordFollowUp } from '@/actions/follow-ups';
import { FOLLOWUP_DAYS, type FollowUpDay } from '@/types/follow-up';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils/cn';
import { formatDate, formatRelative } from '@/lib/utils/format';
import type { Activity } from '@/types/lead';

interface FollowUpTrackerProps {
  leadId: string;
  /** Activities do lead — usadas para detectar quais follow-ups já foram feitos. */
  activities: readonly Activity[];
  /** Data de referência (D-0): início da sequência. Costuma ser a data da call. */
  referenceDate: string;
}

interface ParsedFollowUp {
  day: FollowUpDay;
  scheduledFor: Date;
  done: { at: string; notes: string | null } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function readFollowUpDay(activity: Activity): FollowUpDay | null {
  const meta = activity.metadata;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const raw = (meta as Record<string, unknown>).followup_day;
  if (typeof raw !== 'number') return null;
  return (FOLLOWUP_DAYS as readonly number[]).includes(raw) ? (raw as FollowUpDay) : null;
}

/**
 * Tracker de follow-up D+1/D+2/D+7/D+15/D+30 do closer. Persistência em
 * `activities` com metadata `{ followup_day: N }` — uma activity por checkpoint
 * (idempotente do ponto de vista visual: se houver mais de uma, mostramos a
 * mais recente).
 */
export function FollowUpTracker({ leadId, activities, referenceDate }: FollowUpTrackerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draftNotes, setDraftNotes] = useState<Record<number, string>>({});

  const parsed = useMemo<ParsedFollowUp[]>(() => {
    const baseTime = new Date(referenceDate).getTime();
    const doneMap = new Map<FollowUpDay, { at: string; notes: string | null }>();
    for (const act of activities) {
      const day = readFollowUpDay(act);
      if (day === null) continue;
      const existing = doneMap.get(day);
      if (!existing || new Date(act.created_at).getTime() > new Date(existing.at).getTime()) {
        doneMap.set(day, { at: act.created_at, notes: act.description });
      }
    }
    return FOLLOWUP_DAYS.map((day) => ({
      day,
      scheduledFor: new Date(baseTime + day * DAY_MS),
      done: doneMap.get(day) ?? null,
    }));
  }, [activities, referenceDate]);

  function handleRecord(day: FollowUpDay) {
    const notes = draftNotes[day]?.trim() || null;
    startTransition(async () => {
      const result = await recordFollowUp({ leadId, day, notes });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Follow-up D+${day} registrado`);
      setDraftNotes((prev) => {
        const next = { ...prev };
        delete next[day];
        return next;
      });
      router.refresh();
    });
  }

  return (
    <section className="rounded-md border border-brand-100 bg-white p-3">
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-brand-700">Follow-up do closer</h3>
        <p className="text-[11px] text-brand-400">
          Base D-0: {formatDate(referenceDate)}
        </p>
      </header>
      <ul className="flex flex-col gap-2">
        {parsed.map((row) => {
          const isDone = row.done !== null;
          const isPast = row.scheduledFor.getTime() < Date.now();
          return (
            <li
              key={row.day}
              className={cn(
                'rounded-md border px-3 py-2 transition-colors',
                isDone
                  ? 'border-emerald-200 bg-emerald-50'
                  : isPast
                  ? 'border-amber-200 bg-amber-50'
                  : 'border-brand-100 bg-brand-50/60',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-brand-700">
                    D+{row.day}{' '}
                    <span className="text-xs font-normal text-brand-500">
                      · {formatDate(row.scheduledFor)}
                    </span>
                  </p>
                  {isDone && row.done && (
                    <p className="text-[11px] text-emerald-700">
                      ✓ Concluído {formatRelative(row.done.at)}
                    </p>
                  )}
                  {!isDone && isPast && (
                    <p className="text-[11px] text-amber-700">Atrasado</p>
                  )}
                  {!isDone && !isPast && (
                    <p className="text-[11px] text-brand-400">Programado</p>
                  )}
                </div>
              </div>
              {isDone && row.done?.notes && (
                <p className="mt-1 whitespace-pre-wrap text-xs text-brand-600">
                  {row.done.notes}
                </p>
              )}
              {!isDone && (
                <div className="mt-2 flex flex-col gap-2">
                  <Textarea
                    rows={2}
                    placeholder="Notas (opcional)..."
                    value={draftNotes[row.day] ?? ''}
                    onChange={(e) =>
                      setDraftNotes((prev) => ({ ...prev, [row.day]: e.target.value }))
                    }
                  />
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleRecord(row.day)}
                      disabled={isPending}
                    >
                      Marcar D+{row.day} como feito
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

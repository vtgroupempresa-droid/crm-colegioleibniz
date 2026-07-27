'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { listUserGoals, upsertUserGoal, type UserGoal } from '@/actions/user-goals';
import { Button } from '@/components/ui/button';
import { USER_ROLE_LABELS, type UserRole } from '@/types/user';

interface GoalUser {
  id: string;
  name: string;
  role: UserRole;
}

interface DraftGoal {
  metaAgendamentos: string;
  metaVendas: string;
  metaFaturamento: string;
}

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function draftFrom(goal: UserGoal | undefined): DraftGoal {
  return {
    metaAgendamentos: String(goal?.meta_agendamentos ?? 0),
    metaVendas: String(goal?.meta_vendas ?? 0),
    metaFaturamento: String(goal?.meta_faturamento ?? 0),
  };
}

/**
 * Metas individuais mensais por pessoa do comercial: visitas agendadas,
 * matrículas (qtd) e faturamento (R$).
 * Alimenta a coluna "Meta do mês" em /dashboard/performance-individual.
 */
export function UserGoalsForm({
  users,
  initialMes,
  initialAno,
}: {
  users: GoalUser[];
  initialMes: number;
  initialAno: number;
}) {
  const [mes, setMes] = useState(initialMes);
  const [ano, setAno] = useState(initialAno);
  const [drafts, setDrafts] = useState<Record<string, DraftGoal>>({});
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listUserGoals(mes, ano)
      .then((goals) => {
        if (cancelled) return;
        const byUser = new Map(goals.map((g) => [g.user_id, g]));
        const next: Record<string, DraftGoal> = {};
        for (const user of users) next[user.id] = draftFrom(byUser.get(user.id));
        setDrafts(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mes, ano, users]);

  function updateDraft(userId: string, patch: Partial<DraftGoal>) {
    setDrafts((prev) => {
      const cur = prev[userId] ?? { metaAgendamentos: '0', metaVendas: '0', metaFaturamento: '0' };
      return { ...prev, [userId]: { ...cur, ...patch } };
    });
  }

  function save(user: GoalUser) {
    const draft = drafts[user.id];
    if (!draft) return;
    const nums = {
      metaAgendamentos: Number(draft.metaAgendamentos),
      metaVendas: Number(draft.metaVendas),
      metaFaturamento: Number(draft.metaFaturamento),
    };
    if (Object.values(nums).some((n) => !Number.isFinite(n) || n < 0)) {
      toast.error('Metas devem ser números não-negativos');
      return;
    }
    startTransition(async () => {
      const result = await upsertUserGoal({ userId: user.id, mes, ano, ...nums });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Meta de ${user.name} salva`);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-brand-500">
          Mês
          <select
            className="mt-1 block rounded border border-brand-200 px-2 py-1 text-sm"
            value={mes}
            onChange={(e) => setMes(Number(e.target.value))}
          >
            {MONTHS.map((label, i) => (
              <option key={label} value={i + 1}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-brand-500">
          Ano
          <input
            type="number"
            className="mt-1 block w-24 rounded border border-brand-200 px-2 py-1 text-sm"
            value={ano}
            onChange={(e) => setAno(Number(e.target.value))}
          />
        </label>
        {loading && <span className="pb-1 text-xs text-brand-400">Carregando metas…</span>}
      </div>

      {users.length === 0 ? (
        <p className="text-sm text-brand-400">Nenhum SDR ou closer cadastrado.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-brand-500">
              <tr>
                <th className="pb-2 pr-3">Atendente</th>
                <th className="pb-2 pr-3">Cargo</th>
                <th className="pb-2 pr-3 text-right">Meta visitas</th>
                <th className="pb-2 pr-3 text-right">Meta matrículas (qtd)</th>
                <th className="pb-2 pr-3 text-right">Meta faturamento (R$)</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-100">
              {users.map((user) => {
                const draft = drafts[user.id];
                return (
                  <tr key={user.id}>
                    <td className="py-2 pr-3 font-medium text-brand-700">{user.name}</td>
                    <td className="py-2 pr-3 text-brand-500">
                      {USER_ROLE_LABELS[user.role]}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <input
                        type="number"
                        min={0}
                        className="w-24 rounded border border-brand-200 px-2 py-1 text-right text-sm"
                        value={draft?.metaAgendamentos ?? '0'}
                        onChange={(e) => updateDraft(user.id, { metaAgendamentos: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <input
                        type="number"
                        min={0}
                        className="w-24 rounded border border-brand-200 px-2 py-1 text-right text-sm"
                        value={draft?.metaVendas ?? '0'}
                        onChange={(e) => updateDraft(user.id, { metaVendas: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <input
                        type="number"
                        min={0}
                        step={1000}
                        className="w-32 rounded border border-brand-200 px-2 py-1 text-right text-sm"
                        value={draft?.metaFaturamento ?? '0'}
                        onChange={(e) => updateDraft(user.id, { metaFaturamento: e.target.value })}
                      />
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => save(user)}
                        disabled={isPending || loading}
                      >
                        Salvar
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

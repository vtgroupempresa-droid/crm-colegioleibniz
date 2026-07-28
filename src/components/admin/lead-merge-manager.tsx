'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
  mergeLeads,
  searchLeadsForMerge,
  type DuplicateGroup,
  type LeadSearchRow,
} from '@/actions/merge';
import {
  dismissDuplicateCandidate,
  type CandidateLeadInfo,
  type NameSimilarityCandidate,
} from '@/actions/duplicate-candidates';
import { SUPPORTING_SIGNAL_LABELS } from '@/lib/leads/duplicate-detection';

/** Shape mínimo compartilhado entre busca manual e grupos auto-detectados. */
interface MergeCandidate {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  created_at: string;
}

interface PendingMerge {
  a: MergeCandidate;
  b: MergeCandidate;
  needsForce: boolean;
}

function fmtContact(c: MergeCandidate): string {
  return [c.phone, c.email].filter(Boolean).join(' · ') || 'sem telefone/email';
}

/**
 * O lead MAIS ANTIGO é mantido como principal: preserva o histórico de
 * atendimento e a data de origem real da família no funil.
 */
function pickPrimary(a: MergeCandidate, b: MergeCandidate): { primary: MergeCandidate; secondary: MergeCandidate } {
  return new Date(b.created_at) < new Date(a.created_at)
    ? { primary: b, secondary: a }
    : { primary: a, secondary: b };
}

/** Célula de um lead dentro do par candidato por similaridade de nome. */
function CandidateLeadCell({ lead }: { lead: CandidateLeadInfo }) {
  return (
    <div className="min-w-0 rounded-md border border-brand-100 bg-white p-2.5">
      <p className="truncate font-medium text-brand-700">{lead.name}</p>
      <p className="truncate text-xs text-brand-500">
        {[lead.phone, lead.email].filter(Boolean).join(' · ') || 'sem telefone/email'}
      </p>
      <p className="truncate text-xs text-brand-400">
        {[lead.city, lead.state].filter(Boolean).join('/') || 'sem cidade'} · {lead.pipeline}/
        {lead.stage}
      </p>
      <p className="text-xs text-brand-400">
        {lead.activityCount} {lead.activityCount === 1 ? 'interação' : 'interações'}
      </p>
    </div>
  );
}

export function LeadMergeManager({
  initialGroups,
  nameCandidates,
}: {
  initialGroups: DuplicateGroup[];
  nameCandidates: NameSimilarityCandidate[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Candidatos por similaridade de nome (Camadas 2/3, revisão humana).
  const [candidates, setCandidates] = useState<NameSimilarityCandidate[]>(nameCandidates);

  // Busca manual.
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<LeadSearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [selection, setSelection] = useState<MergeCandidate[]>([]);

  // Modal de confirmação.
  const [pending, setPending] = useState<PendingMerge | null>(null);

  function dismissCandidate(candidateId: string) {
    startTransition(async () => {
      const result = await dismissDuplicateCandidate(candidateId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCandidates((prev) => prev.filter((c) => c.id !== candidateId));
      toast.success('Par marcado como "não é duplicata"');
    });
  }

  async function runSearch() {
    const q = term.trim();
    if (q.length < 2) {
      toast.error('Digite ao menos 2 caracteres');
      return;
    }
    setSearching(true);
    const rows = await searchLeadsForMerge(q);
    setSearching(false);
    setResults(rows);
    if (rows.length === 0) toast.info('Nenhum lead encontrado');
  }

  function toggleSelect(row: LeadSearchRow) {
    setSelection((prev) => {
      if (prev.some((p) => p.id === row.id)) return prev.filter((p) => p.id !== row.id);
      if (prev.length >= 2) return [...prev.slice(1), row];
      return [...prev, row];
    });
  }

  function openConfirm(a: MergeCandidate, b: MergeCandidate) {
    setPending({ a, b, needsForce: false });
  }

  function confirmMerge() {
    if (!pending) return;
    startTransition(async () => {
      const result = await mergeLeads(pending.a.id, pending.b.id, { force: pending.needsForce });
      if (!result.ok) {
        if (result.needsConfirmation) {
          setPending((p) => (p ? { ...p, needsForce: true } : p));
          toast.warning(result.error);
          return;
        }
        toast.error(result.error);
        return;
      }
      toast.success('Leads unificados com sucesso');
      setPending(null);
      setSelection([]);
      setResults((prev) => prev.filter((r) => r.id !== result.secondaryId));
      // O lead arquivado invalida qualquer outro par candidato em que aparecia.
      setCandidates((prev) =>
        prev.filter((c) => c.leadA.id !== result.secondaryId && c.leadB.id !== result.secondaryId),
      );
      router.refresh();
    });
  }

  const [selA, selB] = selection;
  const selectionPair = selA && selB ? pickPrimary(selA, selB) : null;
  const pendingPair = pending ? pickPrimary(pending.a, pending.b) : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Duplicatas detectadas automaticamente */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-500">
          Duplicatas detectadas ({initialGroups.length})
        </h4>
        {initialGroups.length === 0 ? (
          <p className="mt-2 text-sm text-brand-400">
            Nenhum par de telefone/email duplicado entre os leads ativos.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {initialGroups.map((group) => {
              const primary = group.members[0];
              if (!primary) return null;
              return (
                <li
                  key={`${group.matchType}:${group.matchKey}`}
                  className="rounded-md border border-brand-100 p-3"
                >
                  <div className="flex items-center gap-2 text-xs text-brand-500">
                    <Badge tone="warning">
                      {group.matchType === 'phone' ? 'Telefone' : 'Email'} igual
                    </Badge>
                    <span className="font-mono">{group.matchKey}</span>
                    <span>· {group.members.length} leads</span>
                  </div>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {group.members.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="min-w-0">
                          <span className="font-medium text-brand-700">{m.name}</span>{' '}
                          <span className="text-xs text-brand-400">
                            {fmtContact(m)} · score {m.score}
                          </span>
                        </span>
                        {m.id === primary.id ? (
                          <Badge tone="success">principal</Badge>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={isPending}
                            onClick={() => openConfirm(primary, m)}
                          >
                            Unificar
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Candidatos por similaridade de nome (Camadas 2/3 — sempre revisão humana) */}
      <div className="border-t border-brand-100 pt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-500">
          Candidatos por similaridade de nome ({candidates.length})
        </h4>
        <p className="mt-1 text-xs text-brand-400">
          Nomes quase idênticos (ignorando dr./dra. e acentos) que os critérios de telefone/email
          não pegam. Nunca são unificados automaticamente — revise e decida par a par.
        </p>
        {candidates.length === 0 ? (
          <p className="mt-2 text-sm text-brand-400">
            Nenhum par pendente. Novos candidatos aparecem aqui quando a auditoria ou a checagem
            automática de leads novos encontra nomes similares.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {candidates.map((c) => {
              const isLayer2 = c.confidenceLayer === 2;
              return (
                <li
                  key={c.id}
                  className={`rounded-md border p-3 ${
                    isLayer2 ? 'border-amber-300 bg-amber-50/40' : 'border-brand-100'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-brand-500">
                    {isLayer2 ? (
                      <Badge tone="warning">Forte candidato</Badge>
                    ) : (
                      <Badge tone="neutral">Possível duplicata</Badge>
                    )}
                    <Badge tone="info">nome {Math.round(c.nameSimilarity * 100)}% similar</Badge>
                    {c.supportingSignals.map((signal) => (
                      <Badge key={signal} tone="neutral">
                        {SUPPORTING_SIGNAL_LABELS[signal]}
                      </Badge>
                    ))}
                  </div>
                  {!isLayer2 && (
                    <p className="mt-1.5 text-xs font-medium text-red-700">
                      ⚠️ Sem nenhum sinal de apoio — revisar com atenção: pode ser outra pessoa com
                      nome parecido (homônima).
                    </p>
                  )}
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <CandidateLeadCell lead={c.leadA} />
                    <CandidateLeadCell lead={c.leadB} />
                  </div>
                  <div className="mt-2 flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => dismissCandidate(c.id)}
                    >
                      Não é duplicata
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={isPending}
                      onClick={() => openConfirm(c.leadA, c.leadB)}
                    >
                      Unificar
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Busca manual */}
      <div className="border-t border-brand-100 pt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-500">
          Unificar manualmente
        </h4>
        <p className="mt-1 text-xs text-brand-400">
          Busque por nome, telefone ou email e selecione dois leads para unificar.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch();
            }}
            placeholder="Nome, telefone ou email…"
            className="focus-ring h-9 flex-1 rounded-md border border-brand-200 px-3 text-sm"
          />
          <Button type="button" size="sm" onClick={() => void runSearch()} disabled={searching}>
            {searching ? 'Buscando…' : 'Buscar'}
          </Button>
        </div>

        {results.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1">
            {results.map((row) => {
              const checked = selection.some((s) => s.id === row.id);
              return (
                <li key={row.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm ${
                      checked ? 'border-brand-400 bg-brand-50' : 'border-brand-100'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelect(row)}
                      className="h-4 w-4"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-brand-700">{row.name}</span>{' '}
                      <span className="text-xs text-brand-400">
                        {fmtContact(row)}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {selectionPair && (
          <div className="mt-3 flex items-center justify-between rounded-md bg-brand-50 px-3 py-2 text-sm">
            <span className="text-brand-600">
              Manter <strong>{selectionPair.primary.name}</strong> e arquivar{' '}
              <strong>{selectionPair.secondary.name}</strong>
            </span>
            <Button
              type="button"
              size="sm"
              disabled={isPending}
              onClick={() => openConfirm(selectionPair.primary, selectionPair.secondary)}
            >
              Unificar selecionados
            </Button>
          </div>
        )}
      </div>

      {/* Modal de confirmação */}
      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Confirmar unificação"
      >
        {pendingPair && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-brand-600">
              Todo o histórico (atividades, mensagens, tentativas, agendamentos, conversas,
              negócios e scores) do lead arquivado será movido para o principal. Esta ação não
              pode ser desfeita pela interface.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                <Badge tone="success">Principal (mantido)</Badge>
                <p className="mt-1 font-medium text-brand-700">{pendingPair.primary.name}</p>
                <p className="text-xs text-brand-500">{fmtContact(pendingPair.primary)}</p>
                <p className="text-xs text-brand-400">
                  criado em {new Date(pendingPair.primary.created_at).toLocaleDateString('pt-BR')}
                </p>
              </div>
              <div className="rounded-md border border-brand-200 bg-brand-50 p-3">
                <Badge tone="neutral">Secundário (arquivado)</Badge>
                <p className="mt-1 font-medium text-brand-700">{pendingPair.secondary.name}</p>
                <p className="text-xs text-brand-500">{fmtContact(pendingPair.secondary)}</p>
                <p className="text-xs text-brand-400">
                  criado em {new Date(pendingPair.secondary.created_at).toLocaleDateString('pt-BR')}
                </p>
              </div>
            </div>
            {pending?.needsForce && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                ⚠️ Ambos os leads possuem negócios fechados. Ao confirmar, os negócios dos dois
                serão mantidos no lead principal.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setPending(null)}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant={pending?.needsForce ? 'danger' : 'primary'}
                onClick={confirmMerge}
                disabled={isPending}
              >
                {isPending
                  ? 'Unificando…'
                  : pending?.needsForce
                    ? 'Confirmar mesmo assim'
                    : 'Unificar leads'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

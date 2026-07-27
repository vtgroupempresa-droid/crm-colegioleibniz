'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils/cn';
import { firstNameOf } from '@/lib/utils/format';
import {
  sendTemplateBroadcast,
  type BroadcastItemResult,
  type BroadcastTarget,
} from '@/actions/broadcasts';
import { AUTO_LEAD_NAME_VARIABLE, type MessageTemplate } from '@/types/chat';
import { EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS } from '@/types/lead';

/** Valor sentinela do select de nível: revela o campo de texto livre. */
const CUSTOM_OPTION = '__custom__';
/** Envios por chamada — chunks pequenos dão progresso e evitam timeout. */
const CHUNK_SIZE = 10;
/** Teto por disparo (limite diário business-initiated da Meta sem display name). */
const MAX_PER_BROADCAST = 250;

interface BroadcastComposerProps {
  templates: MessageTemplate[];
  initialTargets: BroadcastTarget[];
}

type Phase = 'compose' | 'confirm' | 'sending' | 'done';

/**
 * Primeiro nome utilizável como {{nome}}: lead importado sem nome fica com o
 * telefone no lugar do nome — isso NÃO pode sair no template ("Ei 5511…").
 * Nome que é só dígitos/símbolos conta como vazio e exige preenchimento.
 */
function usableFirstName(raw: string | null | undefined): string {
  const first = firstNameOf(raw ?? undefined) ?? '';
  const semMascara = first.replace(/[+()\s.-]/g, '');
  if (semMascara.length > 0 && /^\d+$/.test(semMascara)) return '';
  return first;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${Math.max(min, 1)}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Composer do /disparos: escolhe o template, preenche as variáveis (produto =
 * select do catálogo ou texto livre), seleciona os leads e dispara em lote com
 * progresso e resultado por lead. Cada envio é registrado na conversa do chat.
 */
export function BroadcastComposer({ templates, initialTargets }: BroadcastComposerProps) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const template = templates.find((t) => t.id === templateId) ?? null;

  const [values, setValues] = useState<Record<string, string>>({});
  const [levelChoice, setLevelChoice] = useState('');

  const [search, setSearch] = useState('');
  // Filtro por número oficial (ex.: só a lista da API OFICIAL MS).
  const [instanceFilter, setInstanceFilter] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Correções manuais do {{nome}} por conversa (o nome do CRM nem sempre está certo).
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({});

  const [phase, setPhase] = useState<Phase>('compose');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<Map<string, BroadcastItemResult>>(new Map());

  const hasLeadNameVar = template?.variables.includes(AUTO_LEAD_NAME_VARIABLE) ?? false;

  const targetById = useMemo(
    () => new Map(initialTargets.map((t) => [t.conversationId, t])),
    [initialTargets],
  );

  // {{nome}} que sairá para a conversa: correção manual > primeiro nome do CRM.
  function resolvedNameFor(conversationId: string): string {
    const override = nameOverrides[conversationId];
    if (override !== undefined) return override;
    return usableFirstName(targetById.get(conversationId)?.name);
  }

  // Troca de template zera variáveis e resultado anterior.
  useEffect(() => {
    setValues({});
    setLevelChoice('');
    setPhase('compose');
    setResults(new Map());
  }, [templateId]);

  const preview = useMemo(() => {
    if (!template) return '';
    let text = template.content;
    for (const v of template.variables) {
      // {{nome}} sai personalizado por lead — no preview fica o marcador.
      const value = v === AUTO_LEAD_NAME_VARIABLE ? '⟨nome do lead⟩' : values[v]?.trim();
      text = text.split(`{{${v}}}`).join(value || `⟨${v}⟩`);
    }
    return text;
  }, [template, values]);

  const instanceNames = useMemo(
    () => [
      ...new Set(
        initialTargets.map((t) => t.instanceName).filter((n): n is string => Boolean(n)),
      ),
    ],
    [initialTargets],
  );

  const filteredTargets = useMemo(() => {
    const term = search.trim().toLowerCase();
    return initialTargets.filter((t) => {
      if (instanceFilter !== 'all' && t.instanceName !== instanceFilter) return false;
      if (!term) return true;
      return t.name.toLowerCase().includes(term) || t.phone.includes(term);
    });
  }, [initialTargets, search, instanceFilter]);

  // {{nome}} não conta aqui: é conferido/ajustado por lead na lista ao lado.
  const allFilled =
    template !== null &&
    template.variables
      .filter((v) => v !== AUTO_LEAD_NAME_VARIABLE)
      .every((v) => (values[v] ?? '').trim().length > 0);
  // Selecionados ainda sem {{nome}} (CRM sem nome ou campo apagado) — bloqueiam o envio.
  const missingNames = hasLeadNameVar
    ? [...selected].filter((id) => !resolvedNameFor(id).trim())
    : [];
  const canSend =
    allFilled && selected.size > 0 && missingNames.length === 0 && phase !== 'sending';

  function setValue(variable: string, value: string) {
    setValues((prev) => ({ ...prev, [variable]: value }));
  }

  function toggle(conversationId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(conversationId)) next.delete(conversationId);
      else if (next.size < MAX_PER_BROADCAST) next.add(conversationId);
      else toast.warning(`Máximo de ${MAX_PER_BROADCAST} leads por disparo.`);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const visible = filteredTargets.map((t) => t.conversationId);
      const allSelected = visible.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        visible.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...visible].slice(0, MAX_PER_BROADCAST));
    });
  }

  async function runBroadcast() {
    if (!template) return;
    const ids = [...selected];
    setPhase('sending');
    setProgress({ done: 0, total: ids.length });
    const acc = new Map<string, BroadcastItemResult>();

    // {{nome}} conferido na lista vai por conversa — cada lead recebe o próprio.
    const perConversationValues = hasLeadNameVar
      ? Object.fromEntries(
          ids.map((id) => [id, { [AUTO_LEAD_NAME_VARIABLE]: resolvedNameFor(id).trim() }]),
        )
      : undefined;

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const res = await sendTemplateBroadcast(template.id, values, chunk, perConversationValues);
      if (!res.ok) {
        toast.error(res.error);
        break;
      }
      for (const r of res.data.results) acc.set(r.conversationId, r);
      setResults(new Map(acc));
      setProgress({ done: Math.min(i + chunk.length, ids.length), total: ids.length });
    }

    const sent = [...acc.values()].filter((r) => r.ok).length;
    const failed = acc.size - sent;
    if (failed === 0) toast.success(`Disparo concluído: ${sent} enviados.`);
    else toast.warning(`Disparo concluído: ${sent} enviados, ${failed} falharam.`);
    setPhase('done');
  }

  if (templates.length === 0) {
    return (
      <p className="rounded-lg border border-brand-100 bg-white p-6 text-sm text-brand-500">
        Nenhum template oficial cadastrado. Crie o template na Meta e cadastre em
        message_templates com o meta_template_name preenchido.
      </p>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_1fr]">
      {/* Coluna 1: template + variáveis + preview */}
      <section className="flex h-fit flex-col gap-4 rounded-lg border border-brand-100 bg-white p-4">
        <Select
          label="Template"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>

        {template?.variables.map((variable) =>
          variable === AUTO_LEAD_NAME_VARIABLE ? (
            <div key={variable} className="flex flex-col gap-1">
              <p className="rounded-md border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-500">
                ✨ <span className="font-medium">nome</span> sai personalizado por lead: entra
                pré-preenchido com o primeiro nome do CRM — confira e ajuste na lista ao lado
                antes de enviar.
              </p>
              {missingNames.length > 0 && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  ⚠ {missingNames.length}{' '}
                  {missingNames.length === 1 ? 'lead selecionado está' : 'leads selecionados estão'}{' '}
                  sem nome — preencha o campo na lista para liberar o envio.
                </p>
              )}
            </div>
          ) : variable === 'nivel' ? (
            <div key={variable} className="flex flex-col gap-2">
              <Select
                label="Nível de ensino *"
                value={levelChoice}
                onChange={(e) => {
                  const choice = e.target.value;
                  setLevelChoice(choice);
                  setValue('nivel', choice === CUSTOM_OPTION ? '' : choice);
                }}
              >
                <option value="">Selecione o nível…</option>
                {EDUCATION_LEVELS.map((level) => (
                  <option key={level} value={EDUCATION_LEVEL_LABELS[level]}>
                    {EDUCATION_LEVEL_LABELS[level]}
                  </option>
                ))}
                <option value={CUSTOM_OPTION}>✏️ Escrever manualmente…</option>
              </Select>
              {levelChoice === CUSTOM_OPTION && (
                <Input
                  label="Nível / turma *"
                  value={values.nivel ?? ''}
                  onChange={(e) => setValue('nivel', e.target.value)}
                  placeholder="Ex.: Fundamental I"
                  autoFocus
                />
              )}
            </div>
          ) : (
            <Input
              key={variable}
              label={`${variable} *`}
              value={values[variable] ?? ''}
              onChange={(e) => setValue(variable, e.target.value)}
            />
          ),
        )}

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-brand-500">Mensagem que será enviada</span>
          <p className="whitespace-pre-wrap break-words rounded-md border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-brand-700">
            {preview}
          </p>
        </div>

        <p className="text-xs text-brand-400">
          Sai como template oficial aprovado na Meta — entrega mesmo fora da janela de 24h. Cada
          envio aparece no histórico do chat do lead. Limite da Meta: {MAX_PER_BROADCAST} conversas
          iniciadas pela empresa a cada 24h.
        </p>

        {phase === 'confirm' ? (
          <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-800">
              Enviar para {selected.size} {selected.size === 1 ? 'lead' : 'leads'}?
            </p>
            <div className="flex gap-2">
              <Button type="button" onClick={runBroadcast}>
                Confirmar envio
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPhase('compose')}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : phase === 'sending' ? (
          <div className="flex flex-col gap-2">
            <div className="h-2 overflow-hidden rounded-full bg-brand-100">
              <div
                className="h-full rounded-full bg-brand-700 transition-all"
                style={{
                  width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                }}
              />
            </div>
            <p className="text-xs text-brand-500">
              Enviando… {progress.done}/{progress.total}
            </p>
          </div>
        ) : (
          <Button type="button" disabled={!canSend} onClick={() => setPhase('confirm')}>
            {phase === 'done'
              ? 'Enviar novamente'
              : `Enviar para ${selected.size} ${selected.size === 1 ? 'lead' : 'leads'}`}
          </Button>
        )}
      </section>

      {/* Coluna 2: destinatários */}
      <section className="flex flex-col rounded-lg border border-brand-100 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-100 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-brand-700">
              Leads da instância oficial ({initialTargets.length})
            </h3>
            <p className="text-xs text-brand-400">
              Quem já conversou com o número oficial. {selected.size} selecionado
              {selected.size === 1 ? '' : 's'}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {instanceNames.length > 1 && (
              <select
                value={instanceFilter}
                onChange={(e) => setInstanceFilter(e.target.value)}
                className="focus-ring h-9 rounded-md border border-brand-200 px-2 text-sm"
              >
                <option value="all">Todos os números</option>
                {instanceNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            )}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou número…"
              className="focus-ring h-9 rounded-md border border-brand-200 px-3 text-sm"
            />
            <Button type="button" variant="ghost" onClick={toggleAll}>
              {filteredTargets.every((t) => selected.has(t.conversationId)) &&
              filteredTargets.length > 0
                ? 'Desmarcar todos'
                : 'Selecionar todos'}
            </Button>
          </div>
        </div>

        <ul className="max-h-[32rem] flex-1 divide-y divide-brand-50 overflow-y-auto">
          {filteredTargets.length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-brand-400">
              {initialTargets.length === 0
                ? 'Nenhum lead falou com o número oficial ainda.'
                : 'Nenhum lead encontrado na busca.'}
            </li>
          )}
          {filteredTargets.map((t) => {
            const result = results.get(t.conversationId);
            const checked = selected.has(t.conversationId);
            return (
              <li key={t.conversationId}>
                <label
                  className={cn(
                    'flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-brand-50',
                    checked && 'bg-brand-50',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(t.conversationId)}
                    disabled={phase === 'sending'}
                    className="focus-ring h-4 w-4 rounded border-brand-300"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-brand-700">
                      {t.name}
                    </span>
                    <span className="block text-xs text-brand-400">
                      {t.phone}
                      {t.pipeline && ` · ${t.pipeline}`}
                      {t.instanceName && ` · ${t.instanceName}`}
                    </span>
                    {hasLeadNameVar && checked && (
                      <span className="mt-1 flex items-center gap-1.5">
                        <span className="text-[10px] text-brand-400">{'{{nome}}'}</span>
                        <input
                          value={resolvedNameFor(t.conversationId)}
                          onChange={(e) =>
                            setNameOverrides((prev) => ({
                              ...prev,
                              [t.conversationId]: e.target.value,
                            }))
                          }
                          placeholder="preencha o nome…"
                          disabled={phase === 'sending'}
                          className={cn(
                            'focus-ring h-7 w-40 rounded-md border px-2 text-xs',
                            resolvedNameFor(t.conversationId).trim()
                              ? 'border-brand-200'
                              : 'border-amber-300 bg-amber-50',
                          )}
                        />
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-brand-400">
                    último contato {timeAgo(t.lastMessageAt)}
                  </span>
                  {result && (
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                        result.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700',
                      )}
                      title={result.error ?? undefined}
                    >
                      {result.ok ? 'Enviado' : 'Falhou'}
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

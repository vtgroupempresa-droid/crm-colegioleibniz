'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { createClient } from '@/lib/supabase/client';
import {
  getImportForms,
  runMetaImport,
  type RunImportInput,
} from '@/actions/meta-import';
import type { FormSummary, ImportReport } from '@/lib/meta/import-core';
import { PIPELINES, PIPELINE_LABELS } from '@/types/pipeline';
import type { PipelineStage } from '@/types/pipeline';

/**
 * Painel de importação histórica do Meta Lead Ads (Fase 11) na tela /admin.
 * Lista formulários, configura destino e dispara a importação, com progresso
 * ao vivo via Realtime (INSERTs em webhook_logs) e relatório final.
 */

interface MetaImportPanelProps {
  stages: PipelineStage[];
}

interface WebhookLogRow {
  payload?: { via?: string } | null;
  status?: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function MetaImportPanel({ stages }: MetaImportPanelProps) {
  const [forms, setForms] = useState<FormSummary[] | null>(null);
  const [formId, setFormId] = useState('');
  const [pipeline, setPipeline] = useState('reativacao');
  const [stage, setStage] = useState('entrada_reativacao');
  const [since, setSince] = useState('');
  const [limit, setLimit] = useState('');
  const [dryRun, setDryRun] = useState(true);

  const [report, setReport] = useState<ImportReport | null>(null);
  const [liveCount, setLiveCount] = useState(0);
  const [isLoadingForms, startLoadForms] = useTransition();
  const [isRunning, startRun] = useTransition();
  const runningRef = useRef(false);

  const stagesForPipeline = useMemo(
    () => stages.filter((s) => s.pipeline === pipeline),
    [stages, pipeline],
  );

  // Realtime: conta INSERTs de webhook_logs da importação durante a execução.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('webhook_logs:import-meta')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'webhook_logs' },
        (payload) => {
          if (!runningRef.current) return;
          const row = payload.new as WebhookLogRow;
          if (row.payload?.via === 'import-meta') {
            setLiveCount((prev) => prev + 1);
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  function loadForms() {
    startLoadForms(async () => {
      const result = await getImportForms();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setForms(result.data);
      if (result.data.length === 0) toast.message('Nenhum formulário encontrado na conta.');
    });
  }

  function selectPipeline(next: string) {
    setPipeline(next);
    const first = stages.find((s) => s.pipeline === next);
    if (first) setStage(first.slug);
  }

  function start() {
    setReport(null);
    setLiveCount(0);
    runningRef.current = true;
    startRun(async () => {
      const input: RunImportInput = {
        formId: formId || null,
        since: since || null,
        limit: limit ? Number(limit) : null,
        pipeline,
        stage,
        dryRun,
      };
      const result = await runMetaImport(input);
      runningRef.current = false;
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setReport(result.data);
      toast.success(
        result.data.dryRun
          ? `Simulação concluída: ${result.data.inserted} novos, ${result.data.duplicates} duplicados`
          : `Importação concluída: ${result.data.inserted} inseridos`,
      );
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <p className="font-medium text-brand-700">Formulários da conta</p>
          <Button size="sm" variant="secondary" onClick={loadForms} disabled={isLoadingForms}>
            {isLoadingForms ? 'Buscando…' : 'Buscar formulários'}
          </Button>
        </div>
        {forms === null ? (
          <p className="text-xs text-brand-400">
            Clique em &quot;Buscar formulários&quot; para listar os formulários ativos do Meta.
          </p>
        ) : forms.length === 0 ? (
          <p className="text-xs text-brand-400">Nenhum formulário disponível.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-brand-50">
            {forms.map((form) => (
              <li key={form.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                <div className="flex flex-col">
                  <span className="text-sm text-brand-700">{form.name}</span>
                  <span className="text-brand-400">
                    {form.leadsCount ?? '?'} leads · último em {formatDate(form.lastLeadAt)}
                  </span>
                </div>
                <Badge tone={form.status === 'ACTIVE' ? 'success' : 'neutral'}>{form.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-4 p-4">
        <p className="font-medium text-brand-700">Configurar importação</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Formulário"
            value={formId}
            onChange={(e) => setFormId(e.target.value)}
          >
            <option value="">Todos os formulários</option>
            {(forms ?? []).map((form) => (
              <option key={form.id} value={form.id}>
                {form.name}
              </option>
            ))}
          </Select>

          <Input
            label="Importar leads desde"
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
          />

          <Select
            label="Pipeline de destino"
            value={pipeline}
            onChange={(e) => selectPipeline(e.target.value)}
          >
            {PIPELINES.map((p) => (
              <option key={p} value={p}>
                {PIPELINE_LABELS[p]}
              </option>
            ))}
          </Select>

          <Select label="Stage de destino" value={stage} onChange={(e) => setStage(e.target.value)}>
            {stagesForPipeline.map((s) => (
              <option key={s.id} value={s.slug}>
                {s.name}
              </option>
            ))}
          </Select>

          <Input
            label="Limite (opcional, p/ teste)"
            type="number"
            min={1}
            placeholder="sem limite"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />

          <label className="flex items-center gap-2 self-end pb-2 text-sm text-brand-700">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="h-4 w-4 rounded border-brand-300"
            />
            Dry-run (simular sem gravar)
          </label>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={start} disabled={isRunning}>
            {isRunning ? 'Importando…' : dryRun ? 'Simular importação' : 'Iniciar importação'}
          </Button>
          {isRunning && !dryRun && (
            <span className="text-xs text-brand-500">{liveCount} processados…</span>
          )}
        </div>
      </Card>

      {report && (
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <p className="font-medium text-brand-700">
              Relatório {report.dryRun ? '(simulação)' : ''}
            </p>
            <div className="flex gap-2">
              <Badge tone="info">{report.totalFound} encontrados</Badge>
              <Badge tone="success">{report.inserted} {report.dryRun ? 'a inserir' : 'inseridos'}</Badge>
              <Badge tone="warning">{report.duplicates} duplicados</Badge>
              {report.errors.length > 0 && <Badge tone="danger">{report.errors.length} erros</Badge>}
            </div>
          </div>

          {report.byForm.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-brand-400">
                    <th className="py-1 pr-4 font-medium">Formulário</th>
                    <th className="py-1 pr-4 font-medium">Encontrados</th>
                    <th className="py-1 pr-4 font-medium">{report.dryRun ? 'A inserir' : 'Inseridos'}</th>
                    <th className="py-1 pr-4 font-medium">Duplicados</th>
                    <th className="py-1 font-medium">Erros</th>
                  </tr>
                </thead>
                <tbody className="text-brand-700">
                  {report.byForm.map((f) => (
                    <tr key={f.formName} className="border-t border-brand-50">
                      <td className="py-1 pr-4">{f.formName}</td>
                      <td className="py-1 pr-4">{f.found}</td>
                      <td className="py-1 pr-4">{f.inserted}</td>
                      <td className="py-1 pr-4">{f.duplicates}</td>
                      <td className="py-1">{f.errors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report.errors.length > 0 && (
            <div className="flex flex-col gap-1 rounded-md bg-red-50 p-3 text-xs text-red-700">
              <p className="font-medium">Erros</p>
              {report.errors.slice(0, 20).map((e, i) => (
                <span key={`${e.leadName}-${i}`}>
                  {e.formName} · {e.leadName}: {e.reason}
                </span>
              ))}
              {report.errors.length > 20 && <span>… e mais {report.errors.length - 20}</span>}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

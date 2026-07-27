'use client';

import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import { createWebhookSource } from '@/actions/webhook-sources';
import { applyFieldMapping, detectPayloadFields } from '@/lib/webhooks/field-mapping';
import { evaluateTagRules, mergeTags } from '@/lib/webhooks/tag-rules';
import { parseCampaignName, campaignAdCreative } from '@/lib/webhooks/campaign-parser';
import {
  MAPPABLE_LEAD_FIELDS,
  MAPPABLE_LEAD_FIELD_LABELS,
  FIELD_TRANSFORMS,
  TAG_RULE_OPS,
  TAG_RULE_OP_LABELS,
  WEBHOOK_SOURCE_PRESETS,
  type FieldMapping,
  type FieldTransform,
  type MappableLeadField,
  type TagRule,
  type TagRuleOp,
} from '@/types/webhooks';
import { PIPELINES, PIPELINE_LABELS, type PipelineKind } from '@/types/pipeline';
import type { PipelineStage } from '@/types/pipeline';

interface WebhookWizardProps {
  open: boolean;
  onClose: () => void;
  stages: PipelineStage[];
  onCreated: () => void;
}

const SAMPLE_PAYLOAD = JSON.stringify(
  {
    full_name: 'Dra. Ana Souza',
    phone_number: '+5511988887777',
    email: 'ana@clinica.com',
    campaign_name: '[SD] [ESR 2605] [Beleza] - Conversão',
    city: 'São Paulo',
    especialidade: 'dermato',
  },
  null,
  2,
);

const STEPS = ['Identificação', 'Mapeamento', 'Tags', 'Teste e ativação'] as const;

const FIXED_OPTION = '__fixed__';

export function WebhookWizard({ open, onClose, stages, onCreated }: WebhookWizardProps) {
  const [step, setStep] = useState(0);
  const [isPending, startTransition] = useTransition();

  // Passo 1
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<string>(WEBHOOK_SOURCE_PRESETS[0]);
  const [pipeline, setPipeline] = useState<PipelineKind>('comercial');
  const [stage, setStage] = useState('novo_lead');

  // Passo 2
  const [payloadText, setPayloadText] = useState(SAMPLE_PAYLOAD);
  const [mapping, setMapping] = useState<FieldMapping>({
    name: { from: 'full_name' },
    phone: { from: 'phone_number' },
    email: { from: 'email' },
  });

  // Passo 3
  const [tagRules, setTagRules] = useState<TagRule[]>([]);

  // Resultado
  const [created, setCreated] = useState<{ slug: string; secret: string } | null>(null);

  const stagesForPipeline = useMemo(
    () => stages.filter((s) => s.pipeline === pipeline),
    [stages, pipeline],
  );

  const payloadObj = useMemo(() => {
    try {
      return JSON.parse(payloadText) as unknown;
    } catch {
      return null;
    }
  }, [payloadText]);

  const detected = useMemo(() => (payloadObj ? detectPayloadFields(payloadObj) : []), [payloadObj]);

  const preview = useMemo(() => {
    if (!payloadObj) return null;
    const mapped = applyFieldMapping(payloadObj, mapping);
    const campaignRaw =
      (mapped.values.utm_campaign ?? null) ||
      (typeof (payloadObj as Record<string, unknown>).campaign_name === 'string'
        ? ((payloadObj as Record<string, unknown>).campaign_name as string)
        : null);
    const parsed = parseCampaignName(campaignRaw);
    const tags = mergeTags(
      parsed.raw_tags,
      parsed.campaign_theme ? [parsed.campaign_theme] : [],
      evaluateTagRules(payloadObj, tagRules),
    );
    return {
      values: mapped.values,
      numbers: mapped.numbers,
      tags,
      adCreative: campaignAdCreative(parsed),
      theme: parsed.campaign_theme,
    };
  }, [payloadObj, mapping, tagRules]);

  function reset() {
    setStep(0);
    setName('');
    setPreset(WEBHOOK_SOURCE_PRESETS[0]);
    setPipeline('comercial');
    setStage('novo_lead');
    setPayloadText(SAMPLE_PAYLOAD);
    setMapping({
      name: { from: 'full_name' },
      phone: { from: 'phone_number' },
      email: { from: 'email' },
    });
    setTagRules([]);
    setCreated(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  // ---- mapeamento helpers ----
  function setFieldSource(field: MappableLeadField, value: string) {
    setMapping((prev) => {
      const next = { ...prev };
      if (value === '') delete next[field];
      else if (value === FIXED_OPTION) next[field] = { fixed: '' };
      else next[field] = { from: value };
      return next;
    });
  }

  function setFieldFixed(field: MappableLeadField, value: string) {
    setMapping((prev) => ({ ...prev, [field]: { fixed: value } }));
  }

  function setFieldTransform(field: MappableLeadField, transform: FieldTransform) {
    setMapping((prev) => {
      const rule = prev[field];
      if (!rule || 'fixed' in rule) return prev;
      return { ...prev, [field]: { from: rule.from, transform } };
    });
  }

  // ---- tag rules helpers ----
  function addRule() {
    setTagRules((prev) => [
      ...prev,
      { field: detected[0] ?? '', op: 'contains', value: '', tag: '' },
    ]);
  }
  function updateRule(idx: number, patch: Partial<TagRule>) {
    setTagRules((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function removeRule(idx: number) {
    setTagRules((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleCreate() {
    if (name.trim().length < 2) {
      toast.error('Dê um nome à integração');
      setStep(0);
      return;
    }
    startTransition(async () => {
      const result = await createWebhookSource({
        name: name.trim(),
        default_pipeline: pipeline,
        default_stage: stage,
        field_mapping: mapping,
        tag_rules: tagRules.filter((r) => r.field && r.tag),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCreated(result.data);
      toast.success('Integração criada e ativada');
    });
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiado`);
    } catch {
      toast.error('Não foi possível copiar');
    }
  }

  const webhookUrl = created
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/receive/${created.slug}`
    : '';

  return (
    <Modal
      open={open}
      onClose={handleClose}
      maxWidthClassName="max-w-3xl"
      title={created ? 'Integração pronta 🎉' : 'Nova integração'}
    >
      {!created && (
        <ol className="mb-5 flex items-center gap-2 text-xs">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full font-semibold',
                  i === step
                    ? 'bg-brand-700 text-canvas'
                    : i < step
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-brand-100 text-brand-400',
                )}
              >
                {i < step ? '✓' : i + 1}
              </span>
              <span className={cn(i === step ? 'font-medium text-brand-700' : 'text-brand-400')}>
                {label}
              </span>
              {i < STEPS.length - 1 && <span className="text-brand-200">→</span>}
            </li>
          ))}
        </ol>
      )}

      {/* PASSO 1 */}
      {!created && step === 0 && (
        <div className="flex flex-col gap-4">
          <Input
            label="Nome da integração"
            placeholder="Ex: Meta Ads — Dermatologia"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Select label="Fonte" value={preset} onChange={(e) => setPreset(e.target.value)}>
            {WEBHOOK_SOURCE_PRESETS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Pipeline de destino"
              value={pipeline}
              onChange={(e) => {
                const p = e.target.value as PipelineKind;
                setPipeline(p);
                const first = stages.find((s) => s.pipeline === p);
                if (first) setStage(first.slug);
              }}
            >
              {PIPELINES.map((p) => (
                <option key={p} value={p}>
                  {PIPELINE_LABELS[p]}
                </option>
              ))}
            </Select>
            <Select
              label="Stage de destino"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
            >
              {stagesForPipeline.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}

      {/* PASSO 2 */}
      {!created && step === 1 && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-brand-600">Cole um payload de exemplo</label>
            <textarea
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
              spellCheck={false}
              className="focus-ring h-72 rounded-md border border-brand-200 bg-brand-50/40 p-3 font-mono text-[11px] text-brand-700"
            />
            {payloadObj ? (
              <p className="text-[11px] text-emerald-600">{detected.length} campos detectados</p>
            ) : (
              <p className="text-[11px] text-red-600">JSON inválido</p>
            )}
          </div>

          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
            <label className="text-xs font-medium text-brand-600">Conecte aos campos do lead</label>
            {MAPPABLE_LEAD_FIELDS.map((field) => {
              const rule = mapping[field];
              const selectValue = rule ? ('fixed' in rule ? FIXED_OPTION : rule.from) : '';
              return (
                <div key={field} className="grid grid-cols-[7rem_1fr] items-center gap-2">
                  <span className="truncate text-xs text-brand-500">
                    {MAPPABLE_LEAD_FIELD_LABELS[field]}
                  </span>
                  <div className="flex gap-1">
                    <select
                      value={selectValue}
                      onChange={(e) => setFieldSource(field, e.target.value)}
                      className="focus-ring h-8 min-w-0 flex-1 rounded-md border border-brand-200 bg-white px-2 text-xs text-brand-700"
                    >
                      <option value="">— não mapear</option>
                      {detected.map((path) => (
                        <option key={path} value={path}>
                          {path}
                        </option>
                      ))}
                      <option value={FIXED_OPTION}>✎ valor fixo…</option>
                    </select>
                    {rule && 'fixed' in rule ? (
                      <input
                        value={rule.fixed}
                        onChange={(e) => setFieldFixed(field, e.target.value)}
                        placeholder="valor"
                        className="focus-ring h-8 w-20 rounded-md border border-brand-200 px-2 text-xs"
                      />
                    ) : rule && 'from' in rule ? (
                      <select
                        value={rule.transform ?? 'none'}
                        onChange={(e) => setFieldTransform(field, e.target.value as FieldTransform)}
                        className="focus-ring h-8 w-20 rounded-md border border-brand-200 bg-white px-1 text-[11px] text-brand-600"
                        title="Transformação"
                      >
                        {FIELD_TRANSFORMS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* PASSO 3 */}
      {!created && step === 2 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-brand-600">
              Regras &quot;se campo X (op) Y então tag Z&quot;
            </p>
            <Button size="sm" variant="secondary" onClick={addRule}>
              + Regra
            </Button>
          </div>

          {tagRules.length === 0 && (
            <p className="rounded-md border border-dashed border-brand-200 px-3 py-6 text-center text-xs text-brand-400">
              Nenhuma regra. As tags da campanha ([SD], tema…) já são geradas automaticamente.
            </p>
          )}

          <div className="flex flex-col gap-2">
            {tagRules.map((rule, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_6rem_1fr_1fr_2rem] items-center gap-2">
                <select
                  value={rule.field}
                  onChange={(e) => updateRule(idx, { field: e.target.value })}
                  className="focus-ring h-8 rounded-md border border-brand-200 bg-white px-2 text-xs text-brand-700"
                >
                  <option value="">campo…</option>
                  {detected.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <select
                  value={rule.op}
                  onChange={(e) => updateRule(idx, { op: e.target.value as TagRuleOp })}
                  className="focus-ring h-8 rounded-md border border-brand-200 bg-white px-1 text-xs text-brand-700"
                >
                  {TAG_RULE_OPS.map((op) => (
                    <option key={op} value={op}>
                      {TAG_RULE_OP_LABELS[op]}
                    </option>
                  ))}
                </select>
                <input
                  value={rule.value}
                  onChange={(e) => updateRule(idx, { value: e.target.value })}
                  placeholder="valor"
                  disabled={rule.op === 'exists'}
                  className="focus-ring h-8 rounded-md border border-brand-200 px-2 text-xs disabled:bg-brand-50"
                />
                <input
                  value={rule.tag}
                  onChange={(e) => updateRule(idx, { tag: e.target.value })}
                  placeholder="tag"
                  className="focus-ring h-8 rounded-md border border-brand-200 px-2 text-xs"
                />
                <button
                  type="button"
                  onClick={() => removeRule(idx)}
                  className="focus-ring h-8 rounded-md text-brand-400 hover:bg-brand-100"
                  aria-label="Remover regra"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="rounded-md bg-brand-50 px-3 py-2">
            <p className="text-[11px] font-medium text-brand-500">Tags geradas (preview):</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {preview && preview.tags.length > 0 ? (
                preview.tags.map((t) => (
                  <Badge key={t} tone="info">
                    {t}
                  </Badge>
                ))
              ) : (
                <span className="text-[11px] text-brand-400">nenhuma tag</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PASSO 4 — antes de criar */}
      {!created && step === 3 && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-brand-600">
            Revise o resultado do mapeamento sobre o payload de teste e crie a integração.
          </p>
          <div className="rounded-md border border-brand-100 bg-brand-50/50 p-3">
            <p className="text-[11px] font-medium text-brand-500">Lead que seria criado:</p>
            {preview ? (
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {Object.entries({ ...preview.values, ...preview.numbers }).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-brand-400">{k}</dt>
                    <dd className="truncate font-medium text-brand-700">{String(v)}</dd>
                  </div>
                ))}
                {preview.adCreative && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-brand-400">ad_creative</dt>
                    <dd className="font-medium text-brand-700">{preview.adCreative}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="mt-2 text-xs text-red-600">Payload de teste inválido</p>
            )}
            {preview && preview.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {preview.tags.map((t) => (
                  <Badge key={t} tone="info">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PASSO 4 — depois de criar */}
      {created && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-brand-600">
            Use a URL e o secret abaixo na sua fonte externa. O secret vai no header{' '}
            <code className="text-xs">X-Webhook-Secret</code> (ou no campo <code>secret</code> do
            body).
          </p>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-brand-600">URL do webhook</label>
            <div className="flex gap-2">
              <input
                readOnly
                value={webhookUrl}
                className="focus-ring h-9 flex-1 rounded-md border border-brand-200 bg-brand-50/50 px-2 font-mono text-[11px] text-brand-700"
              />
              <Button size="sm" variant="secondary" onClick={() => copy(webhookUrl, 'URL')}>
                Copiar
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-brand-600">Secret</label>
            <div className="flex gap-2">
              <input
                readOnly
                value={created.secret}
                className="focus-ring h-9 flex-1 rounded-md border border-brand-200 bg-brand-50/50 px-2 font-mono text-[11px] text-brand-700"
              />
              <Button size="sm" variant="secondary" onClick={() => copy(created.secret, 'Secret')}>
                Copiar
              </Button>
            </div>
          </div>
          <p className="rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            Guarde o secret agora — por segurança ele não é exibido novamente em texto puro nas
            telas de listagem.
          </p>
        </div>
      )}

      {/* Navegação */}
      <footer className="mt-6 flex items-center justify-between border-t border-brand-100 pt-4">
        {created ? (
          <Button
            className="ml-auto"
            onClick={() => {
              onCreated();
              reset();
            }}
          >
            Concluir
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              onClick={() => (step === 0 ? handleClose() : setStep((s) => s - 1))}
            >
              {step === 0 ? 'Cancelar' : 'Voltar'}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button
                onClick={() => setStep((s) => s + 1)}
                disabled={step === 0 && name.trim().length < 2}
              >
                Próximo
              </Button>
            ) : (
              <Button onClick={handleCreate} disabled={isPending}>
                {isPending ? 'Criando…' : 'Criar e ativar'}
              </Button>
            )}
          </>
        )}
      </footer>
    </Modal>
  );
}

'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS } from '@/types/lead';
import { firstNameOf } from '@/lib/utils/format';
import { AUTO_LEAD_NAME_VARIABLE, type MessageTemplate } from '@/types/chat';

/** Valor sentinela do select de produto: revela o campo de texto livre. */
const CUSTOM_OPTION = '__custom__';

interface TemplateSendModalProps {
  open: boolean;
  onClose: () => void;
  /** Template com variáveis a preencher (null enquanto fechado). */
  template: MessageTemplate | null;
  /** Nome do lead da conversa — pré-preenche a variável {{nome}}. */
  leadName?: string | null;
  /** Conversa é da instância oficial? (muda o aviso de como o envio sai). */
  isOfficial: boolean;
  /** Dispara o envio; devolve true se saiu (o modal fecha). */
  onSend: (templateId: string, values: Record<string, string>) => Promise<boolean>;
}

/**
 * Modal de envio de template com variáveis (ex.: follow-up "Posso seguir aqui
 * com a {{produto}} ?"). A variável `produto` é preenchida
 * selecionando um produto do catálogo ou escrevendo manualmente; as demais
 * variáveis (futuras) viram campos de texto. Mostra o preview exato antes de
 * disparar.
 */
export function TemplateSendModal({
  open,
  onClose,
  template,
  leadName,
  isOfficial,
  onSend,
}: TemplateSendModalProps) {
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>({});
  // Por variável 'nivel': escolha do select ('' | rótulo | CUSTOM_OPTION).
  const [levelChoice, setLevelChoice] = useState('');

  const hasLeadNameVar = template?.variables.includes(AUTO_LEAD_NAME_VARIABLE) ?? false;

  // Reset ao abrir — {{nome}} já entra com o primeiro nome do responsável.
  useEffect(() => {
    if (!open) return;
    const first = hasLeadNameVar ? firstNameOf(leadName) : null;
    setValues(first ? { [AUTO_LEAD_NAME_VARIABLE]: first } : {});
    setLevelChoice('');
  }, [open, hasLeadNameVar, leadName]);

  const preview = useMemo(() => {
    if (!template) return '';
    let text = template.content;
    for (const v of template.variables) {
      const value = values[v]?.trim();
      text = text.split(`{{${v}}}`).join(value || `⟨${v}⟩`);
    }
    return text;
  }, [template, values]);

  if (!template) return null;

  const allFilled = template.variables.every((v) => (values[v] ?? '').trim().length > 0);

  function setValue(variable: string, value: string) {
    setValues((prev) => ({ ...prev, [variable]: value }));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!template || !allFilled) return;
    startTransition(async () => {
      const sent = await onSend(template.id, values);
      if (sent) onClose();
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={template.name} maxWidthClassName="max-w-md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {template.variables.map((variable) =>
          variable === 'nivel' ? (
            <div key={variable} className="flex flex-col gap-2">
              <Select
                label="Nível de ensino *"
                value={levelChoice}
                onChange={(e) => {
                  const choice = e.target.value;
                  setLevelChoice(choice);
                  setValue('nivel', choice === CUSTOM_OPTION ? '' : choice);
                }}
                autoFocus
              >
                <option value="">Selecione o nível…</option>
                {EDUCATION_LEVELS.map((level) => (
                  <option key={level} value={EDUCATION_LEVEL_LABELS[level]}>
                    {EDUCATION_LEVEL_LABELS[level]}
                  </option>
                ))}
                <option value={CUSTOM_OPTION}>Escrever manualmente…</option>
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
          {isOfficial && template.meta_template_name
            ? 'Sai como template oficial aprovado na Meta — entrega mesmo fora da janela de 24h.'
            : 'Sai como mensagem de texto comum pela instância desta conversa.'}
        </p>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending || !allFilled}>
            {isPending ? 'Enviando…' : 'Enviar'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

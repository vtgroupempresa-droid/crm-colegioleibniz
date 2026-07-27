'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { updateLead } from '@/actions/leads';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { labelForField } from '@/lib/leads/validators';
import {
  EDUCATION_LEVELS,
  EDUCATION_LEVEL_LABELS,
  INTEREST_LEVELS,
  INTEREST_LEVEL_LABELS,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  SCHOOL_YEARS_BY_LEVEL,
  type EducationLevel,
  type Lead,
} from '@/types/lead';

interface RequiredFieldsModalProps {
  open: boolean;
  onClose: () => void;
  lead: Lead | null;
  missing: readonly string[];
  targetStageName: string;
  /** Chamada quando o lead foi atualizado com sucesso para todos os campos faltantes. */
  onCompleted: () => void;
}

/**
 * Modal invocado pelo Kanban quando o drop em um stage falha por falta de
 * campos obrigatórios. Permite preencher só os faltantes — quando todos são
 * preenchidos com sucesso, fecha e dispara o callback para o board mover o card.
 */
export function RequiredFieldsModal({
  open,
  onClose,
  lead,
  missing,
  targetStageName,
  onCompleted,
}: RequiredFieldsModalProps) {
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>({});

  if (!lead) return null;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!lead) return;

    const payload: Record<string, unknown> = {};
    for (const field of missing) {
      const raw = values[field];
      if (raw === undefined || raw === '') continue;

      if (field === 'child_age') {
        const num = Number(raw);
        if (!Number.isNaN(num)) payload[field] = num;
      } else if (field === 'with_child') {
        payload[field] = raw === 'sim';
      } else {
        payload[field] = raw;
      }
    }

    startTransition(async () => {
      const result = await updateLead(lead.id, payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Campos preenchidos');
      onCompleted();
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Mover para "${targetStageName}" — campos obrigatórios`}
      maxWidthClassName="max-w-lg"
    >
      <p className="mb-4 text-sm text-brand-500">
        Para mover este lead, preencha primeiro:
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {missing.map((field) => (
          <RequiredFieldInput
            key={field}
            field={field}
            value={values[field] ?? ''}
            onChange={(v) => setValues((prev) => ({ ...prev, [field]: v }))}
            lead={lead}
          />
        ))}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Salvando...' : 'Salvar e mover'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface RequiredFieldInputProps {
  field: string;
  value: string;
  onChange: (value: string) => void;
  /** Contexto do lead — o ano escolar depende do nível de ensino já cadastrado. */
  lead: Lead | null;
}

function RequiredFieldInput({ field, value, onChange, lead }: RequiredFieldInputProps) {
  const label = labelForField(field);

  if (field === 'interest_level') {
    return (
      <Select label={label} value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Selecione...</option>
        {INTEREST_LEVELS.map((level) => (
          <option key={level} value={level}>
            {INTEREST_LEVEL_LABELS[level]}
          </option>
        ))}
      </Select>
    );
  }

  if (field === 'education_level') {
    return (
      <Select label={label} value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Selecione...</option>
        {EDUCATION_LEVELS.map((level) => (
          <option key={level} value={level}>
            {EDUCATION_LEVEL_LABELS[level]}
          </option>
        ))}
      </Select>
    );
  }

  if (field === 'school_year') {
    // O nível já cadastrado no lead define os anos possíveis; sem nível,
    // oferece a lista completa para não travar o preenchimento.
    const level = lead?.education_level as EducationLevel | null;
    const options = level
      ? SCHOOL_YEARS_BY_LEVEL[level]
      : EDUCATION_LEVELS.flatMap((l) => SCHOOL_YEARS_BY_LEVEL[l]);
    return (
      <Select label={label} value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Selecione...</option>
        {options.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </Select>
    );
  }

  if (field === 'with_child') {
    return (
      <Select label={label} value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Selecione...</option>
        <option value="sim">Sim, veio com o filho</option>
        <option value="nao">Não</option>
      </Select>
    );
  }

  if (field === 'source') {
    return (
      <Select label={label} value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Selecione...</option>
        {LEAD_SOURCES.map((source) => (
          <option key={source} value={source}>
            {LEAD_SOURCE_LABELS[source]}
          </option>
        ))}
      </Select>
    );
  }

  if (field === 'child_age') {
    return (
      <Input
        label={label}
        type="number"
        min={0}
        max={25}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
    );
  }

  return (
    <Input label={label} value={value} onChange={(e) => onChange(e.target.value)} required />
  );
}

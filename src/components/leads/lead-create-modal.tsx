'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createLead } from '@/actions/leads';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import {
  EDUCATION_LEVELS,
  EDUCATION_LEVEL_LABELS,
  INTEREST_LEVELS,
  INTEREST_LEVEL_LABELS,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  SCHOOL_YEARS_BY_LEVEL,
  type EducationLevel,
  type InterestLevel,
  type LeadSource,
} from '@/types/lead';

interface LeadCreateModalProps {
  open: boolean;
  onClose: () => void;
}

const INITIAL = {
  name: '',
  phone: '',
  source: '' as LeadSource | '',
  email: '',
  instagram: '',
  city: '',
  state: '',
  interest_level: '' as InterestLevel | '',
  with_child: false,
  child_name: '',
  child_age: '',
  education_level: '' as EducationLevel | '',
  school_year: '',
};

export function LeadCreateModal({ open, onClose }: LeadCreateModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState(INITIAL);

  function set<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const schoolYears = form.education_level ? SCHOOL_YEARS_BY_LEVEL[form.education_level] : [];

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.source) {
      toast.error('Selecione uma origem');
      return;
    }

    const payload = {
      name: form.name,
      phone: form.phone,
      source: form.source,
      email: form.email || null,
      instagram: form.instagram || null,
      city: form.city || null,
      state: form.state || null,
      interest_level: form.interest_level || null,
      with_child: form.with_child,
      child_name: form.child_name || null,
      child_age: form.child_age ? Number(form.child_age) : null,
      education_level: form.education_level || null,
      school_year: form.school_year || null,
    };

    startTransition(async () => {
      const result = await createLead(payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data.name} criado`);
      setForm(INITIAL);
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Novo lead" maxWidthClassName="max-w-2xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Nome do responsável *"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            required
            minLength={2}
          />
          <Input
            label="Telefone *"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            required
          />
          <Select
            label="Origem *"
            value={form.source}
            onChange={(e) => set('source', e.target.value as LeadSource | '')}
            required
          >
            <option value="">Selecione...</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {LEAD_SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select
            label="Nível de interesse"
            value={form.interest_level}
            onChange={(e) => set('interest_level', e.target.value as InterestLevel | '')}
          >
            <option value="">—</option>
            {INTEREST_LEVELS.map((l) => (
              <option key={l} value={l}>
                {INTEREST_LEVEL_LABELS[l]}
              </option>
            ))}
          </Select>
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
          />
          <Input
            label="Instagram"
            value={form.instagram}
            onChange={(e) => set('instagram', e.target.value)}
          />
          <Input label="Cidade" value={form.city} onChange={(e) => set('city', e.target.value)} />
          <Input label="Estado" value={form.state} onChange={(e) => set('state', e.target.value)} />
        </div>

        <fieldset className="rounded-md border border-brand-100 p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-brand-500">
            Aluno
          </legend>
          <label className="mb-3 flex items-center gap-2 text-sm text-brand-700">
            <input
              type="checkbox"
              checked={form.with_child}
              onChange={(e) => set('with_child', e.target.checked)}
              className="focus-ring h-4 w-4 rounded border-brand-200"
            />
            Entra com o filho
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Nome do filho/aluno"
              value={form.child_name}
              onChange={(e) => set('child_name', e.target.value)}
            />
            <Input
              label="Idade do filho"
              type="number"
              min={0}
              max={25}
              value={form.child_age}
              onChange={(e) => set('child_age', e.target.value)}
            />
            <Select
              label="Nível de ensino"
              value={form.education_level}
              onChange={(e) => {
                set('education_level', e.target.value as EducationLevel | '');
                set('school_year', '');
              }}
            >
              <option value="">—</option>
              {EDUCATION_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {EDUCATION_LEVEL_LABELS[l]}
                </option>
              ))}
            </Select>
            <Select
              label="Ano escolar"
              value={form.school_year}
              onChange={(e) => set('school_year', e.target.value)}
              disabled={!form.education_level}
            >
              <option value="">—</option>
              {schoolYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
        </fieldset>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Criando...' : 'Criar lead'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

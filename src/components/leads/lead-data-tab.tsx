'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { updateLead, listAssignableUsers } from '@/actions/leads';
import type { AssignableUser, LeadDealSummary } from '@/actions/leads-queries';
import { FollowUpTracker } from '@/components/leads/follow-up-tracker';
import { LeadOriginSection } from '@/components/leads/lead-origin-section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatBRL, formatDate } from '@/lib/utils/format';
import {
  EDUCATION_LEVEL_LABELS,
  EDUCATION_LEVELS,
  INTEREST_LEVEL_LABELS,
  INTEREST_LEVELS,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  SCHOOL_YEARS_BY_LEVEL,
  parseMetaLeadEntries,
  type Activity,
  type Appointment,
  type EducationLevel,
  type Lead,
} from '@/types/lead';
import { USER_ROLE_LABELS, type UserRole } from '@/types/user';

interface LeadDataTabProps {
  lead: Lead;
  activities?: readonly Activity[];
  appointments?: readonly Appointment[];
  hasDeal?: boolean;
  deals?: readonly LeadDealSummary[];
  /** Papel de quem vê (admin edita tudo; comercial opera normalmente). */
  viewerRole?: string | null;
  /** Recarrega o lead no drawer após salvar (mudanças aparecem na hora). */
  onMutated?: () => void | Promise<void>;
}

/**
 * Calcula a data-base do follow-up: data da visita mais recente que aconteceu
 * (showed_up=true), ou criação do lead como fallback.
 */
function pickFollowUpReference(appointments: readonly Appointment[], fallback: string): string {
  const done = appointments
    .filter((a) => a.showed_up === true)
    .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime());
  return done[0]?.scheduled_at ?? fallback;
}

export function LeadDataTab({
  lead,
  activities = [],
  appointments = [],
  hasDeal = false,
  deals = [],
  viewerRole = null,
  onMutated,
}: LeadDataTabProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [users, setUsers] = useState<AssignableUser[]>([]);
  void hasDeal;
  void viewerRole;

  // Lista de responsáveis (equipe comercial) para o select "Responsável".
  useEffect(() => {
    listAssignableUsers().then(setUsers);
  }, []);

  const [form, setForm] = useState({
    name: lead.name,
    phone: lead.phone ?? '',
    email: lead.email ?? '',
    instagram: lead.instagram ?? '',
    city: lead.city ?? '',
    state: lead.state ?? '',
    interest_level: lead.interest_level ?? '',
    with_child: lead.with_child ?? false,
    child_name: lead.child_name ?? '',
    child_age: lead.child_age?.toString() ?? '',
    budget: lead.budget?.toString() ?? '',
    education_level: lead.education_level ?? '',
    school_year: lead.school_year ?? '',
    source: lead.source ?? '',
    assigned_to: lead.assigned_to ?? '',
  });

  function set<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  // Anos escolares disponíveis conforme o nível de ensino escolhido.
  const schoolYears = form.education_level
    ? SCHOOL_YEARS_BY_LEVEL[form.education_level as EducationLevel]
    : [];

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const payload = {
      name: form.name,
      phone: form.phone || null,
      email: form.email || null,
      instagram: form.instagram || null,
      city: form.city || null,
      state: form.state || null,
      interest_level: form.interest_level || null,
      with_child: form.with_child,
      child_name: form.child_name || null,
      child_age: form.child_age ? Number(form.child_age) : null,
      budget: form.budget ? Number(form.budget) : null,
      education_level: form.education_level || null,
      school_year: form.school_year || null,
      source: form.source || undefined,
      assigned_to: form.assigned_to || null,
    };

    startTransition(async () => {
      const result = await updateLead(lead.id, payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Dados da família atualizados');
      await onMutated?.();
      router.refresh();
    });
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex items-center justify-between rounded-md border border-brand-100 bg-white px-3 py-2">
          <p className="text-xs text-brand-400">Etapa atual da matrícula</p>
          <p className="text-sm font-medium text-brand-700">
            {lead.pipeline === 'comercial'
              ? 'Jornada de matrícula'
              : 'Acompanhamento pós-matrícula'}{' '}
            · {lead.stage.replaceAll('_', ' ')}
          </p>
        </div>

        <LeadOriginSection
          lead={lead}
          entries={parseMetaLeadEntries(lead.meta_entries)}
          activities={activities}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Nome do responsável"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            required
          />
          <Input
            label="Telefone"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
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
          <Select
            label="Momento de decisão"
            value={form.interest_level}
            onChange={(e) => set('interest_level', e.target.value)}
          >
            <option value="">—</option>
            {INTEREST_LEVELS.map((l) => (
              <option key={l} value={l}>
                {INTEREST_LEVEL_LABELS[l]}
              </option>
            ))}
          </Select>
          <Select
            label="Origem"
            value={form.source}
            onChange={(e) => set('source', e.target.value)}
          >
            <option value="">—</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {LEAD_SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
          <Input
          label="Orçamento da família (R$)"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
          value={form.budget}
          onChange={(e) => set('budget', e.target.value)}
            placeholder="Ex.: 2500"
          />
        </div>

        <fieldset className="rounded-md border border-brand-100 bg-white p-3">
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
                // Trocar o nível zera o ano escolar (as opções mudam).
                set('education_level', e.target.value);
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

        <Select
          label="Atendente responsável"
          value={form.assigned_to}
          onChange={(e) => set('assigned_to', e.target.value)}
        >
          <option value="">Ainda sem atendente</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({USER_ROLE_LABELS[u.role as UserRole] ?? u.role})
            </option>
          ))}
        </Select>

        {lead.pipeline === 'comercial' && (
          <FollowUpTracker
            leadId={lead.id}
            activities={activities}
            referenceDate={pickFollowUpReference(appointments, lead.created_at)}
          />
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Salvando...' : 'Salvar alterações'}
          </Button>
        </div>
      </form>

      {deals.length > 0 && (
        <section className="mt-4 rounded-md border border-brand-100 bg-white p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
              Matrículas
            </h4>
            <p className="text-xs text-brand-500">
              Total:{' '}
              <strong>{formatBRL(deals.reduce((sum, d) => sum + d.contract_value, 0))}</strong>
            </p>
          </div>
          <ul className="mt-3 divide-y divide-brand-100">
            {deals.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0" title={d.notes ?? undefined}>
                  <p className="truncate text-sm font-medium text-brand-700">
                    {d.student_name ?? lead.child_name ?? 'Aluno não informado'}
                    {d.school_year ? ` · ${d.school_year}` : ''}
                  </p>
                  <p className="text-xs text-brand-400">
                    {formatDate(d.signed_at)}
                    {d.enrollment_year ? ` · Ano letivo ${d.enrollment_year}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-medium text-brand-700">
                    {formatBRL(d.contract_value)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      d.sale_status === 'cancelada'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    {d.sale_status === 'cancelada' ? 'Cancelada' : 'Ativa'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { confirmAppointment, createAppointment, markNoShow } from '@/actions/appointments';
import { getGoogleCalendarStatus } from '@/actions/google-calendar';
import { listTeamMembers } from '@/actions/appointments';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatDateTime, formatRelative } from '@/lib/utils/format';
import { AppointmentEditModal } from '@/components/kanban/appointment-edit-modal';
import type { Appointment } from '@/types/lead';

interface CloserOption {
  id: string;
  name: string;
}

interface LeadAppointmentsTabProps {
  leadId: string;
  appointments: readonly Appointment[];
  /** Recarrega o lead no drawer após criar/confirmar/no-show (reflete na hora). */
  onMutated?: () => void | Promise<void>;
}

export function LeadAppointmentsTab({
  leadId,
  appointments,
  onMutated,
}: LeadAppointmentsTabProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [editApptId, setEditApptId] = useState<string | null>(null);
  const [closers, setClosers] = useState<CloserOption[]>([]);
  const [sdrs, setSdrs] = useState<{ id: string; name: string }[]>([]);
  const [sdrNameById, setSdrNameById] = useState<Map<string, string>>(new Map());
  const [form, setForm] = useState({
    scheduledAt: '',
    closerId: '',
    sdrId: '',
    meetingLink: '',
    notes: '',
  });
  const [googleConnected, setGoogleConnected] = useState(false);
  const [generateMeet, setGenerateMeet] = useState(true);

  // Equipe — alimenta o select de atendente e o mapa id→nome exibido em cada
  // visita (RLS-safe via RPC list_salespeople).
  useEffect(() => {
    listTeamMembers()
      .then((people) => {
        setSdrs(people.map((p) => ({ id: p.id, name: p.name })));
        setSdrNameById(new Map(people.map((p) => [p.id, p.name])));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!showForm) return;
    fetch('/api/closers')
      .then((r) => r.json())
      .then((data: { closers: CloserOption[] }) => setClosers(data.closers ?? []))
      .catch(() => setClosers([]));
    getGoogleCalendarStatus()
      .then((s) => setGoogleConnected(s.connected))
      .catch(() => setGoogleConnected(false));
  }, [showForm]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.scheduledAt) {
      toast.error('Informe a data e hora');
      return;
    }
    if (!form.closerId) {
      toast.error('Selecione o closer responsável');
      return;
    }
    startTransition(async () => {
      const iso = new Date(form.scheduledAt).toISOString();
      const result = await createAppointment({
        leadId,
        closerId: form.closerId,
        sdrId: form.sdrId || null,
        scheduledAt: iso,
        meetingLink: form.meetingLink || null,
        notes: form.notes || null,
        generateMeetLink: googleConnected && generateMeet,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Agendamento criado · lead movido para Closers');
      if (result.data.meetLink) {
        toast.success(
          result.data.inviteSkipped
            ? 'Link do Meet gerado · lead sem e-mail, convite não enviado'
            : 'Link do Meet gerado · convite enviado ao lead',
        );
      } else if (result.data.googleFailed) {
        toast.warning('Agendado, mas falhou ao criar o evento no Google Calendar');
      }
      setForm({ scheduledAt: '', closerId: '', sdrId: '', meetingLink: '', notes: '' });
      setShowForm(false);
      await onMutated?.();
      router.refresh();
    });
  }

  function handleConfirm(appointmentId: string) {
    startTransition(async () => {
      const result = await confirmAppointment(appointmentId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Agendamento confirmado');
      await onMutated?.();
      router.refresh();
    });
  }

  function handleNoShow(appointmentId: string) {
    if (!confirm('Marcar no-show? O lead voltará para o SDR (stage no_show) e perderá 15pts.'))
      return;
    startTransition(async () => {
      const result = await markNoShow(appointmentId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('No-show registrado · lead devolvido ao SDR');
      await onMutated?.();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant={showForm ? 'ghost' : 'primary'}
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? 'Cancelar' : 'Novo agendamento'}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 rounded-md border border-brand-100 bg-white p-3"
        >
          <Select
            label="Closer responsável"
            value={form.closerId}
            onChange={(e) => setForm((f) => ({ ...f, closerId: e.target.value }))}
            required
          >
            <option value="">Selecione...</option>
            {closers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            label="SDR responsável"
            value={form.sdrId}
            onChange={(e) => setForm((f) => ({ ...f, sdrId: e.target.value }))}
          >
            <option value="">— sem SDR</option>
            {sdrs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Input
            label="Data e hora"
            type="datetime-local"
            value={form.scheduledAt}
            onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
            required
          />
          {googleConnected && (
            <label className="flex items-center gap-2 text-sm text-brand-600">
              <input
                type="checkbox"
                checked={generateMeet}
                onChange={(e) => setGenerateMeet(e.target.checked)}
                className="h-4 w-4 rounded border-brand-300"
              />
              Gerar link do Google Meet e convidar o lead por e-mail
            </label>
          )}
          {(!googleConnected || !generateMeet) && (
            <Input
              label="Link da reunião"
              type="url"
              value={form.meetingLink}
              onChange={(e) => setForm((f) => ({ ...f, meetingLink: e.target.value }))}
              placeholder="https://meet.google.com/..."
            />
          )}
          <Textarea
            label="Notas"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </form>
      )}

      <ul className="flex flex-col gap-2">
        {appointments.length === 0 && (
          <li className="text-sm text-brand-400">Sem agendamentos ainda.</li>
        )}
        {appointments.map((appt) => {
          const isPast = new Date(appt.scheduled_at).getTime() < Date.now();
          const isOpen = appt.showed_up === null;
          return (
            <li key={appt.id} className="rounded-md border border-brand-100 bg-white p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-brand-700">
                  {formatDateTime(appt.scheduled_at)}
                </p>
                <span className="text-[11px] text-brand-400">
                  {formatRelative(appt.scheduled_at)}
                </span>
              </div>
              {appt.assigned_to && (
                <p className="mt-1 text-xs text-brand-500">
                  Atende:{' '}
                  <span className="font-medium">{sdrNameById.get(appt.assigned_to) ?? '—'}</span>
                </p>
              )}
              {appt.meeting_link && (
                <a
                  href={appt.meeting_link}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-xs text-sky-700 underline"
                >
                  {appt.meeting_link}
                </a>
              )}
              {appt.notes && <p className="mt-1 text-xs text-brand-500">{appt.notes}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {appt.confirmed && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700">
                    Confirmado
                  </span>
                )}
                {appt.showed_up === false && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] text-red-700">
                    No-show
                  </span>
                )}
                {appt.no_show_recovered && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">
                    Recuperado
                  </span>
                )}
                {isOpen && !appt.confirmed && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleConfirm(appt.id)}
                    disabled={isPending}
                  >
                    Confirmar
                  </Button>
                )}
                {isOpen && isPast && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleNoShow(appt.id)}
                    disabled={isPending}
                  >
                    Marcar no-show
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditApptId(appt.id)}
                  disabled={isPending}
                >
                  Editar
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <AppointmentEditModal
        open={editApptId !== null}
        onClose={() => setEditApptId(null)}
        appointmentId={editApptId}
        onSaved={onMutated}
      />
    </div>
  );
}

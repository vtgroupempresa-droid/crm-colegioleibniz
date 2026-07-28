'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { listTeamMembers, type TeamMember } from '@/actions/appointments';
import { getAppointment, updateAppointment } from '@/actions/appointments';
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS_LABELS,
  type AppointmentStatus,
} from '@/types/appointment';

/** ISO (UTC) → valor de `<input type="datetime-local">` no fuso local. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface AppointmentEditModalProps {
  open: boolean;
  onClose: () => void;
  appointmentId: string | null;
  onSaved?: () => void | Promise<void>;
}

/** Modal de edição de agendamento (data/closer/SDR/link/obs/status). */
export function AppointmentEditModal({
  open,
  onClose,
  appointmentId,
  onSaved,
}: AppointmentEditModalProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [people, setPeople] = useState<TeamMember[]>([]);
  const [assignedToId, setAssignedToId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<AppointmentStatus>('agendado');

  useEffect(() => {
    if (!open || !appointmentId) return;
    setLoading(true);
    void Promise.all([getAppointment(appointmentId), listTeamMembers()]).then(([apt, ppl]) => {
      setPeople(ppl);
      if (apt) {
        setAssignedToId(apt.assignedToId ?? '');
        setScheduledAt(toLocalInput(apt.scheduledAt));
        setMeetingLink(apt.meetingLink ?? '');
        setNotes(apt.notes ?? '');
        setStatus(apt.status);
      }
      setLoading(false);
    });
  }, [open, appointmentId]);



  function save() {
    if (!appointmentId) return;
    if (!assignedToId) {
      toast.error('Selecione quem vai atender a visita.');
      return;
    }
    if (!scheduledAt) {
      toast.error('Informe a data e hora.');
      return;
    }
    startTransition(async () => {
      const res = await updateAppointment(appointmentId, {
        scheduledAt: new Date(scheduledAt).toISOString(),
        assignedToId,
        meetingLink: meetingLink || null,
        notes: notes.trim() || null,
        status,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Visita atualizada.');
      router.refresh();
      await onSaved?.();
      onClose();
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Editar visita" maxWidthClassName="max-w-md">
      {loading ? (
        <p className="py-6 text-center text-sm text-brand-400">Carregando…</p>
      ) : (
        <div className="flex flex-col gap-3">
          <Input
            label="Data e hora"
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
          <Select
            label="Quem vai atender"
            value={assignedToId}
            onChange={(e) => setAssignedToId(e.target.value)}
          >
            <option value="">Selecione…</option>
            {people.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
          <Input
            label="Link da reunião (opcional)"
            type="url"
            value={meetingLink}
            onChange={(e) => setMeetingLink(e.target.value)}
            placeholder="https://…"
          />
          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as AppointmentStatus)}
          >
            {APPOINTMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {APPOINTMENT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Textarea
            label="Observações"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
          <p className="text-xs text-brand-400">
            Se o agendamento estiver sincronizado com o Google Calendar, alterações de data/hora
            atualizam o evento e reenviam o convite ao lead; cancelar remove o evento da agenda.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="button" onClick={save} disabled={isPending}>
              {isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

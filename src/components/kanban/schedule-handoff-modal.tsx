'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createAppointment, listTeamMembers, type TeamMember } from '@/actions/appointments';
import { getGoogleCalendarStatus } from '@/actions/google-calendar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface ScheduleVisitModalProps {
  open: boolean;
  onClose: () => void;
  leadId: string;
  leadName: string;
  /** Disparado quando o modal é fechado SEM salvar (X / cancelar / Esc). */
  onCancel?: () => void;
}

/**
 * Modal de agendamento da VISITA PRESENCIAL. É um passo obrigatório: o lead só
 * entra na etapa "Visita Presencial" depois que a visita é salva. Aberto
 * automaticamente quando o lead é arrastado para a etapa ou quando uma
 * tentativa de contato tem desfecho "Agendou".
 */
export function ScheduleHandoffModal({
  open,
  onClose,
  leadId,
  leadName,
  onCancel,
}: ScheduleVisitModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [assignedToId, setAssignedToId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [notes, setNotes] = useState('');
  const [googleConnected, setGoogleConnected] = useState(false);
  const [addToCalendar, setAddToCalendar] = useState(true);

  useEffect(() => {
    if (!open) return;
    getGoogleCalendarStatus()
      .then((s) => setGoogleConnected(s.connected))
      .catch(() => setGoogleConnected(false));
    setLoading(true);
    listTeamMembers()
      .then(setTeam)
      .finally(() => setLoading(false));
  }, [open, leadId]);

  function reset() {
    setAssignedToId('');
    setScheduledAt('');
    setNotes('');
  }

  /** Fechar sem salvar: o lead NÃO avança — avisa o caller (toast no board). */
  function handleCancel() {
    if (isPending) return;
    onCancel?.();
    onClose();
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!assignedToId) {
      toast.error('Selecione quem vai atender a família');
      return;
    }
    if (!scheduledAt) {
      toast.error('Informe data e hora da visita');
      return;
    }
    startTransition(async () => {
      const iso = new Date(scheduledAt).toISOString();
      const result = await createAppointment({
        leadId,
        assignedToId,
        scheduledAt: iso,
        meetingLink: null,
        notes: notes.trim() || null,
        generateMeetLink: googleConnected && addToCalendar,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Visita agendada · lead movido para Visita Presencial');
      if (result.data.googleFailed) {
        toast.warning('Visita salva, mas falhou ao criar o evento no Google Calendar');
      }
      reset();
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title={
        <span>
          Agendar visita presencial
          <span className="block text-xs font-normal text-brand-400">{leadName}</span>
        </span>
      }
      closeHint="O lead não será movido se você fechar sem salvar"
      maxWidthClassName="max-w-md"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Preencha os dados da visita para mover o lead. Sem agendamento, o lead
          <strong> não avança</strong>.
        </p>

        <Select
          label="Quem vai atender *"
          value={assignedToId}
          onChange={(e) => setAssignedToId(e.target.value)}
          required
          disabled={loading}
        >
          <option value="">{loading ? 'Carregando...' : 'Selecione o atendente...'}</option>
          {team.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </Select>
        <Input
          label="Data e hora da visita *"
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          required
        />
        {googleConnected && (
          <label className="flex items-center gap-2 text-xs text-brand-600">
            <input
              type="checkbox"
              checked={addToCalendar}
              onChange={(e) => setAddToCalendar(e.target.checked)}
              className="h-4 w-4 accent-brand-600"
            />
            Criar evento no Google Calendar da escola
          </label>
        )}
        <Textarea
          label="Observações"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Quem vem junto, interesse principal, pontos a destacar na visita..."
        />

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={handleCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Salvando...' : 'Agendar visita'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

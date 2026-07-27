/**
 * Status editável do agendamento. Fica fora do arquivo `'use server'`
 * (actions/appointments.ts) porque módulos server só podem exportar funções
 * async — consts/objetos precisam viver aqui (só `next build` pega isso).
 */
export const APPOINTMENT_STATUSES = ['agendado', 'confirmado', 'realizado', 'cancelado'] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  realizado: 'Realizado',
  cancelado: 'Cancelado',
};

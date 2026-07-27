/**
 * Mini-fluxo "Registrar contato" do card do board comercial.
 * Resultados possíveis de uma tentativa de contato com o responsável
 * (pai/mãe) e a próxima ação que a UI deve abrir.
 */

export const SDR_CONTACT_RESULTS = [
  'no_answer',
  'qualifying',
  'call_later',
  'qualified_schedule',
  'no_profile',
] as const;

export type SdrContactResult = (typeof SDR_CONTACT_RESULTS)[number];

export const SDR_CONTACT_RESULT_LABELS: Record<SdrContactResult, string> = {
  no_answer: 'Não atendeu',
  qualifying: 'Em conversa',
  call_later: 'Pediu para falar depois',
  qualified_schedule: 'Quer agendar visita',
  no_profile: 'Sem interesse',
};

/**
 * Próxima ação da UI após registrar o contato:
 *  - 'schedule': abrir o modal de agendamento de visita.
 *  - 'lost': abrir o modal de motivo de perda.
 *  - null: nada a abrir.
 */
export type SdrContactNextAction = 'schedule' | 'lost' | null;

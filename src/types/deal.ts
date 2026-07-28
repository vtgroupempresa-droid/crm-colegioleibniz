/**
 * Resultados possíveis ao registrar o desfecho de uma visita presencial
 * (lead em `visita_presencial`). Cada um aponta para um stage downstream:
 *   send_proposal     → comercial/em_negociacao (família pediu proposta/valores)
 *   schedule_followup → comercial/follow_up (retomar contato depois)
 *   close_now         → mantém o stage; UI abre o modal de matrícula em seguida.
 *
 * Vive aqui (e não em actions/deals.ts) porque arquivos 'use server' só podem
 * exportar funções async — exportar a constante de lá quebra QUALQUER action
 * do arquivo em runtime ("A 'use server' file can only export async functions").
 */
export const CALL_NEXT_ACTIONS = ['send_proposal', 'schedule_followup', 'close_now'] as const;
export type CallNextAction = (typeof CALL_NEXT_ACTIONS)[number];

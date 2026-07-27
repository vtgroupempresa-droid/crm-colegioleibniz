/**
 * Checkpoints da cadência de follow-up do closer (D+1/D+2/D+7/D+15/D+30).
 * Vive aqui (e não em actions/follow-ups.ts) porque arquivos 'use server' só
 * podem exportar funções async — exportar a constante de lá quebra as actions
 * do arquivo em runtime.
 */
export const FOLLOWUP_DAYS = [1, 2, 7, 15, 30] as const;
export type FollowUpDay = (typeof FOLLOWUP_DAYS)[number];

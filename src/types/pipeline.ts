import type { Tables, Enums } from './database';
import type { UserRole } from './user';

export type PipelineKind = Enums<'pipeline_kind'>;
export type PipelineStage = Tables<'pipeline_stages'>;

/**
 * Pipelines operados no board.
 * `comercial` é o funil de matrículas (Novo Lead → Cliente Fechado).
 * `pos_matricula` é o terreno para a integração EasySchool (rematrícula
 * automática) — fica oculto das abas até a integração entrar.
 */
export const PIPELINES: readonly PipelineKind[] = ['comercial', 'pos_matricula'] as const;

export const PIPELINE_LABELS: Record<PipelineKind, string> = {
  comercial: 'Comercial',
  pos_matricula: 'Pós-Matrícula',
};

export function isPipelineKind(value: string): value is PipelineKind {
  return (PIPELINES as readonly string[]).includes(value);
}

/**
 * Pipelines visíveis na tela unificada /oportunidades. Toda a equipe
 * (admin e comercial) opera o board inteiro — a RLS de leads acompanha.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function pipelinesForRole(_role?: UserRole): readonly PipelineKind[] {
  return PIPELINES;
}

import type { PipelineKind } from '@/types/pipeline';

/**
 * Estado vazio por pipeline (Fase 8). Ilustração SVG inline (sem imagem externa)
 * + texto contextual. Sem botão de criar lead — criação só pela tela /leads.
 */
const EMPTY_STATES: Record<PipelineKind, { title: string; description: string }> = {
  comercial: {
    title: 'Nenhum lead no funil ainda',
    description:
      'Assim que uma família entrar em contato pelo Instagram, WhatsApp, telefone ou presencialmente, o lead aparece aqui.',
  },
  pos_matricula: {
    title: 'Nenhum aluno em acompanhamento',
    description:
      'Este funil recebe os alunos matriculados para o acompanhamento de rematrícula (integração EasySchool).',
  },
};

export function PipelineEmptyState({ pipeline }: { pipeline: PipelineKind }) {
  const copy = EMPTY_STATES[pipeline];

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
      <svg
        width="120"
        height="120"
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="mb-6 text-brand-200"
      >
        <rect x="18" y="26" width="84" height="68" rx="8" stroke="currentColor" strokeWidth="3" />
        <line x1="46" y1="26" x2="46" y2="94" stroke="currentColor" strokeWidth="3" />
        <line x1="74" y1="26" x2="74" y2="94" stroke="currentColor" strokeWidth="3" />
        <rect x="26" y="40" width="12" height="14" rx="3" fill="currentColor" opacity="0.5" />
        <rect x="54" y="40" width="12" height="14" rx="3" fill="currentColor" opacity="0.3" />
        <rect x="82" y="40" width="12" height="14" rx="3" fill="currentColor" opacity="0.2" />
      </svg>
      <h3 className="text-base font-semibold text-brand-600">{copy.title}</h3>
      <p className="mt-1 max-w-sm text-sm text-brand-400">{copy.description}</p>
    </div>
  );
}

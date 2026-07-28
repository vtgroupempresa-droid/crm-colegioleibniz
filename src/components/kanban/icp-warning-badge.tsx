'use client';

import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { labelForField } from '@/lib/leads/validators';

interface IcpWarningBadgeProps {
  missingFields: readonly string[];
}

/**
 * Badge âmbar (não vermelho) que aparece quando há campos faltantes para o
 * próximo stage. Substitui o "Bloqueado" da Fase 2 — o SDR continua avançando,
 * mas o aviso visual fica visível.
 */
export function IcpWarningBadge({ missingFields }: IcpWarningBadgeProps) {
  if (missingFields.length === 0) return null;
  const labels = missingFields.map(labelForField).join(', ');
  return (
    <Tooltip content={`Atenção: ${labels} não preenchidos`}>
      <Badge tone="warning">! ICP incompleto</Badge>
    </Tooltip>
  );
}

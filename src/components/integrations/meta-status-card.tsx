import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { MetaWebhookStatus } from '@/lib/meta/status';

/**
 * Card de status operacional da integração Meta (Fase 11) — renderizado no
 * servidor a partir de getMetaWebhookStatus. Mostra cada variável de ambiente,
 * o último evento recebido e o volume de leads das últimas 24h.
 */

function formatDateTime(iso: string | null): string {
  if (!iso) return 'nenhum evento ainda';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function MetaStatusCard({ status }: { status: MetaWebhookStatus }) {
  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium text-brand-700">Status do webhook</p>
        {status.allConfigured ? (
          <Badge tone="success">Tudo configurado</Badge>
        ) : (
          <Badge tone="warning">Configuração incompleta</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        {status.vars.map((v) => (
          <div key={v.key} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-brand-500">{v.label}</span>
            <Badge tone={v.configured ? 'success' : 'warning'}>
              {v.configured ? 'configurada' : 'pendente'}
            </Badge>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-6 border-t border-brand-50 pt-3 text-xs">
        <div className="flex flex-col">
          <span className="text-brand-400">Último evento recebido</span>
          <span className="font-medium text-brand-700">{formatDateTime(status.lastEventAt)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-brand-400">Leads via Meta (24h)</span>
          <span className="font-medium text-brand-700">{status.leads24h}</span>
        </div>
      </div>
    </Card>
  );
}

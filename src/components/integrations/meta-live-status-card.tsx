import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { MetaIntegrationStatus } from '@/lib/meta/status';

/**
 * Card de status ao vivo da integração Meta (Parte 5): página + campos
 * assinados, Instagram Direct, últimos eventos e volumes 24h. Renderizado no
 * servidor a partir de getMetaIntegrationStatus.
 */

function formatDateTime(iso: string | null): string {
  if (!iso) return 'nenhum ainda';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_BADGE: Record<
  'connected' | 'not_configured' | 'error',
  { tone: 'success' | 'warning' | 'danger'; label: string }
> = {
  connected: { tone: 'success', label: 'conectado' },
  not_configured: { tone: 'warning', label: 'não configurado' },
  error: { tone: 'danger', label: 'erro' },
};

export function MetaLiveStatusCard({ status }: { status: MetaIntegrationStatus }) {
  const { page, instagram_direct, last_events, counts_24h } = status;
  const pageBadge = STATUS_BADGE[page.status];
  const igBadge = STATUS_BADGE[instagram_direct.status];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Página + Lead Ads */}
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <p className="font-medium text-brand-700">Página (Lead Ads)</p>
          <Badge tone={pageBadge.tone}>{pageBadge.label}</Badge>
        </div>
        <div className="text-xs text-brand-500">
          <p>
            <span className="text-brand-400">Nome:</span> {page.name ?? '—'}
          </p>
          <p>
            <span className="text-brand-400">ID:</span>{' '}
            <span className="font-mono">{page.id ?? '—'}</span>
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-brand-400">Campos assinados</p>
          {page.subscribed_fields.length === 0 ? (
            <p className="mt-1 text-xs text-brand-400">nenhum</p>
          ) : (
            <div className="mt-1 flex flex-wrap gap-1">
              {page.subscribed_fields.map((f) => (
                <Badge key={f} tone={f.startsWith('leadgen') ? 'success' : 'neutral'}>
                  {f}
                </Badge>
              ))}
            </div>
          )}
        </div>
        {page.error && <p className="text-xs text-red-600">{page.error}</p>}
        <div className="border-t border-brand-50 pt-2 text-xs">
          <span className="text-brand-400">Último leadgen:</span>{' '}
          <span className="font-medium text-brand-700">
            {formatDateTime(last_events.leadgen)}
          </span>
        </div>
      </Card>

      {/* Instagram Direct */}
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <p className="font-medium text-brand-700">Instagram Direct</p>
          <Badge tone={igBadge.tone}>{igBadge.label}</Badge>
        </div>
        <div className="text-xs text-brand-500">
          <p>
            <span className="text-brand-400">Conta:</span>{' '}
            {instagram_direct.username ? `@${instagram_direct.username}` : '—'}
          </p>
          <p>
            <span className="text-brand-400">User ID:</span>{' '}
            <span className="font-mono">{instagram_direct.user_id ?? '—'}</span>
          </p>
        </div>
        {instagram_direct.error && (
          <p className="text-xs text-red-600">{instagram_direct.error}</p>
        )}
        <div className="border-t border-brand-50 pt-2 text-xs">
          <span className="text-brand-400">Última mensagem:</span>{' '}
          <span className="font-medium text-brand-700">
            {formatDateTime(last_events.instagram_message)}
          </span>
        </div>
      </Card>

      {/* Volumes 24h */}
      <Card className="flex flex-wrap gap-6 p-4 md:col-span-2">
        <div className="flex flex-col">
          <span className="text-xs text-brand-400">Leads via Meta Ads (24h)</span>
          <span className="text-2xl font-semibold text-brand-700">
            {counts_24h.leads_meta_ads}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-brand-400">Mensagens Instagram (24h)</span>
          <span className="text-2xl font-semibold text-brand-700">
            {counts_24h.instagram_messages}
          </span>
        </div>
      </Card>
    </div>
  );
}

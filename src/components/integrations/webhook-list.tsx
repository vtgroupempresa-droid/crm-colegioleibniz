'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { WebhookWizard } from './webhook-wizard';
import {
  setWebhookSourceActive,
  deleteWebhookSource,
  type WebhookSourceStats,
} from '@/actions/webhook-sources';
import type { PipelineStage } from '@/types/pipeline';
import { PIPELINE_LABELS, type PipelineKind } from '@/types/pipeline';

interface WebhookListProps {
  initialSources: WebhookSourceStats[];
  stages: PipelineStage[];
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'nunca';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

export function WebhookList({ initialSources, stages }: WebhookListProps) {
  const router = useRouter();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function webhookUrl(slug: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/api/webhooks/receive/${slug}`;
  }

  function handleToggle(id: string, current: boolean) {
    startTransition(async () => {
      const result = await setWebhookSourceActive(id, !current);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(current ? 'Integração pausada' : 'Integração ativada');
      router.refresh();
    });
  }

  function handleDelete(id: string, name: string) {
    if (!window.confirm(`Excluir a integração "${name}"? Os logs também serão removidos.`)) return;
    startTransition(async () => {
      const result = await deleteWebhookSource(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Integração excluída');
      router.refresh();
    });
  }

  async function copyUrl(slug: string) {
    try {
      await navigator.clipboard.writeText(webhookUrl(slug));
      toast.success('URL copiada');
    } catch {
      toast.error('Não foi possível copiar');
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-brand-700">Webhooks</h2>
          <p className="text-sm text-brand-500">
            Fontes externas que enviam leads para o CRM. {initialSources.length}{' '}
            {initialSources.length === 1 ? 'integração' : 'integrações'}.
          </p>
        </div>
        <Button onClick={() => setWizardOpen(true)}>+ Nova integração</Button>
      </header>

      {initialSources.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="text-3xl">🔗</span>
          <p className="font-medium text-brand-700">Nenhuma integração ainda</p>
          <p className="max-w-md text-sm text-brand-500">
            Crie uma integração para receber leads de Meta Ads, Elementor, Typeform e
            qualquer outra fonte — sem escrever código.
          </p>
          <Button onClick={() => setWizardOpen(true)}>Criar primeira integração</Button>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {initialSources.map(({ source, lastReceivedAt, total, successCount }) => (
            <Card key={source.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-semibold text-brand-700">{source.name}</p>
                  <Badge tone={source.is_active ? 'success' : 'neutral'}>
                    {source.is_active ? 'Ativa' : 'Pausada'}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate text-xs text-brand-400">
                  {PIPELINE_LABELS[source.default_pipeline as PipelineKind]} → {source.default_stage}
                  {' · '}
                  Último recebimento: {timeAgo(lastReceivedAt)}
                  {' · '}
                  {successCount}/{total} ok
                </p>
                <code className="mt-1 block truncate text-[11px] text-brand-300">
                  /api/webhooks/receive/{source.slug}
                </code>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => copyUrl(source.slug)}>
                  Copiar URL
                </Button>
                <Link href={`/integracoes/webhooks/${source.slug}/logs`} className="focus-ring rounded-md">
                  <Button size="sm" variant="ghost">
                    Logs
                  </Button>
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => handleToggle(source.id, source.is_active)}
                >
                  {source.is_active ? 'Pausar' : 'Ativar'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => handleDelete(source.id, source.name)}
                  className="text-red-600 hover:bg-red-50"
                >
                  Excluir
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <WebhookWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        stages={stages}
        onCreated={() => {
          setWizardOpen(false);
          router.refresh();
        }}
      />
    </section>
  );
}

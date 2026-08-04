'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  testWhatsappInstanceConnection,
  toggleWhatsappInstanceActive,
  type WhatsappInstanceRow,
} from '@/actions/whatsapp-instances';
import { WhatsappInstanceModal } from '@/components/admin/whatsapp-instance-modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { WHATSAPP_PROVIDER_LABELS, isWhatsappProvider } from '@/types/whatsapp-instance';

function timeAgoLabel(iso: string | null): string {
  if (!iso) return 'nunca';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

interface WhatsappInstancesManagerProps {
  instances: WhatsappInstanceRow[];
  webhookUrl: string;
}

/**
 * Gestão das linhas de WhatsApp oficial. Cada instância é um número da Cloud
 * API da Meta. O
 * badge colorido com a sigla identifica a instância nas conversas do /chat.
 */
export function WhatsappInstancesManager({ instances, webhookUrl }: WhatsappInstancesManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [testingId, setTestingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WhatsappInstanceRow | null>(null);

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(instance: WhatsappInstanceRow) {
    setEditing(instance);
    setModalOpen(true);
  }

  function handleToggle(instance: WhatsappInstanceRow) {
    startTransition(async () => {
      const result = await toggleWhatsappInstanceActive(instance.id, !instance.is_active);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(instance.is_active ? 'Instância desativada' : 'Instância reativada');
      router.refresh();
    });
  }

  function handleTest(instance: WhatsappInstanceRow) {
    setTestingId(instance.id);
    startTransition(async () => {
      const result = await testWhatsappInstanceConnection(instance.id);
      setTestingId(null);
      if (!result.ok) {
        toast.error(`Falha no teste: ${result.error}`);
        return;
      }
      const { connected, loggedIn, profileName } = result.data;
      if (connected && loggedIn) {
        toast.success(`Conectado${profileName ? ` · ${profileName}` : ''}`);
      } else {
        toast.warning('Linha desconectada — confira o token permanente e o Phone Number ID.');
      }
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm text-brand-500">
          {instances.length} {instances.length === 1 ? 'instância' : 'instâncias'} cadastrada
          {instances.length === 1 ? '' : 's'}.
        </p>
        <Button type="button" size="sm" onClick={openNew}>
          Nova instância
        </Button>
      </div>

      {instances.length === 0 ? (
        <p className="mt-3 text-sm text-brand-400">
          Nenhuma linha oficial ainda. Cadastre o número e o token permanente da Meta.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-brand-500">
              <tr>
                <th className="pb-2 pr-3">Instância</th>
                <th className="pb-2 pr-3">Provedor</th>
                <th className="pb-2 pr-3">Número</th>
                <th className="pb-2 pr-3">Conexão</th>
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-100">
              {instances.map((i) => (
                <tr key={i.id}>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="flex h-6 min-w-6 items-center justify-center rounded px-1 text-[10px] font-bold text-white"
                        style={{ backgroundColor: i.color ?? '#22c55e' }}
                        title={i.name}
                      >
                        {i.label ?? i.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <p className="font-medium text-brand-700">{i.name}</p>
                        <p className="text-[11px] text-brand-400">
                          Token: {i.hasToken ? i.tokenPreview : 'não cadastrado'}
                        </p>
                        {i.bot_enabled && (
                          <p className="mt-0.5 text-[11px] font-semibold text-emerald-700">
                            Bot e roteamento ativos
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-brand-600">
                    {isWhatsappProvider(i.provider)
                      ? WHATSAPP_PROVIDER_LABELS[i.provider]
                      : i.provider}
                  </td>
                  <td className="py-2 pr-3 text-brand-600">{i.phone_number ?? '—'}</td>
                  <td className="py-2 pr-3">
                    {i.is_connected ? (
                      <Badge tone="success">Conectado</Badge>
                    ) : (
                      <Badge tone="danger">Desconectado</Badge>
                    )}
                    <p className="mt-0.5 text-[11px] text-brand-400">
                      {timeAgoLabel(i.last_connected_at)}
                    </p>
                  </td>
                  <td className="py-2 pr-3">
                    {i.is_active ? (
                      <Badge tone="success">Ativa</Badge>
                    ) : (
                      <Badge tone="neutral">Inativa</Badge>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <div className="inline-flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => handleTest(i)}
                        disabled={isPending || !i.hasToken}
                      >
                        {testingId === i.id ? 'Testando…' : 'Testar conexão'}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => openEdit(i)}>
                        Editar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => handleToggle(i)}
                        disabled={isPending}
                      >
                        {i.is_active ? 'Desativar' : 'Reativar'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 rounded-md border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-600">
        <p className="font-semibold uppercase tracking-wide">Webhook da API oficial</p>
        <p className="mt-1">
          No painel do app da Meta, assine o campo <code>messages</code> da conta do WhatsApp e use{' '}
          <code className="break-all">{webhookUrl}</code> como URL de callback. O token de
          verificação é o valor seguro de <code>META_VERIFY_TOKEN</code>; ele não é exibido nesta
          tela.
        </p>
      </div>

      <WhatsappInstanceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        instance={editing}
      />
    </div>
  );
}

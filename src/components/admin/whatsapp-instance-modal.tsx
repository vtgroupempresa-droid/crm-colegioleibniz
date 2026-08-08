'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  createWhatsappInstance,
  testWhatsappInstanceConnection,
  updateWhatsappInstance,
  type WhatsappInstanceRow,
} from '@/actions/whatsapp-instances';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import {
  WHATSAPP_PROVIDERS,
  WHATSAPP_PROVIDER_LABELS,
  isWhatsappProvider,
  type WhatsappProvider,
} from '@/types/whatsapp-instance';

interface WhatsappInstanceModalProps {
  open: boolean;
  onClose: () => void;
  /** Instância a editar; null cria uma nova. */
  instance: WhatsappInstanceRow | null;
  sectors: Array<{ id: string; name: string }>;
}

export function WhatsappInstanceModal({
  open,
  onClose,
  instance,
  sectors,
}: WhatsappInstanceModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('#22c55e');
  // O Leibniz opera só na API oficial — 'official' é o padrão de uma linha nova.
  const [provider, setProvider] = useState<WhatsappProvider>('official');
  const [token, setToken] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [botEnabled, setBotEnabled] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [sectorId, setSectorId] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(instance?.name ?? '');
    setLabel(instance?.label ?? '');
    setColor(instance?.color ?? '#22c55e');
    setProvider(isWhatsappProvider(instance?.provider) ? instance.provider : 'official');
    setToken('');
    setPhoneNumber(instance?.phone_number ?? '');
    setPhoneNumberId(instance?.phone_number_id ?? '');
    setBotEnabled(instance?.bot_enabled ?? false);
    setIsActive(instance?.is_active ?? true);
    setSectorId(instance?.sector_id ?? sectors[0]?.id ?? '');
  }, [open, instance, sectors]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const payload = {
      name: name.trim(),
      label: label.trim() || null,
      color,
      provider,
      instanceToken: token.trim() || null,
      phoneNumber: phoneNumber.trim() || null,
      phoneNumberId: phoneNumberId.trim() || null,
      botEnabled: provider === 'official' && botEnabled,
      isActive,
      sectorId,
    };
    startTransition(async () => {
      const result = instance
        ? await updateWhatsappInstance(instance.id, payload)
        : await createWhatsappInstance(payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(instance ? 'Instância atualizada' : 'Instância criada');
      onClose();
      router.refresh();
    });
  }

  /** Testa se o número oficial responde na Graph API com as credenciais salvas. */
  function handleTestConnection() {
    if (!instance) return;
    startTransition(async () => {
      const result = await testWhatsappInstanceConnection(instance.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.data.connected) {
        const label = result.data.profileName ?? result.data.phoneNumber ?? instance.name;
        toast.success(`Conectado: ${label}`);
      } else {
        toast.warning('Número ainda não respondeu — confira as credenciais da WABA.');
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={instance ? `Editar · ${instance.name}` : 'Nova instância de WhatsApp'}
      maxWidthClassName="max-w-md"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Input
          label="Nome (ex: Método Sari, SDR - João)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Sigla no chat (ex: MS)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={6}
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-brand-500">Cor do badge</label>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-full cursor-pointer rounded-md border border-brand-200"
              aria-label="Cor do badge"
            />
          </div>
        </div>

        <Select
          label="Provedor"
          value={provider}
          onChange={(e) => setProvider(e.target.value as WhatsappProvider)}
        >
          {WHATSAPP_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {WHATSAPP_PROVIDER_LABELS[p]}
            </option>
          ))}
        </Select>

        <Select
          label="Setor responsável"
          value={sectorId}
          onChange={(e) => setSectorId(e.target.value)}
          required
        >
          <option value="">Selecione o setor</option>
          {sectors.map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.name}
            </option>
          ))}
        </Select>

        <Input
          label={
            instance?.hasToken
              ? 'Token da instância (vazio = manter atual)'
              : provider === 'official'
                ? 'Token de acesso da WABA'
                : 'Token da instância UaZAPI'
          }
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={instance?.hasToken ? `Atual: ${instance.tokenPreview}` : ''}
          required={!instance?.hasToken && provider === 'uazapi'}
        />
        <Input
          label="Número (ex: +5531999999999)"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
        />
        {provider === 'official' && (
          <div className="flex flex-col gap-1">
            <Input
              label="ID do número na Meta (phone_number_id)"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              placeholder="1276125232244518"
              inputMode="numeric"
              required
            />
            <span className="text-xs text-brand-500">
              Só dígitos. É por ele que o webhook identifica a linha e o envio escolhe o número —
              sem isso a linha não recebe nem envia.
            </span>
          </div>
        )}

        {provider === 'official' && (
          <label className="rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm text-brand-700">
            <span className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={botEnabled}
                onChange={(e) => setBotEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-brand-700"
              />
              <span>
                <strong className="block">Bot Leibniz + menu de setores</strong>
                <span className="mt-0.5 block text-xs text-brand-500">
                  Mostra os setores no primeiro contato e continua o roteiro comercial quando a
                  família escolhe Comercial &amp; Matrículas.
                </span>
              </span>
            </span>
          </label>
        )}

        <label className="flex items-center gap-2 text-sm text-brand-700">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 accent-brand-700"
          />
          Ativa (recebe e envia mensagens)
        </label>

        {instance && (
          <div className="flex flex-wrap gap-2 rounded-md border border-brand-100 bg-brand-50 p-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleTestConnection}
              disabled={isPending}
            >
              Testar conexão
            </Button>
          </div>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Salvando...' : instance ? 'Salvar' : 'Criar instância'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

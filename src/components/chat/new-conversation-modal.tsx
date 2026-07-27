'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  getOfficialWhatsappStatus,
  searchChatLeads,
  startConversation,
  type ChatLeadSearchResult,
  type OfficialWhatsappStatus,
} from '@/actions/conversations';
import {
  isInstanceDisconnected,
  WHATSAPP_PROVIDER_LABELS,
  type WhatsappInstanceBadge,
} from '@/types/whatsapp-instance';

interface NewConversationModalProps {
  open: boolean;
  onClose: () => void;
  /** Instâncias de WhatsApp ativas (oficial + UaZAPI). */
  instances: WhatsappInstanceBadge[];
  /** Chamado com o id da conversa criada — o layout seleciona/atualiza a lista. */
  onCreated: (conversationId: string) => void;
}

type Mode = 'lead' | 'new';

/**
 * Modal "Nova conversa" (/chat): inicia uma conversa de WhatsApp ativa.
 *  - Aba "Lead do CRM": busca um lead e usa o telefone dele.
 *  - Aba "Número novo": telefone + nome → cria um lead mínimo.
 * O número de envio (instância) é escolhido no dropdown.
 */
export function NewConversationModal({
  open,
  onClose,
  instances,
  onCreated,
}: NewConversationModalProps) {
  const [mode, setMode] = useState<Mode>('lead');
  const [isPending, startTransition] = useTransition();

  // Aba "Lead do CRM"
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<ChatLeadSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedLead, setSelectedLead] = useState<ChatLeadSearchResult | null>(null);

  // Aba "Número novo"
  const [phone, setPhone] = useState('');
  const [contactName, setContactName] = useState('');

  const [instanceId, setInstanceId] = useState('');
  const [message, setMessage] = useState('');
  const [official, setOfficial] = useState<OfficialWhatsappStatus | null>(null);

  const searchSeq = useRef(0);

  // Reset ao abrir + escolhe instância padrão (1ª conectada, senão a 1ª) e
  // busca o status do número oficial.
  useEffect(() => {
    if (!open) return;
    setMode('lead');
    setTerm('');
    setResults([]);
    setSelectedLead(null);
    setPhone('');
    setContactName('');
    setMessage('');
    const preferred = instances.find((i) => i.is_connected) ?? instances[0];
    setInstanceId(preferred?.id ?? '');
    void getOfficialWhatsappStatus().then(setOfficial);
  }, [open, instances]);

  // Busca de leads com debounce.
  useEffect(() => {
    if (mode !== 'lead') return;
    const q = term.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      const rows = await searchChatLeads(q);
      if (seq === searchSeq.current) {
        setResults(rows);
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [term, mode]);

  const selectedInstance = instances.find((i) => i.id === instanceId) ?? null;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!instanceId) {
      toast.error('Selecione o número que vai enviar.');
      return;
    }
    if (!message.trim()) {
      toast.error('Escreva a mensagem.');
      return;
    }
    if (mode === 'lead' && !selectedLead) {
      toast.error('Selecione um lead na busca.');
      return;
    }
    if (mode === 'new' && phone.replace(/\D/g, '').length < 10) {
      toast.error('Informe um telefone de WhatsApp válido (com DDD).');
      return;
    }

    startTransition(async () => {
      const result = await startConversation({
        leadId: mode === 'lead' ? selectedLead?.id : null,
        phone: mode === 'new' ? phone : null,
        contactName: mode === 'new' ? contactName : null,
        instanceId,
        message,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.data.warning) toast.warning(result.data.warning);
      else toast.success('Conversa iniciada.');
      onCreated(result.data.conversationId);
      onClose();
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Nova conversa" maxWidthClassName="max-w-lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Alternância de modo */}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-brand-100 p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode('lead')}
            className={`focus-ring rounded-md px-3 py-1.5 font-medium ${
              mode === 'lead' ? 'bg-canvas text-brand-700 shadow-sm' : 'text-brand-500'
            }`}
          >
            Lead do CRM
          </button>
          <button
            type="button"
            onClick={() => setMode('new')}
            className={`focus-ring rounded-md px-3 py-1.5 font-medium ${
              mode === 'new' ? 'bg-canvas text-brand-700 shadow-sm' : 'text-brand-500'
            }`}
          >
            Número novo
          </button>
        </div>

        {mode === 'lead' ? (
          <div className="flex flex-col gap-2">
            <Input
              label="Buscar lead (nome, telefone ou email)"
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                setSelectedLead(null);
              }}
              placeholder="Digite ao menos 2 caracteres…"
              autoFocus
            />
            {selectedLead ? (
              <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-brand-700">{selectedLead.name}</span>
                  <span className="ml-2 text-brand-500">{selectedLead.phone ?? 'sem telefone'}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedLead(null)}
                  className="focus-ring shrink-0 text-xs text-brand-500 hover:text-brand-700"
                >
                  trocar
                </button>
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-md border border-brand-100">
                {searching && (
                  <p className="px-3 py-2 text-xs text-brand-400">Buscando…</p>
                )}
                {!searching && term.trim().length >= 2 && results.length === 0 && (
                  <p className="px-3 py-2 text-xs text-brand-400">Nenhum lead encontrado.</p>
                )}
                {results.map((lead) => (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => setSelectedLead(lead)}
                    className="focus-ring flex w-full items-center justify-between gap-2 border-b border-brand-50 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-brand-50"
                  >
                    <span className="truncate font-medium text-brand-700">{lead.name}</span>
                    <span className="shrink-0 text-xs text-brand-400">
                      {lead.phone ?? lead.instagram ?? '—'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Telefone *"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ex.: 31 99999-9999"
              autoFocus
            />
            <Input
              label="Nome do contato"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Opcional"
            />
            <p className="col-span-2 text-xs text-brand-400">
              Um lead novo é criado em SDR · Novo Lead com você como responsável.
            </p>
          </div>
        )}

        <Select
          label="Enviar pelo número"
          value={instanceId}
          onChange={(e) => setInstanceId(e.target.value)}
          required
        >
          <option value="">Selecione…</option>
          {instances.map((inst) => (
            <option key={inst.id} value={inst.id}>
              {inst.name} · {WHATSAPP_PROVIDER_LABELS[inst.provider === 'official' ? 'official' : 'uazapi']}
              {isInstanceDisconnected(inst) ? ' (desconectado)' : ''}
            </option>
          ))}
        </Select>

        {selectedInstance && isInstanceDisconnected(selectedInstance) && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
            Esta instância UaZAPI está desconectada — a mensagem pode não sair. Reconecte em
            Admin · WhatsApp.
          </p>
        )}

        {selectedInstance?.provider === 'official' && official && (
          <p
            className={`rounded-md px-3 py-2 text-xs ${
              official.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            {official.error
              ? `API oficial indisponível: ${official.error}`
              : `API oficial OK · ${official.displayPhoneNumber ?? ''} · ${official.verifiedName ?? ''} · qualidade ${official.qualityRating ?? '—'}`}
          </p>
        )}

        <Textarea
          label="Mensagem *"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="Escreva a primeira mensagem…"
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Enviando…' : 'Iniciar conversa'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

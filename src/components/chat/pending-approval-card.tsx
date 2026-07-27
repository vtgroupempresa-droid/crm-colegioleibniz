'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { approveAiMessage, rejectAiMessage } from '@/actions/conversations';
import type { Message } from '@/types/chat';

/**
 * Cartão de mensagem da IA SDR aguardando aprovação (Shadow Mode — Bloco 4.3).
 * Borda tracejada amarela, com botões "Aprovar e enviar" / "Descartar".
 */
export function PendingApprovalCard({
  message,
  onResolved,
}: {
  message: Message;
  onResolved: () => void;
}) {
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null);

  async function approve() {
    setBusy('approve');
    const res = await approveAiMessage(message.id);
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if (res.data.warning) toast.warning(res.data.warning);
    else toast.success('Mensagem aprovada e enviada.');
    onResolved();
  }

  async function reject() {
    setBusy('reject');
    const res = await rejectAiMessage(message.id);
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success('Mensagem descartada.');
    onResolved();
  }

  return (
    <div className="my-2 rounded-lg border-2 border-dashed border-yellow-400 bg-yellow-50 p-3">
      <div className="mb-2 flex items-center gap-1">
        <span className="rounded-full bg-purple-200 px-2 py-0.5 text-[10px] font-semibold text-purple-800">
          IA SDR
        </span>
        <span className="text-xs font-medium text-yellow-700">Aguardando aprovação</span>
      </div>
      <p className="mb-2 whitespace-pre-wrap break-words text-sm text-gray-800">{message.content}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={approve}
          disabled={busy !== null}
          className="focus-ring rounded-full bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
        >
          {busy === 'approve' ? 'Enviando…' : '✓ Aprovar e enviar'}
        </button>
        <button
          type="button"
          onClick={reject}
          disabled={busy !== null}
          className="focus-ring rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-200 disabled:opacity-60"
        >
          {busy === 'reject' ? 'Descartando…' : '✗ Descartar'}
        </button>
      </div>
    </div>
  );
}

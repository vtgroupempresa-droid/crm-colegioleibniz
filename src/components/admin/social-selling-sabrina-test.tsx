'use client';

import { useState } from 'react';
import { toast } from 'sonner';

/**
 * Botão de diagnóstico do canal da Sabrina (Bloco 7.5). Dispara
 * GET /api/social-selling/test-sabrina e mostra o método usado + sucesso/erro,
 * para validar o WhatsApp antes do primeiro lead real de consulta.
 */
export function SabrinaDiagnosticButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/social-selling/test-sabrina');
      const json = await res.json();
      if (json.success) {
        setResult(`✓ Enviado via ${json.method}`);
        toast.success(`Notificação de teste enviada (${json.method}).`);
      } else {
        setResult(`✗ Falhou${json.detail ? `: ${json.detail}` : ''}`);
        toast.error('Nenhum método de envio funcionou.');
      }
    } catch {
      setResult('✗ Erro de rede');
      toast.error('Erro ao chamar o diagnóstico.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <div>
        <p className="font-medium text-emerald-800">Diagnóstico — WhatsApp da Sabrina</p>
        <p className="text-sm text-emerald-700">
          Envia uma mensagem de teste para o WhatsApp da Sabrina (consultas) e confirma o canal.
          {result && <span className="ml-1 font-semibold">{result}</span>}
        </p>
      </div>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="focus-ring shrink-0 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {busy ? 'Enviando…' : 'Testar envio'}
      </button>
    </div>
  );
}

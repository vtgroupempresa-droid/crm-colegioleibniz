'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Modal } from '@/components/ui/modal';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { WEBHOOK_LOG_STATUS_META, type WebhookLog, type WebhookLogStatus } from '@/types/webhooks';

interface WebhookLogsViewProps {
  logs: WebhookLog[];
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function statusMeta(status: string) {
  return WEBHOOK_LOG_STATUS_META[status as WebhookLogStatus] ?? { label: status, tone: 'neutral' as const };
}

export function WebhookLogsView({ logs }: WebhookLogsViewProps) {
  const [payload, setPayload] = useState<WebhookLog | null>(null);

  if (logs.length === 0) {
    return (
      <Card className="py-12 text-center text-sm text-brand-400">
        Nenhum recebimento ainda. Quando a fonte enviar dados, eles aparecem aqui.
      </Card>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-brand-100 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-brand-100 text-left text-xs text-brand-400">
              <th className="px-4 py-2 font-medium">Recebido</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Lead</th>
              <th className="px-4 py-2 font-medium">Tempo</th>
              <th className="px-4 py-2 font-medium">Payload</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const meta = statusMeta(log.status);
              return (
                <tr key={log.id} className="border-b border-brand-50 last:border-0">
                  <td className="whitespace-nowrap px-4 py-2 text-brand-600">{fmt(log.received_at)}</td>
                  <td className="px-4 py-2">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {log.error_message && (
                      <span className="ml-2 text-[11px] text-red-500">{log.error_message}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {log.lead_id ? (
                      <Link
                        href={`/leads?lead=${log.lead_id}`}
                        className="text-xs text-brand-600 underline hover:text-brand-800"
                      >
                        ver lead
                      </Link>
                    ) : (
                      <span className="text-xs text-brand-300">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-brand-400">
                    {log.processing_time_ms != null ? `${log.processing_time_ms}ms` : '—'}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => setPayload(log)}
                      className="focus-ring rounded text-xs font-medium text-brand-500 hover:text-brand-700"
                    >
                      Ver payload
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal
        open={payload !== null}
        onClose={() => setPayload(null)}
        title="Payload recebido"
        maxWidthClassName="max-w-2xl"
      >
        <pre className="max-h-[60vh] overflow-auto rounded-md bg-brand-900/95 p-4 font-mono text-[11px] leading-relaxed text-emerald-50">
          {payload ? JSON.stringify(payload.payload, null, 2) : ''}
        </pre>
      </Modal>
    </>
  );
}

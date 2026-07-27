'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  disconnectGoogleCalendar,
  triggerManualSync,
  type GoogleCalendarStatus,
} from '@/actions/google-calendar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * Card "Google Calendar" do /integracoes (admin): status da conexão com a
 * agenda da escola, conectar (OAuth), sincronizar agora e desconectar.
 * Mesmo padrão do painel Conta Azul do /financeiro.
 */

const fmtDateTime = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export function GoogleCalendarPanel({ status }: { status: GoogleCalendarStatus }) {
  const router = useRouter();
  const [syncing, startSync] = useTransition();
  const [disconnecting, startDisconnect] = useTransition();

  function syncNow() {
    startSync(async () => {
      const result = await triggerManualSync();
      if (result.ok) {
        toast.success(
          `Sincronizado: ${result.data.processed} eventos processados, ` +
            `${result.data.appointmentsUpdated} agendamentos atualizados`,
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDisconnect() {
    if (
      !confirm(
        'Desconectar o Google Calendar? Novos agendamentos deixarão de gerar evento/link do Meet.',
      )
    )
      return;
    startDisconnect(async () => {
      const result = await disconnectGoogleCalendar();
      if (result.ok) {
        toast.success('Google Calendar desconectado');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-100 bg-white p-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-xl" aria-hidden="true">
            📅
          </span>
          <p className="text-sm font-semibold text-brand-700">Google Calendar</p>
          {status.connected ? (
            <Badge tone="success">● conectada</Badge>
          ) : (
            <Badge tone="danger">● desconectada</Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-brand-400">
          {status.connected ? (
            <>
              {status.connectedEmail && <>Conta: {status.connectedEmail} · </>}
              Último sync: {fmtDateTime(status.lastSyncedAt)}
            </>
          ) : (
            'Conecte a agenda da escola para gerar link do Meet, convidar leads e ver a agenda no CRM.'
          )}
        </p>
      </div>
      <div className="flex gap-2">
        {!status.connected && (
          <a href="/api/google-calendar/authorize" className="inline-flex">
            <Button size="sm">Conectar Google Calendar</Button>
          </a>
        )}
        {status.connected && (
          <>
            <Button size="sm" variant="secondary" onClick={syncNow} disabled={syncing}>
              {syncing ? 'Sincronizando…' : 'Sincronizar agora'}
            </Button>
            <Button size="sm" variant="ghost" onClick={handleDisconnect} disabled={disconnecting}>
              Desconectar
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

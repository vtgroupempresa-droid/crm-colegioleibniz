'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  createInvitation,
  revokeInvitation,
  type InvitationRow,
  type InvitationStatus,
} from '@/actions/invitations';
import { USER_ROLES, type UserRole } from '@/types/user';

interface InviteSector {
  id: string;
  name: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  comercial: 'Comercial',
};

const STATUS_META: Record<
  InvitationStatus,
  { label: string; tone: 'success' | 'info' | 'neutral' | 'danger' }
> = {
  pending: { label: 'Pendente', tone: 'info' },
  accepted: { label: 'Aceito', tone: 'success' },
  revoked: { label: 'Revogado', tone: 'neutral' },
  expired: { label: 'Expirado', tone: 'danger' },
};

export function InvitesManager({
  invites,
  sectors,
}: {
  invites: InvitationRow[];
  sectors: readonly InviteSector[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('comercial');
  const [sectorId, setSectorId] = useState(sectors[0]?.id ?? '');
  const [creating, setCreating] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const result = await createInvitation({
      email,
      role,
      sectorId: role === 'admin' ? null : sectorId || null,
    });
    setCreating(false);
    if (result.ok) {
      const copied = await navigator.clipboard
        .writeText(result.data.inviteUrl)
        .then(() => true)
        .catch(() => false);
      toast.success(
        copied
          ? 'Convite criado! Link copiado para a área de transferência.'
          : 'Convite criado! Copie o link na lista abaixo.',
      );
      setEmail('');
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  function copyLink(url: string) {
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success('Link copiado.'))
      .catch(() => toast.error('Não foi possível copiar o link.'));
  }

  function handleRevoke(id: string) {
    setPendingId(id);
    startTransition(async () => {
      const result = await revokeInvitation(id);
      setPendingId(null);
      if (result.ok) {
        toast.success('Convite revogado.');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <Input
            label="E-mail do convidado"
            name="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="pessoa@email.com"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="invite-role" className="text-xs font-medium text-brand-600">
            Cargo
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="focus-ring h-10 rounded-md border border-brand-200 bg-white px-3 text-sm text-brand-700"
          >
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        {role !== 'admin' && (
          <div className="flex min-w-[16rem] flex-col gap-1">
            <label htmlFor="invite-sector" className="text-xs font-medium text-brand-600">
              Setor
            </label>
            <select
              id="invite-sector"
              value={sectorId}
              onChange={(e) => setSectorId(e.target.value)}
              required
              className="focus-ring h-10 rounded-md border border-brand-200 bg-white px-3 text-sm text-brand-700"
            >
              <option value="">Selecione o setor</option>
              {sectors.map((sector) => (
                <option key={sector.id} value={sector.id}>
                  {sector.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <Button type="submit" disabled={creating}>
          {creating ? 'Gerando...' : 'Gerar link de convite'}
        </Button>
      </form>

      {invites.length === 0 ? (
        <p className="text-sm text-brand-400">Nenhum convite gerado ainda.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-brand-100 rounded-md border border-brand-100">
          {invites.map((inv) => {
            const meta = STATUS_META[inv.status];
            return (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-[12rem] flex-1">
                  <p className="text-sm font-medium text-brand-700">{inv.email}</p>
                  <p className="text-xs text-brand-400">
                    {ROLE_LABELS[inv.role]}
                    {inv.sectorId
                      ? ` · ${sectors.find((sector) => sector.id === inv.sectorId)?.name ?? 'Setor'}`
                      : ''}
                  </p>
                </div>
                <Badge tone={meta.tone}>{meta.label}</Badge>
                {inv.status === 'pending' && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => copyLink(inv.inviteUrl)}
                      className="text-xs font-medium text-brand-700 underline-offset-2 hover:underline"
                    >
                      Copiar link
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRevoke(inv.id)}
                      disabled={pendingId === inv.id}
                      className="text-xs font-medium text-red-600 underline-offset-2 hover:underline disabled:opacity-60"
                    >
                      {pendingId === inv.id ? 'Revogando...' : 'Revogar'}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

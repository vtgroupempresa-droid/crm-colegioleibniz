'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { updateUserRole, updateUserSector } from '@/actions/admin';
import { Select } from '@/components/ui/select';
import { USER_ROLES, type UserRole } from '@/types/user';

interface AdminUser {
  id: string;
  name: string;
  role: UserRole;
  sectorId: string | null;
}

interface AdminSector {
  id: string;
  name: string;
  color: string;
}

interface UsersTableProps {
  users: readonly AdminUser[];
  sectors: readonly AdminSector[];
  currentUserId: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  comercial: 'Comercial',
};

export function UsersTable({ users, sectors, currentUserId }: UsersTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleRoleChange(userId: string, role: UserRole) {
    startTransition(async () => {
      const result = await updateUserRole({ userId, role });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Role atualizada');
      router.refresh();
    });
  }

  function handleSectorChange(userId: string, sectorId: string) {
    startTransition(async () => {
      const result = await updateUserSector({ userId, sectorId: sectorId || null });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Setor atualizado');
      router.refresh();
    });
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-brand-100 bg-white">
      <table className="min-w-[48rem] w-full text-sm">
        <thead className="bg-brand-50 text-left text-xs uppercase text-brand-500">
          <tr>
            <th className="px-4 py-2">Nome</th>
            <th className="px-4 py-2">Role atual</th>
            <th className="px-4 py-2">Setor</th>
            <th className="px-4 py-2">Alterar</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-100">
          {users.map((u) => {
            const isMe = u.id === currentUserId;
            return (
              <tr key={u.id} className="hover:bg-brand-50">
                <td className="px-4 py-3 font-medium text-brand-700">
                  {u.name}
                  {isMe && <span className="ml-2 text-[11px] text-brand-400">(você)</span>}
                </td>
                <td className="px-4 py-3 text-brand-600">{ROLE_LABELS[u.role]}</td>
                <td className="min-w-[15rem] px-4 py-3">
                  <Select
                    aria-label={`Setor de ${u.name}`}
                    value={u.sectorId ?? ''}
                    onChange={(e) => handleSectorChange(u.id, e.target.value)}
                    disabled={isPending}
                  >
                    <option value="">{u.role === 'admin' ? 'Visão global' : 'Selecione o setor'}</option>
                    {sectors.map((sector) => (
                      <option key={sector.id} value={sector.id}>
                        {sector.name}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-4 py-3">
                  <Select
                    value={u.role}
                    onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                    disabled={isPending || isMe}
                  >
                    {USER_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

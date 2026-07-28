'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { updateUserRole } from '@/actions/admin';
import { Select } from '@/components/ui/select';
import { USER_ROLES, type UserRole } from '@/types/user';

interface AdminUser {
  id: string;
  name: string;
  role: UserRole;
}

interface UsersTableProps {
  users: readonly AdminUser[];
  currentUserId: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  comercial: 'Comercial',
};

export function UsersTable({ users, currentUserId }: UsersTableProps) {
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

  return (
    <div className="overflow-hidden rounded-lg border border-brand-100 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-brand-50 text-left text-xs uppercase text-brand-500">
          <tr>
            <th className="px-4 py-2">Nome</th>
            <th className="px-4 py-2">Role atual</th>
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

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { acceptInvitation } from '@/actions/invitations';
import type { UserRole } from '@/types/user';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  comercial: 'Comercial',
};

interface AcceptInviteFormProps {
  token: string;
  email: string;
  role: UserRole;
}

export function AcceptInviteForm({ token, email, role }: AcceptInviteFormProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error('As senhas não conferem');
      return;
    }
    setSaving(true);
    const result = await acceptInvitation({ token, name, password });
    setSaving(false);
    if (result.ok) {
      toast.success('Conta criada! Faça login para começar.');
      router.push('/login');
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-brand-600">E-mail</span>
        <p className="text-sm text-brand-500">{email}</p>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-brand-600">Cargo</span>
        <p className="text-sm text-brand-500">{ROLE_LABELS[role]}</p>
      </div>
      <Input
        label="Nome completo"
        name="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        minLength={2}
        autoComplete="name"
      />
      <Input
        label="Senha"
        name="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={8}
        autoComplete="new-password"
        placeholder="Mínimo de 8 caracteres"
      />
      <Input
        label="Confirmar senha"
        name="confirm"
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        required
        minLength={8}
        autoComplete="new-password"
      />
      <Button type="submit" disabled={saving || password.length < 8} className="mt-2">
        {saving ? 'Criando conta...' : 'Criar conta'}
      </Button>
    </form>
  );
}

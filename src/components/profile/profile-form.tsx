'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AvatarUploader } from './avatar-uploader';
import {
  requestPasswordReset,
  updateAvatar,
  updatePassword,
  updateProfile,
} from '@/actions/profile';
import type { UserRole } from '@/types/user';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  comercial: 'Comercial',
};

interface ProfileFormProps {
  userId: string;
  email: string;
  role: UserRole;
  initialName: string;
  initialPhone: string;
  initialAvatarUrl: string | null;
}

export function ProfileForm({
  userId,
  email,
  role,
  initialName,
  initialPhone,
  initialAvatarUrl,
}: ProfileFormProps) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);
  const [pending, startTransition] = useTransition();
  const [resetting, setResetting] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateProfile({ name, phone, avatarUrl });
      if (result.ok) toast.success('Perfil atualizado.');
      else toast.error(result.error);
    });
  }

  async function handleAvatarUploaded(url: string) {
    setAvatarUrl(url);
    const result = await updateAvatar(url);
    if (!result.ok) toast.error(result.error);
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setSavingPassword(true);
    const result = await updatePassword({ password: newPassword, confirm: confirmPassword });
    setSavingPassword(false);
    if (result.ok) {
      toast.success('Senha alterada com sucesso.');
      setNewPassword('');
      setConfirmPassword('');
    } else {
      toast.error(result.error);
    }
  }

  async function handlePasswordReset() {
    setResetting(true);
    const result = await requestPasswordReset();
    setResetting(false);
    if (result.ok) toast.success('Enviamos um email para redefinir sua senha.');
    else toast.error(result.error);
  }

  return (
    <div className="flex max-w-xl flex-col gap-8">
      <section className="flex flex-col gap-4 rounded-lg border border-brand-100 bg-white p-6">
        <h2 className="text-sm font-semibold text-brand-700">Foto de perfil</h2>
        <AvatarUploader
          userId={userId}
          name={name || email}
          currentUrl={avatarUrl}
          onUploaded={handleAvatarUploaded}
        />
      </section>

      <form
        onSubmit={handleSave}
        className="flex flex-col gap-4 rounded-lg border border-brand-100 bg-white p-6"
      >
        <h2 className="text-sm font-semibold text-brand-700">Dados</h2>
        <Input
          label="Nome completo"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
        />
        <Input
          label="Telefone"
          name="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(31) 99999-9999"
        />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-brand-600">Email</span>
          <p className="text-sm text-brand-500">{email}</p>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-brand-600">Função</span>
          <p className="text-sm text-brand-500">
            {ROLE_LABELS[role]}{' '}
            <span className="text-brand-300">· alteração apenas pelo admin</span>
          </p>
        </div>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? 'Salvando...' : 'Salvar alterações'}
          </Button>
        </div>
      </form>

      <form
        onSubmit={handlePasswordChange}
        className="flex flex-col gap-4 rounded-lg border border-brand-100 bg-white p-6"
      >
        <h2 className="text-sm font-semibold text-brand-700">Segurança</h2>
        <p className="text-sm text-brand-500">
          Defina uma nova senha. A alteração é imediata e não exige confirmação por email.
        </p>
        <Input
          label="Nova senha"
          name="new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
          placeholder="Mínimo de 8 caracteres"
        />
        <Input
          label="Confirmar nova senha"
          name="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={8}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={savingPassword || newPassword.length < 8}>
            {savingPassword ? 'Alterando...' : 'Alterar senha'}
          </Button>
          <button
            type="button"
            onClick={handlePasswordReset}
            disabled={resetting}
            className="text-xs text-brand-400 underline-offset-2 hover:underline disabled:opacity-60"
          >
            {resetting ? 'Enviando...' : 'Prefiro receber um link por email'}
          </button>
        </div>
      </form>
    </div>
  );
}

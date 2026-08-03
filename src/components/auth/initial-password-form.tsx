'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { changeInitialPassword } from '@/actions/password';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function InitialPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await changeInitialPassword({ password, confirmation });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Senha atualizada. Acesso liberado.');
      router.replace('/leads');
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
      <Input
        label="Nova senha"
        name="new-password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
        minLength={10}
      />
      <Input
        label="Confirmar nova senha"
        name="confirm-password"
        type="password"
        autoComplete="new-password"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        required
        minLength={10}
      />
      <p className="text-xs leading-relaxed text-brand-400">
        Use pelo menos 10 caracteres, com letra maiúscula, minúscula e número.
      </p>
      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? 'Salvando…' : 'Salvar nova senha e entrar'}
      </Button>
    </form>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { signInAction } from './actions';

interface LoginFormProps {
  redirectTo?: string;
}

export function LoginForm({ redirectTo }: LoginFormProps) {
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    setErrors({});
    startTransition(async () => {
      const result = await signInAction(formData);
      if (!result.ok) {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="redirectTo" value={redirectTo ?? ''} />
      <Input
        name="email"
        type="email"
        label="Email"
        placeholder="voce@colegioleibniz.com.br"
        autoComplete="email"
        required
        error={errors.email}
      />
      <Input
        name="password"
        type="password"
        label="Senha"
        placeholder="••••••••"
        autoComplete="current-password"
        required
        error={errors.password}
      />
      <Button type="submit" disabled={isPending} className="mt-2">
        {isPending ? 'Entrando...' : 'Entrar'}
      </Button>
    </form>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AvatarUploader } from '@/components/profile/avatar-uploader';
import { updateProfile } from '@/actions/profile';
import { cn } from '@/lib/utils/cn';
import type { UserRole } from '@/types/user';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  comercial: 'Comercial',
};

interface OnboardingFlowProps {
  userId: string;
  email: string;
  role: UserRole;
}

const STEPS = ['Seus dados', 'Foto de perfil', 'Confirmação'] as const;

export function OnboardingFlow({ userId, email, role }: OnboardingFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canAdvanceStep1 = name.trim().length >= 2;

  function finish() {
    startTransition(async () => {
      const result = await updateProfile({ name, phone, avatarUrl });
      if (result.ok) {
        toast.success('Tudo pronto! Bem-vindo(a) ao CRM.');
        router.replace('/leads');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-6 rounded-xl border border-brand-100 bg-white p-8 shadow-sm">
      <div>
        <h1 className="text-xl font-semibold text-brand-700">Bem-vindo(a) ao Colégio Leibniz</h1>
        <p className="text-sm text-brand-500">
          Vamos completar seu cadastro — leva menos de 1 minuto.
        </p>
      </div>

      {/* Indicador de passos */}
      <ol className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 flex-col gap-1">
            <span
              className={cn(
                'h-1.5 rounded-full transition-colors',
                i <= step ? 'bg-brand-700' : 'bg-brand-100',
              )}
            />
            <span className={cn('text-[11px]', i === step ? 'text-brand-700' : 'text-brand-400')}>
              {label}
            </span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="flex flex-col gap-4">
          <Input
            label="Nome completo"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Como devemos te chamar?"
            autoFocus
          />
          <Input
            label="Telefone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(31) 99999-9999"
          />
          <Button onClick={() => setStep(1)} disabled={!canAdvanceStep1}>
            Continuar
          </Button>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-brand-500">
            Adicione uma foto para o time te reconhecer. Você pode pular e fazer isso depois.
          </p>
          <AvatarUploader
            userId={userId}
            name={name}
            currentUrl={avatarUrl}
            onUploaded={setAvatarUrl}
          />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep(2)}>
              Pular
            </Button>
            <Button onClick={() => setStep(2)} className="flex-1">
              Continuar
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={name} className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-700 text-2xl font-semibold text-canvas">
                {(name || email).charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-brand-700">{name}</p>
              <p className="truncate text-sm text-brand-500">{email}</p>
              <p className="text-xs text-brand-400">{ROLE_LABELS[role]}</p>
            </div>
          </div>
          {phone && <p className="text-sm text-brand-500">Telefone: {phone}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep(0)}>
              Voltar
            </Button>
            <Button onClick={finish} disabled={pending} className="flex-1">
              {pending ? 'Entrando...' : 'Entrar no CRM'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

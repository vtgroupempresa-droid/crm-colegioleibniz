'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
}

/**
 * UI amigável para error boundaries de rota (Fase 8). Cada error.tsx renderiza
 * este componente. Mensagem em PT-BR + botão "Tentar novamente".
 */
export function RouteError({ error, reset, title = 'Algo deu errado' }: RouteErrorProps) {
  useEffect(() => {
    // Log no console do servidor/cliente para diagnóstico.
    console.error('[RouteError]', error);
  }, [error]);

  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <svg
        width="64"
        height="64"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="text-brand-300"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <div>
        <h2 className="text-lg font-semibold text-brand-700">{title}</h2>
        <p className="mt-1 max-w-sm text-sm text-brand-500">
          Encontramos um problema ao carregar esta tela. Você pode tentar novamente — se
          persistir, recarregue a página.
        </p>
      </div>
      <Button onClick={reset}>Tentar novamente</Button>
    </div>
  );
}

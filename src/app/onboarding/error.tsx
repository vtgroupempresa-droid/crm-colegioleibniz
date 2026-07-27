'use client';

import { RouteError } from '@/components/ui/route-error';

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <RouteError {...props} title="Não foi possível iniciar o onboarding" />
    </main>
  );
}

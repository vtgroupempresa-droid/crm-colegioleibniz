import { Card } from '@/components/ui/card';
import { LoginForm } from './login-form';

interface PageProps {
  searchParams: { redirectTo?: string };
}

export default function LoginPage({ searchParams }: PageProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold text-brand-700">CRM Colégio Leibniz</h1>
          <p className="mt-2 text-sm text-brand-500">Entre com sua conta da escola.</p>
        </div>
        <Card>
          <LoginForm redirectTo={searchParams.redirectTo} />
        </Card>
      </div>
    </main>
  );
}

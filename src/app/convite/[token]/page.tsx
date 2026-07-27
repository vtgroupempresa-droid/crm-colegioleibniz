import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { AcceptInviteForm } from '@/components/invite/accept-invite-form';
import { getInvitationByToken } from '@/actions/invitations';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { token: string };
}

export default async function ConvitePage({ params }: PageProps) {
  const invite = await getInvitationByToken(params.token);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold text-brand-700">CRM Colégio Leibniz</h1>
          <p className="mt-2 text-sm text-brand-500">
            {invite ? 'Você foi convidado. Crie sua conta abaixo.' : 'Convite indisponível'}
          </p>
        </div>
        <Card>
          {invite ? (
            <AcceptInviteForm token={params.token} email={invite.email} role={invite.role} />
          ) : (
            <div className="flex flex-col gap-4 text-sm text-brand-500">
              <p>
                Este convite é inválido, já foi utilizado, foi revogado ou expirou. Peça ao
                administrador para gerar um novo link.
              </p>
              <Link href="/login" className="text-brand-700 underline-offset-2 hover:underline">
                Ir para o login
              </Link>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getSession, isAdmin } from '@/lib/auth/session';
import { getGoogleCalendarStatus } from '@/actions/google-calendar';
import { GoogleCalendarPanel } from '@/components/integrations/google-calendar-panel';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Integrações · CRM Colégio Leibniz' };

interface IntegrationCard {
  href: string | null;
  title: string;
  description: string;
  icon: string;
  soon?: boolean;
}

const ACTIVE: IntegrationCard[] = [
  {
    href: '/integracoes/webhooks',
    title: 'Webhooks',
    description:
      'Receba leads de qualquer fonte externa sem código. Configure mapeamento de campos e regras de tags pela interface.',
    icon: '🔗',
  },
  {
    href: '/integracoes/meta',
    title: 'Meta',
    description:
      'WhatsApp, Instagram e Lead Ads. Live chat unificado e captura automática de formulários.',
    icon: '🟦',
  },
];

const SOON: IntegrationCard[] = [
  {
    href: null,
    title: 'RD Station',
    description: 'Marketing e automação.',
    icon: '🟠',
    soon: true,
  },
  {
    href: null,
    title: 'ActiveCampaign',
    description: 'Email marketing e CRM.',
    icon: '🔵',
    soon: true,
  },
  {
    href: null,
    title: 'Google Ads',
    description: 'Importação de leads de campanhas.',
    icon: '🟡',
    soon: true,
  },
  {
    href: null,
    title: 'HubSpot',
    description: 'Sincronização bidirecional.',
    icon: '🟧',
    soon: true,
  },
];

interface IntegracoesPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const GOOGLE_CALENDAR_FEEDBACK: Record<string, { tone: 'ok' | 'error'; message: string }> = {
  conectada: { tone: 'ok', message: 'Google Calendar conectado com sucesso.' },
  erro_sem_codigo: { tone: 'error', message: 'Google não retornou o código de autorização.' },
  erro_state: { tone: 'error', message: 'Falha de segurança na autorização (state). Tente de novo.' },
  erro_token: { tone: 'error', message: 'Falha ao trocar o código por tokens. Tente de novo.' },
};

export default async function IntegracoesPage(props: IntegracoesPageProps) {
  const searchParams = await props.searchParams;
  const session = await getSession();
  if (!session) redirect('/login');
  if (!isAdmin(session.role)) redirect('/');

  const googleCalendarStatus = await getGoogleCalendarStatus();
  const gcParam = Array.isArray(searchParams.google_calendar)
    ? searchParams.google_calendar[0]
    : searchParams.google_calendar;
  const gcFeedback = gcParam ? GOOGLE_CALENDAR_FEEDBACK[gcParam] : undefined;

  return (
    <section className="flex flex-col gap-8">
      <header>
        <h2 className="text-2xl font-semibold text-brand-700">Integrações</h2>
        <p className="text-sm text-brand-500">
          Conecte fontes externas ao CRM. Acesso restrito a administradores.
        </p>
      </header>

      {gcFeedback && (
        <p
          className={
            gcFeedback.tone === 'ok'
              ? 'rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800'
              : 'rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700'
          }
        >
          {gcFeedback.message}
        </p>
      )}

      <GoogleCalendarPanel status={googleCalendarStatus} />

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-400">
          Disponíveis
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {ACTIVE.map((item) => (
            <Link key={item.title} href={item.href ?? '#'} className="focus-ring rounded-lg">
              <Card className="h-full transition-shadow hover:shadow-md">
                <div className="flex items-start gap-3">
                  <span className="text-2xl" aria-hidden="true">
                    {item.icon}
                  </span>
                  <div>
                    <p className="font-semibold text-brand-700">{item.title}</p>
                    <p className="mt-1 text-sm text-brand-500">{item.description}</p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-400">
          Em breve
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SOON.map((item) => (
            <Card key={item.title} className="h-full cursor-not-allowed opacity-60">
              <div className="flex items-start justify-between gap-2">
                <span className="text-2xl" aria-hidden="true">
                  {item.icon}
                </span>
                <Badge tone="neutral">Em breve</Badge>
              </div>
              <p className="mt-2 font-semibold text-brand-700">{item.title}</p>
              <p className="mt-1 text-xs text-brand-500">{item.description}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

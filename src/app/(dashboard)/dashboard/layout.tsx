import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '@/lib/auth/session';

/**
 * Guard de cargo de TODA a área /dashboard/* (inclui topo-funil, qualidade,
 * performance-individual, pipeline-forecast e leads-detalhado). A sidebar só
 * mostra o Dashboard para admin; sem este guard qualquer cargo logado abria
 * as rotas por URL direta. getSession é cacheada por request — custo zero.
 */
export default async function DashboardAreaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!isAdmin(session.role)) redirect('/');
  return <>{children}</>;
}

import { redirect } from 'next/navigation';
import { MetasForm } from '@/components/admin/metas-form';
import { UserGoalsForm } from '@/components/admin/user-goals-form';
import { UsersTable } from '@/components/admin/users-table';
import { InvitesManager } from '@/components/admin/invites-manager';
import { listInvitations } from '@/actions/invitations';
import { MetaImportPanel } from '@/components/integrations/meta-import-panel';
import { PipelinesManager } from '@/components/admin/pipelines-manager';
import { LeadMergeManager } from '@/components/admin/lead-merge-manager';
import { WhatsappInstancesManager } from '@/components/admin/whatsapp-instances-manager';
import { getDuplicateGroups } from '@/actions/merge';
import { getNameSimilarityCandidates } from '@/actions/duplicate-candidates';
import { listWhatsappInstances } from '@/actions/whatsapp-instances';
import type { PipelineGroup } from '@/actions/pipeline-stages';
import { createClient } from '@/lib/supabase/server';
import { isPipelineKind, type PipelineKind, type PipelineStage } from '@/types/pipeline';
import type { UserRole } from '@/types/user';
import { isUserRole } from '@/types/user';

export const dynamic = 'force-dynamic';

interface AdminUserRow {
  id: string;
  name: string;
  role: UserRole;
}

export default async function AdminPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: me } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (me?.role !== 'admin') {
    return (
      <section>
        <h2 className="text-2xl font-semibold text-brand-700">Admin</h2>
        <p className="mt-2 text-sm text-red-600">
          Acesso restrito a administradores. Sua role atual é{' '}
          <strong>{me?.role ?? 'desconhecida'}</strong>.
        </p>
      </section>
    );
  }

  const { data } = await supabase
    .from('user_profiles')
    .select('id, name, role')
    .order('name', { ascending: true });

  const users: AdminUserRow[] = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    role: isUserRole(row.role) ? row.role : 'comercial',
  }));

  const invites = await listInvitations();
  const duplicateGroups = await getDuplicateGroups();
  const nameCandidates = await getNameSimilarityCandidates();
  const whatsappInstances = await listWhatsappInstances();
  // Endpoint único da Meta (Instagram + WhatsApp Cloud) — o mesmo configurado
  // no painel do app. Exibido para copiar/colar na configuração da WABA.
  const whatsappWebhookUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/api/meta/webhook`;

  const { data: stagesData } = await supabase
    .from('pipeline_stages')
    .select('*')
    .order('pipeline', { ascending: true })
    .order('position', { ascending: true });
  const stages = (stagesData ?? []) as PipelineStage[];

  // Agrupa todos os stages (ativos + inativos) por pipeline para o editor.
  const pipelineGroups: PipelineGroup[] = [];
  const groupIndex = new Map<PipelineKind, PipelineGroup>();
  for (const stage of stages) {
    if (!isPipelineKind(stage.pipeline)) continue;
    let group = groupIndex.get(stage.pipeline);
    if (!group) {
      group = { pipeline: stage.pipeline, stages: [] };
      groupIndex.set(stage.pipeline, group);
      pipelineGroups.push(group);
    }
    group.stages.push(stage);
  }

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h2 className="text-2xl font-semibold text-brand-700">Admin</h2>
        <p className="mt-1 text-sm text-brand-500">
          Gestão de equipe e roles. {users.length} {users.length === 1 ? 'usuário' : 'usuários'}{' '}
          cadastrado{users.length === 1 ? '' : 's'}.
        </p>
      </header>
      <UsersTable users={users} currentUserId={user.id} />

      <section className="rounded-lg border border-brand-100 bg-white p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
          Convidar / criar usuários
        </h3>
        <p className="mt-1 text-sm text-brand-500">
          Gere um link de convite com o cargo desejado e envie para o e-mail da pessoa. Ela abre
          quando quiser, define a própria senha e a conta é criada já com o cargo escolhido. O link
          expira em 7 dias.
        </p>
        <div className="mt-4">
          <InvitesManager invites={invites} />
        </div>
      </section>

      <section className="rounded-lg border border-brand-100 bg-white p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
          Metas do mês
        </h3>
        <p className="mt-1 text-sm text-brand-500">
          Defina mês a mês as metas de leads, visitas e matrículas. Alimentam as barras de meta e
          os KPIs do Dashboard.
        </p>
        <div className="mt-4">
          <MetasForm initialMes={new Date().getMonth() + 1} initialAno={new Date().getFullYear()} />
        </div>
      </section>

      <section className="rounded-lg border border-brand-100 bg-white p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
          Metas individuais
        </h3>
        <p className="mt-1 text-sm text-brand-500">
          Meta mensal por pessoa do comercial: visitas agendadas, matrículas e faturamento.
          Alimenta o Dashboard › Performance Individual.
        </p>
        <div className="mt-4">
          <UserGoalsForm
            users={users.map((u) => ({ id: u.id, name: u.name, role: u.role }))}
            initialMes={new Date().getMonth() + 1}
            initialAno={new Date().getFullYear()}
          />
        </div>
      </section>

      <section className="rounded-lg border border-brand-100 bg-white p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">WhatsApp</h3>
        <p className="mt-1 text-sm text-brand-500">
          Linhas de atendimento WhatsApp (API oficial da Meta). Cada conversa mostra o badge da
          linha que a recebeu; o envio sai pelo mesmo número.
        </p>
        <div className="mt-4">
          <WhatsappInstancesManager instances={whatsappInstances} webhookUrl={whatsappWebhookUrl} />
        </div>
      </section>

      <section className="rounded-lg border border-brand-100 bg-white p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">Pipelines</h3>
        <p className="mt-1 text-sm text-brand-500">
          Edite as etapas do funil: arraste para reordenar, ajuste nome/cor/flags e campos
          obrigatórios, adicione novas ou desative (etapas com leads não podem ser desativadas). As
          mudanças refletem no board de Oportunidades.
        </p>
        <div className="mt-4">
          <PipelinesManager groups={pipelineGroups} />
        </div>
      </section>

      <section className="rounded-lg border border-brand-100 bg-white p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
          Importar do Meta
        </h3>
        <p className="mt-1 text-sm text-brand-500">
          Importação histórica de leads do Meta Lead Ads. Os leads entram sem responsável no
          pipeline escolhido para a equipe requalificar. Use o dry-run para simular antes de
          gravar.
        </p>
        <div className="mt-4">
          <MetaImportPanel stages={stages} />
        </div>
      </section>

      <section className="rounded-lg border border-brand-100 bg-white p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
          Unificar leads
        </h3>
        <p className="mt-1 text-sm text-brand-500">
          Leads são únicos: a mesma família que chega pelo Instagram e pelo WhatsApp deve virar um
          só registro. Aqui você revê duplicatas detectadas (telefone/email iguais), candidatos por
          similaridade de nome e unifica manualmente — o registro mais completo é mantido e o outro
          é arquivado com todo o histórico movido.
        </p>
        <div className="mt-4">
          <LeadMergeManager initialGroups={duplicateGroups} nameCandidates={nameCandidates} />
        </div>
      </section>
    </section>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMyDayData } from '@/actions/my-day';
import { formatRelative } from '@/lib/utils/format';

export const dynamic = 'force-dynamic';

function appointmentStatus(status: string, confirmed: boolean): string {
  if (confirmed) return 'Confirmada';
  if (status === 'realizado') return 'Realizada';
  return 'A confirmar';
}

/** Ponto de entrada individual do CRM: trabalho do dia da pessoa logada. */
export default async function MeuDiaPage() {
  const data = await getMyDayData();
  if (!data) redirect('/login');

  const overdue = data.tasks.filter((task) => task.isOverdue).length;

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-400">Meu dia</p>
          <h2 className="mt-1 text-2xl font-semibold text-brand-700">
            Olá, {data.userName.split(' ')[0]}. Vamos cuidar das famílias de hoje?
          </h2>
          <p className="mt-1 capitalize text-sm text-brand-500">{data.dateLabel}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/oportunidades"
            className="focus-ring inline-flex h-10 items-center justify-center rounded-md bg-brand-700 px-4 text-sm font-medium text-canvas hover:bg-brand-800"
          >
            Abrir funil
          </Link>
          <Link
            href="/calendario"
            className="focus-ring inline-flex h-10 items-center justify-center rounded-md bg-brand-100 px-4 text-sm font-medium text-brand-700 hover:bg-brand-200"
          >
            Ver agenda
          </Link>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-brand-100 bg-white p-4">
          <p className="text-xs font-medium text-brand-400">Minha carteira</p>
          <p className="mt-1 text-2xl font-semibold text-brand-700">{data.portfolioCount}</p>
          <p className="mt-1 text-xs text-brand-500">famílias sob sua responsabilidade</p>
        </div>
        <div className="rounded-xl border border-brand-100 bg-white p-4">
          <p className="text-xs font-medium text-brand-400">Novas para atender</p>
          <p className="mt-1 text-2xl font-semibold text-brand-700">{data.newLeadCount}</p>
          <p className="mt-1 text-xs text-brand-500">famílias na etapa de entrada</p>
        </div>
        <div className="rounded-xl border border-brand-100 bg-white p-4">
          <p className="text-xs font-medium text-brand-400">Visitas de hoje</p>
          <p className="mt-1 text-2xl font-semibold text-brand-700">{data.appointments.length}</p>
          <p className="mt-1 text-xs text-brand-500">agendadas para você</p>
        </div>
      </div>

      {data.unassignedLeadCount !== null && data.unassignedLeadCount > 0 && (
        <Link
          href="/leads?unassigned=1"
          className="focus-ring flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100"
        >
          <span>
            <strong>{data.unassignedLeadCount}</strong>{' '}
            {data.unassignedLeadCount === 1 ? 'família está' : 'famílias estão'} sem responsável.
          </span>
          <span className="shrink-0 font-semibold">Distribuir →</span>
        </Link>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
        <section className="rounded-xl border border-brand-100 bg-white">
          <div className="flex items-center justify-between border-b border-brand-100 px-4 py-3">
            <div>
              <h3 className="font-semibold text-brand-700">Prioridades de hoje</h3>
              <p className="mt-0.5 text-xs text-brand-400">
                {overdue > 0
                  ? `${overdue} ${overdue === 1 ? 'ação atrasada exige atenção' : 'ações atrasadas exigem atenção'}.`
                  : 'Conclua ou reagende; nenhuma família fica sem próximo passo.'}
              </p>
            </div>
            <Link href="/oportunidades" className="focus-ring text-xs font-semibold text-brand-600 hover:underline">
              Ver no funil
            </Link>
          </div>
          {data.tasks.length === 0 ? (
            <div className="p-6 text-center text-sm text-brand-400">
              Nenhuma ação pendente para hoje. Acompanhe sua agenda ou abra o funil.
            </div>
          ) : (
            <ul className="divide-y divide-brand-100">
              {data.tasks.map((task) => (
                <li key={task.id}>
                  <Link
                    href={task.leadId ? `/leads?lead=${task.leadId}` : '/oportunidades'}
                    className="focus-ring flex items-center justify-between gap-3 px-4 py-3 hover:bg-brand-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-brand-700">
                        {task.leadName ?? task.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-brand-500">
                        {task.leadName ? task.title : 'Ação da sua rotina'}
                        {task.childName ? ` · ${task.childName}` : ''}
                      </span>
                    </span>
                    <span
                      className={task.isOverdue ? 'shrink-0 text-xs font-semibold text-red-600' : 'shrink-0 text-xs text-brand-400'}
                    >
                      {formatRelative(task.dueAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-brand-100 bg-white">
          <div className="flex items-center justify-between border-b border-brand-100 px-4 py-3">
            <div>
              <h3 className="font-semibold text-brand-700">Agenda de hoje</h3>
              <p className="mt-0.5 text-xs text-brand-400">Visitas que você conduz ou acompanhou.</p>
            </div>
            <Link href="/calendario" className="focus-ring text-xs font-semibold text-brand-600 hover:underline">
              Agenda completa
            </Link>
          </div>
          {data.appointments.length === 0 ? (
            <div className="p-6 text-center text-sm text-brand-400">Nenhuma visita agendada para hoje.</div>
          ) : (
            <ul className="divide-y divide-brand-100">
              {data.appointments.map((appointment) => (
                <li key={appointment.id}>
                  <Link
                    href={`/leads?lead=${appointment.leadId}`}
                    className="focus-ring flex items-center justify-between gap-3 px-4 py-3 hover:bg-brand-50"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-brand-700">
                        {new Date(appointment.scheduledAt).toLocaleTimeString('pt-BR', {
                          timeZone: 'America/Sao_Paulo',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        · {appointment.leadName}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-brand-500">
                        {appointment.childName ?? 'Aluno(a) não informado'}
                      </span>
                    </span>
                    <span
                      className={appointment.confirmed ? 'shrink-0 text-xs font-semibold text-emerald-700' : 'shrink-0 text-xs font-semibold text-amber-700'}
                    >
                      {appointmentStatus(appointment.status, appointment.confirmed)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

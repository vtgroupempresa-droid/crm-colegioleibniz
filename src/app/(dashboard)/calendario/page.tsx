import { getAppointmentsForCalendar, listTeamMembers } from '@/actions/appointments';
import { getExternalEventsForCalendar } from '@/actions/google-calendar';
import { CalendarView } from '@/components/kanban/calendar-view';

export const dynamic = 'force-dynamic';

interface CalendarioPageProps {
  searchParams: { [key: string]: string | string[] | undefined };
}

function parseMonth(param: string | undefined): { year: number; month: number } {
  const now = new Date();
  if (param && /^\d{4}-\d{2}$/.test(param)) {
    const [y, m] = param.split('-').map(Number);
    return { year: y!, month: m! - 1 };
  }
  return { year: now.getFullYear(), month: now.getMonth() };
}

function ym(year: number, month: number): string {
  return `${year}-${(month + 1).toString().padStart(2, '0')}`;
}

/** Calendário mensal de visitas (cor por atendente, filtros, clique = editar). */
export default async function CalendarioPage({ searchParams }: CalendarioPageProps) {
  const monthParam = Array.isArray(searchParams.month) ? searchParams.month[0] : searchParams.month;
  const { year, month } = parseMonth(monthParam);

  const from = new Date(year, month, 1);
  const to = new Date(year, month + 1, 1);
  const [appointments, externalEvents, salespeople] = await Promise.all([
    getAppointmentsForCalendar(from.toISOString(), to.toISOString()),
    getExternalEventsForCalendar(from.toISOString(), to.toISOString()),
    listTeamMembers(),
  ]);

  const monthLabel = from.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const prev = new Date(year, month - 1, 1);
  const next = new Date(year, month + 1, 1);
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h2 className="text-2xl font-semibold text-brand-700">Calendário</h2>
        <p className="mt-1 text-sm text-brand-500">
          Visitas do mês. Cor por atendente; clique em um evento para editar.
        </p>
      </header>
      <CalendarView
        appointments={appointments}
        externalEvents={externalEvents}
        salespeople={salespeople}
        year={year}
        month={month}
        monthLabel={monthLabel}
        prevHref={`/calendario?month=${ym(prev.getFullYear(), prev.getMonth())}`}
        nextHref={`/calendario?month=${ym(next.getFullYear(), next.getMonth())}`}
        todayHref={`/calendario?month=${ym(now.getFullYear(), now.getMonth())}`}
      />
    </div>
  );
}

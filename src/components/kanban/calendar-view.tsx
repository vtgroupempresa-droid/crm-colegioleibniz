'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
import { Select } from '@/components/ui/select';
import { AppointmentEditModal } from './appointment-edit-modal';
import { type CalendarAppointment } from '@/actions/appointments';
import { type ExternalCalendarEvent } from '@/actions/google-calendar';
import { APPOINTMENT_STATUS_LABELS, type AppointmentStatus } from '@/types/appointment';

interface Person {
  id: string;
  name: string;
  role: string;
}

interface CalendarViewProps {
  appointments: CalendarAppointment[];
  /** Eventos da agenda Google que não são appointments (cinza, abre no Google). */
  externalEvents?: ExternalCalendarEvent[];
  salespeople: Person[];
  year: number;
  /** 0-11. */
  month: number;
  monthLabel: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
}

const CLOSER_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-purple-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-cyan-600',
  'bg-amber-500',
  'bg-rose-500',
];
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const RESPONSIBLE_NAMES = ['lucilia', 'nubia', 'lorraine'];

function firstNameNormalized(name: string) {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)[0];
}

export function CalendarView({
  appointments,
  externalEvents = [],
  salespeople,
  year,
  month,
  monthLabel,
  prevHref,
  nextHref,
  todayHref,
}: CalendarViewProps) {
  const [responsibleFilter, setResponsibleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  // A equipe do Leibniz usa este filtro único no lugar dos filtros separados
  // de closer e SDR. A comparação normalizada permite perfis como “Núbia”.
  const responsiblePeople = RESPONSIBLE_NAMES.flatMap((expectedName) =>
    salespeople.find((person) => firstNameNormalized(person.name) === expectedName) ?? [],
  );

  // Cor consistente por closer.
  const colorByCloser = useMemo(() => {
    const m = new Map<string, string>();
    let i = 0;
    for (const a of appointments) {
      if (a.assignedToId && !m.has(a.assignedToId)) {
        m.set(a.assignedToId, CLOSER_COLORS[i % CLOSER_COLORS.length]!);
        i += 1;
      }
    }
    return m;
  }, [appointments]);

  const filtered = useMemo(
    () =>
      appointments.filter((a) => {
        if (
          responsibleFilter !== 'all' &&
          a.assignedToId !== responsibleFilter &&
          a.createdById !== responsibleFilter
        ) {
          return false;
        }
        if (statusFilter !== 'all' && a.status !== statusFilter) return false;
        return true;
      }),
    [appointments, responsibleFilter, statusFilter],
  );

  const byDay = useMemo(() => {
    const m = new Map<number, CalendarAppointment[]>();
    for (const a of filtered) {
      const d = new Date(a.scheduledAt);
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;
      const list = m.get(d.getDate()) ?? [];
      list.push(a);
      m.set(d.getDate(), list);
    }
    return m;
  }, [filtered, year, month]);

  // Eventos externos (agenda Google) ficam fora dos filtros de closer/SDR/status.
  const externalByDay = useMemo(() => {
    const m = new Map<number, ExternalCalendarEvent[]>();
    for (const e of externalEvents) {
      if (!e.startAt) continue;
      const d = new Date(e.startAt);
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;
      const list = m.get(d.getDate()) ?? [];
      list.push(e);
      m.set(d.getDate(), list);
    }
    return m;
  }, [externalEvents, year, month]);

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const timeFmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const selectedEvents = selectedDay ? (byDay.get(selectedDay) ?? []) : [];
  const selectedExternal = selectedDay ? (externalByDay.get(selectedDay) ?? []) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={prevHref}
            className="focus-ring rounded-md border border-brand-200 px-2 py-1 text-sm hover:bg-brand-100"
          >
            ‹
          </Link>
          <span className="min-w-40 text-center text-lg font-semibold capitalize text-brand-700">
            {monthLabel}
          </span>
          <Link
            href={nextHref}
            className="focus-ring rounded-md border border-brand-200 px-2 py-1 text-sm hover:bg-brand-100"
          >
            ›
          </Link>
          <Link
            href={todayHref}
            className="focus-ring rounded-md border border-brand-200 px-2 py-1 text-xs hover:bg-brand-100"
          >
            Hoje
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={responsibleFilter} onChange={(e) => setResponsibleFilter(e.target.value)}>
            <option value="all">Responsável</option>
            {responsiblePeople.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">Todos os status</option>
            {(Object.keys(APPOINTMENT_STATUS_LABELS) as AppointmentStatus[]).map((s) => (
              <option key={s} value={s}>
                {APPOINTMENT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-brand-100 bg-white">
        <div className="grid grid-cols-7 border-b border-brand-100 bg-brand-50 text-center text-xs font-medium text-brand-500">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-2">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, idx) => {
            const events = day ? (byDay.get(day) ?? []) : [];
            const external = day ? (externalByDay.get(day) ?? []) : [];
            const isSelected = day !== null && day === selectedDay;
            return (
              <div
                key={idx}
                className={cn(
                  'min-h-24 border-b border-r border-brand-50 p-1',
                  !day && 'bg-brand-50/40',
                  isSelected && 'bg-brand-50 ring-1 ring-inset ring-brand-300',
                )}
              >
                {day && (
                  <>
                    <button
                      type="button"
                      onClick={() => setSelectedDay(day)}
                      className={cn(
                        'focus-ring rounded px-1 text-[11px] font-medium',
                        isSelected ? 'text-brand-700' : 'text-brand-500',
                      )}
                    >
                      {day}
                    </button>
                    <div className="mt-1 flex flex-col gap-0.5">
                      {events.slice(0, 3).map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => setEditId(a.id)}
                          title={`${timeFmt(a.scheduledAt)} · ${a.leadName} · ${a.assignedToName ?? 'sem closer'}`}
                          className={cn(
                            'truncate rounded px-1 py-0.5 text-left text-[10px] text-white',
                            a.assignedToId ? (colorByCloser.get(a.assignedToId) ?? 'bg-brand-400') : 'bg-brand-400',
                            a.status === 'cancelado' && 'opacity-50 line-through',
                          )}
                        >
                          {timeFmt(a.scheduledAt)} {a.leadName}
                        </button>
                      ))}
                      {events.length > 3 && (
                        <button
                          type="button"
                          onClick={() => setSelectedDay(day)}
                          className="focus-ring text-left text-[10px] text-brand-400"
                        >
                          +{events.length - 3} mais
                        </button>
                      )}
                      {external.slice(0, 2).map((e) => (
                        <a
                          key={e.id}
                          href={e.htmlLink ?? '#'}
                          target="_blank"
                          rel="noreferrer"
                          title={`${e.allDay ? 'dia inteiro' : timeFmt(e.startAt!)} · ${e.summary ?? 'Evento da agenda Google'} · abre no Google Calendar`}
                          className="truncate rounded border border-brand-200 bg-brand-50 px-1 py-0.5 text-left text-[10px] text-brand-500"
                        >
                          {e.allDay ? '📅' : timeFmt(e.startAt!)} {e.summary ?? 'Agenda Google'}
                        </a>
                      ))}
                      {external.length > 2 && (
                        <button
                          type="button"
                          onClick={() => setSelectedDay(day)}
                          className="focus-ring text-left text-[10px] text-brand-400"
                        >
                          +{external.length - 2} da agenda
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {selectedDay && (
        <div className="rounded-lg border border-brand-100 bg-white p-4">
          <h3 className="text-sm font-semibold text-brand-700">
            Dia {selectedDay} · {selectedEvents.length} agendamento(s)
            {selectedExternal.length > 0 && ` · ${selectedExternal.length} da agenda Google`}
          </h3>
          {selectedEvents.length === 0 && selectedExternal.length === 0 ? (
            <p className="mt-2 text-sm text-brand-400">Nenhum agendamento neste dia.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {selectedEvents.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setEditId(a.id)}
                    className="focus-ring flex w-full items-center justify-between gap-2 rounded-md border border-brand-100 px-3 py-2 text-left text-sm hover:bg-brand-50"
                  >
                    <span className="min-w-0">
                      <span className="font-medium text-brand-700">
                        {timeFmt(a.scheduledAt)} · {a.leadName}
                      </span>
                      <span className="block text-xs text-brand-400">
                        Closer: {a.assignedToName ?? '—'} · SDR: {a.createdByName ?? '—'}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] text-brand-600">
                      {APPOINTMENT_STATUS_LABELS[a.status]}
                    </span>
                  </button>
                </li>
              ))}
              {selectedExternal.map((e) => (
                <li key={e.id}>
                  <a
                    href={e.htmlLink ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="focus-ring flex w-full items-center justify-between gap-2 rounded-md border border-dashed border-brand-200 bg-brand-50/50 px-3 py-2 text-left text-sm hover:bg-brand-50"
                  >
                    <span className="min-w-0">
                      <span className="font-medium text-brand-600">
                        {e.allDay ? 'Dia inteiro' : timeFmt(e.startAt!)} ·{' '}
                        {e.summary ?? 'Evento da agenda Google'}
                      </span>
                      <span className="block text-xs text-brand-400">
                        Agenda Google · abre no Google Calendar ↗
                      </span>
                    </span>
                    {e.meetLink && (
                      <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] text-sky-700">
                        Meet
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <AppointmentEditModal
        open={editId !== null}
        onClose={() => setEditId(null)}
        appointmentId={editId}
      />
    </div>
  );
}

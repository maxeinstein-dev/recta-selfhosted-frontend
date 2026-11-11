/**
 * Pure logic of the yearly calendar (Renda > Calendário do ano): the events of GET /payroll/events, one entry each, put
 * under the month of the PAYMENT date (not the competence), with the month and year totals split into what is estimated
 * and what is not. No React: tools/fe-tests/t32_income_simulator.mts runs it under tsx (CALENDAR_MODULE points it at a
 * mutated copy).
 *
 * Money: the API answers in reais; every sum is in whole cents. Days are 'YYYY-MM-DD', months 'YYYY-MM'.
 */
import { monthOf, toCents, type PayrollEvents } from './income';

export type CalendarKind = 'salary' | 'thirteenth' | 'vacation' | 'birthday' | 'benefit';

export interface CalendarEntry {
  key: string;
  kind: CalendarKind;
  /** Payment date: the entry sits in the month of this day. */
  date: string;
  employmentId: string;
  amountCents: number;
  estimated: boolean;
  availableCash: boolean;
  /** Salary: the month it refers to ('YYYY-MM'). */
  competence?: string;
  /** 13th installment (1 or 2). */
  installment?: 1 | 2;
  /** Benefit: its name and counted days. */
  name?: string;
  days?: number;
  /** Vacation: the period it covers (inclusive days) and its length. */
  periodStart?: string;
  periodEnd?: string;
  periodDays?: number;
}

export interface CalendarMonth {
  /** 'YYYY-MM' */
  month: string;
  entries: CalendarEntry[];
  totalCents: number;
  estimatedCents: number;
  /** Total minus estimated: what is not estimated. */
  firmCents: number;
  /** Before the current month. */
  past: boolean;
  current: boolean;
}

export interface CalendarYear {
  year: number;
  months: CalendarMonth[];
  totalCents: number;
  estimatedCents: number;
  firmCents: number;
}

const KIND_ORDER: Record<CalendarKind, number> = { salary: 0, thirteenth: 1, vacation: 2, birthday: 3, benefit: 4 };

/** The first and last day of a year. */
export function yearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Every event of the sets as one flat list of entries (not yet grouped). */
export function calendarEntries(sets: readonly PayrollEvents[]): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  for (const set of sets) {
    const id = set.employmentId;
    for (const s of set.salary) {
      out.push({ key: `sal:${id}:${s.competence}`, kind: 'salary', date: s.paymentDate, employmentId: id, amountCents: toCents(s.net), estimated: s.estimated, availableCash: true, competence: s.competence });
    }
    for (const t of set.thirteenth) {
      out.push({ key: `13:${id}:${t.year}:${t.installment}`, kind: 'thirteenth', date: t.date, employmentId: id, amountCents: toCents(t.net), estimated: t.estimated, availableCash: true, installment: t.installment });
    }
    for (const v of set.vacations) {
      out.push({
        key: `vac:${id}:${v.id}`,
        kind: 'vacation',
        date: v.paymentDate,
        employmentId: id,
        amountCents: toCents(v.net),
        estimated: v.estimated,
        availableCash: true,
        periodStart: v.period.start,
        periodEnd: v.period.end,
        periodDays: v.period.days,
      });
    }
    for (const b of set.birthdayWithdrawals) {
      out.push({ key: `bday:${id}:${b.date}`, kind: 'birthday', date: b.date, employmentId: id, amountCents: toCents(b.amount), estimated: true, availableCash: true });
    }
    for (const b of set.benefits) {
      out.push({
        key: `ben:${id}:${b.itemId}:${b.referenceMonth}`,
        kind: 'benefit',
        date: b.paymentDate,
        employmentId: id,
        amountCents: toCents(b.amount),
        estimated: true,
        availableCash: b.isAvailableCash,
        name: b.name,
        days: b.countedDays,
      });
    }
  }
  return out;
}

/** Day, then kind, then key: the order inside a month. */
export function compareEntries(a: CalendarEntry, b: CalendarEntry): number {
  return a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.key.localeCompare(b.key);
}

/**
 * The twelve months of a year, each with its entries (by payment date), its total, the part that is estimated and the
 * rest. `today` only marks the past and current months; nothing is filtered by it here (the API already leaves out the
 * 13th and vacations paid before today).
 */
export function buildCalendarYear(sets: readonly PayrollEvents[], year: number, today: string): CalendarYear {
  const entries = calendarEntries(sets).filter((e) => e.date.startsWith(`${year}-`));
  const current = monthOf(today);
  const months: CalendarMonth[] = [];
  for (let n = 1; n <= 12; n++) {
    const month = `${year}-${pad(n)}`;
    const mine = entries.filter((e) => monthOf(e.date) === month).sort(compareEntries);
    const totalCents = mine.reduce((sum, e) => sum + e.amountCents, 0);
    const estimatedCents = mine.reduce((sum, e) => (e.estimated ? sum + e.amountCents : sum), 0);
    months.push({ month, entries: mine, totalCents, estimatedCents, firmCents: totalCents - estimatedCents, past: month < current, current: month === current });
  }
  const totalCents = months.reduce((sum, m) => sum + m.totalCents, 0);
  const estimatedCents = months.reduce((sum, m) => sum + m.estimatedCents, 0);
  return { year, months, totalCents, estimatedCents, firmCents: totalCents - estimatedCents };
}

/** Whether the year has any month before the current one (then the note about the 13th and vacations applies). */
export const yearHasPast = (year: number, today: string): boolean => `${year}-01` < monthOf(today);

/**
 * Pure logic of the mobile Extrato (below 768 px, lote R1): the month's period, the day headers and their totals, the
 * short filter pills and the preview of the capture box. No React and no imports from the app, so
 * tools/fe-tests/t36_extrato_mobile.mts runs it under tsx (EXTRATO_MOBILE_MODULE points it at a mutated copy).
 */

export type ShortFilter = 'todos' | 'despesas' | 'receitas' | 'cartao';

/** The pills of the Extrato, in order. */
export const SHORT_FILTERS: readonly { id: ShortFilter; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'despesas', label: 'Despesas' },
  { id: 'receitas', label: 'Receitas' },
  { id: 'cartao', label: 'No cartão' },
];

const WEEKDAYS_PT = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;
const MONTHS_SHORT_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;

/** The first and last instant of a month key ('YYYY-MM'), in local time. The last one is 23:59:59.999 of the last day. */
export function monthBounds(monthKey: string): { startDate: Date; endDate: Date } {
  const [y, m] = monthKey.split('-').map(Number);
  return {
    startDate: new Date(y, m - 1, 1, 0, 0, 0, 0),
    endDate: new Date(y, m, 0, 23, 59, 59, 999),
  };
}

/** The day key ('YYYY-MM-DD') of a date in local time. */
export function dayKeyOf(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The day key a day before `dayKey` (the day keys are plain calendar days, so local time is never involved). */
function previousDayKey(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return dayKeyOf(new Date(y, m - 1, d - 1));
}

/**
 * The header of a day group: "Hoje", "Ontem", or the weekday and the day with its month ("terça, 10 nov"). The
 * weekday comes from the calendar day itself, so it does not shift with the time zone.
 */
export function dayLabel(dayKey: string, todayKey: string): string {
  if (dayKey === todayKey) return 'Hoje';
  if (dayKey === previousDayKey(todayKey)) return 'Ontem';
  const [y, m, d] = dayKey.split('-').map(Number);
  const weekday = WEEKDAYS_PT[new Date(y, m - 1, d).getDay()];
  return `${weekday}, ${d} ${MONTHS_SHORT_PT[m - 1]}`;
}

/** The effect of a transaction on the day's total: income adds, expense takes away, transfers and allocations are 0. */
export function signedAmount(type: string, amount: number): number {
  const value = Math.abs(Number(amount) || 0);
  if (type === 'INCOME') return value;
  if (type === 'EXPENSE') return -value;
  return 0;
}

export interface DayRow {
  id: string;
  dayKey: string;
  amount: number;
}

export interface DayGroup<T extends DayRow> {
  dayKey: string;
  /** Sum of the signed amounts of the rows of the day. */
  total: number;
  items: T[];
}

/** Groups the rows by day, the newest day first. Rows keep the order they came in inside each day. */
export function groupByDay<T extends DayRow>(rows: readonly T[]): DayGroup<T>[] {
  const byDay = new Map<string, DayGroup<T>>();
  for (const row of rows) {
    let group = byDay.get(row.dayKey);
    if (!group) {
      group = { dayKey: row.dayKey, total: 0, items: [] };
      byDay.set(row.dayKey, group);
    }
    group.items.push(row);
    group.total += row.amount;
  }
  return [...byDay.values()].sort((a, b) => (a.dayKey < b.dayKey ? 1 : a.dayKey > b.dayKey ? -1 : 0));
}

/** Whether a row passes a pill. Despesas and Receitas read the sign of the type; No cartão reads the account. */
export function matchesShortFilter(row: { type: string; onCard: boolean }, filter: ShortFilter): boolean {
  switch (filter) {
    case 'todos':
      return true;
    case 'despesas':
      return row.type === 'EXPENSE';
    case 'receitas':
      return row.type === 'INCOME';
    case 'cartao':
      return row.onCard;
  }
}

/** How many captures the box shows: the first one while collapsed, all of them when open, and how many stay hidden. */
export function captureVisibleCount(total: number, open: boolean): { visible: number; rest: number } {
  const visible = open ? total : Math.min(1, total);
  return { visible, rest: total - visible };
}

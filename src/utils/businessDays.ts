/**
 * Client twin of the server's Brazilian business-day calendar (`br-calendar.ts` of the backend): the same rules, so the
 * form preview, the list and the "Confirmar recebimento" dialog show the days the server counts. Business day = Monday to
 * Friday that is not a national holiday (fixed ones, Consciência Negra from 2024, Good Friday), not an optional
 * holiday the recurrence switched on (Carnaval Monday and Tuesday, Corpus Christi) and not one of its "dias sem vale"
 * ('MM-DD' every year or 'YYYY-MM-DD'). Calendar arithmetic on UTC dates: the time zone of the browser never shifts a
 * day. No React, no axios and no `import.meta`, so it also runs under `tsx`.
 */
export type OptionalHoliday = 'CARNIVAL' | 'CORPUS_CHRISTI';
export const OPTIONAL_HOLIDAYS: readonly OptionalHoliday[] = ['CARNIVAL', 'CORPUS_CHRISTI'];

export interface CalendarOptions {
  optionalHolidays?: readonly string[] | null;
  nonWorkingDays?: readonly string[] | null;
}

const FIRST_YEAR_BLACK_AWARENESS = 2024;
const FIXED_HOLIDAYS: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [4, 21], [5, 1], [9, 7], [10, 12], [11, 2], [11, 15], [11, 20], [12, 25],
];

const pad = (n: number, size = 2): string => String(n).padStart(size, '0');
const keyOf = (d: Date): string => `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d));
const shift = (d: Date, days: number): Date => new Date(d.getTime() + days * 86_400_000);

/** Easter Sunday of `year` (Meeus/Jones/Butcher), as a UTC date. */
export function easterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  return utc(year, Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1);
}

/** 'YYYY-MM-DD' of Easter Sunday. */
export const easterSunday = (year: number): string => keyOf(easterDate(year));

/** Days off of a year (holidays + the recurrence's own days), 'YYYY-MM-DD'. */
function offDays(year: number, options: CalendarOptions): Set<string> {
  const off = new Set<string>();
  for (const [m, d] of FIXED_HOLIDAYS) {
    if (m === 11 && d === 20 && year < FIRST_YEAR_BLACK_AWARENESS) continue;
    off.add(keyOf(utc(year, m, d)));
  }
  const easter = easterDate(year);
  off.add(keyOf(shift(easter, -2))); // Good Friday
  const optional = options.optionalHolidays ?? [];
  if (optional.includes('CARNIVAL')) {
    off.add(keyOf(shift(easter, -48)));
    off.add(keyOf(shift(easter, -47)));
  }
  if (optional.includes('CORPUS_CHRISTI')) off.add(keyOf(shift(easter, 60)));
  for (const entry of options.nonWorkingDays ?? []) {
    const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entry);
    if (full) {
      if (Number(full[1]) === year) off.add(entry);
    } else if (/^\d{2}-\d{2}$/.test(entry)) {
      off.add(`${pad(year, 4)}-${entry}`);
    }
  }
  return off;
}

/** Business days of a month ('YYYY-MM'); 0 for a malformed month. */
export function businessDaysInMonth(month: string, options: CalendarOptions = {}): number {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return 0;
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const off = offDays(year, options);
  const last = utc(year, mon + 1, 0).getUTCDate();
  let count = 0;
  for (let day = 1; day <= last; day += 1) {
    const date = utc(year, mon, day);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !off.has(keyOf(date))) count += 1;
  }
  return count;
}

/** True for 'MM-DD' (02-29 accepted) or a real 'YYYY-MM-DD'. */
export function isValidNonWorkingDay(value: string): boolean {
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (full) return keyOf(utc(Number(full[1]), Number(full[2]), Number(full[3]))) === value;
  const part = /^(\d{2})-(\d{2})$/.exec(value);
  if (!part) return false;
  const month = Number(part[1]);
  return month >= 1 && month <= 12 && keyOf(utc(2000, month, Number(part[2]))) === `2000-${value}`;
}

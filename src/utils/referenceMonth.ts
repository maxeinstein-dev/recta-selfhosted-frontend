/**
 * Pure logic of the reference month (competencia): income such as a meal voucher is deposited on 25 Sep but belongs to
 * October. The server keeps `competenceMonth` ('YYYY-MM', null = the month of the date) on a transaction and
 * `competenceOffsetMonths` (0..12, null = same month) on a recurrence. Balances and the calendar follow the DATE; month
 * planning (the month summaries, budgets, reports) follows the effective month. No React, no axios and no
 * `import.meta`, so it also runs under `tsx`.
 */

export interface MonthRef {
  /** A local Date, or 'YYYY-MM-DD' (an ISO timestamp is fine: the date part is used). */
  date: Date | string;
  competenceMonth?: string | null;
  type?: string;
}

/** The server accepts a reference month at most this many months away from the date. */
export const MAX_COMPETENCE_DISTANCE = 24;
/** Largest offset a recurrence takes. */
export const MAX_OFFSET_MONTHS = 12;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isMonthKey = (value: unknown): value is string => typeof value === 'string' && MONTH_RE.test(value);

/** 'YYYY-MM' of a local Date or of the date part of a string; '' when it is neither. */
export function monthKeyOf(date: Date | string | null | undefined): string {
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) return '';
    return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  const match = typeof date === 'string' ? /^(\d{4}-\d{2})/.exec(date) : null;
  return match ? match[1] : '';
}

/** 'YYYY-MM' moved by n months. */
export function addMonthsKey(month: string, n: number): string {
  const idx = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${String(Math.floor(idx / 12)).padStart(4, '0')}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Months from a to b ('YYYY-MM'). */
export function monthsBetween(a: string, b: string): number {
  return Number(b.slice(0, 4)) * 12 + Number(b.slice(5, 7)) - (Number(a.slice(0, 4)) * 12 + Number(a.slice(5, 7)));
}

/** The month a row counts for in month planning: its reference month when set, else the month of its date. */
export function effectiveMonthOf(row: MonthRef): string {
  return isMonthKey(row.competenceMonth) ? row.competenceMonth : monthKeyOf(row.date);
}

/** '2026-10' as '10/2026'. */
export function monthLabel(month: string): string {
  return isMonthKey(month) ? `${month.slice(5, 7)}/${month.slice(0, 4)}` : month;
}

/**
 * The small chip of a list row: "ref. 10/2026" when the row counts in another month than the one of its date (null
 * when it has no reference month, or the same month as the date: nothing to say).
 */
export function referenceChip(row: MonthRef): string | null {
  if (!isMonthKey(row.competenceMonth)) return null;
  if (row.type === 'TRANSFER' || row.type === 'ALLOCATION') return null;
  const own = monthKeyOf(row.date);
  if (!own || own === row.competenceMonth) return null;
  return `ref. ${monthLabel(row.competenceMonth)}`;
}

/** The month a freshly switched-on "Referente a outro mês" starts at: the month after the date. */
export function defaultReferenceMonth(date: Date | string): string {
  const own = monthKeyOf(date);
  return own ? addMonthsKey(own, 1) : '';
}

/** Why a reference month cannot be used with this date, or null when it can. */
export function referenceMonthError(competenceMonth: string, date: Date | string): string | null {
  if (!isMonthKey(competenceMonth)) return 'Informe o mês de referência.';
  const own = monthKeyOf(date);
  if (own && Math.abs(monthsBetween(own, competenceMonth)) > MAX_COMPETENCE_DISTANCE) {
    return `O mês de referência deve ficar a no máximo ${MAX_COMPETENCE_DISTANCE} meses da data.`;
  }
  return null;
}

/**
 * What the form sends as `competenceMonth`: the chosen month when the toggle is on (and the month is usable), null
 * when it is off (clears one that was set), undefined when the toggle is on but the month is not usable.
 */
export function competenceToSend(enabled: boolean, month: string, date: Date | string): string | null | undefined {
  if (!enabled) return null;
  return referenceMonthError(month, date) === null ? month : undefined;
}

// ---- Recurrences -------------------------------------------------------------------------------------------

export interface OffsetOption {
  value: number;
  label: string;
}

/** "Referente a: mesmo mês / mês seguinte / em 2 meses". */
export const OFFSET_OPTIONS: readonly OffsetOption[] = [
  { value: 0, label: 'Mesmo mês' },
  { value: 1, label: 'Mês seguinte' },
  { value: 2, label: 'Em 2 meses' },
];

export const OFFSET_LABEL = 'Referente a';
export const OFFSET_HELP = 'Quando o dinheiro cai num mês mas é referente a outro (vale-alimentação pago no fim do mês anterior).';

/** Text of an offset: 0 same month, 1 following month, n "em n meses". */
export function offsetLabel(offset: number | null | undefined): string {
  if (offset === null || offset === undefined || offset === 0) return 'Mesmo mês';
  if (offset === 1) return 'Mês seguinte';
  return `Em ${offset} meses`;
}

/** The offset a form field holds as a select value ('' = none). */
export function offsetFromSelect(value: string): number | null {
  if (value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= MAX_OFFSET_MONTHS ? n : null;
}

/** The select value of an offset. */
export const offsetToSelect = (offset: number | null | undefined): string => (offset === null || offset === undefined ? '' : String(offset));

/**
 * What a recurrence form sends: a number to set it, null to clear it. "Mesmo mês" is stored as null (nothing to stamp)
 * so a recurrence without a real offset behaves exactly as before.
 */
export function offsetToSend(offset: number | null | undefined): number | null {
  return typeof offset === 'number' && Number.isInteger(offset) && offset >= 1 && offset <= MAX_OFFSET_MONTHS ? offset : null;
}

/** Chip of a recurrence list row ("ref. mês seguinte"), or null for the same month. */
export function recurrenceChip(offset: number | null | undefined): string | null {
  const sent = offsetToSend(offset);
  return sent === null ? null : `ref. ${offsetLabel(sent).toLowerCase()}`;
}

/** The reference month an occurrence dated `date` of a recurrence with this offset is born with, or null. */
export function occurrenceCompetence(date: Date | string, offset: number | null | undefined): string | null {
  const sent = offsetToSend(offset);
  const own = monthKeyOf(date);
  return sent === null || !own ? null : addMonthsKey(own, sent);
}

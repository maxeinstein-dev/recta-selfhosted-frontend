/**
 * Pure logic of "acompanhar o último valor" (phase 5, adjustment of 05/10): a recurrence that follows the last amount
 * takes the amount of the most recent occurrence the user edits. The server decides (in the transaction update route);
 * the client only warns before saving and confirms after. No React, no axios and no `import.meta`, so it also runs
 * under `tsx`.
 */
import { moneyText } from './people';

export const FOLLOW_LAST_LABEL = 'Acompanhar o último valor';
export const FOLLOW_LAST_HELP = 'O valor da ocorrência mais recente que você ajustar passa a ser o valor dos próximos meses.';
export const FOLLOW_LAST_BADGE = 'acompanha o último valor';
export const FOLLOW_LAST_HINT = 'Este valor será usado nos próximos meses';

/** A transaction counts as "the most recent occurrence" only up to this many days after today. */
export const LATEST_WINDOW_DAYS = 31;

export interface OccurrenceRef {
  id?: string;
  /** YYYY-MM-DD (an ISO timestamp is fine: the date part is used) or a Date (local day). */
  date: string | Date;
  recurringTransactionId?: string | null;
}

export interface RecurrenceRef {
  id?: string;
  followLastAmount?: boolean;
  /**
   * Server-computed: the newest transaction date of the recurrence that is not beyond today + 31 days (YYYY-MM-DD), or
   * null when there is none. Absent (undefined) on an older server: the client then falls back to a heuristic.
   */
  lastOccurrenceDate?: string | null;
}

/** The notice the transaction update response carries when it changed the recurrence. */
export interface RecurrenceUpdatedNotice {
  id: string;
  amount: number;
}

/** YYYY-MM-DD of a string (date part) or a Date (local day); '' when it is neither. */
export function dayKey(value: string | Date | null | undefined): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const match = typeof value === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(value) : null;
  return match ? match[1] : '';
}

/** YYYY-MM-DD of `today` plus `days`, in the local calendar. */
export function addDaysKey(today: Date, days: number): string {
  return dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days));
}

/**
 * Whether `tx` is the most recent occurrence of its recurrence among the transactions the client knows: its date is not
 * beyond today + 31 days, no other known occurrence of the same recurrence is later (and also within that limit), and
 * the known list reaches back to it (a transaction older than everything listed cannot be judged: no hint).
 */
export function isLatestOccurrence(tx: OccurrenceRef, known: readonly OccurrenceRef[], today: Date): boolean {
  const recurrenceId = tx.recurringTransactionId;
  const own = dayKey(tx.date);
  if (!recurrenceId || !own) return false;
  const limit = addDaysKey(today, LATEST_WINDOW_DAYS);
  if (own > limit) return false;
  const keys = known.map((k) => dayKey(k.date)).filter(Boolean);
  if (keys.length === 0) return false;
  if (own < keys.reduce((min, k) => (k < min ? k : min), keys[0])) return false;
  for (const other of known) {
    if ((tx.id !== undefined && other.id === tx.id) || other.recurringTransactionId !== recurrenceId) continue;
    const key = dayKey(other.date);
    if (key && key <= limit && key > own) return false;
  }
  return true;
}

/** The hint to show next to the amount of the edited transaction, or null. */
export function followLastHint(
  tx: OccurrenceRef | null | undefined,
  recurrences: readonly RecurrenceRef[],
  known: readonly OccurrenceRef[],
  today: Date,
): string | null {
  if (!tx || !tx.recurringTransactionId) return null;
  const recurrence = recurrences.find((r) => r.id === tx.recurringTransactionId);
  if (!recurrence || recurrence.followLastAmount !== true) return null;
  if (recurrence.lastOccurrenceDate !== undefined) {
    // The server knows the newest occurrence: no guessing from the page of transactions the client happens to hold.
    const own = dayKey(tx.date);
    const last = dayKey(recurrence.lastOccurrenceDate);
    return own && last && own <= addDaysKey(today, LATEST_WINDOW_DAYS) && own >= last ? FOLLOW_LAST_HINT : null;
  }
  return isLatestOccurrence(tx, known, today) ? FOLLOW_LAST_HINT : null;
}

/**
 * Whether the amount in an edit differs from the stored one, in integer cents. An update that does not change the amount
 * must not send it: a recurrence that follows the last amount adopts whatever amount the update carries.
 */
export function amountChanged(stored: number | null | undefined, edited: number | null | undefined): boolean {
  const cents = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100 + (v < 0 ? -1e-6 : 1e-6)) : null);
  return cents(stored) !== cents(edited);
}

/** "Recorrência atualizada para R$ 120,00", or null when the response did not change the recurrence. */
export function recurrenceUpdatedMessage(
  notice: { id?: unknown; amount?: unknown } | null | undefined,
  formatAmount?: (value: number) => string,
): string | null {
  if (!notice || typeof notice.id !== 'string' || !notice.id) return null;
  const amount = Number(notice.amount);
  if (!Number.isFinite(amount)) return null;
  const text = formatAmount ? formatAmount(amount) : moneyText(Math.round(amount * 100 + (amount < 0 ? -1e-6 : 1e-6)));
  return `Recorrência atualizada para ${text}`;
}

/**
 * Pure logic of "Confirmar recebimento" / "Confirmar pagamento": a PENDING transaction (a forecast, usually an expected
 * income such as a meal voucher) is confirmed with the amount and the date it really had. The dialog sends the existing
 * update (PATCH {amount, date, paid:true}), so the balance moves once with the ACTUAL amount and date, the reference
 * month is untouched and a recurrence that follows the last amount learns the new value. Everything here is integer
 * cents; reais appear only at the edges. No React, no axios and no `import.meta`, so it also runs under `tsx`.
 */
import { followLastHint, dayKey } from './recurringFollow';
import type { OccurrenceRef, RecurrenceRef } from './recurringFollow';
import { centsToReais, moneyText, reaisToCents } from './people';
import { updateFailureMessage } from './transactionConflict';
import { confirmedValueNote, expectedAmountOf } from './forecastStrategy';
import type { ForecastFields, ForecastStrategy } from './forecastStrategy';

export interface ConfirmableTx {
  id?: string;
  type?: string;
  amount: number;
  /** A local Date, or 'YYYY-MM-DD'. */
  date: Date | string;
  paid?: boolean;
  notes?: string | null;
  recurringTransactionId?: string | null;
  /** Reference month 'YYYY-MM' the row already has (null = the month of its date). */
  competenceMonth?: string | null;
}

/** Most digits an amount may have (cents included): 9 integer digits and 2 decimals. */
const MAX_DIGITS = 11;

/** A confirmation exists for a pending income or expense (never for a transfer, an allocation or a paid row). */
export function isConfirmable(tx: Pick<ConfirmableTx, 'id' | 'type' | 'paid'> | null | undefined): boolean {
  if (!tx || !tx.id) return false;
  if (tx.paid !== false) return false;
  return tx.type === undefined || tx.type === 'INCOME' || tx.type === 'EXPENSE';
}

/**
 * Payment actions of the row menu. "Confirmar pagamento/recebimento" (dialog with the real amount and date) replaces the
 * plain "Marcar como pago" whenever it applies, so a pending row never offers two actions that do the same thing.
 * The plain toggle stays for what the dialog does not cover (transfers, allocations) and "Marcar como pendente" for paid rows.
 */
export function paymentMenuActions(
  tx: Pick<ConfirmableTx, 'id' | 'type' | 'paid'>,
  canConfirm: boolean,
): { confirm: boolean; markAsPaid: boolean; markAsPending: boolean } {
  const isPaid = tx.paid !== false;
  const confirm = canConfirm && isConfirmable(tx);
  return { confirm, markAsPaid: !isPaid && !confirm, markAsPending: isPaid };
}

/** Pending, and its expected day has come (today or earlier): it should have happened by now. */
export function isDueToConfirm(tx: ConfirmableTx, today: Date): boolean {
  if (!isConfirmable(tx)) return false;
  const key = dayKey(tx.date);
  return key !== '' && key <= dayKey(today);
}

/** The "A confirmar" list: due pending rows, oldest expected date first (ties by id, so the order is stable). */
export function dueToConfirm<T extends ConfirmableTx>(rows: readonly T[], today: Date): T[] {
  return rows
    .filter((tx) => isDueToConfirm(tx, today))
    .sort((a, b) => dayKey(a.date).localeCompare(dayKey(b.date)) || String(a.id).localeCompare(String(b.id)));
}

export interface ConfirmCopy {
  title: string;
  /** Menu item and button. */
  action: string;
  amountLabel: string;
  dateLabel: string;
  /** "recebido" / "pago", for the difference hint. */
  received: string;
  success: (amountText: string, dateText: string) => string;
}

/** The wording: income is "recebimento", expense is "pagamento". */
export function confirmCopy(type: string | undefined): ConfirmCopy {
  if (type === 'EXPENSE') {
    return {
      title: 'Confirmar pagamento',
      action: 'Confirmar pagamento',
      amountLabel: 'Valor pago',
      dateLabel: 'Data do pagamento',
      received: 'pago',
      success: (amount, date) => `Pagamento confirmado: ${amount} em ${date}.`,
    };
  }
  return {
    title: 'Confirmar recebimento',
    action: 'Confirmar recebimento',
    amountLabel: 'Valor recebido',
    dateLabel: 'Data em que caiu',
    received: 'recebido',
    success: (amount, date) => `Recebimento confirmado: ${amount} em ${date}.`,
  };
}

export interface ConfirmDraft {
  /** What the amount field shows (the masked text). */
  amountText: string;
  /** YYYY-MM-DD (the value of a date input). */
  dateKey: string;
  note: string;
}

/** The amount field mask: only the digits count, they are cents ("38022" is 380,22). */
export function maskCents(text: string, format: (cents: number) => string = moneyText): { cents: number | null; display: string } {
  const digits = text.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (!digits || digits.length > MAX_DIGITS) {
    return digits ? { cents: null, display: text } : { cents: null, display: '' };
  }
  const cents = Number(digits);
  return { cents, display: format(cents) };
}

/**
 * The dialog opens with the expected amount and date. When the expected day is already past (the usual case for a
 * confirmation) the date is today: the user then edits it to the day the money really arrived.
 */
export function initialDraft(tx: ConfirmableTx, today: Date, format: (cents: number) => string = moneyText): ConfirmDraft {
  const expectedKey = dayKey(tx.date);
  const todayKey = dayKey(today);
  return {
    amountText: format(Math.abs(reaisToCents(tx.amount))),
    dateKey: expectedKey && expectedKey > todayKey ? expectedKey : todayKey,
    note: tx.notes ?? '',
  };
}

export interface ConfirmCheck {
  ok: boolean;
  amountCents: number | null;
  errors: { amount?: string; date?: string };
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar day written YYYY-MM-DD. */
export function isIsoDay(value: string): boolean {
  const m = ISO_DAY.exec(value);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

export function validateConfirm(draft: ConfirmDraft, format: (cents: number) => string = moneyText): ConfirmCheck {
  const errors: ConfirmCheck['errors'] = {};
  const masked = maskCents(draft.amountText, format);
  if (masked.cents === null || masked.cents <= 0) errors.amount = 'Informe um valor maior que zero.';
  if (!isIsoDay(draft.dateKey)) errors.date = 'Informe a data.';
  return { ok: Object.keys(errors).length === 0, amountCents: masked.cents, errors };
}

/** The body of the update: ALWAYS paid + date; the amount only when it differs from the expected one; the note only when edited. */
export interface ConfirmPatch {
  paid: true;
  /** Local midnight of the chosen day (the context formats it as YYYY-MM-DD). */
  date: Date;
  amount?: number;
  /** The edited note; '' clears it (the context sends null). */
  notes?: string;
  /**
   * Set when the real date falls in another month than the expected one and the row had no reference month: the row keeps
   * counting for the month it was expected in, instead of silently moving to the month of the new date.
   */
  competenceMonth?: string;
}

/**
 * Why the amount is left out when it did not change: a recurrence that follows the last amount adopts whatever amount an
 * update carries, so confirming "as expected" must not make it adopt the stored one (it may have been updated since).
 */
export function buildPatch(tx: ConfirmableTx, draft: ConfirmDraft, format: (cents: number) => string = moneyText): ConfirmPatch | null {
  const check = validateConfirm(draft, format);
  if (!check.ok || check.amountCents === null) return null;
  const [y, m, d] = draft.dateKey.split('-').map(Number);
  const patch: ConfirmPatch = { paid: true, date: new Date(y, m - 1, d) };
  const expectedCents = Math.abs(reaisToCents(tx.amount));
  if (check.amountCents !== expectedCents) {
    // Same sign convention as the row: the amount the app stores for an expense is positive.
    patch.amount = centsToReais(check.amountCents);
  }
  const note = draft.note.trim();
  if (note !== (tx.notes ?? '').trim()) patch.notes = note;
  const kept = keptReferenceMonth(tx, draft.dateKey);
  if (kept) patch.competenceMonth = kept;
  return patch;
}

/**
 * "Esperado R$ 600,00, recebido R$ 640,00; as próximas ocorrências passam a usar R$ 640,00." Null when the amount is the
 * expected one. The second half only when the recurrence follows the last amount.
 */
export function differenceHint(
  expectedCents: number,
  receivedCents: number | null,
  type: string | undefined,
  followsLast: boolean,
  format: (cents: number) => string = moneyText,
  strategy: ForecastStrategy = 'LAST',
): string | null {
  if (receivedCents === null || receivedCents <= 0 || receivedCents === expectedCents) return null;
  const copy = confirmCopy(type);
  const base = `Esperado ${format(expectedCents)}, ${copy.received} ${format(receivedCents)}`;
  if (followsLast) return `${base}; as próximas ocorrências passam a usar ${format(receivedCents)}.`;
  const note = confirmedValueNote(strategy);
  return note ? `${base}; ${note}.` : `${base}.`;
}

/** Whether confirming with a new amount makes the recurrence follow it (it follows the last amount and this is the latest occurrence). */
export function followsLastAmount(
  tx: OccurrenceRef & ConfirmableTx,
  recurrences: readonly RecurrenceRef[],
  known: readonly OccurrenceRef[],
  today: Date,
): boolean {
  return followLastHint(tx, recurrences, known, today) !== null;
}

/** The toast text when the update changed the recurrence ("Recorrência atualizada para R$ 640,00") is `recurrenceUpdatedMessage`. */
export const confirmErrorMessage = (err: unknown): string => updateFailureMessage(err, 'Não foi possível confirmar.');

/** dd/mm/yyyy of a YYYY-MM-DD, without a Date (no time-zone shift). */
export function dayText(key: string): string {
  const m = ISO_DAY.exec(key);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : key;
}

/**
 * Client twin of the server's `expectedAmountFor(recurrence, history, referenceMonth)`: the single place that says "what
 * amount does an occurrence carry" (see `forecastStrategy.ts` for the rules: last value, fixed, conservative, per business
 * day). A recurrence without a strategy is the last value: its amount, which "acompanhar o último valor" keeps at the
 * last confirmed one. `history` holds the confirmed occurrences, newest first.
 */
export function expectedAmountFor(
  recurrence: ForecastFields & { type?: string },
  history: ReadonlyArray<{ amount: number; date?: string }> = [],
  referenceMonth = '',
): number {
  return expectedAmountOf(recurrence, recurrence.type === 'INCOME' ? 'INCOME' : 'EXPENSE', history, referenceMonth);
}

/**
 * The reference month a confirmation must pin: when the row has none and the real date is in another month than the
 * expected date, the month the row was expected in (so a 500 expected on 01/10 and received on 30/09 still counts in
 * October). Null when nothing needs pinning.
 */
export function keptReferenceMonth(tx: Pick<ConfirmableTx, 'date' | 'competenceMonth'>, newDateKey: string): string | null {
  if (tx.competenceMonth) return null;
  const expectedMonth = dayKey(tx.date).slice(0, 7);
  const newMonth = newDateKey.slice(0, 7);
  return expectedMonth && newMonth && expectedMonth !== newMonth ? expectedMonth : null;
}

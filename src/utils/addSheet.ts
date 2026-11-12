/**
 * Pure logic of the mobile add sheet (lote R2, below 768 px). No React here.
 * Amounts are in cents while typing and in reais when they leave for the form, as the form itself does.
 */

/** Minimal storage shape, so the functions take localStorage or a stub. */
export interface RecentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** How many recent values a list keeps. */
export const RECENT_LIMIT = 8;

/** Only the digits count; at most 11 digits, as the prototype does. */
export function amountDigitsToCents(raw: string): number {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 11);
  return digits ? parseInt(digits, 10) : 0;
}

/** The amount as typed in the field: no currency symbol, `decimalPlaces` after the separator. */
export function formatAmountInput(cents: number, decimalPlaces: number, locale: string): string {
  const divisor = decimalPlaces === 0 ? 1 : 100;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  }).format(cents / divisor);
}

/** The options with the recently used ones first (in recency order); the rest keep the default order. */
export function orderByRecent(options: readonly string[], recent: readonly string[]): string[] {
  const inOptions = recent.filter((value, index) => options.includes(value) && recent.indexOf(value) === index);
  const rest = options.filter((value) => !inOptions.includes(value));
  return [...inOptions, ...rest];
}

/** The list after `value` was used: it goes to the front, without duplicates, and the list is capped. */
export function rememberRecent(list: readonly string[], value: string, limit: number = RECENT_LIMIT): string[] {
  return [value, ...list.filter((item) => item !== value)].slice(0, limit);
}

/** Storage key: each household, each type (expense or income) and each kind (category or account) apart. */
export function recentStorageKey(householdId: string, type: 'EXPENSE' | 'INCOME', kind: 'category' | 'account'): string {
  return `recta.addSheet.recent.${householdId}.${type}.${kind}`;
}

/** The saved list; a broken or blocked storage gives an empty list and never throws. */
export function readRecent(storage: RecentStorage | null, key: string): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** Saves the list; a blocked storage is ignored (the sheet still works, without history). */
export function writeRecent(storage: RecentStorage | null, key: string, list: readonly string[]): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(list));
  } catch {
    // Private window or blocked site data: no history, nothing else changes.
  }
}

/** The date for the "Hoje" and "Ontem" pills; the time of day is kept. */
export function dateChipDate(chip: 'today' | 'yesterday', now: Date): Date {
  const date = new Date(now.getTime());
  if (chip === 'yesterday') date.setDate(date.getDate() - 1);
  return date;
}

/**
 * Paid by default: a date today or earlier is paid, a future date is pending. The form opens paid for today's date;
 * the sheet also takes "Ontem", which must not show as late, so only a future date stays pending.
 */
export function paidForDate(date: Date, now: Date): boolean {
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return date.getTime() < startOfTomorrow.getTime();
}

/** The state of the sheet, as the screen keeps it. */
export interface AddSheetState {
  type: 'EXPENSE' | 'INCOME';
  amountCents: number;
  description: string;
  category: string;
  accountId: string;
  date: Date;
  /** The situation the user tapped (true = paid or received); null while untouched, so the date decides. */
  paidChoice?: boolean | null;
}

/**
 * Whether the lançamento starts paid: the user's tap wins; without a tap the date decides
 * (today or earlier paid, a later date pending).
 */
export function situationPaid(date: Date, now: Date, choice: boolean | null | undefined): boolean {
  if (choice === true || choice === false) return choice;
  return paidForDate(date, now);
}

/** The two situation pills of the sheet, in the words of the type. */
export function situationLabels(type: 'EXPENSE' | 'INCOME'): { paid: string; pending: string } {
  return type === 'INCOME' ? { paid: 'Recebido', pending: 'A receber' } : { paid: 'Pago', pending: 'Pendente' };
}

/** The message the sheet shows when "Lançar" has no amount; null when the amount is fine. */
export function sheetCreateError(state: Pick<AddSheetState, 'amountCents'>): string | null {
  return state.amountCents > 0 ? null : 'Informe um valor maior que zero.';
}

/** The plain transaction the sheet creates: the same fields and defaults the form sends for a simple lançamento. */
export function toTransactionInput(state: AddSheetState, now: Date) {
  return {
    description: state.description.trim(),
    amount: state.amountCents / 100,
    type: state.type,
    category: state.category,
    date: state.date,
    paid: situationPaid(state.date, now, state.paidChoice),
    accountId: state.accountId,
    installments: 1,
    fromAccountId: '',
    toAccountId: '',
  };
}

/** What the full form opens with when "Parcelar, repetir ou dividir" is chosen. */
export function toFullFormPrefill(state: AddSheetState, now: Date) {
  return {
    type: state.type,
    amount: state.amountCents / 100,
    description: state.description.trim(),
    category: state.category,
    accountId: state.accountId,
    date: state.date,
    paid: situationPaid(state.date, now, state.paidChoice),
  };
}

/** What the full form opens with when "Transferência" is chosen: the amount and the description carry over. */
export function toTransferPrefill(state: AddSheetState, now: Date) {
  return {
    type: 'TRANSFER' as const,
    amount: state.amountCents / 100,
    description: state.description.trim(),
    category: '',
    accountId: '',
    fromAccountId: '',
    toAccountId: '',
    date: state.date,
    paid: situationPaid(state.date, now, state.paidChoice),
  };
}

/** The accounts the sheet offers: every account the form offers, which leaves out investments. */
export function sheetAccounts<T extends { type: string }>(accounts: readonly T[]): T[] {
  return accounts.filter((account) => account.type !== 'INVESTMENT');
}

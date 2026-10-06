// Pure logic of the "Ajustar saldo" dialog. Money is integer cents everywhere here; the wire number is cents / 100
// (exact: the division is correctly rounded), which the server accepts with at most two decimals.

/** Largest typed amount: 12 digits of cents (R$ 9.999.999.999,99), far below the server limit (1e12 reais). */
export const MAX_ADJUST_DIGITS = 12;
/** Server limit of the reason (accounts.schema.ts adjustBalanceSchema). */
export const MAX_REASON_LENGTH = 255;

export const DEFAULT_ADJUST_REASON = 'Ajuste de saldo';
export const OPENING_BALANCE_REASON = 'Saldo inicial';

export interface MaskedMoney {
  /** Typed amount in cents (negative when the text has a minus sign); null while no digit was typed. */
  cents: number | null;
  /** What the field shows: "R$ 3.802,27", "-R$ 10,00", "-" (sign only) or "". */
  display: string;
}

/** Digits only, filled from the right like a bank terminal; a "-" anywhere makes it negative. */
export function maskMoneyInput(text: string): MaskedMoney {
  const negative = text.includes('-');
  const digits = text.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, MAX_ADJUST_DIGITS);
  if (!digits) return { cents: null, display: negative ? '-' : '' };
  const abs = Number(digits);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const display = `${negative ? '-' : ''}R$ ${whole},${String(abs % 100).padStart(2, '0')}`;
  return { cents: negative && abs !== 0 ? -abs : abs, display };
}

/** Cents as the text a field shows for it (the inverse of maskMoneyInput). */
export function centsToMaskedText(cents: number): string {
  return maskMoneyInput(`${cents < 0 ? '-' : ''}${Math.abs(Math.trunc(cents))}`).display;
}

/** Reais from the API to integer cents (rounds the float noise of 3665.04 * 100). */
export function reaisToCents(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100 + (value < 0 ? -1e-6 : 1e-6)) : 0;
}

/** Today as YYYY-MM-DD in local time. */
export function todayIsoDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** The last day of the previous year, the suggested date of an opening balance ("31/12/2025" in 2026). */
export function lastDayOfPreviousYear(now: Date = new Date()): string {
  return `${now.getFullYear() - 1}-12-31`;
}

/** A real calendar day written YYYY-MM-DD (2025-02-30 is not). */
export function isValidIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const parsed = new Date(y, mo - 1, d);
  return parsed.getFullYear() === y && parsed.getMonth() === mo - 1 && parsed.getDate() === d;
}

/** YYYY-MM-DD to dd/mm/yyyy without any timezone shift. */
export function formatIsoDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

/** "Saldo inicial" when the date falls before the current year (an opening balance), else "Ajuste de saldo". */
export function defaultAdjustReason(date: string, now: Date = new Date()): string {
  return isValidIsoDate(date) && date < `${now.getFullYear()}-01-01` ? OPENING_BALANCE_REASON : DEFAULT_ADJUST_REASON;
}

export interface AdjustInput {
  /** Current total balance of the account, in cents. */
  currentCents: number;
  /** Target balance in cents; null while nothing was typed. */
  targetCents: number | null;
  date: string;
  reason: string;
}

export interface AdjustCheck {
  ok: boolean;
  /** target - current, in cents (null while the target is missing). Positive: an income entry; negative: an expense. */
  differenceCents: number | null;
  errors: { target?: string; date?: string; reason?: string };
}

export function validateAdjust(input: AdjustInput, now: Date = new Date()): AdjustCheck {
  const errors: AdjustCheck['errors'] = {};
  const differenceCents = input.targetCents === null ? null : input.targetCents - input.currentCents;
  if (input.targetCents === null) errors.target = 'Informe o saldo correto da conta.';
  else if (differenceCents === 0) errors.target = 'A conta já está com esse saldo; não há o que ajustar.';
  if (!input.date) errors.date = 'Informe a data do ajuste.';
  else if (!isValidIsoDate(input.date)) errors.date = 'Data inválida.';
  else if (input.date > todayIsoDate(now)) errors.date = 'A data não pode ser no futuro.';
  if (input.reason.trim().length > MAX_REASON_LENGTH) errors.reason = `No máximo ${MAX_REASON_LENGTH} caracteres.`;
  return { ok: Object.keys(errors).length === 0, differenceCents, errors };
}

export interface AdjustBody {
  newBalance: number;
  date: string;
  reason: string;
}

/** The request body, or null when the input does not validate. A blank reason becomes the default for that date. */
export function buildAdjustBody(input: AdjustInput, now: Date = new Date()): AdjustBody | null {
  if (!validateAdjust(input, now).ok || input.targetCents === null) return null;
  return {
    newBalance: input.targetCents / 100,
    date: input.date,
    reason: input.reason.trim() || defaultAdjustReason(input.date, now),
  };
}

/** What the entry will be, in words: "uma entrada de R$ 137,23" / "uma saída de R$ 10,00". */
export function describeAdjustment(differenceCents: number, formatMoney: (cents: number) => string): string {
  return `${differenceCents > 0 ? 'uma entrada' : 'uma saída'} de ${formatMoney(Math.abs(differenceCents))}`;
}

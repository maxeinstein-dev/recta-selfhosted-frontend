/**
 * Pure logic of plan P18: how much of the spending went on the credit card (GET /dashboard/spending-by-method, shown on
 * the Início) and what is still owed in installments (the `installments` block of the card commitment, shown on the
 * Cartões screen). The numbers are computed on the server; this only shapes them for the screen. No React, so
 * tools/fe-tests/t54_credit_vs_debit.mts runs it under tsx (CREDIT_VS_DEBIT_MODULE points it at a mutated copy).
 */

export interface MethodAmounts {
  credit: number;
  other: number;
  total: number;
  /** credit / total, four decimals; null when nothing was spent. */
  creditShare: number | null;
}

export interface MethodMonth extends MethodAmounts {
  month: string;
}

/** The `data` of GET /dashboard/spending-by-method. */
export interface SpendingByMethodResponse {
  basis: 'own-share';
  months: MethodMonth[];
  totals: MethodAmounts;
}

/** The `installments` block of GET /transactions/credit-cards/:accountId/commitment. */
export interface InstallmentsLeft {
  outstanding: number;
  activeCount: number;
  lastMonth: string | null;
}

export interface ShareCell {
  month: string;
  /** Short month name in the locale, without the dot ('out'). */
  label: string;
  share: number | null;
  /** Whole percent ('58%'), or a dash for a month with no spending. */
  percent: string;
}

export interface CreditShareLine {
  current: ShareCell;
  /** The months before the current one, oldest first. */
  previous: ShareCell[];
  /** Against the month before: 'down' is the goal. Null when either month has no spending. */
  trend: 'down' | 'up' | 'same' | null;
}

const DASH = '–';
const MONTH_RE = /^\d{4}-\d{2}$/;

function shortMonth(month: string, locale: string): string {
  if (!MONTH_RE.test(month)) return month;
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 15));
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(date).replace('.', '');
}

function cell(m: MethodMonth, locale: string): ShareCell {
  const share = m.total > 0 && m.creditShare !== null ? m.creditShare : null;
  return { month: m.month, label: shortMonth(m.month, locale), share, percent: share === null ? DASH : `${Math.round(share * 100)}%` };
}

/** The line of the Início: the current month and the ones before it; null when no month had any spending. */
export function creditShareLine(response: SpendingByMethodResponse | null | undefined, locale: string): CreditShareLine | null {
  const months = response?.months ?? [];
  if (months.length === 0 || months.every((m) => !(m.total > 0))) return null;
  const cells = months.map((m) => cell(m, locale));
  const current = cells[cells.length - 1]!;
  const before = cells.length > 1 ? cells[cells.length - 2]! : null;
  let trend: CreditShareLine['trend'] = null;
  if (before && before.share !== null && current.share !== null) {
    const diff = Math.round(current.share * 100) - Math.round(before.share * 100);
    trend = diff < 0 ? 'down' : diff > 0 ? 'up' : 'same';
  }
  return { current, previous: cells.slice(0, -1), trend };
}

export interface InstallmentsLeftLine {
  cents: number;
  count: number;
  /** Last invoice with a parcel, 'MM/AAAA'. */
  lastLabel: string;
  /** One purchase: the screen uses the singular text. */
  one: boolean;
}

/** The line of the Cartões screen; null when nothing is left (or the route is older and has no block). */
export function installmentsLeftLine(installments: InstallmentsLeft | null | undefined): InstallmentsLeftLine | null {
  if (!installments) return null;
  const cents = Math.round(installments.outstanding * 100);
  if (!(cents > 0)) return null;
  const last = installments.lastMonth;
  return {
    cents,
    count: installments.activeCount,
    lastLabel: last && MONTH_RE.test(last) ? `${last.slice(5, 7)}/${last.slice(0, 4)}` : '',
    one: installments.activeCount === 1,
  };
}

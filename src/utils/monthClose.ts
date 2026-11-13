/**
 * Month close ("Fechamento do mês"): pure helpers of the page. The numbers come from GET /dashboard/month-close and
 * are never recalculated here; this file only does month arithmetic, reads the typed statement balance, compares it
 * with the system one in whole cents, and says where each pending item is solved.
 */

export type MonthCloseBlockerCode = 'pending_entries' | 'invoice_open' | 'review_queue' | 'uncategorized' | 'pending_captures';

export interface MonthCloseBlocker {
  code: MonthCloseBlockerCode;
  count: number;
  amount?: number;
}

export interface MonthCloseConference {
  informedBalance: number;
  systemBalance: number;
  difference: number;
  closedAt: string;
  closedByUserId: string | null;
  changedSince: boolean;
}

export interface MonthCloseAccount {
  accountId: string;
  name: string;
  type: string;
  systemBalance: number;
  ok: boolean;
  blockers: MonthCloseBlocker[];
  closing: MonthCloseConference | null;
}

export interface MonthCloseCard {
  accountId: string;
  name: string;
  invoiceTotal: number;
  state: 'open' | 'closed' | 'paid';
  reviewQueueCount: number;
  ok: boolean;
  blockers: MonthCloseBlocker[];
  closing: MonthCloseConference | null;
}

export interface MonthCloseResponse {
  month: string;
  accounts: MonthCloseAccount[];
  cards: MonthCloseCard[];
  general: { ok: boolean; blockers: MonthCloseBlocker[] };
  ok: boolean;
}

export type ConferenceState = 'none' | 'matches' | 'differs' | 'changed';

const pad = (n: number): string => String(n).padStart(2, '0');

/** 'YYYY-MM' moved by n months. */
export function shiftMonth(month: string, n: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** The month the page opens on: the last complete one before `today` ('YYYY-MM-DD'). */
export function defaultCloseMonth(today: string): string {
  return shiftMonth(today.slice(0, 7), -1);
}

/** First and last day of 'YYYY-MM' as 'YYYY-MM-DD'. */
export function monthRange(month: string): { start: string; end: string } {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${pad(last)}` };
}

/**
 * The balance the user typed from the statement: reais with comma or dot decimals (dots as thousands separators when
 * there is a comma, or when exactly three digits follow each dot and there is no comma), at most two decimals, an
 * optional leading minus (an overdrawn account). Null for anything else.
 */
export function parseInformedBalance(text: string): number | null {
  const raw = text.trim().replace(/\s/g, '');
  const negative = raw.startsWith('-');
  const body = negative ? raw.slice(1) : raw;
  if (!body) return null;
  let normalized: string;
  if (body.includes(',')) {
    if (!/^(\d{1,3}(\.\d{3})+|\d+),\d{1,2}$/.test(body)) return null;
    normalized = body.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(body)) {
    normalized = body.replace(/\./g, ''); // 1.000 is one thousand
  } else if (/^\d+(\.\d{1,2})?$/.test(body)) {
    normalized = body;
  } else {
    return null;
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

const toCents = (value: number): number => Math.round(value * 100);

/** informed - system, in whole cents. */
export function differenceCents(informed: number, system: number): number {
  return toCents(informed) - toCents(system);
}

/** What a recorded conference says: nothing yet, it matched, it differed, or something moved after it (this wins). */
export function conferenceState(closing: MonthCloseConference | null): ConferenceState {
  if (!closing) return 'none';
  if (closing.changedSince) return 'changed';
  return toCents(closing.difference) === 0 ? 'matches' : 'differs';
}

export function blockerTextKey(code: MonthCloseBlockerCode) {
  switch (code) {
    case 'pending_entries':
      return 'monthCloseBlockPending' as const;
    case 'invoice_open':
      return 'monthCloseBlockInvoiceOpen' as const;
    case 'review_queue':
      return 'monthCloseBlockReviewQueue' as const;
    case 'uncategorized':
      return 'monthCloseBlockUncategorized' as const;
    case 'pending_captures':
      return 'monthCloseBlockCaptures' as const;
  }
}

/**
 * Where a pending item is solved (an existing screen; this page never changes anything by itself). Null when the item
 * needs an account and none was given.
 */
export function blockerHref(code: MonthCloseBlockerCode, ctx: { month: string; accountId?: string }): string | null {
  const { start, end } = monthRange(ctx.month);
  switch (code) {
    case 'pending_entries':
      return `/app/transactions?startDate=${start}&endDate=${end}&paid=pending`;
    case 'uncategorized':
      return `/app/transactions?startDate=${start}&endDate=${end}`;
    case 'pending_captures':
      return '/app/captures';
    case 'review_queue':
    case 'invoice_open':
      return ctx.accountId ? `/app/credit-cards?card=${ctx.accountId}&month=${ctx.month}` : null;
  }
}

/** How many pending items stop the month, over every block. */
export function blockerTotal(data: MonthCloseResponse): number {
  const sum = (blockers: MonthCloseBlocker[]) => blockers.reduce((total, b) => total + b.count, 0);
  return (
    data.accounts.reduce((total, a) => total + sum(a.blockers), 0) +
    data.cards.reduce((total, c) => total + sum(c.blockers), 0) +
    sum(data.general.blockers)
  );
}

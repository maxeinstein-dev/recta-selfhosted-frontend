/**
 * Pure logic of the "Contas a pagar" checklist: which events of GET /dashboard/cash-flow are bills still to pay this
 * month, how they are grouped in due-day pills, the total, the "N of M paid" counter and which action each bill offers.
 * No React and no imports but the cash flow helpers, so tools/fe-tests/t30_bills_checklist.mts runs it under tsx
 * (BILLS_CHECKLIST_MODULE points it at a mutated copy).
 *
 * Money: the API answers in money units; every sum here is done in whole cents so a float never drifts.
 * Days are 'YYYY-MM-DD' strings and are only compared as text, so no time zone shifts them.
 */
import { isDayKey, toCents, type CashFlowEvent } from './cashFlow';
import { effectiveMonthOf } from './referenceMonth';
import { canPayNow, type CashFlowEarlyDiscount } from './earlyDiscount';

/** The cash flow period the checklist asks for: 30 days always reach the end of the current month. */
export const BILLS_PERIOD_DAYS = 30;

/** What a bill is, as far as this screen can act on it. A source the screen does not know is 'unknown' (never markable). */
export type BillKind = 'pending' | 'recurrence' | 'invoice' | 'reserve' | 'unknown';

export function billKind(source: string): BillKind {
  if (source === 'pending' || source === 'recurrence' || source === 'invoice' || source === 'reserve') return source;
  return 'unknown';
}

export interface Bill {
  /** Stable key of the line: source, id, due day and amount. */
  key: string;
  kind: BillKind;
  /** Raw source of the event (kept for the unknown ones). */
  source: string;
  /** Id of the pending entry, of the recurrence or of the card. */
  sourceId: string;
  description: string;
  /** Always positive: what leaves the account. */
  amountCents: number;
  /** Day the line is listed on (an overdue bill is listed on the day of the answer, today). */
  date: string;
  /** The day it was really due: the original day of an overdue bill, else `date`. */
  dueDate: string;
  overdue: boolean;
  estimated: boolean;
  accountId: string;
  invoiceMonth: string | null;
  /** Early-payment discount still valid for this occurrence (the amount above is already the discounted one); null otherwise. */
  earlyDiscount: CashFlowEarlyDiscount | null;
}

/** Last day of the month of `day`, 'YYYY-MM-DD'. */
export function monthEnd(day: string): string {
  const next = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 1);
  const d = new Date(next - 86_400_000);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** First day of the month of `day`. */
export const monthStart = (day: string): string => `${day.slice(0, 7)}-01`;

function billKey(event: CashFlowEvent, cents: number): string {
  return `${event.source}:${event.sourceId}:${event.originalDate ?? event.date}:${cents}`;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Overdue first (oldest due day first), then by day, description and key: the same order everywhere. */
export function compareBills(a: Bill, b: Bill): number {
  return (
    Number(b.overdue) - Number(a.overdue) ||
    compareText(a.dueDate, b.dueDate) ||
    compareText(a.date, b.date) ||
    compareText(a.description, b.description) ||
    compareText(a.key, b.key)
  );
}

/**
 * The bills to pay: the outflows of the answer (income and zero amounts are left out) from today to the end of the current
 * month, plus every overdue one (the API already moves them to today). `hiddenKeys` are the lines the user just marked and
 * the answer has not caught up with yet.
 */
export function buildBills(events: readonly CashFlowEvent[], today: string, hiddenKeys: ReadonlySet<string> = new Set()): Bill[] {
  const end = monthEnd(today);
  const bills: Bill[] = [];
  for (const event of events) {
    // Payroll (13th, vacation, birthday withdrawal, benefits) is money coming in: an entry, never a bill to pay here.
    if (event.source === 'payroll') continue;
    if (!isDayKey(event.date) || event.date > end) continue;
    const cents = toCents(event.amount);
    if (cents >= 0) continue;
    const key = billKey(event, -cents);
    if (hiddenKeys.has(key)) continue;
    bills.push({
      key,
      kind: billKind(event.source),
      source: event.source,
      sourceId: event.sourceId,
      description: event.description,
      amountCents: -cents,
      date: event.date,
      dueDate: event.overdue && isDayKey(event.originalDate) ? event.originalDate : event.date,
      overdue: event.overdue || event.date < today,
      estimated: event.certainty === 'estimated',
      accountId: event.accountId,
      invoiceMonth: event.invoiceMonth,
      earlyDiscount: event.earlyDiscount ?? null,
    });
  }
  return bills.sort(compareBills);
}

export const billsTotalCents = (bills: readonly Bill[]): number => bills.reduce((sum, b) => sum + b.amountCents, 0);

export interface DayPill {
  date: string;
  count: number;
  totalCents: number;
}

export interface DayPills {
  /** The overdue bills together (they are not spread over their old due days); null when there are none. */
  overdue: { count: number; totalCents: number } | null;
  /** One pill per due day of the bills that are not overdue, in date order. */
  days: DayPill[];
}

export function buildDayPills(bills: readonly Bill[]): DayPills {
  let overdueCount = 0;
  let overdueCents = 0;
  const byDay = new Map<string, DayPill>();
  for (const bill of bills) {
    if (bill.overdue) {
      overdueCount += 1;
      overdueCents += bill.amountCents;
      continue;
    }
    const pill = byDay.get(bill.date) ?? { date: bill.date, count: 0, totalCents: 0 };
    pill.count += 1;
    pill.totalCents += bill.amountCents;
    byDay.set(bill.date, pill);
  }
  return { overdue: overdueCount > 0 ? { count: overdueCount, totalCents: overdueCents } : null, days: [...byDay.values()].sort((a, b) => compareText(a.date, b.date)) };
}

/** 'all', 'overdue' or a due day 'YYYY-MM-DD'. */
export type BillsFilter = string;
export const FILTER_ALL = 'all';
export const FILTER_OVERDUE = 'overdue';

/** A filter that no longer matches any pill (the last bill of that day was paid) falls back to "all". */
export function normalizeFilter(filter: BillsFilter, bills: readonly Bill[]): BillsFilter {
  if (filter === FILTER_ALL) return FILTER_ALL;
  if (filter === FILTER_OVERDUE) return bills.some((b) => b.overdue) ? FILTER_OVERDUE : FILTER_ALL;
  return bills.some((b) => !b.overdue && b.date === filter) ? filter : FILTER_ALL;
}

export function filterBills(bills: readonly Bill[], filter: BillsFilter): Bill[] {
  if (filter === FILTER_ALL) return [...bills];
  if (filter === FILTER_OVERDUE) return bills.filter((b) => b.overdue);
  return bills.filter((b) => !b.overdue && b.date === filter);
}

/** The two-digit day of a 'YYYY-MM-DD' for the pill; '' for anything else. */
export const dayNumber = (day: string): string => (isDayKey(day) ? day.slice(8, 10) : '');

/** What the checklist needs to know about a recurrence to decide whether it can generate the occurrence of a bill. */
export interface RecurrenceInfo {
  frequency: string;
  /** ISO date or 'YYYY-MM-DD' of the next occurrence the recurrence will generate. */
  nextRunAt: string;
  /** Months between an occurrence's date and its reference month; null = same month. */
  competenceOffsetMonths?: number | null;
}

export type BillAction =
  /** Pending entry: mark it paid (through the confirmation dialog when `confirm`, the value being an estimate). */
  | { type: 'pay'; confirm: boolean }
  /** Not-yet-generated occurrence: generate it once and pay it (generate first, then confirm, when `confirm`). */
  | { type: 'execute'; confirm: boolean }
  /** Recurrence occurrence with a discount that the API says can be paid now: pay it ahead through pay-next (never generated first). */
  | { type: 'payNext'; recurringId: string }
  /** Planned contribution of a savings goal: record it (POST .../contributions) dated on the line's day. No entry, no balance change. */
  | { type: 'reserve'; goalId: string; date: string }
  /** Card invoice: never paid here; go to the card's payment flow. */
  | { type: 'invoice' }
  /** No control: `later` for a recurrence that is not the next one (or not monthly), `unknown` for an unknown source. */
  | { type: 'none'; reason: 'later' | 'unknown' };

/**
 * The action of a bill. A recurrence occurrence can be generated only when the route would generate exactly this one:
 * the recurrence is monthly (the route has a once-per-month guard only for those) and the bill's day is the recurrence's
 * next run (the route always generates the next run). Any other recurrence line waits for its date.
 */
export function billAction(bill: Pick<Bill, 'kind' | 'sourceId' | 'dueDate' | 'estimated'> & { date?: string } & { earlyDiscount?: CashFlowEarlyDiscount | null }, recurrences?: ReadonlyMap<string, RecurrenceInfo>): BillAction {
  if (bill.kind === 'pending') return { type: 'pay', confirm: bill.estimated };
  if (bill.kind === 'invoice') return { type: 'invoice' };
  // An overdue contribution is listed today (the API moves it), and today is the day it is made
  if (bill.kind === 'reserve') return { type: 'reserve', goalId: bill.sourceId, date: bill.date ?? bill.dueDate };
  if (bill.kind === 'recurrence') {
    if (canPayNow(bill.earlyDiscount)) return { type: 'payNext', recurringId: bill.earlyDiscount!.recurringId };
    const info = recurrences?.get(bill.sourceId);
    if (info && info.frequency === 'MONTHLY' && info.nextRunAt.slice(0, 10) === bill.dueDate) {
      return { type: 'execute', confirm: bill.estimated };
    }
    return { type: 'none', reason: 'later' };
  }
  return { type: 'none', reason: 'unknown' };
}

/** The part of a transaction the paid counter reads. */
export interface PaidCandidate {
  id: string;
  type?: string;
  paid?: boolean;
  recurringTransactionId?: string | null;
  /** ISO date or 'YYYY-MM-DD'. */
  date: string;
  /** 'YYYY-MM' the row refers to; null/absent = the month of its date. */
  competenceMonth?: string | null;
}

/**
 * The paid half of the counter: expenses already paid that came from a recurrence (the same set the pending bills belong
 * to) and refer to the month of `from`, plus the transactions this screen just paid. "Refer to" is the effective month
 * (the reference month when set, else the month of the date), not the date alone: a bill paid ahead on 28/11 for December
 * is December's, so it is not counted in November (where it would show as a second paid bill) and is counted in
 * December. `from`/`to` are the first and last day of the period (one month). Counted by id, so nothing is counted twice.
 */
export function paidIds(transactions: readonly PaidCandidate[], from: string, to: string, markedIds: ReadonlySet<string> = new Set(), recurrences?: ReadonlyMap<string, RecurrenceInfo>): Set<string> {
  const ids = new Set<string>(markedIds);
  const first = from.slice(0, 7);
  const last = to.slice(0, 7);
  for (const t of transactions) {
    if (t.type !== 'EXPENSE' || t.paid !== true || !t.recurringTransactionId) continue;
    // The reference month moves a row to another month only when its recurrence has no offset (paid ahead through
    // pay-next). With an offset the reference month is always the next one(s) and the bills total counts by the date;
    // an unknown recurrence counts by the date too.
    const info = recurrences?.get(t.recurringTransactionId);
    const movable = !!info && !info.competenceOffsetMonths;
    const month = movable ? effectiveMonthOf({ date: t.date, competenceMonth: t.competenceMonth }) : String(t.date).slice(0, 7);
    if (month < first || month > last) continue;
    ids.add(t.id);
  }
  return ids;
}

/**
 * First day the paid-expenses query must cover for the month of `day`: 31 days before the month starts, because a bill
 * paid ahead (the server accepts up to 31 days) is dated before the month it refers to.
 */
export function paidWindowStart(day: string): string {
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, 1) - 31 * 86_400_000);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export interface BillsProgress {
  paid: number;
  total: number;
}

/** "N of M paid": M is what is still to pay plus what is paid. Never more paid than the total. */
export function billsProgress(bills: readonly Bill[], paidCount: number): BillsProgress {
  const paid = Math.max(0, paidCount);
  return { paid, total: bills.length + paid };
}

export type BillSourceTextKey = 'billsSourcePending' | 'billsSourceRecurrence' | 'billsSourceInvoice' | 'billsSourceReserve' | 'billsSourceOther';

export function billSourceTextKey(kind: BillKind): BillSourceTextKey {
  if (kind === 'pending') return 'billsSourcePending';
  if (kind === 'recurrence') return 'billsSourceRecurrence';
  if (kind === 'invoice') return 'billsSourceInvoice';
  if (kind === 'reserve') return 'billsSourceReserve';
  return 'billsSourceOther';
}

/**
 * The recurrences by id, from the answer of the list route: a plain array, or an envelope `{ data: [...] }` (the route
 * answers both ways depending on the layer). Active ones only; anything without an id, frequency or next run is skipped.
 */
export function recurrenceMap(raw: unknown): Map<string, RecurrenceInfo> {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { data?: unknown } | null | undefined)?.data) ? (raw as { data: unknown[] }).data : [];
  const map = new Map<string, RecurrenceInfo>();
  for (const item of list) {
    const r = item as { id?: unknown; frequency?: unknown; nextRunAt?: unknown; isActive?: unknown; competenceOffsetMonths?: unknown } | null;
    if (!r || typeof r.id !== 'string' || typeof r.frequency !== 'string' || typeof r.nextRunAt !== 'string') continue;
    if (r.isActive === false) continue;
    map.set(r.id, { frequency: r.frequency, nextRunAt: r.nextRunAt, competenceOffsetMonths: typeof r.competenceOffsetMonths === 'number' ? r.competenceOffsetMonths : null });
  }
  return map;
}

/**
 * The day to pay on when the bill is not due yet: today (the money leaves now, and a paid entry never carries a future
 * day). Null when the day needs no change: a bill due today or already overdue keeps its day (the confirmation dialog
 * itself proposes today for an overdue one).
 */
export function earlyPaymentDay(dueDate: string, today: string): string | null {
  return isDayKey(dueDate) && isDayKey(today) && dueDate > today ? today : null;
}

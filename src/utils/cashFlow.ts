/**
 * Pure logic of the projected cash flow page: the types of GET /dashboard/cash-flow, the full daily series (the API omits
 * the days without events), the order and grouping of the events, the labels that depend on source, certainty and
 * overdue, and the cash account filter. No React and no imports but the texts, so tools/fe-tests/t28_cash_flow.mts runs it
 * under tsx (CASH_FLOW_MODULE points it at a mutated copy).
 *
 * Money: the API answers in money units; every sum here is done in whole cents so a float never drifts.
 */
import type { CashFlowTextKey } from './cashFlowTexts';

/** 'payroll': 13th, vacation and birthday FGTS withdrawal forecast by a CLT employment (an entry, never a bill). */
export type CashFlowSource = 'pending' | 'recurrence' | 'payroll' | 'invoice';
export type CashFlowCertainty = 'confirmed' | 'expected' | 'estimated';
export type CashFlowReason = 'no_payer_account' | 'no_due_date';

export interface CashFlowEvent {
  /** Day the money moves (an overdue item is moved to the day of the answer). */
  date: string;
  description: string;
  /** Signed: income positive, outflow negative. */
  amount: number;
  source: CashFlowSource;
  certainty: CashFlowCertainty;
  overdue: boolean;
  originalDate: string | null;
  sourceId: string;
  accountId: string;
  invoiceMonth: string | null;
}

export interface CashFlowDay {
  date: string;
  events: CashFlowEvent[];
  inflow: number;
  outflow: number;
  net: number;
  endBalance: number;
}

export interface CashFlowSummary {
  lowestBalance: { date: string; amount: number };
  firstNegativeDate: string | null;
  endingBalance: number;
  balanceAfterDays: Array<{ days: number; date: string; balance: number }>;
  totalInflow: number;
  totalOutflow: number;
  eventCount: number;
  estimatedCount: number;
  overdueCount: number;
}

export interface CashFlowUnassignedInvoice {
  accountId: string;
  accountName: string;
  month: string;
  dueDate: string | null;
  amount: number;
  reason: CashFlowReason;
}

/** The `data` of GET /dashboard/cash-flow. */
export interface CashFlowResponse {
  currency: string | null;
  period: { from: string; to: string; days: number };
  startingBalance: number;
  days: CashFlowDay[];
  summary: CashFlowSummary;
  unassignedInvoices: CashFlowUnassignedInvoice[];
}

/** One day of the full series: the balance at its end, and what moved that day. */
export interface CashFlowPoint {
  date: string;
  balance: number;
  net: number;
  hasEvents: boolean;
}

export interface CashFlowDayGroup {
  date: string;
  events: CashFlowEvent[];
  inflow: number;
  outflow: number;
  net: number;
}

export const CASH_FLOW_PERIODS = [30, 60, 90] as const;
export const DEFAULT_CASH_FLOW_DAYS = 90;

/** Money units to whole cents (the API's values have at most two decimals; Math.round absorbs the float noise). */
export const toCents = (amount: number): number => Math.round(amount * 100);
export const fromCents = (cents: number): number => cents / 100;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

export const isDayKey = (value: unknown): value is string => typeof value === 'string' && DAY_RE.test(value);

/** 'YYYY-MM-DD' plus n calendar days (UTC arithmetic, free of daylight saving). */
export function addDays(day: string, n: number): string {
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + n));
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' as 'dd/MM' (cut from the string, no Date, so no time zone shift); '' for anything else. */
export function shortDate(day: string | null | undefined): string {
  return isDayKey(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}` : '';
}

/** 'YYYY-MM-DD' as 'dd/MM/yyyy'; '' for anything else. */
export function longDate(day: string | null | undefined): string {
  return isDayKey(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : '';
}

/** Invoice month 'YYYY-MM' as 'MM/yyyy'; '' for anything else. */
export function monthLabel(month: string | null | undefined): string {
  return month && MONTH_RE.test(month) ? `${month.slice(5, 7)}/${month.slice(0, 4)}` : '';
}

/**
 * The full series from the start day to the end day of the period, both inclusive (days + 1 points). The balance of a
 * day is the starting balance plus every event of the days up to it, in cents. Days without events keep the balance of
 * the day before. Events outside the period are ignored.
 */
export function buildDailySeries(response: Pick<CashFlowResponse, 'period' | 'startingBalance' | 'days'>): CashFlowPoint[] {
  const { from, days: horizon } = response.period;
  const netByDay = new Map<string, number>();
  for (const day of response.days) {
    if (!isDayKey(day.date)) continue;
    let net = netByDay.get(day.date) ?? 0;
    for (const event of day.events) net += toCents(event.amount);
    netByDay.set(day.date, net);
  }
  let balance = toCents(response.startingBalance);
  const points: CashFlowPoint[] = [];
  for (let i = 0; i <= horizon; i += 1) {
    const date = addDays(from, i);
    const net = netByDay.get(date) ?? 0;
    balance += net;
    points.push({ date, balance: fromCents(balance), net: fromCents(net), hasEvents: netByDay.has(date) });
  }
  return points;
}

/** The lowest end-of-day balance and its day; the earliest day when two tie. Null for an empty series. */
export function lowestPoint(points: readonly CashFlowPoint[]): { date: string; amount: number } | null {
  let best: CashFlowPoint | null = null;
  for (const p of points) {
    if (best === null || toCents(p.balance) < toCents(best.balance)) best = p;
  }
  return best ? { date: best.date, amount: best.balance } : null;
}

/** The first day whose end balance is below zero; null when none is. */
export function firstNegativeDate(points: readonly CashFlowPoint[]): string | null {
  const hit = points.find((p) => toCents(p.balance) < 0);
  return hit ? hit.date : null;
}

/** The order of the sources on one day. A source this build does not know sorts last (a future one must not break the list). */
const SOURCE_ORDER: Record<CashFlowSource, number> = { pending: 0, recurrence: 1, payroll: 2, invoice: 3 };
const sourceRank = (source: string): number => (source in SOURCE_ORDER ? SOURCE_ORDER[source as CashFlowSource] : 99);

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Day, then kind of source, description, id, amount: the same order on every screen and in the tests. */
export function compareEvents(a: CashFlowEvent, b: CashFlowEvent): number {
  return (
    compareText(a.date, b.date) ||
    sourceRank(a.source) - sourceRank(b.source) ||
    compareText(a.description, b.description) ||
    compareText(a.sourceId, b.sourceId) ||
    toCents(a.amount) - toCents(b.amount)
  );
}

/** Every event of the answer, in the order of compareEvents. */
export function allEvents(response: Pick<CashFlowResponse, 'days'>): CashFlowEvent[] {
  return response.days.flatMap((day) => day.events).sort(compareEvents);
}

/** The events grouped by day, days in date order; each day with its inflow, outflow and net (in cents, then money). */
export function groupEventsByDay(events: readonly CashFlowEvent[]): CashFlowDayGroup[] {
  const groups: Array<CashFlowDayGroup & { inCents: number; outCents: number }> = [];
  for (const event of [...events].sort(compareEvents)) {
    const cents = toCents(event.amount);
    let target = groups[groups.length - 1];
    if (!target || target.date !== event.date) {
      target = { date: event.date, events: [], inflow: 0, outflow: 0, net: 0, inCents: 0, outCents: 0 };
      groups.push(target);
    }
    target.events.push(event);
    if (cents >= 0) target.inCents += cents;
    else target.outCents += -cents;
  }
  return groups.map(({ inCents, outCents, ...group }) => ({
    ...group,
    inflow: fromCents(inCents),
    outflow: fromCents(outCents),
    net: fromCents(inCents - outCents),
  }));
}

/** Which way the money moves, for the colour of the amount. Zero is neutral. */
export function eventTone(amount: number): 'income' | 'expense' | 'neutral' {
  const cents = toCents(amount);
  if (cents > 0) return 'income';
  if (cents < 0) return 'expense';
  return 'neutral';
}

/** The label of a source; a source this build does not know is "Outra origem", never mistaken for a pending entry. */
export function sourceTextKey(source: CashFlowSource | string): CashFlowTextKey {
  if (source === 'recurrence') return 'cashFlowSourceRecurrence';
  if (source === 'invoice') return 'cashFlowSourceInvoice';
  if (source === 'payroll') return 'cashFlowSourcePayroll';
  if (source === 'pending') return 'cashFlowSourcePending';
  return 'cashFlowSourceOther';
}

export function certaintyTextKey(certainty: CashFlowCertainty): CashFlowTextKey {
  if (certainty === 'estimated') return 'cashFlowCertaintyEstimated';
  if (certainty === 'expected') return 'cashFlowCertaintyExpected';
  return 'cashFlowCertaintyConfirmed';
}

/** The badge "Estimado" shows only for estimated events: the number is not firm. */
export const isEstimated = (event: Pick<CashFlowEvent, 'certainty'>): boolean => event.certainty === 'estimated';

/** The badge "Atrasado" with the original due day, when the event was due before the day it is shown on. */
export function overdueDetail(event: Pick<CashFlowEvent, 'overdue' | 'originalDate'>): { date: string } | null {
  if (!event.overdue || !isDayKey(event.originalDate)) return null;
  return { date: shortDate(event.originalDate) };
}

/** The notice about estimated events; null when there are none. */
export function estimatedNotice(count: number): { key: CashFlowTextKey; vars: { count: number } } | null {
  if (count <= 0) return null;
  return { key: count === 1 ? 'cashFlowEstimatedOne' : 'cashFlowEstimatedMany', vars: { count } };
}

export function reasonTextKey(reason: CashFlowReason): CashFlowTextKey {
  return reason === 'no_due_date' ? 'cashFlowUnassignedNoDue' : 'cashFlowUnassignedNoPayer';
}

/** Account shape the cash flow screen needs. */
export interface AccountLike {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

const CASH_ACCOUNT_TYPES = ['CHECKING', 'SAVINGS', 'CASH'];

/** The accounts the projection is about: active checking, savings and cash accounts (cards and investments are out). */
export function cashAccounts<T extends AccountLike>(accounts: readonly T[]): T[] {
  return accounts.filter((a) => a.isActive && CASH_ACCOUNT_TYPES.includes(a.type));
}

/** The period the screen asks for: one of 30, 60 or 90; anything else is the default. */
export function normalizePeriod(value: unknown): number {
  return (CASH_FLOW_PERIODS as readonly number[]).includes(value as number) ? (value as number) : DEFAULT_CASH_FLOW_DAYS;
}

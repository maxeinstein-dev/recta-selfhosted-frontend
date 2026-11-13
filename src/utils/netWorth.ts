// Pure logic of the net worth page ("Patrimônio"). The numbers come from GET /dashboard/net-worth already calculated:
// nothing here recomputes a balance, a debt or an FGTS estimate. Money in the API is reais; sums are done in whole cents
// so 0.1 + 0.2 never shows as 0.30000000000000004.
import { isValidIsoDate, reaisToCents } from './adjustBalance';

export type NetWorthKind = 'cash' | 'investment' | 'reserve' | 'fgts' | 'card';

export interface NetWorthMonth {
  month: string;
  cash: number;
  investments: number;
  reserves: number;
  fgts: number;
  cardDebt: number;
  total: number;
  savings: { income: number; expense: number; surplus: number; contributed: number; rate: number | null };
}

export interface NetWorthItem {
  kind: NetWorthKind;
  id: string;
  name: string;
  /** Signed: a card is negative. */
  amount: number;
  estimated: boolean;
  /** Investments: the date of the market value in use; null when there is none. */
  valuationDate: string | null;
}

export interface NetWorthResponse {
  currency: string;
  /** The income of the savings figures is the realized one (paid entries of the month). */
  incomeBasis: 'realized';
  months: NetWorthMonth[];
  /** The pieces of the last month; they add up to its total. */
  composition: NetWorthItem[];
}

export const NET_WORTH_PERIODS = [6, 12, 24] as const;
export const DEFAULT_NET_WORTH_MONTHS = 12;

const SHORT_MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const LONG_MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** 'out/26', or 'outubro de 2026' when [long]. */
export function monthLabel(month: string, long = false): string {
  const [year, m] = month.split('-');
  const name = (long ? LONG_MONTHS : SHORT_MONTHS)[Number(m) - 1] ?? month;
  return long ? `${name} de ${year}` : `${name}/${(year ?? '').slice(2)}`;
}

export function latest(data: NetWorthResponse): NetWorthMonth | null {
  return data.months[data.months.length - 1] ?? null;
}

/** Change of the total from the month before to the last one. Percent is null when the month before was not positive. */
export function variation(data: NetWorthResponse): { amount: number; percent: number | null } | null {
  if (data.months.length < 2) return null;
  const last = data.months[data.months.length - 1]!;
  const before = data.months[data.months.length - 2]!;
  const diff = reaisToCents(last.total) - reaisToCents(before.total);
  const base = reaisToCents(before.total);
  return { amount: diff / 100, percent: base > 0 ? Math.round((diff / base) * 1000) / 10 : null };
}

export function chartSeries(data: NetWorthResponse): Array<{ month: string; label: string; total: number }> {
  return data.months.map((m) => ({ month: m.month, label: monthLabel(m.month), total: m.total }));
}

const GROUP_ORDER: NetWorthKind[] = ['cash', 'investment', 'reserve', 'fgts', 'card'];

export interface CompositionGroup {
  kind: NetWorthKind;
  total: number;
  /** True when at least one item of the group is an estimate. */
  estimated: boolean;
  items: NetWorthItem[];
}

/** The items grouped by kind, in the order of the screen; a kind without items is not listed. */
export function compositionGroups(items: readonly NetWorthItem[]): CompositionGroup[] {
  const groups: CompositionGroup[] = [];
  for (const kind of GROUP_ORDER) {
    const own = items.filter((i) => i.kind === kind);
    if (own.length === 0) continue;
    groups.push({
      kind,
      total: own.reduce((s, i) => s + reaisToCents(i.amount), 0) / 100,
      estimated: own.some((i) => i.estimated),
      items: own,
    });
  }
  return groups;
}

/** The kinds that carry an estimate, in the order of the screen (for the notice under the total). */
export function estimatedKinds(data: NetWorthResponse): NetWorthKind[] {
  return compositionGroups(data.composition).filter((g) => g.estimated).map((g) => g.kind);
}

/** '62%', '12,3%', '-5%'; a dash when there is no rate (no income in the month). */
export function rateText(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return '—';
  const pct = Math.round(rate * 1000) / 10;
  return `${String(pct).replace('.', ',')}%`;
}

/** The month the savings card talks about: the last one that had realized income. */
export function savingsMonth(data: NetWorthResponse): NetWorthMonth | null {
  for (let i = data.months.length - 1; i >= 0; i--) {
    if (data.months[i]!.savings.income > 0) return data.months[i]!;
  }
  return null;
}

export type ValuationError = 'date' | 'future' | 'amount';

export type ValuationResult = { ok: true; body: { date: string; amount: number } } | { ok: false; error: ValuationError };

/** The body of PUT /accounts/:id/valuations from the form (amount typed in cents), or what is wrong with it. */
export function valuationBody(form: { date: string; cents: number | null }, today: string): ValuationResult {
  if (!isValidIsoDate(form.date)) return { ok: false, error: 'date' };
  if (form.date > today) return { ok: false, error: 'future' };
  if (form.cents === null || form.cents < 0) return { ok: false, error: 'amount' };
  return { ok: true, body: { date: form.date, amount: form.cents / 100 } };
}

/** The last day of the previous month: the statement closes there, so it is the day the value is usually read. */
export function suggestedValuationDate(today: string): string {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** The active investment accounts: the only ones that take a market value. */
export function investmentAccounts<T extends { type: string; isActive: boolean }>(accounts: readonly T[]): T[] {
  return accounts.filter((a) => a.type === 'INVESTMENT' && a.isActive);
}

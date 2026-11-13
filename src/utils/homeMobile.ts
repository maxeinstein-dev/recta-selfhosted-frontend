/**
 * Presentation logic of the Início tab below 768 px (lote R5). Pure: no React, so tools/fe-tests/t44_home_mobile.mts
 * runs it under tsx (HOME_MOBILE_MODULE points it at a mutated copy).
 *
 * It only shapes what the screen shows. The numbers come from the existing routes and helpers (cash flow, bills
 * checklist, accounts); nothing here pays, recalculates a balance or decides what the user should do.
 * Money: sums are done in whole cents, so a float never drifts.
 */
import { addDays, isDayKey, monthLabel, shortDate, toCents, type CashFlowEvent } from './cashFlow';
import type { Bill } from './billsChecklist';
import { reserveText } from './savingsGoalsPlan';

/** Formats an amount given in whole cents (the screen passes its own currency formatter). */
export type CentsFormatter = (cents: number) => string;

/* ---------- sobra do mês ---------- */

export interface MonthLeftover {
  incomeCents: number;
  expenseCents: number;
  /** Income minus expense. */
  cents: number;
  /** Share of the income that is left, whole percent; null when there is no income. */
  percentOfIncome: number | null;
  tone: 'positive' | 'negative' | 'zero';
}

const safeCents = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? toCents(value) : 0);

/** "Quanto sobra": the month's income minus everything spent, from the month summary. */
export function monthLeftover(income: unknown, expense: unknown): MonthLeftover {
  return leftoverFromCents(safeCents(income), Math.abs(safeCents(expense)));
}

function leftoverFromCents(incomeCents: number, expenseCents: number): MonthLeftover {
  const cents = incomeCents - expenseCents;
  return {
    incomeCents,
    expenseCents,
    cents,
    percentOfIncome: incomeCents > 0 ? Math.round((cents / incomeCents) * 100) : null,
    tone: cents > 0 ? 'positive' : cents < 0 ? 'negative' : 'zero',
  };
}

/** The line under the big number: a fact in words, never advice. */
export function leftoverHint(leftover: MonthLeftover, format: CentsFormatter): string {
  if (leftover.incomeCents === 0) {
    return leftover.expenseCents === 0 ? 'Sem receita nem despesa lançadas no mês' : 'Sem receita lançada no mês';
  }
  if (leftover.cents < 0) return `As despesas passam da receita em ${format(-leftover.cents)}`;
  if (leftover.cents === 0) return 'Receita e despesas do mês se igualam';
  return `${leftover.percentOfIncome}% da receita do mês fica livre depois das despesas`;
}

/* ---------- sobra prevista ---------- */

/** The periods the cash flow route accepts, in days. */
const FLOW_PERIODS = [30, 60, 90] as const;

export type ForecastPlan = { kind: 'past' } | { kind: 'beyond' } | { kind: 'flow'; days: number };

const DAY_MS = 86_400_000;
const dayMs = (day: string): number => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));

/** Last day of a 'YYYY-MM' month as 'YYYY-MM-DD'. */
function lastDayOf(monthKey: string): string {
  const next = Date.UTC(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 1);
  const d = new Date(next - DAY_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * What the projection must cover to forecast the month chosen in the header: a past month has no projection (the cash
 * flow starts today); the current month uses the 30 days the screen already asks for; a future month needs the
 * shortest period (30, 60 or 90 days) that reaches its last day; past 90 days the forecast does not reach it.
 */
export function forecastPlan(today: string, monthKey: string): ForecastPlan {
  if (!isDayKey(today) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return { kind: 'beyond' };
  const todayMonth = today.slice(0, 7);
  if (monthKey < todayMonth) return { kind: 'past' };
  if (monthKey === todayMonth) return { kind: 'flow', days: FLOW_PERIODS[0] };
  const needed = Math.round((dayMs(lastDayOf(monthKey)) - dayMs(today)) / DAY_MS);
  const days = FLOW_PERIODS.find((p) => p >= needed);
  return days ? { kind: 'flow', days } : { kind: 'beyond' };
}

export interface ProjectedLeftover {
  leftover: MonthLeftover;
  /** 'forecast' includes what is still to come; 'past' and 'beyond' are the posted amount only. */
  reach: 'forecast' | 'past' | 'beyond';
  addedIncomeCents: number;
  addedExpenseCents: number;
}

/** Sources the month summary does not hold yet: occurrences not generated, payroll, and card invoices (cards are left out of the summary). */
const FORECAST_SOURCES: ReadonlySet<string> = new Set(['recurrence', 'payroll', 'invoice']);

/**
 * The month's leftover forecast: what is posted (the month summary: income and expense) plus the events the cash flow
 * projects inside that month and the summary does not hold: recurrence occurrences not generated yet, payroll and
 * invoices (a pending entry is already in the summary). Income adds, expense subtracts, by the event's own amount.
 */
export function projectedLeftover(input: { income: unknown; expense: unknown; events: readonly CashFlowEvent[]; today: string; monthKey: string }): ProjectedLeftover {
  const incomeCents = safeCents(input.income);
  const expenseCents = Math.abs(safeCents(input.expense));
  const plan = forecastPlan(input.today, input.monthKey);
  if (plan.kind !== 'flow') {
    return { leftover: leftoverFromCents(incomeCents, expenseCents), reach: plan.kind, addedIncomeCents: 0, addedExpenseCents: 0 };
  }
  let addedIncomeCents = 0;
  let addedExpenseCents = 0;
  for (const e of input.events) {
    if (!FORECAST_SOURCES.has(e.source) || !isDayKey(e.date) || e.date.slice(0, 7) !== input.monthKey) continue;
    const cents = toCents(e.amount);
    if (cents > 0) addedIncomeCents += cents;
    else addedExpenseCents += -cents;
  }
  return {
    leftover: leftoverFromCents(incomeCents + addedIncomeCents, expenseCents + addedExpenseCents),
    reach: 'forecast',
    addedIncomeCents,
    addedExpenseCents,
  };
}

/** The title of the first card: "Saldo previsto" only when it includes what is still to come. */
export function leftoverTitle(reach: ProjectedLeftover['reach']): string {
  return reach === 'forecast' ? 'Saldo previsto' : reach === 'past' ? 'Sobra do mês' : 'Sobra lançada';
}

/** The fact under the hint: what the forecast added, or that it does not reach the month. Null when there is nothing to add. */
export function leftoverNote(reach: ProjectedLeftover['reach'], monthName: string, addedIncomeCents: number, addedExpenseCents: number, format: CentsFormatter): string | null {
  if (reach === 'past') return null;
  if (reach === 'beyond') return `A previsão não alcança ${monthName}; o valor mostra só o que já foi lançado.`;
  const parts: string[] = [];
  if (addedIncomeCents > 0) parts.push(`${format(addedIncomeCents)} de receitas`);
  if (addedExpenseCents > 0) parts.push(`${format(addedExpenseCents)} de despesas`);
  if (parts.length === 0) return `Nada mais a vencer em ${monthName} no fluxo de caixa`;
  return `Inclui ${parts.join(' e ')} que ainda vão vencer em ${monthName}`;
}

/* ---------- saldos por conta ---------- */

/** Days the "most used" ranking looks back, today included. */
export const USAGE_DAYS = 30;

/** How many transactions each account had in the last 30 days (today included); no account or a bad day is skipped. */
export function accountUsage(transactions: ReadonlyArray<{ accountId?: string | null; date: unknown }>, today: string): Map<string, number> {
  const usage = new Map<string, number>();
  if (!isDayKey(today)) return usage;
  const from = addDays(today, -(USAGE_DAYS - 1));
  for (const t of transactions) {
    if (!t.accountId) continue;
    const day = String(t.date).slice(0, 10);
    if (!isDayKey(day) || day < from || day > today) continue;
    usage.set(t.accountId, (usage.get(t.accountId) ?? 0) + 1);
  }
  return usage;
}

export interface BalanceAccount {
  id: string;
  name: string;
  balance: number;
}

export type BalanceCell = { kind: 'account'; id: string; name: string; cents: number } | { kind: 'more'; count: number; cents: number };

/** How many account cells the row has at most (the last one may be "Mais N contas"). */
export const MAX_BALANCE_CELLS = 3;

/**
 * The row of balances: the most used accounts first (ties by name, so the order never jumps). Up to three accounts all
 * show; with more, the two most used and one "Mais N contas" cell with the sum of the others.
 */
export function balanceCells(accounts: readonly BalanceAccount[], usage: ReadonlyMap<string, number>): BalanceCell[] {
  const ordered = [...accounts].sort(
    (a, b) =>
      (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) ||
      a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const cell = (a: BalanceAccount): BalanceCell => ({ kind: 'account', id: a.id, name: a.name, cents: safeCents(a.balance) });
  if (ordered.length <= MAX_BALANCE_CELLS) return ordered.map(cell);
  const shown = ordered.slice(0, MAX_BALANCE_CELLS - 1).map(cell);
  const rest = ordered.slice(MAX_BALANCE_CELLS - 1);
  return [...shown, { kind: 'more', count: rest.length, cents: rest.reduce((sum, a) => sum + safeCents(a.balance), 0) }];
}

/* ---------- contas a pagar ---------- */

export type BillSituationKind = 'overdue' | 'pending' | 'paid';

/** The single badge of a bill: Pendente until the due day, Atrasada when it passed unpaid, Paga when paid. */
export function billSituation(bill: Pick<Bill, 'overdue'>, paid = false): { kind: BillSituationKind; label: string } {
  if (paid) return { kind: 'paid', label: 'Paga' };
  return bill.overdue ? { kind: 'overdue', label: 'Atrasada' } : { kind: 'pending', label: 'Pendente' };
}

/** The detail line of a bill: its due day; an invoice also names its month. */
export function billDetail(bill: Pick<Bill, 'kind' | 'overdue' | 'dueDate' | 'invoiceMonth'>): string {
  const verb = bill.overdue ? 'venceu' : 'vence';
  if (bill.kind === 'invoice' && bill.invoiceMonth) return `Fatura ${monthLabel(bill.invoiceMonth)} · ${verb} ${shortDate(bill.dueDate)}`;
  return `${bill.overdue ? 'Venceu' : 'Vence'} ${shortDate(bill.dueDate)}`;
}

/** The amount as the list shows it: an estimate carries "≈" in the text, not only a colour. */
export function billAmountText(bill: Pick<Bill, 'amountCents' | 'estimated'>, format: CentsFormatter): string {
  return `${bill.estimated ? '≈ ' : ''}${format(bill.amountCents)}`;
}

/** The name of a line: a savings-goal contribution reads "Guardar: <meta>", any other its description. */
export function billName(bill: Pick<Bill, 'description'> & { kind?: string }): string {
  if (bill.kind === 'reserve') return reserveText(bill.description, null);
  return bill.description || 'Conta sem descrição';
}

/** The accessible name of a bill's check box: bill, due day, situation and amount. */
export function billA11yName(bill: Pick<Bill, 'description' | 'dueDate' | 'overdue' | 'amountCents' | 'estimated'> & { kind?: string }, format: CentsFormatter, paid = false): string {
  const name = billName(bill);
  const amount = `${bill.estimated ? 'valor estimado ' : ''}${format(bill.amountCents)}`;
  return `${name}, vencimento ${shortDate(bill.dueDate)}, ${billSituation(bill, paid).label}, ${amount}`;
}

/** The line under the total of the bills: what is left to pay and how many are overdue. */
export function billsHint(bills: readonly Pick<Bill, 'overdue'>[], monthName: string): { lead: string; overdue: string | null } {
  if (bills.length === 0) return { lead: `Tudo pago em ${monthName}`, overdue: null };
  const late = bills.filter((b) => b.overdue).length;
  return { lead: `falta pagar em ${monthName}`, overdue: late > 0 ? `${late} ${late === 1 ? 'atrasada' : 'atrasadas'}` : null };
}

/** "N de M pagas"; empty when there is nothing at all. */
export function paidCounterText(paid: number, total: number): string {
  const p = Math.max(0, Math.floor(Number.isFinite(paid) ? paid : 0));
  const t = Math.max(0, Math.floor(Number.isFinite(total) ? total : 0));
  return t === 0 ? '' : `${p} de ${t} pagas`;
}

const billCount = (count: number): string => `${count} ${count === 1 ? 'conta' : 'contas'}`;

/** The accessible name of a due-day pill: "Dia 10, 2 contas". */
export function dayPillName(day: string, count: number): string {
  return `Dia ${isDayKey(day) ? day.slice(8, 10) : ''}, ${billCount(count)}`;
}

/** The accessible name of the overdue pill. */
export function overduePillName(count: number): string {
  return `Atrasadas, ${billCount(count)}`;
}

/* ---------- próxima fatura ---------- */

export interface NextInvoice {
  /** Id of the card. */
  sourceId: string;
  description: string;
  amountCents: number;
  /** The day it is really due (the original day of an overdue one). */
  dueDate: string;
  invoiceMonth: string | null;
  overdue: boolean;
  estimated: boolean;
}

/** The invoice to pay first: the outflows of source "invoice" in the cash flow answer, overdue first, then by due day. */
export function nextInvoice(events: readonly CashFlowEvent[], today: string): NextInvoice | null {
  const invoices: NextInvoice[] = [];
  for (const e of events) {
    if (e.source !== 'invoice') continue;
    const cents = toCents(e.amount);
    if (cents >= 0) continue;
    invoices.push({
      sourceId: e.sourceId,
      description: e.description,
      amountCents: -cents,
      dueDate: e.overdue && isDayKey(e.originalDate) ? e.originalDate : e.date,
      invoiceMonth: e.invoiceMonth,
      overdue: e.overdue || e.date < today,
      estimated: e.certainty === 'estimated',
    });
  }
  invoices.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0) || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));
  return invoices[0] ?? null;
}

/** "vence hoje", "vence amanhã", "vence 12/12" or "venceu 08/11"; empty for a bad day. */
export function invoiceDueText(dueDate: string, today: string): string {
  if (!isDayKey(dueDate) || !isDayKey(today)) return '';
  if (dueDate === today) return 'vence hoje';
  if (dueDate === addDays(today, 1)) return 'vence amanhã';
  return `${dueDate < today ? 'venceu' : 'vence'} ${shortDate(dueDate)}`;
}

/* ---------- faixas de aviso ---------- */

export interface WarningStrip {
  id: 'captures' | 'negative';
  title: string;
  subtitle: string;
  /** Route the strip opens. */
  to: string;
}

/** The strips of the Início: shown only when there is something to say, and only facts. */
export function warningStrips(input: { captures: number; negativeDate: string | null }): WarningStrip[] {
  const strips: WarningStrip[] = [];
  const captures = Number.isFinite(input.captures) ? Math.floor(input.captures) : 0;
  if (captures > 0) {
    strips.push({
      id: 'captures',
      title: `${captures} ${captures === 1 ? 'captura' : 'capturas'} a confirmar`,
      subtitle: 'Notificações do banco esperando você',
      to: '/app/transactions',
    });
  }
  if (isDayKey(input.negativeDate)) {
    strips.push({ id: 'negative', title: `A conta fica negativa em ${shortDate(input.negativeDate)}`, subtitle: 'Veja o saldo dia a dia', to: '/app/cash-flow' });
  }
  return strips;
}

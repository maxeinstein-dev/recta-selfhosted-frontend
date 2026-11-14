/**
 * "Pode gastar até DD/MM" (P07 L1): the card at the top of the Fluxo (desktop and mobile) and on the Início. Pure: no
 * React, so tools/fe-tests/t53_spendable.mts runs it under tsx (SPENDABLE_MODULE points it at a mutated copy).
 *
 * The number is the server's (`summary.spendableUntilNextIncome` of GET /dashboard/cash-flow): the lowest FREE balance
 * from today to the next known income, never negative, with no estimate of day-to-day spending. Here we only pick the
 * state and the words. It never says "sobra": the Início already has the leftover (cash) and "Livre da renda".
 */
import { isDayKey, shortDate, toCents, type CashFlowResponse } from './cashFlow';
import type { CashFlowTextKey } from './cashFlowTexts';

export type SpendableView =
  | {
      kind: 'amount';
      /** Day of the next income ('YYYY-MM-DD'). */
      untilDate: string;
      /** What can be spent until it, whole cents, never negative. */
      cents: number;
      zero: boolean;
      /** Day of the lowest free balance in the window. */
      lowestDate: string;
      lowestIsToday: boolean;
      incomeCents: number;
      incomeDescription: string;
    }
  | { kind: 'no-income'; days: number };

/**
 * The state of the card from the cash flow answer; null when there is no answer yet or the backend is older than the
 * fields (the card is then left out, never shown with a guess).
 */
export function spendableView(response: Pick<CashFlowResponse, 'period' | 'summary'> | null | undefined): SpendableView | null {
  const summary = response?.summary;
  if (!summary || summary.nextIncome === undefined) return null;
  const next = summary.nextIncome;
  const spendable = summary.spendableUntilNextIncome;
  if (!next || !spendable || !isDayKey(next.date)) return { kind: 'no-income', days: response!.period.days };
  const cents = Math.max(0, toCents(Number(spendable.amount) || 0));
  return {
    kind: 'amount',
    untilDate: next.date,
    cents,
    zero: cents === 0,
    lowestDate: spendable.lowestDate,
    lowestIsToday: spendable.lowestDate === response!.period.from,
    incomeCents: toCents(Number(next.amount) || 0),
    incomeDescription: next.description ?? '',
  };
}

export interface SpendableLines {
  title: string;
  /** The amount; null when there is no income to measure up to. */
  value: string | null;
  detail: string;
  /** What the number leaves out (free balance, no estimate). */
  note: string;
}

type Text = (key: CashFlowTextKey, vars?: Record<string, string | number>) => string;

/** The words of the card. `money` formats whole cents in the answer's currency. */
export function spendableLines(view: SpendableView, text: Text, money: (cents: number) => string): SpendableLines {
  const note = text('cashFlowSpendableNote');
  if (view.kind === 'no-income') {
    return { title: text('cashFlowSpendableTitleNoIncome'), value: null, detail: text('cashFlowSpendableNoIncome', { days: view.days }), note };
  }
  const date = shortDate(view.untilDate);
  const vars = {
    date,
    lowest: view.lowestIsToday ? text('cashFlowSpendableToday') : shortDate(view.lowestDate),
    description: view.incomeDescription.trim() || text('cashFlowNoDescription'),
    amount: money(view.incomeCents),
  };
  return {
    title: text('cashFlowSpendableTitle', { date }),
    value: money(view.cents),
    detail: text(view.zero ? 'cashFlowSpendableZero' : 'cashFlowSpendableDetail', vars),
    note,
  };
}

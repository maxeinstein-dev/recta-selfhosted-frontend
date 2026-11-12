/**
 * Pure logic of the Fluxo tab on the phone (lote R4): the warning under the chart, which only states facts computed from
 * the projection (first negative day, worst day with the amount short, the day the balance is positive again), and the
 * heading of each day in the list. No React; tools/fe-tests/t42_cash_flow_mobile.mts runs it under tsx
 * (CASH_FLOW_MOBILE_MODULE points it at a mutated copy). The warning never suggests what to do: that is not a fact.
 */
import { fromCents, isDayKey, shortDate, toCents, type CashFlowPoint } from './cashFlow';
import type { CashFlowTextKey } from './cashFlowTexts';

export interface CashFlowWarningFacts {
  /** The first day whose end balance is below zero. */
  negativeDate: string;
  /** The day of the lowest end balance; the earliest one when two tie. */
  worstDate: string;
  /** How much is short on the worst day, in money units (positive). */
  missing: number;
  /** The first day after the worst one with a balance of zero or more; null when it stays negative to the end. */
  backDate: string | null;
  /** The last day of the series (the end of the period). */
  endDate: string;
}

export interface CashFlowWarningLine {
  key: CashFlowTextKey;
  vars: Record<string, string>;
}

/** The facts of the warning, or null when the balance never goes below zero (no warning at all). */
export function cashFlowWarningFacts(points: readonly CashFlowPoint[]): CashFlowWarningFacts | null {
  const negative = points.find((p) => toCents(p.balance) < 0);
  if (!negative) return null;

  let worstIndex = 0;
  for (let i = 1; i < points.length; i += 1) {
    if (toCents(points[i].balance) < toCents(points[worstIndex].balance)) worstIndex = i;
  }
  const worst = points[worstIndex];
  const back = points.slice(worstIndex + 1).find((p) => toCents(p.balance) >= 0);

  return {
    negativeDate: negative.date,
    worstDate: worst.date,
    missing: fromCents(-toCents(worst.balance)),
    backDate: back ? back.date : null,
    endDate: points[points.length - 1].date,
  };
}

/**
 * The sentences of the warning, as keys and values for the texts (so the screen translates them). `formatAmount` writes
 * the money of the missing amount in the currency of the screen. Empty when there are no facts.
 */
export function cashFlowWarningLines(
  facts: CashFlowWarningFacts | null,
  formatAmount: (amount: number) => string,
): CashFlowWarningLine[] {
  if (!facts) return [];
  const lines: CashFlowWarningLine[] = [
    { key: 'cashFlowWarnNegativeFrom', vars: { date: shortDate(facts.negativeDate) } },
    { key: 'cashFlowWarnWorst', vars: { date: shortDate(facts.worstDate), amount: formatAmount(facts.missing) } },
  ];
  if (facts.backDate) {
    lines.push({ key: 'cashFlowWarnBackPositive', vars: { date: shortDate(facts.backDate) } });
  } else {
    lines.push({ key: 'cashFlowWarnStaysNegative', vars: { date: shortDate(facts.endDate) } });
  }
  return lines;
}

const WEEKDAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

/**
 * The heading of a day in the list: "Hoje, 10/11" for the day of the visit, and the weekday for the others ("Seg, 15/11").
 * Empty for anything that is not a day key, so a bad value never shows "NaN".
 */
export function dayHeadingLabel(day: string, today: string, todayWord: string): string {
  if (!isDayKey(day)) return '';
  if (day === today) return `${todayWord}, ${shortDate(day)}`;
  const weekday = WEEKDAYS_PT[new Date(`${day}T12:00:00Z`).getUTCDay()];
  return `${weekday}, ${shortDate(day)}`;
}

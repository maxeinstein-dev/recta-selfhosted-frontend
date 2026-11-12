/**
 * Own share of a budget: what the user really carries of the spending of a category, after taking out what other
 * people owe on those expenses (GET /budgets/summary answers it as `ownSpent`, next to `spending`).
 *
 * The screens keep their own realized number; this only says when there is a share to show and how it compares with
 * the limit. No React: tools/fe-tests/t34_budget_own_share.mts runs it under tsx.
 *
 * Money: the API answers in reais; comparisons are made in whole cents.
 */
export interface OwnShareSummaryRow {
  budgetId: string;
  spending: number;
  ownSpent?: number;
  /** How the budget is measured (absent on an older API: the full spending). */
  measure?: string;
  /** The amount the limit is compared with, as the API computed it. */
  measured?: number;
  /** First month in force ('YYYY-MM'): the budget repeats from it on. */
  month?: string;
}

export interface OwnShare {
  /** What the user carries, in reais. */
  ownSpent: number;
  /** What other people owe on the expenses of the budget, in reais. */
  othersOwe: number;
}

const cents = (value: number): number => Math.round(value * 100);

/**
 * Budget id -> own share, only for the budgets where other people owe something (own share below the spending by at
 * least one cent). A row without `ownSpent` (older API) or with an invalid number is left out.
 */
export function ownShareByBudget(rows: readonly OwnShareSummaryRow[] | undefined): Map<string, OwnShare> {
  const out = new Map<string, OwnShare>();
  for (const row of rows ?? []) {
    if (typeof row.ownSpent !== 'number' || !Number.isFinite(row.ownSpent) || !Number.isFinite(row.spending)) continue;
    const own = Math.max(0, cents(row.ownSpent));
    const diff = cents(row.spending) - own;
    if (diff < 1) continue;
    out.set(row.budgetId, { ownSpent: own / 100, othersOwe: diff / 100 });
  }
  return out;
}

export type BudgetRealizedStatus = 'ok' | 'warning' | 'exceeded';

/** WHOLE: the full spending (a budget kept together). OWN_SHARE: only the own share (kept separately). */
export type BudgetMeasure = 'WHOLE' | 'OWN_SHARE';

export interface BudgetRealized {
  measure: BudgetMeasure;
  /** Full realized amount of the month, as the API computed it. */
  spent: number;
  /** The amount the limit is compared with: `spent`, or the own share for a budget measured separately. */
  measured: number;
  /** Own share, only for an expense budget where other people owe part of the spending. Never above `spent`. */
  ownSpent?: number;
  /** Limit minus the measured amount (negative when exceeded). */
  remaining: number;
  /** Measured amount over the limit, in percent (0 without a limit). */
  percentage: number;
  status: BudgetRealizedStatus;
}

/** Budget id -> its row of GET /budgets/summary. */
export function summaryRowsByBudget(rows: readonly OwnShareSummaryRow[] | undefined): Map<string, OwnShareSummaryRow> {
  return new Map((rows ?? []).map((row): [string, OwnShareSummaryRow] => [row.budgetId, row]));
}

/**
 * The numbers a budget shows, all from ONE source: its row of GET /budgets/summary. The screens never sum transactions
 * themselves (they only hold the latest page of them in memory, and the API is where the rules of the month, of the
 * type and of the shares live). No row, or an invalid amount, gives null: the screen then shows that the amount is not
 * available instead of a number of its own.
 *
 * Sums are made in whole cents. The status follows the MEASURED amount over the limit (the amount the API measured for
 * the mode of the budget; never one computed here): 100% or more is exceeded, 80% or more a warning.
 */
export function budgetRealized(limit: number, row: OwnShareSummaryRow | undefined, isExpense: boolean): BudgetRealized | null {
  if (!row || typeof row.spending !== 'number' || !Number.isFinite(row.spending) || !Number.isFinite(limit)) return null;
  const spentCents = Math.max(0, cents(row.spending));
  const limitCents = cents(limit);
  // Only an expense budget can be measured separately, and only with the amount the API measured
  const separate = isExpense && row.measure === 'OWN_SHARE' && typeof row.measured === 'number' && Number.isFinite(row.measured);
  const measure: BudgetMeasure = isExpense && row.measure === 'OWN_SHARE' ? 'OWN_SHARE' : 'WHOLE';
  const measuredCents = separate ? Math.max(0, cents(row.measured as number)) : spentCents;
  const percentage = limitCents > 0 ? (measuredCents / limitCents) * 100 : 0;
  const status: BudgetRealizedStatus = percentage >= 100 ? 'exceeded' : percentage >= 80 ? 'warning' : 'ok';
  const own = isExpense ? ownShareByBudget([row]).get(row.budgetId) : undefined;
  return {
    measure,
    spent: spentCents / 100,
    measured: measuredCents / 100,
    ...(own ? { ownSpent: Math.min(own.ownSpent, spentCents / 100) } : {}),
    remaining: (limitCents - measuredCents) / 100,
    percentage,
    status,
  };
}

/** Own share as a percentage of the limit (0 when there is no limit). */
export function ownSharePercentage(ownSpent: number, limit: number): number {
  return limit > 0 ? (ownSpent / limit) * 100 : 0;
}

/** 'YYYY-MM' of a local date: the planning month the summary is asked for. */
export function summaryMonthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** The mode a budget is saved with: only an expense budget can be measured separately; anything else is WHOLE. */
export function measureForSave(choice: string | undefined, isExpense: boolean): BudgetMeasure {
  return isExpense && choice === 'OWN_SHARE' ? 'OWN_SHARE' : 'WHOLE';
}

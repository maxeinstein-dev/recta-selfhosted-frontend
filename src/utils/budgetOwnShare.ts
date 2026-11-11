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

/** Own share as a percentage of the limit (0 when there is no limit). */
export function ownSharePercentage(ownSpent: number, limit: number): number {
  return limit > 0 ? (ownSpent / limit) * 100 : 0;
}

/** 'YYYY-MM' of a local date: the planning month the summary is asked for. */
export function summaryMonthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

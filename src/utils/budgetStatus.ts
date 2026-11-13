/**
 * Status of a budget against its limit, in whole cents (the same rule as the server, budget-status.ts): exactly at the
 * limit is "reached" (all of the limit is used), above it "exceeded", from 80% on "warning". A limit of zero or less
 * is never reached. No React: tools/fe-tests/t50_budget_status.mts runs it under tsx.
 */
export type BudgetStatusName = 'ok' | 'warning' | 'reached' | 'exceeded';

const toCents = (value: number): number => Math.round(value * 100);

export function budgetStatusOf(spent: number, limit: number): BudgetStatusName {
  const limitCents = toCents(limit);
  if (limitCents <= 0) return 'ok';
  const spentCents = toCents(spent);
  if (spentCents > limitCents) return 'exceeded';
  if (spentCents === limitCents) return 'reached';
  if (spentCents * 100 >= limitCents * 80) return 'warning';
  return 'ok';
}

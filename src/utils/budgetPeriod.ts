/**
 * A budget repeats: it is in force from its own month on, until a later budget of the same category replaces it or
 * until its end month. The server decides which budgets are in force in a month (GET /budgets/summary?month= answers
 * only those); the screens never filter by month themselves.
 *
 * This module only says what the screen does with a budget it shows in a month that is not the budget's own month:
 * editing it means "a new amount from this month on" (a new budget for this month; past months keep theirs), and
 * removing it means "end it before this month" (past months keep showing it). In its own month, edit and delete act on
 * the budget itself.
 *
 * No React: tools/fe-tests/t41_budget_period.mts runs it under tsx. Months are 'YYYY-MM' strings.
 */

/** 'YYYY-MM' of a local date. */
export function monthKeyOfDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** The month before a 'YYYY-MM' month. */
export function previousMonthKey(monthKey: string): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

/** Whether a budget shown in `selectedKey` comes from an earlier month (it repeats into the month shown). */
export function isInherited(budgetMonthKey: string | undefined, selectedKey: string): boolean {
  return !!budgetMonthKey && budgetMonthKey < selectedKey;
}

/** The budgets the server says are in force in the month, in the order of `budgets`. */
export function budgetsInForce<T extends { id?: string }>(budgets: readonly T[], inForceIds: ReadonlySet<string>): T[] {
  return budgets.filter((b) => !!b.id && inForceIds.has(b.id));
}

/**
 * What editing a budget shown in `selectedKey` edits: the budget itself in its own month; otherwise a NEW budget for the
 * month shown, prefilled with the inherited values (no id, month = the month shown).
 */
export function editTarget<T extends { id?: string; month: Date }>(budget: T, budgetMonthKey: string | undefined, selectedMonth: Date): T {
  if (!isInherited(budgetMonthKey, monthKeyOfDate(selectedMonth))) return budget;
  return { ...budget, id: undefined, month: new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1) };
}

export type BudgetRemoval = { kind: 'delete' } | { kind: 'end'; endMonth: string };

/**
 * What removing a budget shown in `selectedKey` does: in its own month, delete it; inherited from an earlier month, end
 * it in the month before (the request takes a day: the first of that month).
 */
export function removalFor(budgetMonthKey: string | undefined, selectedKey: string): BudgetRemoval {
  return isInherited(budgetMonthKey, selectedKey) ? { kind: 'end', endMonth: `${previousMonthKey(selectedKey)}-01` } : { kind: 'delete' };
}

/** 'MM/YYYY' of a 'YYYY-MM' month, for "since" labels. */
export function monthLabel(monthKey: string): string {
  return `${monthKey.slice(5, 7)}/${monthKey.slice(0, 4)}`;
}

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CategoryType } from '../../lib/enums';
import { BILLS_PERIOD_DAYS, monthEnd, monthStart } from '../../utils/billsChecklist';
import { useCashFlow } from './useCashFlow';
import { useExecuteRecurringTransaction, useRecurringTransactions } from './useRecurringTransactions';
import { useTransactions, useUpdateTransaction } from './useTransactions';

export interface BillsParams {
  householdId?: string;
  /** One cash account; omit it for all the cash accounts of the household. */
  accountId?: string;
}

/** 'YYYY-MM-DD' as a local Date at midnight (the transaction list formats its dates with local fields). */
const localDate = (day: string): Date => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));

/** The cash flow answer the checklist reads: the next 30 days, which always reach the end of the current month. */
export function useBillsCashFlow({ householdId, accountId }: BillsParams) {
  return useCashFlow({ householdId, accountId, days: BILLS_PERIOD_DAYS });
}

/**
 * The paid expenses of the month of `today` (the day the cash flow answer was computed on; undefined until it arrives).
 * One page of 100: the counter only reads the recurrence-born ones, and a month rarely has more than that.
 */
export function usePaidMonthExpenses({ householdId, accountId, today }: BillsParams & { today?: string }) {
  return useTransactions({
    householdId: today ? householdId : undefined,
    accountId,
    startDate: today ? localDate(monthStart(today)) : undefined,
    endDate: today ? localDate(monthEnd(today)) : undefined,
    type: CategoryType.EXPENSE,
    paid: true,
    limit: 100,
  });
}

/** The active recurrences of the household, to know which not-yet-generated occurrences the route can generate. */
export function useBillsRecurrences(householdId?: string) {
  return useRecurringTransactions({ householdId: householdId ?? '', isActive: true });
}

/**
 * The writes of the checklist, on the routes the app already has: PATCH /transactions/:id for a pending entry and
 * POST /recurring-transactions/:id/execute for an occurrence. Both also refresh the cash flow (the 'dashboard' keys),
 * which the execute hook alone does not.
 */
export function useBillActions() {
  const queryClient = useQueryClient();
  const update = useUpdateTransaction();
  const execute = useExecuteRecurringTransaction();

  const payPending = useCallback(async (transactionId: string) => {
    await update.mutateAsync({ id: transactionId, paid: true });
  }, [update]);

  const generateOccurrence = useCallback(async (recurringId: string, paid: boolean) => {
    const result = await execute.mutateAsync({ recurringId, paid });
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    return result;
  }, [execute, queryClient]);

  return { payPending, generateOccurrence };
}

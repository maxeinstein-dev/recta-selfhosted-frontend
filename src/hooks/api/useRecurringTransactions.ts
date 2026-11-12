import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { CategoryType, RecurrenceFrequency, CategoryName } from '../../lib/enums';
import type { Transaction } from './useTransactions';
import type { ForecastDetail, ForecastStrategy } from '../../utils/forecastStrategy';

export interface RecurringTransaction {
  id: string;
  householdId: string;
  description: string;
  amount: number;
  categoryName: CategoryName;
  accountId: string;
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate?: string;
  nextRunAt: string;
  isActive: boolean;
  /** Phase 5: the amount follows the most recent occurrence the user adjusts. Absent on an older server. */
  followLastAmount?: boolean;
  /** YYYY-MM-DD of the newest occurrence up to today + 31 days; null when none; absent on an older server. */
  lastOccurrenceDate?: string | null;
  /** Months between an occurrence's date and the month it refers to; null = same month. Absent on an older server. */
  competenceOffsetMonths?: number | null;
  /** How the amount of the next occurrence is forecast. Absent on an older server (= the last value). */
  forecastStrategy?: ForecastStrategy;
  forecastWindow?: number | null;
  dailyRate?: number | null;
  safetyBusinessDays?: number;
  nonWorkingDays?: string[];
  optionalHolidays?: string[];
  aliases?: string[];
  earlyDiscountDay?: number | null;
  earlyDiscountType?: 'FIXED' | 'PERCENT' | null;
  earlyDiscountValue?: number | null;
  /** The discount of the next occurrence while it can still be had (list only). */
  earlyDiscount?: { limitDate: string; fullAmount: number; discountedAmount: number; savings: number } | null;
  /** What the next occurrence is expected to carry and how it was reached (list only). */
  forecast?: ForecastDetail | null;
  createdAt: string;
  updatedAt: string;
}

/** Sent back by the transaction update when it changed the amount of the recurrence the transaction belongs to. */
export interface RecurringUpdatedNotice {
  id: string;
  amount: number;
}

export interface ListRecurringTransactionsParams {
  householdId: string;
  isActive?: boolean;
  type?: CategoryType;
}

/**
 * List recurring transactions
 */
export interface RecurringTransactionsResponse {
  success: boolean;
  data: RecurringTransaction[];
}

export function useRecurringTransactions(params: ListRecurringTransactionsParams) {
  const { currentUser } = useAuth();
  const isAuthenticated = !!currentUser;
  
  return useQuery({
    queryKey: ['recurring-transactions', params],
    queryFn: async () => {
      const response = await apiClient.get<RecurringTransactionsResponse>('/recurring-transactions', params);
      return response.data!;
    },
    enabled: isAuthenticated && !!params.householdId, // Only fetch when authenticated and householdId is available
  });
}

/**
 * Get recurring transactions that are due
 */
export function useDueRecurringTransactions(householdId: string) {
  const { currentUser } = useAuth();
  const isAuthenticated = !!currentUser;
  
  return useQuery({
    queryKey: ['recurring-transactions', 'due', householdId],
    queryFn: async () => {
      const response = await apiClient.get<RecurringTransaction[]>('/recurring-transactions/due', { householdId });
      return response.data!;
    },
    enabled: isAuthenticated && !!householdId, // Only fetch when authenticated and householdId is available
  });
}

/**
 * Get recurring transaction by ID
 */
export function useRecurringTransaction(recurringId: string) {
  return useQuery({
    queryKey: ['recurring-transactions', recurringId],
    queryFn: async () => {
      const response = await apiClient.get<RecurringTransaction>(`/recurring-transactions/${recurringId}`);
      return response.data!;
    },
    enabled: !!recurringId,
  });
}

/**
 * Create recurring transaction mutation
 */
export function useCreateRecurringTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      householdId?: string; // Optional - backend will create personal household if not provided
      description?: string;
      amount: number;
      categoryName: CategoryName;
      accountId: string;
      frequency: RecurrenceFrequency;
      startDate: string;
      nextRunAt: string;
      endDate?: string;
      isActive?: boolean;
      followLastAmount?: boolean;
      competenceOffsetMonths?: number | null;
      forecastStrategy?: ForecastStrategy;
      forecastWindow?: number | null;
      dailyRate?: number | null;
      safetyBusinessDays?: number;
      nonWorkingDays?: string[];
      optionalHolidays?: string[];
      aliases?: string[];
      earlyDiscountDay?: number | null;
      earlyDiscountType?: 'FIXED' | 'PERCENT' | null;
      earlyDiscountValue?: number | null;
    }) => {
      const response = await apiClient.post<RecurringTransaction>('/recurring-transactions', data);
      return response.data!;
    },
    onSuccess: () => {
      // The card statement forecast depends on the recurrences.
      queryClient.invalidateQueries({ queryKey: ['transactions', 'credit-card-invoice'] });
      queryClient.invalidateQueries({ queryKey: ['transactions', 'card-commitment'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-transactions'] });
      // Invalidate auth/me to refresh household list
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });
}

/**
 * Update recurring transaction mutation
 */
export function useUpdateRecurringTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<RecurringTransaction>) => {
      const response = await apiClient.patch<RecurringTransaction>(`/recurring-transactions/${id}`, data);
      return response.data!;
    },
    onSuccess: (_, variables) => {
      // The card statement forecast depends on the recurrences.
      queryClient.invalidateQueries({ queryKey: ['transactions', 'credit-card-invoice'] });
      queryClient.invalidateQueries({ queryKey: ['transactions', 'card-commitment'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-transactions', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['recurring-transactions', 'due'] });
    },
  });
}

/**
 * Delete recurring transaction mutation
 */
export function useDeleteRecurringTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recurringId: string) => {
      const response = await apiClient.delete<{ id: string }>(`/recurring-transactions/${recurringId}`);
      return response.data!;
    },
    onSuccess: () => {
      // The card statement forecast depends on the recurrences.
      queryClient.invalidateQueries({ queryKey: ['transactions', 'credit-card-invoice'] });
      queryClient.invalidateQueries({ queryKey: ['transactions', 'card-commitment'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-transactions', 'due'] });
    },
  });
}

/**
 * Execute recurring transaction mutation
 */
export function useExecuteRecurringTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ recurringId, ...data }: { recurringId: string; date?: string; amount?: number; paid?: boolean }) => {
      const response = await apiClient.post<{ transaction: Transaction; nextRunAt?: string; skipped?: boolean; recurringTransaction?: RecurringTransaction }>(
        `/recurring-transactions/${recurringId}/execute`,
        data
      );
      return response.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-transactions', 'due'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}


/**
 * Pay the next occurrence of a recurrence ahead (POST /recurring-transactions/:id/pay-next): creates the occurrence of its
 * nextRunAt already paid (the discounted amount until the limit day, the full one after) and moves the recurrence on.
 * Refreshes everything that shows money: balances, bills, cash flow, card commitment and the recurrences.
 */
export function usePayNextOccurrence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ recurringId, ...body }: { recurringId: string; amount?: number; date?: string; accountId?: string }) => {
      const response = await apiClient.post<{ transaction: Transaction; nextRunAt?: string }>(`/recurring-transactions/${recurringId}/pay-next`, body);
      return response.data!;
    },
    // On success or failure: a 409 means the data on screen is stale, so it is refreshed either way.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] }); // lists, summaries, card invoice and commitment
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }); // cash flow, bills, home
    },
  });
}

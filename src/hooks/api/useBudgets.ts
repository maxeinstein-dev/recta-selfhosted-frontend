import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../utils/api';
import { CategoryName, CategoryType } from '../../lib/enums';
import { useAuth } from '../../context/AuthContext';

export interface Budget {
  id: string;
  householdId: string;
  categoryName: CategoryName | 'GENERAL';
  monthlyLimit: number;
  month: string;
  type: CategoryType;
  measure?: 'WHOLE' | 'OWN_SHARE';
  /** Last month in force ('YYYY-MM-DD', first day); null or absent = no end. */
  endMonth?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetSummary {
  budgets: Array<{
    budgetId: string;
    categoryName: CategoryName | 'GENERAL';
    categoryColor?: string;
    monthlyLimit: number;
    spending: number;
    /** Spending minus what other people owe on those expenses (absent on an older API). */
    ownSpent?: number;
    /** How the budget is measured, and the amount the limit is compared with. */
    measure?: 'WHOLE' | 'OWN_SHARE';
    measured?: number;
    /** First month in force and last one ('YYYY-MM'; null = no end). Absent on an older API. */
    month?: string;
    endMonth?: string | null;
    remaining: number;
    percentage: number;
    isOverBudget: boolean;
  }>;
  totalLimit: number;
  totalSpending: number;
  totalOwnSpending?: number;
}

export interface ListBudgetsParams {
  householdId?: string; // Optional - backend will use personal household if not provided
  startDate?: string;
  endDate?: string;
  categoryName?: CategoryName | 'GENERAL';
}

export interface BudgetSummaryParams {
  householdId: string;
  /** Planning month 'YYYY-MM' (reference month when set); or a date range. */
  month?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * List budgets
 */
export function useBudgets(params?: ListBudgetsParams) {
  const { currentUser } = useAuth();
  const isAuthenticated = !!currentUser;
  
  return useQuery({
    queryKey: ['budgets', params],
    queryFn: async () => {
      const response = await apiClient.get<Budget[]>('/budgets', params || {});
      return response.data!;
    },
    enabled: isAuthenticated && (!params || !!params.householdId), // Only fetch when authenticated and householdId is available
  });
}

/**
 * Get budget by ID
 */
export function useBudget(budgetId: string) {
  const { currentUser } = useAuth();
  const isAuthenticated = !!currentUser;
  
  return useQuery({
    queryKey: ['budgets', budgetId],
    queryFn: async () => {
      const response = await apiClient.get<Budget>(`/budgets/${budgetId}`);
      return response.data!;
    },
    enabled: isAuthenticated && !!budgetId, // Only fetch when authenticated and budgetId is available
  });
}

/**
 * Get budget summary
 */
export function useBudgetSummary(params: BudgetSummaryParams) {
  const { currentUser } = useAuth();
  const isAuthenticated = !!currentUser;
  
  return useQuery({
    queryKey: ['budgets', 'summary', params],
    queryFn: async () => {
      const response = await apiClient.get<BudgetSummary>('/budgets/summary', params);
      return response.data!;
    },
    // The screens show these numbers as they are: never an old answer after a transaction changed.
    staleTime: 0,
    refetchOnMount: 'always',
    enabled: isAuthenticated && !!params.householdId && (!!params.month || (!!params.startDate && !!params.endDate)), // Only fetch when authenticated and all params are available
  });
}

/**
 * Create budget mutation
 */
export function useCreateBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      householdId?: string; // Optional - backend will create personal household if not provided
      categoryName: CategoryName | 'GENERAL';
      monthlyLimit: number;
      month: string;
      type: CategoryType;
      measure?: 'WHOLE' | 'OWN_SHARE';
    }) => {
      const response = await apiClient.post<Budget>('/budgets', data);
      return response.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
      queryClient.invalidateQueries({ queryKey: ['budgets', 'summary'] });
      // Invalidate auth/me to refresh household list
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });
}

/**
 * Update budget mutation
 */
export function useUpdateBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<Budget>) => {
      const response = await apiClient.patch<Budget>(`/budgets/${id}`, data);
      return response.data!;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
      queryClient.invalidateQueries({ queryKey: ['budgets', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['budgets', 'summary'] });
    },
  });
}

/**
 * Delete budget mutation
 */
export function useDeleteBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (budgetId: string) => {
      const response = await apiClient.delete<{ id: string }>(`/budgets/${budgetId}`);
      return response.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
      queryClient.invalidateQueries({ queryKey: ['budgets', 'summary'] });
    },
  });
}


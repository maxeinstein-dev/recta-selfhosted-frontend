import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { contributionBody, type GoalKind, type GoalThisMonth } from '../../utils/savingsGoalsPlan';

export interface SavingsGoal {
  id: string;
  householdId: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate?: string;
  accountId?: string;
  /** P03: reserve (kept little by little) or provision (an expense with a due month). */
  kind?: GoalKind;
  monthlyContribution?: number | string | null;
  /** 1..28 */
  contributionDay?: number | null;
  /** 'YYYY-MM', provisions only. */
  dueMonth?: string | null;
  thisMonth?: GoalThisMonth;
  createdAt: string;
  updatedAt: string;
}

export interface ListSavingsGoalsParams {
  householdId: string;
  accountId?: string;
}

/**
 * List savings goals
 */
export function useSavingsGoals(params: ListSavingsGoalsParams) {
  const { currentUser } = useAuth();
  const isAuthenticated = !!currentUser;
  
  return useQuery({
    queryKey: ['savings-goals', params],
    queryFn: async () => {
      const response = await apiClient.get<SavingsGoal[]>('/savings-goals', params);
      return response.data!;
    },
    enabled: isAuthenticated && !!params.householdId, // Only fetch when authenticated and householdId is available
  });
}

/**
 * Get savings goal by ID
 */
export function useSavingsGoal(goalId: string) {
  const { currentUser } = useAuth();
  const isAuthenticated = !!currentUser;
  
  return useQuery({
    queryKey: ['savings-goals', goalId],
    queryFn: async () => {
      const response = await apiClient.get<SavingsGoal>(`/savings-goals/${goalId}`);
      return response.data!;
    },
    enabled: isAuthenticated && !!goalId, // Only fetch when authenticated and goalId is available
  });
}

/**
 * Create savings goal mutation
 */
export function useCreateSavingsGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      householdId?: string; // Optional - backend will create personal household if not provided
      name: string;
      targetAmount: number;
      currentAmount?: number;
      targetDate?: string;
      accountId?: string;
      kind?: GoalKind;
      monthlyContribution?: number;
      contributionDay?: number;
      dueMonth?: string;
    }) => {
      const response = await apiClient.post<SavingsGoal>('/savings-goals', {
        ...data,
        currentAmount: data.currentAmount ?? 0,
      });
      return response.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savings-goals'] });
      // Invalidate auth/me to refresh household list
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });
}

/**
 * Update savings goal mutation
 */
export function useUpdateSavingsGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<SavingsGoal>) => {
      const response = await apiClient.patch<SavingsGoal>(`/savings-goals/${id}`, data);
      return response.data!;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['savings-goals'] });
      queryClient.invalidateQueries({ queryKey: ['savings-goals', variables.id] });
    },
  });
}

/**
 * Add to savings goal mutation
 */
export function useAddToSavingsGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ goalId, ...data }: { goalId: string; amount: number; description?: string }) => {
      const response = await apiClient.post<SavingsGoal>(`/savings-goals/${goalId}/add`, data);
      return response.data!;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['savings-goals'] });
      queryClient.invalidateQueries({ queryKey: ['savings-goals', data.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

/**
 * Delete savings goal mutation
 */
export function useDeleteSavingsGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (goalId: string) => {
      const response = await apiClient.delete<{ id: string }>(`/savings-goals/${goalId}`);
      return response.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savings-goals'] });
    },
  });
}


/** One account of GET /savings-goals/summary: what the goals keep in it and what is free. */
export interface SavingsGoalsSummary {
  accounts: Array<{ accountId: string; name: string; type: string; balance: number; allocated: number; free: number }>;
  totalAllocated: number;
}

/** Free and kept money of the accounts that have a linked goal (the account balance itself never changes with a contribution). */
export function useSavingsGoalsSummary(householdId?: string) {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: ['savings-goals', 'summary', householdId ?? null],
    enabled: !!currentUser && !!householdId,
    queryFn: async () => {
      const response = await apiClient.get<SavingsGoalsSummary>('/savings-goals/summary', householdId ? { householdId } : undefined);
      return response.data!;
    },
  });
}

export interface GoalContribution {
  id: string;
  goalId: string;
  amount: number;
  date: string;
  month: string;
  createdAt: string;
}

/** What changes after a contribution: the goals, the summary (same key) and the cash flow / bills (['dashboard']). */
function invalidateAfterContribution(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['savings-goals'] });
  queryClient.invalidateQueries({ queryKey: ['dashboard'] });
}

/**
 * "Guardar agora": POST /savings-goals/:id/contributions. No amount = the month's planned one; no date = today. The 409
 * (the month already has one) is left to the caller, which asks and sends again with confirmDuplicate.
 */
export function useContributeToGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (p: { goalId: string; amountCents?: number | null; date?: string | null; confirmDuplicate?: boolean }) => {
      const response = await apiClient.post<{ contribution: GoalContribution; goal: { id: string; currentAmount: number } }>(
        `/savings-goals/${p.goalId}/contributions`,
        contributionBody(p),
      );
      return response.data!;
    },
    onSuccess: () => invalidateAfterContribution(queryClient),
  });
}

/** Undo the latest contribution of the goal in `month` ('YYYY-MM'). Resolves false when the month has none. */
export function useUndoLastContribution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (p: { goalId: string; month: string }) => {
      const list = await apiClient.get<GoalContribution[] | { contributions: GoalContribution[] }>(`/savings-goals/${p.goalId}/contributions`, { month: p.month });
      const raw = list.data as unknown;
      const items = Array.isArray(raw) ? raw : ((raw as { contributions?: GoalContribution[] } | undefined)?.contributions ?? []);
      // The route lists the newest first
      const latest = items[0];
      if (!latest) return false;
      await apiClient.delete(`/savings-goals/${p.goalId}/contributions/${latest.id}`);
      return true;
    },
    onSuccess: () => invalidateAfterContribution(queryClient),
  });
}

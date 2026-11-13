import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { apiClient } from '../../utils/api';
import type { MonthCloseResponse } from '../../utils/monthClose';

/**
 * What still stops a month from being conferred (GET /dashboard/month-close). Read-only. The key lives under
 * ['dashboard'] so a change to the balances (which invalidates it) refreshes the check too.
 */
export function useMonthClose(params: { householdId?: string; month: string }) {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: ['dashboard', 'month-close', params.householdId ?? null, params.month],
    enabled: !!currentUser && !!params.householdId,
    queryFn: async (): Promise<MonthCloseResponse> => {
      const query: Record<string, unknown> = { month: params.month };
      if (params.householdId) query.householdId = params.householdId;
      const response = await apiClient.get<MonthCloseResponse>('/dashboard/month-close', query);
      if (!response.data) throw new Error('Empty month close response');
      return response.data;
    },
    refetchOnWindowFocus: false,
  });
}

/** Records the conference of one account (or card): the balance on the statement, against the system's. */
export function useSaveMonthClosing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { householdId?: string; month: string; accountId: string; informedBalance: number }) => {
      const response = await apiClient.post<{ difference: number }>('/dashboard/month-close', input);
      return response.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'month-close'] });
    },
  });
}

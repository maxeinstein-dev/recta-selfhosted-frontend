import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { apiClient } from '../../utils/api';
import type { SpendingByMethodResponse } from '../../utils/creditVsDebit';

/**
 * How the spending of the last months was paid: credit card against the other accounts (GET /dashboard/spending-by-method).
 * Read-only. The key lives under ['dashboard'], so the invalidation that follows a change to the transactions refreshes it.
 */
export function useSpendingByMethod(params: { householdId: string | undefined; to: string; months: number }) {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: ['dashboard', 'spending-by-method', params.householdId ?? null, params.to, params.months],
    enabled: !!currentUser && !!params.householdId,
    queryFn: async (): Promise<SpendingByMethodResponse> => {
      const response = await apiClient.get<SpendingByMethodResponse>('/dashboard/spending-by-method', {
        householdId: params.householdId,
        to: params.to,
        months: params.months,
      });
      if (!response.data) throw new Error('Empty spending by method response');
      return response.data;
    },
    refetchOnWindowFocus: false,
  });
}

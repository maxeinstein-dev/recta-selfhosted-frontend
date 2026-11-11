import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { apiClient } from '../../utils/api';
import type { CashFlowResponse } from '../../utils/cashFlow';

export interface CashFlowParams {
  householdId?: string;
  /** One cash account; omit it for all the cash accounts of the household. */
  accountId?: string;
  /** Days after today: 30, 60 or 90. */
  days: number;
}

/**
 * The projected cash flow (GET /dashboard/cash-flow). Read-only, so nothing here invalidates it; the dashboard key is
 * shared so a change to the balances (which invalidates ['dashboard']) refreshes it too.
 */
export function useCashFlow(params: CashFlowParams) {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: ['dashboard', 'cash-flow', params.householdId ?? null, params.accountId ?? null, params.days],
    enabled: !!currentUser && !!params.householdId,
    queryFn: async (): Promise<CashFlowResponse> => {
      const query: Record<string, unknown> = { days: params.days };
      if (params.householdId) query.householdId = params.householdId;
      if (params.accountId) query.accountId = params.accountId;
      const response = await apiClient.get<CashFlowResponse>('/dashboard/cash-flow', query);
      if (!response.data) throw new Error('Empty cash flow response');
      return response.data;
    },
    refetchOnWindowFocus: false,
  });
}

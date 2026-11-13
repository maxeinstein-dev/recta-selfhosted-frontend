import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { apiClient } from '../../utils/api';
import type { NetWorthResponse } from '../../utils/netWorth';

export interface NetWorthParams {
  householdId?: string;
  /** Months back from the current one, included: 6, 12 or 24. */
  months: number;
}

/**
 * The net worth by month (GET /dashboard/net-worth). Read-only. The key lives under ['dashboard'], so anything that
 * changes a balance (which invalidates it) refreshes the page too.
 */
export function useNetWorth(params: NetWorthParams) {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: ['dashboard', 'net-worth', params.householdId ?? null, params.months],
    enabled: !!currentUser && !!params.householdId,
    queryFn: async (): Promise<NetWorthResponse> => {
      const query: Record<string, unknown> = { months: params.months };
      if (params.householdId) query.householdId = params.householdId;
      const response = await apiClient.get<NetWorthResponse>('/dashboard/net-worth', query);
      if (!response.data) throw new Error('Empty net worth response');
      return response.data;
    },
    refetchOnWindowFocus: false,
  });
}

export interface AccountValuation {
  id: string;
  accountId: string;
  /** YYYY-MM-DD */
  date: string;
  amount: number;
}

/** The market values informed for an investment account, newest first. */
export function useAccountValuations(accountId: string | undefined) {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: ['valuations', accountId ?? null],
    enabled: !!currentUser && !!accountId,
    queryFn: async (): Promise<AccountValuation[]> => {
      const response = await apiClient.get<AccountValuation[]>(`/accounts/${accountId}/valuations`);
      return response.data ?? [];
    },
    refetchOnWindowFocus: false,
  });
}

function useRefreshAfterValuation() {
  const queryClient = useQueryClient();
  return (accountId: string) => {
    queryClient.invalidateQueries({ queryKey: ['valuations', accountId] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

/** Informs the market value of an account on a day; the same day again replaces it. */
export function useSaveValuation() {
  const refresh = useRefreshAfterValuation();
  return useMutation({
    mutationFn: async ({ accountId, date, amount }: { accountId: string; date: string; amount: number }) => {
      const response = await apiClient.put<AccountValuation>(`/accounts/${accountId}/valuations`, { date, amount });
      return response.data!;
    },
    onSuccess: (_data, variables) => refresh(variables.accountId),
  });
}

export function useDeleteValuation() {
  const refresh = useRefreshAfterValuation();
  return useMutation({
    mutationFn: async ({ accountId, valuationId }: { accountId: string; valuationId: string }) => {
      await apiClient.delete(`/accounts/${accountId}/valuations/${valuationId}`);
    },
    onSuccess: (_data, variables) => refresh(variables.accountId),
  });
}

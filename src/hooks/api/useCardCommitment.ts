import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { apiClient } from '../../utils/api';
import type { CardCommitmentResponse } from '../../utils/cardCommitment';

export interface CardCommitmentParams {
  householdId?: string;
  /** The credit card account. Nothing is fetched without it. */
  accountId?: string | null;
  /** How many invoices, starting from the current month (the route accepts 1 to 12). */
  months: number;
}

/**
 * What the next invoices of one card already commit (GET /transactions/credit-cards/:accountId/commitment). Read-only.
 * The key starts with 'transactions', so the invalidation that follows a change to the card's transactions refreshes it.
 */
export function useCardCommitment(params: CardCommitmentParams) {
  const { currentUser } = useAuth();
  const accountId = params.accountId ?? null;
  return useQuery({
    queryKey: ['transactions', 'card-commitment', accountId, params.householdId ?? null, params.months],
    enabled: !!currentUser && !!params.householdId && !!accountId,
    queryFn: async (): Promise<CardCommitmentResponse> => {
      const query: Record<string, unknown> = { months: params.months };
      if (params.householdId) query.householdId = params.householdId;
      const response = await apiClient.get<CardCommitmentResponse>(
        `/transactions/credit-cards/${accountId}/commitment`,
        query,
      );
      if (!response.data) throw new Error('Empty card commitment response');
      return response.data;
    },
    refetchOnWindowFocus: false,
  });
}

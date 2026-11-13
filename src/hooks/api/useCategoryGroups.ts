import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { apiClient } from '../../utils/api';
import { moveCategory, type CategoryGroup, type CategoryGroupList, type IncomeSplit } from '../../utils/incomeSplit';

/**
 * Where the month's income goes (GET /dashboard/income-split). Read-only. The key lives under ['dashboard'], so anything
 * that changes a balance or a transaction (which invalidates it) refreshes the bar too.
 */
export function useIncomeSplit(params: { householdId?: string; month: string }) {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: ['dashboard', 'income-split', params.householdId ?? null, params.month],
    enabled: !!currentUser && !!params.householdId && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month),
    queryFn: async (): Promise<IncomeSplit> => {
      const response = await apiClient.get<IncomeSplit>('/dashboard/income-split', { householdId: params.householdId, month: params.month });
      if (!response.data) throw new Error('Empty income split response');
      return response.data;
    },
    refetchOnWindowFocus: false,
  });
}

/** Under ['categories'], so creating, merging or deleting a category refreshes the groups as well. */
const groupsKey = (householdId: string | undefined) => ['categories', 'groups', householdId ?? null];

/** Spending groups with their categories, and the ungrouped expense categories (GET /category-groups). */
export function useCategoryGroups(householdId: string | undefined) {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: groupsKey(householdId),
    enabled: !!currentUser && !!householdId,
    queryFn: async (): Promise<CategoryGroupList> => {
      const response = await apiClient.get<CategoryGroupList>('/category-groups', { householdId });
      return response.data ?? { groups: [], ungrouped: [] };
    },
  });
}

function useRefreshGroups(householdId: string | undefined) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: groupsKey(householdId) });
    void queryClient.invalidateQueries({ queryKey: ['dashboard', 'income-split'] });
  };
}

export function useCreateCategoryGroup(householdId: string | undefined) {
  const refresh = useRefreshGroups(householdId);
  return useMutation({
    mutationFn: async (input: { name: string; color?: string | null; isHousing?: boolean }) =>
      (await apiClient.post<CategoryGroup>('/category-groups', { householdId, ...input })).data,
    onSuccess: refresh,
  });
}

export function useUpdateCategoryGroup(householdId: string | undefined) {
  const refresh = useRefreshGroups(householdId);
  return useMutation({
    mutationFn: async ({ id, ...input }: { id: string; name?: string; color?: string | null; isHousing?: boolean; sortOrder?: number }) =>
      (await apiClient.patch<CategoryGroup>(`/category-groups/${id}`, input)).data,
    onSuccess: refresh,
  });
}

export function useDeleteCategoryGroup(householdId: string | undefined) {
  const refresh = useRefreshGroups(householdId);
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/category-groups/${id}`);
    },
    onSuccess: refresh,
  });
}

/**
 * Puts a category in a group (null = "Outros"). Optimistic: the list moves at once and goes back if the server refuses.
 */
export function useAssignCategoryGroup(householdId: string | undefined) {
  const queryClient = useQueryClient();
  const refresh = useRefreshGroups(householdId);
  return useMutation({
    mutationFn: async (input: { categoryName: string; groupId: string | null }) =>
      (await apiClient.put('/category-groups/assignments', { householdId, ...input })).data,
    onMutate: async (input) => {
      const key = groupsKey(householdId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CategoryGroupList>(key);
      if (previous) queryClient.setQueryData(key, moveCategory(previous, input.categoryName, input.groupId));
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(groupsKey(householdId), context.previous);
    },
    onSettled: refresh,
  });
}

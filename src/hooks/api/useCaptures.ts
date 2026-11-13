import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { apiClient } from '../../utils/api';
import type { CaptureItem, CaptureStatus, ConfirmBody } from '../../utils/captureInbox';
import type { AccountRule, RulesDraft } from '../../utils/captureRules';
import { buildRulesBody } from '../../utils/captureRules';
import { buildCardRulesBody, type CardRule, type ReparseResult } from '../../utils/captureReading';

/** Rows per page of the inbox. */
export const CAPTURE_PAGE_SIZE = 20;

interface CapturePage {
  data: CaptureItem[];
  pagination: { nextCursor: string | null; hasMore: boolean };
}

/** The answer of the confirm route: the capture and the transaction it became (new, or the one it already had). */
export interface ConfirmCaptureResult {
  capture: { id: string; status: CaptureStatus; transactionId: string };
  transaction: { id: string };
}

/** The envelope apiClient returns is the response body: { success, data, pagination? }. */
const bodyOf = <T>(response: unknown): { data?: T; pagination?: CapturePage['pagination'] } =>
  (response ?? {}) as { data?: T; pagination?: CapturePage['pagination'] };

const withHousehold = (path: string, householdId: string | undefined): string =>
  householdId ? `${path}${path.includes('?') ? '&' : '?'}householdId=${encodeURIComponent(householdId)}` : path;

/** The captures of a status, newest first, page by page (cursor). */
export function useCaptures(params: { householdId?: string; status: CaptureStatus }) {
  const { currentUser } = useAuth();
  return useInfiniteQuery({
    queryKey: ['captures', 'list', params.householdId ?? null, params.status],
    enabled: !!currentUser && !!params.householdId,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const query: Record<string, unknown> = { status: params.status, limit: CAPTURE_PAGE_SIZE };
      if (params.householdId) query.householdId = params.householdId;
      if (pageParam) query.cursor = pageParam;
      const body = bodyOf<CaptureItem[]>(await apiClient.get<CaptureItem[]>('/captures', query));
      return {
        data: body.data ?? [],
        pagination: body.pagination ?? { nextCursor: null, hasMore: false },
      } satisfies CapturePage;
    },
    getNextPageParam: (last) => (last.pagination.hasMore ? last.pagination.nextCursor : undefined),
    refetchOnWindowFocus: false,
  });
}

/** How many captures wait for a decision (the menu badge). Refreshed every minute while the app is open. */
export function useCapturesCount(householdId: string | undefined, status: CaptureStatus = 'PENDING') {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: ['captures', 'count', householdId ?? null, status],
    enabled: !!currentUser && !!householdId,
    queryFn: async () => {
      const query: Record<string, unknown> = { status };
      if (householdId) query.householdId = householdId;
      const body = bodyOf<{ count: number }>(await apiClient.get<{ count: number }>('/captures/count', query));
      return body.data?.count ?? 0;
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** A confirm, dismiss or restore changes the lists and the balances: refresh them all. */
function invalidateCaptureChange(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['captures'] });
  void queryClient.invalidateQueries({ queryKey: ['transactions'] });
  void queryClient.invalidateQueries({ queryKey: ['accounts'] });
  void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
}

/**
 * POST /captures/:id/confirm. The body is built by buildConfirmBody (only the keys the server takes). Repeating it
 * answers the same transaction, so a double tap cannot create two.
 */
export function useConfirmCapture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; householdId?: string; body: ConfirmBody }) => {
      const response = await apiClient.post<ConfirmCaptureResult>(
        withHousehold(`/captures/${input.id}/confirm`, input.householdId),
        input.body,
      );
      return bodyOf<ConfirmCaptureResult>(response).data;
    },
    onSettled: () => invalidateCaptureChange(queryClient),
  });
}

/** POST /captures/:id/dismiss (idempotent on DISMISSED). */
export function useDismissCapture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; householdId?: string }) =>
      apiClient.post(withHousehold(`/captures/${input.id}/dismiss`, input.householdId)),
    onSettled: () => invalidateCaptureChange(queryClient),
  });
}

/** POST /captures/:id/restore (DISMISSED back to PENDING). */
export function useRestoreCapture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; householdId?: string }) =>
      apiClient.post(withHousehold(`/captures/${input.id}/restore`, input.householdId)),
    onSettled: () => invalidateCaptureChange(queryClient),
  });
}

/** GET /captures/account-rules: every rule of the household. */
export function useCaptureAccountRules(householdId: string | undefined) {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: ['captures', 'account-rules', householdId ?? null],
    enabled: !!currentUser && !!householdId,
    queryFn: async () => {
      const body = bodyOf<AccountRule[]>(await apiClient.get<AccountRule[]>('/captures/account-rules', { householdId }));
      return body.data ?? [];
    },
    refetchOnWindowFocus: false,
  });
}

/**
 * PUT /captures/account-rules. It replaces all the rules, so the body comes from buildRulesBody with the rules the
 * server has now (the ones the screen does not show go back unchanged).
 */
export function useSaveCaptureAccountRules(householdId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { draft: RulesDraft; current: AccountRule[] }) => {
      const body = buildRulesBody(input.draft, input.current);
      const response = await apiClient.put<AccountRule[]>(withHousehold('/captures/account-rules', householdId), body);
      return bodyOf<AccountRule[]>(response).data ?? [];
    },
    onSuccess: (rules) => {
      // The PUT answers the household's rules as saved: show them at once, no flash of the old ones.
      queryClient.setQueryData(['captures', 'account-rules', householdId ?? null], rules);
    },
  });
}

/**
 * POST /captures/reparse (EDITOR): reads again the pending captures read by an older version of the reader. Running it
 * again without a new version answers scanned 0. The lists change, so they are refreshed.
 */
export function useReparseCaptures(householdId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<ReparseResult>(withHousehold('/captures/reparse', householdId));
      return bodyOf<ReparseResult>(response).data ?? null;
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['captures'] }),
  });
}

/** GET /captures/card-rules: the account of each card ending (VIEWER reads). */
export function useCaptureCardRules(householdId: string | undefined) {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: ['captures', 'card-rules', householdId ?? null],
    enabled: !!currentUser && !!householdId,
    queryFn: async () => {
      const body = bodyOf<CardRule[]>(await apiClient.get<CardRule[]>('/captures/card-rules', { householdId }));
      return body.data ?? [];
    },
    refetchOnWindowFocus: false,
  });
}

/** PUT /captures/card-rules (EDITOR): replaces every card-ending rule; the body comes from buildCardRulesBody. */
export function useSaveCaptureCardRules(householdId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rows: CardRule[]) => {
      const response = await apiClient.put<CardRule[]>(withHousehold('/captures/card-rules', householdId), buildCardRulesBody(rows));
      return bodyOf<CardRule[]>(response).data ?? [];
    },
    onSuccess: (rules) => {
      queryClient.setQueryData(['captures', 'card-rules', householdId ?? null], rules);
      // The suggested account of the pending captures may change with the rules.
      void queryClient.invalidateQueries({ queryKey: ['captures', 'list'] });
    },
  });
}

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { apiClient, axiosInstance } from '../../utils/api';
import type { ApiResponse } from '../../utils/api';
import { mergeSavedSettlementAccount, parseSavedSettlementAccount } from '../../utils/people';

// ============================================================================
// Types mirrored from the HTTP contract of phase 4 (people and shared expenses). Names follow the contract so
// both sides can be diffed; the frontend cannot import the backend types. Pure logic: utils/people.ts and
// utils/organizeShares.ts. Amounts are reais with 2 decimals (the UI works in integer cents).
// ============================================================================

export type ShareDirection = 'THEY_OWE_ME' | 'I_OWE_THEM';
export type SettlementDirection = 'RECEIVED' | 'PAID';
export type SplitStrategy = 'exact' | 'percent' | 'shares' | 'equal';

export interface Person {
  id: string;
  householdId: string;
  name: string;
  aliases: string[];
  userId: string | null;
  isActive: boolean;
}

export interface PersonBalance {
  person: Person;
  owedToMe: number;
  iOwe: number;
  received: number;
  paid: number;
  /** owedToMe - iOwe - received + paid; > 0 means she owes me. */
  balance: number;
  openShares: number;
}

export interface LedgerEntry {
  kind: 'share' | 'settlement';
  id: string;
  /** YYYY-MM-DD */
  date: string;
  description: string;
  direction: ShareDirection | SettlementDirection;
  amount: number;
  /** > 0 increases what she owes me. */
  signed: number;
  balanceAfter: number;
  transactionId: string | null;
  transactionAmount: number | null;
  note: string | null;
  source: 'manual' | 'import' | null;
}

export interface LedgerPage {
  data: LedgerEntry[];
  pagination: { nextCursor: string | null; hasMore: boolean; total?: number };
}

export interface ShareEntryInput {
  personId: string;
  amount?: number;
  percent?: number;
  shares?: number;
  note?: string;
}

export interface PutSharesInput {
  direction: ShareDirection;
  strategy: SplitStrategy;
  entries: ShareEntryInput[];
  /** Strategy `shares`: shares of my own part (default 1). */
  myShares?: number;
}

export interface TransactionShare {
  id: string;
  transactionId: string;
  personId: string;
  personName: string;
  direction: ShareDirection;
  amount: number;
  note: string | null;
  source: 'manual' | 'import';
}

export interface TransactionSharesResponse {
  transactionId: string;
  transactionAmount: number;
  shares: TransactionShare[];
  /** Transaction amount minus the THEY_OWE_ME parts. */
  myPart: number;
}

export interface SharesPreviewResponse {
  shares: Array<{ personId: string; amount: number }>;
  myPart: number;
}

export interface Settlement {
  id: string;
  personId: string;
  direction: SettlementDirection;
  amount: number;
  date: string;
  transactionId: string | null;
  note: string | null;
}

export interface CreateSettlementInput {
  householdId: string;
  direction: SettlementDirection;
  amount: number;
  date: string;
  note?: string;
  /** Links an existing transaction (RECEIVED = INCOME, PAID = EXPENSE). */
  transactionId?: string;
  /** Creates the real transaction on the account. */
  createTransaction?: { accountId: string; description?: string; categoryName?: string };
}

export interface OrganizeOptions {
  householdId: string;
  startDate?: string;
  endDate?: string;
  onlyImported?: boolean;
}

export interface OrganizePersonRef {
  /** null = a new person to create. */
  id: string | null;
  name: string;
}

export interface ShareProposal {
  /** Deterministic: transaction + person + direction. */
  id: string;
  transactionId: string;
  description: string;
  date: string;
  transactionAmount: number;
  /** The note it came from. */
  note: string;
  person: OrganizePersonRef;
  direction: ShareDirection;
  amount: number;
  percent: number | null;
  defaultSelected: boolean;
}

export interface ReviewLine {
  transactionId: string;
  description: string;
  date: string;
  transactionAmount: number;
  note: string;
  reason: string;
  suggestedPersonId: string | null;
}

export interface SettlementProposal {
  id: string;
  transactionId: string;
  description: string;
  date: string;
  amount: number;
  person: OrganizePersonRef;
  direction: SettlementDirection;
  defaultSelected: boolean;
}

export interface OrganizePreview {
  proposals: ShareProposal[];
  review: ReviewLine[];
  settlements: SettlementProposal[];
  newPeople: Array<{ name: string; aliases: string[] }>;
  alreadyDone: number;
  warnings: string[];
}

export interface OrganizeApplyPerson {
  name: string;
  aliases?: string[];
  existingId?: string;
}

export interface OrganizeManualEntry {
  transactionId: string;
  personId?: string;
  personName?: string;
  direction: ShareDirection;
  amount: number;
}

export interface OrganizeApplyInput {
  householdId: string;
  startDate?: string;
  endDate?: string;
  onlyImported?: boolean;
  people: OrganizeApplyPerson[];
  proposalIds: string[];
  settlementIds: string[];
  manual: OrganizeManualEntry[];
}

export interface OrganizeApplyResult {
  peopleCreated: number;
  sharesCreated: number;
  settlementsCreated: number;
  skipped: number;
  warnings: string[];
}

// ============================================================================
// Query keys and invalidation
// ============================================================================

/** All the people data lives under ['people', ...]; the shares of a transaction under ['transactions', 'shares', id]. */
export const peopleKeys = {
  all: ['people'] as const,
  list: (householdId: string | undefined, includeInactive: boolean) => ['people', 'list', householdId, includeInactive] as const,
  balances: (householdId: string | undefined) => ['people', 'balances', householdId] as const,
  ledger: (householdId: string | undefined, personId: string | undefined) => ['people', 'ledger', householdId, personId] as const,
  settlements: (householdId: string | undefined, personId: string | undefined) => ['people', 'settlements', householdId, personId] as const,
  shares: (transactionId: string | undefined) => ['transactions', 'shares', transactionId] as const,
};

/**
 * What a change in shares or settlements can touch: balances and ledgers (people), the shares of the transaction
 * and the lists (transactions); a settlement that creates a transaction also moves accounts and the dashboard.
 */
function invalidatePeopleData(queryClient: QueryClient, opts: { money: boolean }): void {
  queryClient.invalidateQueries({ queryKey: peopleKeys.all });
  queryClient.invalidateQueries({ queryKey: ['transactions'] });
  if (opts.money) {
    queryClient.invalidateQueries({ queryKey: ['accounts'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  }
}

// ============================================================================
// People
// ============================================================================

export function usePeople(householdId: string | undefined, includeInactive = false) {
  return useQuery({
    queryKey: peopleKeys.list(householdId, includeInactive),
    queryFn: async () => {
      const response = await apiClient.get<Person[]>('/people', { householdId, includeInactive: includeInactive ? true : undefined });
      return response.data ?? [];
    },
    enabled: !!householdId,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
}

export function usePeopleBalances(householdId: string | undefined) {
  return useQuery({
    queryKey: peopleKeys.balances(householdId),
    queryFn: async () => {
      const response = await apiClient.get<PersonBalance[]>('/people/balances', { householdId });
      return response.data ?? [];
    },
    enabled: !!householdId,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
}

export interface CreatePersonInput {
  householdId: string;
  name: string;
  aliases?: string[];
}

export function useCreatePerson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePersonInput): Promise<Person> => {
      const response = await apiClient.post<Person>('/people', input);
      return response.data!;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: peopleKeys.all });
    },
  });
}

export interface UpdatePersonInput {
  id: string;
  name?: string;
  aliases?: string[];
  isActive?: boolean;
}

export function useUpdatePerson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: UpdatePersonInput): Promise<Person> => {
      const response = await apiClient.patch<Person>(`/people/${id}`, patch);
      return response.data!;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: peopleKeys.all });
    },
  });
}

/** 204: the person had no data and is gone. 200: she had data and was only deactivated (the person comes back). */
export type DeletePersonResult = { deleted: true; person: null } | { deleted: false; person: Person | null };

export function useDeletePerson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<DeletePersonResult> => {
      // The raw instance: apiClient.delete hides the status, and the status is the answer here.
      const response = await axiosInstance.delete<ApiResponse<Person> | undefined>(`/people/${id}`);
      if (response.status === 204) return { deleted: true, person: null };
      const body = response.data;
      return { deleted: false, person: body && typeof body === 'object' && 'data' in body ? (body.data ?? null) : null };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: peopleKeys.all });
    },
  });
}

// ============================================================================
// Ledger (cursor)
// ============================================================================

/** The page shape of the list endpoints is `{ data, pagination }` at the top level; a nested one is tolerated. */
function toLedgerPage(response: ApiResponse<unknown> & { pagination?: LedgerPage['pagination'] }): LedgerPage {
  const inner = response.data as unknown;
  const rows = Array.isArray(inner) ? (inner as LedgerEntry[]) : ((inner as Partial<LedgerPage> | undefined)?.data ?? []);
  const nested = Array.isArray(inner) ? undefined : (inner as Partial<LedgerPage> | undefined)?.pagination;
  return { data: rows, pagination: response.pagination ?? nested ?? { nextCursor: null, hasMore: false } };
}

export const LEDGER_PAGE_SIZE = 25;

export function usePersonLedger(householdId: string | undefined, personId: string | undefined) {
  return useInfiniteQuery({
    queryKey: peopleKeys.ledger(householdId, personId),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const response = await apiClient.get<LedgerEntry[]>(`/people/${personId}/ledger`, {
        householdId,
        limit: LEDGER_PAGE_SIZE,
        cursor: pageParam,
      });
      return toLedgerPage(response as ApiResponse<unknown> & { pagination?: LedgerPage['pagination'] });
    },
    getNextPageParam: (last) => (last.pagination.hasMore && last.pagination.nextCursor ? last.pagination.nextCursor : undefined),
    enabled: !!householdId && !!personId,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
}

// ============================================================================
// Shares of a transaction
// ============================================================================

export function useTransactionShares(transactionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: peopleKeys.shares(transactionId),
    queryFn: async () => {
      const response = await apiClient.get<TransactionSharesResponse>(`/transactions/${transactionId}/shares`);
      return response.data!;
    },
    enabled: enabled && !!transactionId,
    refetchOnWindowFocus: false,
    staleTime: 0,
    // Opening the dialog again must show what is stored now, not what was cached the last time.
    refetchOnMount: 'always',
  });
}

export function usePutTransactionShares() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ transactionId, input }: { transactionId: string; input: PutSharesInput }): Promise<TransactionSharesResponse> => {
      const response = await apiClient.put<TransactionSharesResponse>(`/transactions/${transactionId}/shares`, input);
      return response.data!;
    },
    onSettled: () => {
      invalidatePeopleData(queryClient, { money: false });
    },
  });
}

/** Calculation without saving (the server rule is the reference for the preview the dialog computes locally). */
export function useSharesPreview() {
  return useMutation({
    mutationFn: async ({ transactionId, input }: { transactionId: string; input: PutSharesInput }): Promise<SharesPreviewResponse> => {
      const response = await apiClient.post<SharesPreviewResponse>(`/transactions/${transactionId}/shares/preview`, input);
      return response.data!;
    },
  });
}

// ============================================================================
// Settlements
// ============================================================================

export function usePersonSettlements(householdId: string | undefined, personId: string | undefined) {
  return useQuery({
    queryKey: peopleKeys.settlements(householdId, personId),
    queryFn: async () => {
      const response = await apiClient.get<Settlement[]>(`/people/${personId}/settlements`, { householdId });
      return response.data ?? [];
    },
    enabled: !!householdId && !!personId,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
}

export function useCreateSettlement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ personId, input }: { personId: string; input: CreateSettlementInput }): Promise<Settlement> => {
      const response = await apiClient.post<Settlement>(`/people/${personId}/settlements`, input);
      return response.data!;
    },
    // On error too: a failed request may have created the transaction before failing.
    onSettled: () => {
      invalidatePeopleData(queryClient, { money: true });
    },
  });
}

export const SETTLEMENT_ACCOUNT_STORAGE_KEY = 'recta.people.settlementAccount';

/** The account last used for a settlement in this household. Never throws. */
export function loadSettlementAccount(householdId: string | null | undefined): string {
  if (!householdId) return '';
  try {
    return parseSavedSettlementAccount(window.localStorage.getItem(SETTLEMENT_ACCOUNT_STORAGE_KEY), householdId);
  } catch {
    return '';
  }
}

export function saveSettlementAccount(householdId: string | null | undefined, accountId: string): void {
  if (!householdId || !accountId) return;
  try {
    window.localStorage.setItem(SETTLEMENT_ACCOUNT_STORAGE_KEY,
      mergeSavedSettlementAccount(window.localStorage.getItem(SETTLEMENT_ACCOUNT_STORAGE_KEY), householdId, accountId));
  } catch {
    // Storage unavailable: remembering is best-effort.
  }
}

/** 204. The linked transaction is NOT deleted. */
export function useDeleteSettlement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settlementId: string): Promise<void> => {
      await apiClient.delete(`/settlements/${settlementId}`);
    },
    onSettled: () => {
      invalidatePeopleData(queryClient, { money: false });
    },
  });
}

// ============================================================================
// Organize shares
// ============================================================================

export function useOrganizePreview() {
  return useMutation({
    mutationFn: async (options: OrganizeOptions): Promise<OrganizePreview> => {
      const response = await apiClient.post<OrganizePreview>('/people/organize/preview', options);
      return response.data!;
    },
  });
}

/** One request. Invalidates on success AND on error: a failed apply may already have written part of it. */
export function useOrganizeApply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: OrganizeApplyInput): Promise<OrganizeApplyResult> => {
      const response = await apiClient.post<OrganizeApplyResult>('/people/organize/apply', input);
      return response.data!;
    },
    onSettled: () => {
      invalidatePeopleData(queryClient, { money: false });
    },
  });
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../utils/api';
import type { MaxFinTransactionType } from './useImportMaxFin';

// ============================================================================
// Review queue of a credit card: sheet rows with no bank counterpart in months whose OFX invoice was imported.
// Types mirror the HTTP contract of the backend (specs/import-maxfin-fase3-ofx.md, section C); amounts are reais on
// the wire (the pure logic in utils/cardOfxReview.ts works in integer cents).
//   GET  /transactions/import/card-ofx/review-queue?accountId=&monthKey=&limit=&view=
//   POST /transactions/import/card-ofx/review-queue/actions
// ============================================================================

export type CardOfxReviewView = 'queue' | 'kept';

export interface CardOfxReviewItem {
  transactionId: string;
  description: string;
  /** Always > 0; the direction is in `type`. */
  amount: number;
  type: MaxFinTransactionType;
  /** YYYY-MM-DD */
  date: string;
  sourceRef: string;
  /** Sheet month (invoice due month) the row came from, YYYY-MM. */
  monthKey: string;
  categoryName: string | null;
  /** The row has shares, a split, a settlement, a recurrence or an attachment: only "keep" is allowed. */
  blocked: boolean;
}

export interface CardOfxReviewMonth {
  monthKey: string;
  count: number;
  /** Net amount of the rows still in the list (purchases positive). */
  net: number;
}

export interface CardOfxReviewQueue {
  accountId: string;
  items: CardOfxReviewItem[];
  months: CardOfxReviewMonth[];
  totals: { count: number; net: number };
  /** 'queue' (default) or 'kept': rows already marked "sem comprovante". */
  view: CardOfxReviewView;
  /** The items were cut at `limit`. */
  truncated: boolean;
}

export interface CardOfxReviewQueueParams {
  accountId: string;
  monthKey?: string;
  limit?: number;
  view?: CardOfxReviewView;
}

/** The server may add actions later: the UI only ever sends these four. */
export type CardOfxReviewActionType = 'keep' | 'unkeep' | 'move' | 'delete';

export interface CardOfxReviewAction {
  transactionId: string;
  action: CardOfxReviewActionType;
  /** move: the account that receives the row (same household, active, not a credit card). */
  targetAccountId?: string;
}

export interface CardOfxReviewActionsRequest {
  accountId: string;
  /** Up to 200 per request. */
  actions: CardOfxReviewAction[];
}

/** done: applied; skipped: no longer in the list; blocked: move/delete refused; failed: this row hit an error (reason = its code). */
export type CardOfxReviewStatus = 'done' | 'skipped' | 'blocked' | 'failed';

export interface CardOfxReviewActionResult {
  transactionId: string;
  action: CardOfxReviewActionType;
  status: CardOfxReviewStatus;
  reason?: string;
}

export interface CardOfxReviewActionsResponse {
  results: CardOfxReviewActionResult[];
  done: number;
  skipped: number;
  blocked: number;
  failed: number;
  /** Things to know about what was done (e.g. whether a deleted sheet row can come back with the workbook). */
  warnings: string[];
}

// ============================================================================
// Requests
// ============================================================================

/**
 * Reads the queue (or the kept rows). A mutation, like the detection of recurring expenses: the dialog drives each
 * read explicitly and keeps only the newest one (latest wins), instead of caching a list that every action changes.
 */
export function useCardOfxReviewQueue() {
  return useMutation({
    mutationFn: async (params: CardOfxReviewQueueParams): Promise<CardOfxReviewQueue> => {
      const query: Record<string, string | number> = { accountId: params.accountId };
      if (params.monthKey) query.monthKey = params.monthKey;
      if (params.limit) query.limit = params.limit;
      if (params.view) query.view = params.view;
      const response = await apiClient.get<CardOfxReviewQueue>('/transactions/import/card-ofx/review-queue', query);
      return response.data!;
    },
  });
}

/**
 * Applies the decisions (one request, partial row by row). Invalidates on success AND on error: a request that
 * failed halfway may already have moved or deleted rows, and the invoice must not keep stale data.
 */
export function useCardOfxReviewActions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CardOfxReviewActionsRequest): Promise<CardOfxReviewActionsResponse> => {
      const response = await apiClient.post<CardOfxReviewActionsResponse>('/transactions/import/card-ofx/review-queue/actions', input);
      return response.data!;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

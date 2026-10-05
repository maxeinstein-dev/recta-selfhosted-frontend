import { useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, axiosInstance } from '../../utils/api';
import type { ApiResponse } from '../../utils/api';
import type { MaxFinCategoryMapEntry, MaxFinCategoryMapInput, MaxFinMonth, MaxFinTransactionType } from './useImportMaxFin';

// ============================================================================
// Types mirrored from the HTTP contract of the card invoice (.ofx) import. Names follow the contract so both
// sides can be diffed; the frontend cannot import the backend types. Pure logic: utils/cardOfx.ts.
// ============================================================================

export interface CardOfxOptionsInput {
  /** Invoice month chosen by the user instead of the one derived from the statement. */
  monthOverride?: MaxFinMonth;
}

/** The server may add kinds later: the UI never relies on this list being complete. */
export type CardOfxKind = 'purchase' | 'refund' | 'discount' | 'payment';
export type CardOfxStatus = 'reconciled' | 'proposed' | 'payment';

export interface CardOfxInstallment {
  number: number;
  total: number;
}

export interface CardOfxLine {
  /** `ofx:<FITID>:<8 hex>` */
  ref: string;
  fitid: string;
  /** YYYY-MM-DD */
  date: string;
  /** Always > 0; the direction is in `type`. */
  amount: number;
  /** Purchase = EXPENSE; refund and discount = INCOME; payment = INCOME (never becomes a transaction). */
  type: MaxFinTransactionType;
  kind: CardOfxKind;
  memo: string;
  /** Memo without " - Parcela N/M" and " - NuPay". */
  merchant: string;
  installment: CardOfxInstallment | null;
  status: CardOfxStatus;
  /** Proposal the line belongs to. */
  group: string | null;
}

/** The server may add kinds later: a proposal of a kind this client does not know is shown but never sent. */
export type CardOfxProposalKind = 'enrich-exact' | 'enrich-plan' | 'enrich-sum' | 'enrich-merge' | 'enrich-neighbour' | 'enrich-group' | 'enrich-near' | 'consume-future' | 'create' | 'reversal';

/** Why the server leaves a proposal unticked. The server may add reasons: the UI never relies on this list. */
export type CardOfxProposalReason =
  | 'ambiguous' | 'no-shared-words' | 'mixed-categories' | 'sheet-residue' | 'neighbour-ambiguous' | 'neighbour-weak'
  | 'neighbour-month-not-imported' | 'near-amount' | 'near-ambiguous' | 'pool-too-large';

/** The stored transaction a proposal changes: the sheet row (enrich) or the future installment (consume). */
export interface CardOfxTarget {
  transactionId: string;
  description: string;
  amount: number;
  type: MaxFinTransactionType;
  date: string;
  sourceRef: string | null;
}

/** How the target transaction ends up (enrich and consume). */
export interface CardOfxResult {
  date: string;
  description: string;
  notesAppend: string | null;
}

export interface CardOfxProposal {
  /** Deterministic id: kind + sorted refs + target transaction (confirm recomputes and compares). */
  group: string;
  kind: CardOfxProposalKind;
  /** OFX lines covered by the proposal: a group only goes in with all of them. */
  refs: string[];
  /** False for an ambiguous sum and for a purchase + refund pair. */
  defaultSelected: boolean;
  ambiguous: boolean;
  target: CardOfxTarget | null;
  /** enrich-merge: the other sheet rows whose amounts the target takes over (deleted on apply). Absent or empty otherwise. */
  absorbed?: CardOfxTarget[];
  /** Why the server leaves the proposal unticked; null or absent when it is ticked. A string this client does not know is shown as is. */
  reason?: CardOfxProposalReason | string | null;
  /** reason 'sheet-residue' on history: the card row left over that the new purchase may be a copy of. */
  counterpart?: CardOfxTarget | null;
  result: CardOfxResult | null;
  /** create: future installments that will be generated. */
  futureInstallments: number;
}

/** A card transaction of the invoice month that no OFX line matched (information only: nothing is deleted). */
export interface CardOfxSheetOnly {
  transactionId: string;
  description: string;
  amount: number;
  type: MaxFinTransactionType;
  date: string;
  sourceRef: string | null;
}

export interface CardOfxRecordedPayment {
  transactionId: string;
  amount: number;
  date: string;
  sourceAccountId: string | null;
}

export type CardOfxPaymentProposal = 'ok' | 'adjust' | 'create';

/** The "Pagamento recebido" line that pays the previous invoice. */
export interface CardOfxPayment {
  ref: string;
  amount: number;
  date: string;
  /** Invoice it pays ('YYYY-MM', the month before). */
  invoiceMonthKey: string;
  recorded: CardOfxRecordedPayment | null;
  proposal: CardOfxPaymentProposal;
}

/**
 * Statement closing the server computed with the proposals ticked by default. delta = uncreated + heldMatches -
 * sheetOnlyInPeriod - foreignInPeriod - advancePayments + residual. Amounts in reais, purchases positive.
 */
export interface CardOfxClosing {
  periodStart: string;
  periodEnd: string;
  /** DTEND counts as inside the period only when the OFX lists lines dated on it. */
  endInclusive: boolean;
  ofxTotal: number;
  recordedTotal: number;
  /** ofxTotal - recordedTotal: positive = the card holds less than the bank charged. */
  delta: number;
  components: {
    uncreated: number;
    heldMatches: number;
    sheetOnlyInPeriod: number;
    foreignInPeriod: number;
    advancePayments: number;
    residual: number;
  };
  sheetOnlyOutsidePeriod: number;
  /** |residual| within 5 cents. */
  explained: boolean;
}

export interface CardOfxPreviewTotals {
  lines: number;
  reconciled: number;
  proposals: number;
  create: number;
  sheetOnly: number;
}

export interface CardOfxPreviewResponse {
  accountId: string;
  householdId: string;
  month: MaxFinMonth;
  /** 'YYYY-MM' */
  monthKey: string;
  monthSource: 'statement' | 'override';
  /** DTSTART / DTEND of the statement (YYYY-MM-DD). */
  period: { start: string; end: string };
  /** Purchases minus refunds and discounts (payments excluded). */
  ofxTotal: number;
  lines: CardOfxLine[];
  proposals: CardOfxProposal[];
  sheetOnly: CardOfxSheetOnly[];
  payment: CardOfxPayment | null;
  /** The statement closing with the default selection; absent on a server that predates it. */
  closing?: CardOfxClosing | null;
  /** Merchants of the create proposals (same format as the monthly sheet importer). */
  categoryMap: MaxFinCategoryMapEntry[];
  totals: CardOfxPreviewTotals;
  warnings: string[];
}

/** A preview line echoed back to confirm: the fields of the statement, without status and group. */
export type CardOfxConfirmLine = Pick<
  CardOfxLine,
  'ref' | 'fitid' | 'date' | 'amount' | 'type' | 'kind' | 'memo' | 'merchant' | 'installment'
>;

/** `sourceAccountId` is required when the payment proposal is `create` (and only sent then). */
export interface CardOfxPaymentDecision {
  apply: boolean;
  sourceAccountId?: string;
}

export interface CardOfxConfirmRequest {
  accountId: string;
  monthKey: string;
  /** Every line of the preview (at most 1000): the server recomputes the reconciliation from them. */
  lines: CardOfxConfirmLine[];
  selectedGroups: string[];
  /** Merchants of the selected create proposals. */
  categoryMap: MaxFinCategoryMapInput[];
  payment: CardOfxPaymentDecision | null;
}

export interface CardOfxConfirmResponse {
  enriched: number;
  /** Sheet rows deleted by merges (absorbed into the row that stays); absent on a server that predates merges. */
  absorbedRows?: number;
  consumedFutures: number;
  created: number;
  futureInstallments: number;
  reversalsImported: number;
  payment: { action: 'adjusted' | 'created'; transactionId: string; amount: number; date: string } | null;
  /** Groups that no longer exist when confirm recomputes the reconciliation. */
  skipped: number;
  createdCategories: Array<{ id: string; name: string; type: MaxFinTransactionType }>;
  warnings: string[];
}

// ============================================================================
// Mutations
// ============================================================================

export interface CardOfxPreviewParams {
  /** Credit card account the invoice belongs to. */
  accountId: string;
  options?: CardOfxOptionsInput;
  file: File;
}

/**
 * Upload the invoice (.ofx) of a credit card and get the reconciliation against the stored transactions.
 * Nothing is persisted. Multipart FormData goes through the raw axios instance WITHOUT a manual Content-Type
 * (same reasoning as useMaxFinPreview): the shared instance defaults to application/json, under which axios
 * would JSON-stringify the FormData and destroy the upload. The response interceptor still applies.
 */
export function useCardOfxPreview() {
  return useMutation({
    mutationFn: (params: CardOfxPreviewParams): Promise<CardOfxPreviewResponse> => sharedCardOfxPreview(params),
  });
}

async function requestCardOfxPreview({ accountId, options, file }: CardOfxPreviewParams): Promise<CardOfxPreviewResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('accountId', accountId);
  if (options) {
    formData.append('options', JSON.stringify(options));
  }

  const response = await axiosInstance.post<ApiResponse<CardOfxPreviewResponse>>(
    '/transactions/import/card-ofx/preview',
    formData,
    {
      // Remove the instance JSON default so the browser sets multipart + boundary.
      headers: { 'Content-Type': undefined as unknown as string },
    },
  );
  return response.data.data!;
}

// Identical previews that overlap (the same file object, card and options) share one request: StrictMode runs the effect
// that opens the dialog twice in development. A preview asked again after the first settled is a new request.
const fileIds = new WeakMap<File, number>();
let nextFileId = 0;
const inFlightPreviews = new Map<string, Promise<CardOfxPreviewResponse>>();

function sharedCardOfxPreview(params: CardOfxPreviewParams): Promise<CardOfxPreviewResponse> {
  let id = fileIds.get(params.file);
  if (id === undefined) {
    nextFileId += 1;
    id = nextFileId;
    fileIds.set(params.file, id);
  }
  const key = `${id}|${params.accountId}|${JSON.stringify(params.options ?? null)}`;
  const shared = inFlightPreviews.get(key);
  if (shared) return shared;
  const request = requestCardOfxPreview(params).finally(() => inFlightPreviews.delete(key));
  inFlightPreviews.set(key, request);
  return request;
}

/**
 * Apply the chosen proposals (one request). Invalidates everything the import touches on success AND on error:
 * a failed request may already have changed part of the invoice, and the screens must not keep stale data.
 *
 * In a queue of several invoices the dialog calls `deferInvalidation(true)`: the invalidation of a confirm that
 * succeeded then waits for `flushInvalidations()` (end of the queue, a stop, closing) instead of refetching the
 * transactions, accounts, dashboard and categories after every file. A confirm that FAILED always invalidates at once.
 */
export function useCardOfxConfirm() {
  const queryClient = useQueryClient();
  const deferRef = useRef(false);
  const pendingRef = useRef(false);

  const invalidateAll = useCallback(() => {
    pendingRef.current = false;
    // The card invoice lives under ['transactions', 'credit-card-invoice', ...]: the first key covers it
    // (and the lists, summaries and the previous invoice the payment touches).
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
    queryClient.invalidateQueries({ queryKey: ['accounts'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['categories'] });
  }, [queryClient]);

  const deferInvalidation = useCallback((defer: boolean) => {
    deferRef.current = defer;
  }, []);

  const flushInvalidations = useCallback(() => {
    if (pendingRef.current) invalidateAll();
  }, [invalidateAll]);

  const mutation = useMutation({
    mutationFn: async (payload: CardOfxConfirmRequest): Promise<CardOfxConfirmResponse> => {
      const response = await apiClient.post<CardOfxConfirmResponse>('/transactions/import/card-ofx/confirm', payload);
      return response.data!;
    },
    onSettled: (_data, error) => {
      if (deferRef.current && !error) pendingRef.current = true;
      else invalidateAll();
    },
  });

  return { ...mutation, deferInvalidation, flushInvalidations };
}

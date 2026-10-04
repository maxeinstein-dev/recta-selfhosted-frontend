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
export type CardOfxProposalKind = 'enrich-exact' | 'enrich-plan' | 'enrich-sum' | 'consume-future' | 'create' | 'reversal';

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
    mutationFn: async ({ accountId, options, file }: CardOfxPreviewParams): Promise<CardOfxPreviewResponse> => {
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
    },
  });
}

/**
 * Apply the chosen proposals (one request). Invalidates everything the import touches on success AND on error:
 * a failed request may already have changed part of the invoice, and the screens must not keep stale data.
 */
export function useCardOfxConfirm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CardOfxConfirmRequest): Promise<CardOfxConfirmResponse> => {
      const response = await apiClient.post<CardOfxConfirmResponse>('/transactions/import/card-ofx/confirm', payload);
      return response.data!;
    },
    onSettled: () => {
      // The card invoice lives under ['transactions', 'credit-card-invoice', ...]: the first key covers it
      // (and the lists, summaries and the previous invoice the payment touches).
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, axiosInstance } from '../../utils/api';
import type { ApiResponse } from '../../utils/api';
import {
  MAXFIN_SECTION_ORDER, mergeSavedAccountIds, mergeSavedCategoryChoices, parseSavedAccountIds, parseSavedCategoryChoices,
} from '../../utils/maxfinPayload';

// ============================================================================
// Types mirrored from the backend MaxFin importer. Names are kept identical to
// the backend so both sides can be diffed; the frontend cannot import them.
// ============================================================================

export type MaxFinSectionKey = 'income' | 'bills' | 'credit' | 'debit';
export type MaxFinTransactionType = 'INCOME' | 'EXPENSE';

/** `month` is 1-12. */
export interface MaxFinMonth {
  year: number;
  month: number;
}

export interface MaxFinAccountsInput {
  income: string;
  bills: string;
  credit: string;
  debit: string;
}

export interface MaxFinImportOptions {
  closedMonth: boolean;
  payInvoice: boolean;
  generateFutureInstallments: boolean;
}

export interface MaxFinPreviewOptionsInput extends Partial<MaxFinImportOptions> {
  monthOverride?: MaxFinMonth;
}

export interface MaxFinInstallment {
  number: number;
  total: number;
  prepaid: number;
  baseDescription: string;
  installmentId: string;
  futureCount: number;
}

export type ShareHint =
  | { kind: 'split'; person: string; percent: 50 }
  | { kind: 'owed_to_me'; person: string; percent: 100 }
  | { kind: 'reimbursable'; person: null; percent: 100 }
  | { kind: 'owed_by_me'; person: string };

/**
 * `replaces-future`: generated future installments of the same plan (from an earlier import) are superseded by this row.
 * The server may add statuses later: the UI treats any other value as unknown (never selected, never sent).
 */
export type MaxFinRowStatus = 'new' | 'duplicate' | 'changed' | 'replaces-future' | 'legacy-duplicate';

export interface MaxFinPreviewRow {
  sourceLine: number;
  sourceRef: string;
  section: MaxFinSectionKey;
  accountId: string;
  type: MaxFinTransactionType;
  description: string;
  categoryKey: string;
  amount: number;
  planned: number | null;
  realized: number | null;
  paid: boolean;
  /** YYYY-MM-DD */
  date: string;
  notes: string | null;
  flag: string | null;
  installment: MaxFinInstallment | null;
  futureInstallments: number;
  shareHint: ShareHint | null;
  status: MaxFinRowStatus;
  statusDetail: string | null;
  existingTransactionId: string | null;
}

export type MaxFinCategoryTargetKind = 'system' | 'custom' | 'create' | 'default';

export interface MaxFinCategorySuggestion {
  kind: MaxFinCategoryTargetKind;
  categoryName?: string;
  categoryId?: string;
  name?: string;
  label: string;
}

export interface MaxFinCategoryMapEntry {
  key: string;
  type: MaxFinTransactionType;
  count: number;
  sections: MaxFinSectionKey[];
  suggestion: MaxFinCategorySuggestion;
}

export interface MaxFinSectionPreview {
  key: MaxFinSectionKey;
  label: string;
  accountId: string;
  count: number;
  sum: number;
  sheetTotalPlanned: number | null;
  sheetTotalRealized: number | null;
  newCount: number;
  duplicateCount: number;
  changedCount: number;
}

export interface MaxFinInvoicePreview {
  creditAccountId: string;
  sourceAccountId: string;
  month: string;
  paymentDate: string;
  amount: number;
  dueDay: number | null;
  closingDay: number | null;
  /** A payment for this card and month was already recorded (confirm would not create a second one). */
  alreadyPaid?: boolean;
  willPay: boolean;
}

export interface MaxFinSkippedRow {
  sourceLine: number;
  description: string;
  reason: string;
}

export interface MaxFinPreviewTotals {
  rows: number;
  new: number;
  duplicate: number;
  changed: number;
  legacyDuplicate: number;
  skipped: number;
}

export interface MaxFinPreviewResponse {
  month: MaxFinMonth | null;
  monthKey: string | null;
  /** 'sheet': taken from the tab name (it wins over a stale title; the server warns when they disagree). */
  monthSource: 'title' | 'sheet' | 'filename' | 'override' | 'none';
  householdId: string;
  accounts: MaxFinAccountsInput;
  options: MaxFinImportOptions;
  sections: MaxFinSectionPreview[];
  rows: MaxFinPreviewRow[];
  skipped: MaxFinSkippedRow[];
  categoryMap: MaxFinCategoryMapEntry[];
  invoice: MaxFinInvoicePreview | null;
  warnings: string[];
  totals: MaxFinPreviewTotals;
}

export type MaxFinCategoryTargetInput =
  | { kind: 'system'; categoryName: string }
  | { kind: 'custom'; categoryId: string }
  | { kind: 'create'; name: string }
  | { kind: 'default' };

export interface MaxFinCategoryMapInput {
  key: string;
  type: MaxFinTransactionType;
  target: MaxFinCategoryTargetInput;
}

export interface MaxFinConfirmRow {
  sourceRef: string;
  section: MaxFinSectionKey;
  type: MaxFinTransactionType;
  description: string;
  categoryKey: string;
  amount: number;
  paid: boolean;
  date: string;
  notes: string | null;
  installment: MaxFinInstallment | null;
  replace?: boolean;
}

export interface MaxFinConfirmRequest {
  month: MaxFinMonth;
  accounts: MaxFinAccountsInput;
  options: MaxFinImportOptions;
  categoryMap: MaxFinCategoryMapInput[];
  rows: MaxFinConfirmRow[];
}

export interface MaxFinConfirmResponse {
  imported: number;
  skipped: number;
  replaced: number;
  /** Generated future installments deleted because a sheet row of the same plan superseded them. */
  consumedFutureInstallments: number;
  futureInstallments: number;
  createdCategories: Array<{ id: string; name: string; type: MaxFinTransactionType }>;
  invoicePayment: { transactionId: string; amount: number; date: string } | null;
  ids: string[];
  warnings: string[];
}

// ---- Workbook (.xlsx with every monthly tab) ----------------------------------
// POST /transactions/import/maxfin/workbook/preview. Each selected month comes back as a full
// MaxFinPreviewResponse (with its own options) and is confirmed with the monthly confirm endpoint.

/** Options of the workbook preview; every field is optional (the server fills the defaults). */
export interface MaxFinWorkbookOptionsInput {
  /** 'YYYY-MM'; default: every detected month up to the current one. */
  months?: string[];
  /** 'YYYY-MM'; months up to it are closed; default: the month before the current one; null = none. */
  closedThrough?: string | null;
  /** Default true (only applies to closed months). */
  payInvoice?: boolean;
  /** Default true (only the last selected month, and only when it is open). */
  generateFutureInstallments?: boolean;
}

/** Options the server applied (the echo of MaxFinWorkbookOptionsInput, defaults resolved). */
export interface MaxFinWorkbookOptions {
  months: string[];
  closedThrough: string | null;
  payInvoice: boolean;
  generateFutureInstallments: boolean;
}

/** The server may add statuses later: the UI treats any other value like `skipped` (never selectable). */
export type MaxFinWorkbookSheetStatus = 'selected' | 'available' | 'skipped';

export interface MaxFinWorkbookSheet {
  name: string;
  /** 'YYYY-MM' */
  monthKey: string | null;
  status: MaxFinWorkbookSheetStatus;
  /** Why the sheet was skipped. */
  reason: string | null;
  /** Rows read by the parser (0 when skipped). */
  rowCount: number;
  /** Hidden in the workbook: read as any other sheet, informative only. */
  hidden: boolean;
}

export interface MaxFinWorkbookPreviewResponse {
  filename: string;
  householdId: string;
  accounts: MaxFinAccountsInput;
  options: MaxFinWorkbookOptions;
  /** In workbook order. */
  sheets: MaxFinWorkbookSheet[];
  /** Selected months, oldest first, each with its own options. */
  months: MaxFinPreviewResponse[];
  /** Merged across the selected months. */
  categoryMap: MaxFinCategoryMapEntry[];
  /** Workbook-level warnings (each month carries its own in months[i].warnings). */
  warnings: string[];
}

// ============================================================================
// Mutations
// ============================================================================

export interface MaxFinPreviewParams {
  accounts: MaxFinAccountsInput;
  options?: MaxFinPreviewOptionsInput;
  file: File;
}

/**
 * Upload one monthly tab (.csv) and get the parsed preview. Nothing is persisted.
 * Multipart FormData goes through the raw axios instance WITHOUT a manual
 * Content-Type (same reasoning as useImportPreview): the shared instance
 * defaults to application/json, under which axios would JSON-stringify the
 * FormData and destroy the upload. The response interceptor still applies.
 */
export function useMaxFinPreview() {
  return useMutation({
    mutationFn: async ({ accounts, options, file }: MaxFinPreviewParams): Promise<MaxFinPreviewResponse> => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('accounts', JSON.stringify(accounts));
      if (options) {
        formData.append('options', JSON.stringify(options));
      }

      const response = await axiosInstance.post<ApiResponse<MaxFinPreviewResponse>>(
        '/transactions/import/maxfin/preview',
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

export interface MaxFinWorkbookPreviewParams {
  accounts: MaxFinAccountsInput;
  options?: MaxFinWorkbookOptionsInput;
  file: File;
}

/**
 * Upload the whole workbook (.xlsx) and get one preview per selected month. Nothing is persisted.
 * Same multipart handling as useMaxFinPreview (no manual Content-Type).
 */
export function useMaxFinWorkbookPreview() {
  return useMutation({
    mutationFn: async ({ accounts, options, file }: MaxFinWorkbookPreviewParams): Promise<MaxFinWorkbookPreviewResponse> => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('accounts', JSON.stringify(accounts));
      if (options) {
        formData.append('options', JSON.stringify(options));
      }

      const response = await axiosInstance.post<ApiResponse<MaxFinWorkbookPreviewResponse>>(
        '/transactions/import/maxfin/workbook/preview',
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
 * Persist the reviewed rows (201). Invalidates everything the import touches on success AND on error:
 * a failed request may already have stored part of the rows, and the screens must not keep stale data.
 */
export function useMaxFinConfirm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: MaxFinConfirmRequest): Promise<MaxFinConfirmResponse> => {
      const response = await apiClient.post<MaxFinConfirmResponse>(
        '/transactions/import/maxfin/confirm',
        payload,
      );
      return response.data!;
    },
    onSettled: () => {
      // No query key starts with 'credit-cards'; the invoice query lives under
      // ['transactions', 'credit-card-invoice', ...] and is covered below.
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

// ============================================================================
// Display helpers. The logic that decides what is sent (selection, payload,
// invoice, categories, options) lives in utils/maxfinPayload.ts.
// ============================================================================

export const MAXFIN_SECTION_LABELS: Record<MaxFinSectionKey, string> = {
  income: 'Entradas',
  bills: 'Contas fixas',
  credit: 'Cartão',
  debit: 'Débito/pix',
};

const MONTHS_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/** "Outubro/2026" */
export function monthLabel(month: MaxFinMonth): string {
  const name = MONTHS_PT[month.month - 1] ?? String(month.month);
  return `${name}/${month.year}`;
}

export function monthSourceLabel(source: MaxFinPreviewResponse['monthSource']): string {
  switch (source) {
    case 'title':
      return 'pelo título';
    case 'sheet':
      return 'pelo nome da aba';
    case 'filename':
      return 'pelo nome do arquivo';
    case 'override':
      return 'informado manualmente';
    default:
      return '';
  }
}

export function describeShareHint(hint: ShareHint): string {
  switch (hint.kind) {
    case 'split':
      return `divide com ${hint.person} (${hint.percent}%)`;
    case 'owed_to_me':
      return `${hint.person} paga ${hint.percent}%`;
    case 'reimbursable':
      return 'reembolsável';
    case 'owed_by_me':
      return `devo a ${hint.person}`;
  }
}

/** "3/12" */
export function installmentLabel(installment: MaxFinInstallment): string {
  return `${installment.number}/${installment.total}`;
}

/** "+2 antecipadas", or null when nothing was prepaid. */
export function prepaidLabel(installment: MaxFinInstallment): string | null {
  if (installment.prepaid <= 0) return null;
  return `+${installment.prepaid} ${installment.prepaid === 1 ? 'antecipada' : 'antecipadas'}`;
}

export interface MaxFinRowGroup {
  key: MaxFinSectionKey;
  section: MaxFinSectionPreview | undefined;
  rows: MaxFinPreviewRow[];
}

/** Rows grouped by section, in the section order of the server; empty groups are dropped. */
export function groupRowsBySection(preview: Pick<MaxFinPreviewResponse, 'sections' | 'rows'>): MaxFinRowGroup[] {
  const bySection = new Map<MaxFinSectionKey, MaxFinPreviewRow[]>();
  for (const row of preview.rows) {
    const list = bySection.get(row.section);
    if (list) list.push(row);
    else bySection.set(row.section, [row]);
  }
  const order: MaxFinSectionKey[] =
    preview.sections.length > 0 ? preview.sections.map((s) => s.key) : [...MAXFIN_SECTION_ORDER];
  for (const key of bySection.keys()) if (!order.includes(key)) order.push(key);
  return order
    .map((key) => ({ key, section: preview.sections.find((s) => s.key === key), rows: bySection.get(key) ?? [] }))
    .filter((group) => group.rows.length > 0);
}

// ---- localStorage memory ------------------------------------------------------
// Every access is guarded: storage may be unavailable (private mode, blocked site data).
// Parsing and merging are pure and live in utils/maxfinPayload.ts.

// A new key: the former global one (`recta.maxfin.categoryMap`) mixed households and is ignored.
export const MAXFIN_CATEGORY_CHOICES_STORAGE_KEY = 'recta.maxfin.categoryChoices';

export type MaxFinSavedCategoryChoices = Record<string, MaxFinCategoryTargetInput>;

/** Shape per household: { [`${type}|${normalized key}`]: MaxFinCategoryTargetInput }. Never throws. */
export function loadSavedCategoryChoices(householdId: string | null | undefined): MaxFinSavedCategoryChoices {
  if (!householdId) return {};
  try {
    return parseSavedCategoryChoices(window.localStorage.getItem(MAXFIN_CATEGORY_CHOICES_STORAGE_KEY), householdId);
  } catch {
    // Storage unavailable: behave as if nothing was saved.
    return {};
  }
}

/** Merges into what is already saved (a corrupt stored value is replaced). Never throws. */
export function saveCategoryChoices(householdId: string | null | undefined, choices: MaxFinSavedCategoryChoices): void {
  if (!householdId) return;
  try {
    const raw = window.localStorage.getItem(MAXFIN_CATEGORY_CHOICES_STORAGE_KEY);
    window.localStorage.setItem(MAXFIN_CATEGORY_CHOICES_STORAGE_KEY, mergeSavedCategoryChoices(raw, householdId, choices));
  } catch {
    // Storage unavailable (private mode, quota): remembering is best-effort.
  }
}

export const MAXFIN_ACCOUNTS_STORAGE_KEY = 'recta.maxfin.accounts';

/**
 * Last destination accounts chosen per household (`{ [householdId]: MaxFinAccountsInput }`), so importing
 * several months in a row does not mean re-selecting four accounts every time.
 */
export function loadSavedAccountIds(householdId: string | null | undefined): Partial<MaxFinAccountsInput> {
  if (!householdId) return {};
  try {
    return parseSavedAccountIds(window.localStorage.getItem(MAXFIN_ACCOUNTS_STORAGE_KEY), householdId);
  } catch {
    return {};
  }
}

/** Merges into what is already saved; a corrupt stored value starts over from `{}`. Never throws. */
export function saveAccountIds(householdId: string | null | undefined, ids: MaxFinAccountsInput): void {
  if (!householdId) return;
  try {
    const raw = window.localStorage.getItem(MAXFIN_ACCOUNTS_STORAGE_KEY);
    window.localStorage.setItem(MAXFIN_ACCOUNTS_STORAGE_KEY, mergeSavedAccountIds(raw, householdId, ids));
  } catch {
    // storage unavailable: the choice just is not remembered
  }
}

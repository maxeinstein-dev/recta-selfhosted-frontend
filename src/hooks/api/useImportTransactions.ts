import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, axiosInstance } from '../../utils/api';
import type { ApiResponse } from '../../utils/api';

export type ImportTransactionType = 'INCOME' | 'EXPENSE';

export interface ImportPreviewRow {
  index: number;
  date: string;
  description: string;
  amount: number;
  type: ImportTransactionType;
  duplicate: boolean;
}

export interface ImportPreview {
  rows: ImportPreviewRow[];
  total: number;
  duplicateCount: number;
  newCount: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  ids: string[];
}

export interface ImportPreviewParams {
  householdId?: string;
  accountId: string;
  file: File;
}

export interface ConfirmImportRow {
  date: string;
  description: string;
  amount: number;
  type: ImportTransactionType;
}

export interface ConfirmImportParams {
  householdId?: string;
  accountId: string;
  rows?: ConfirmImportRow[];
  importId?: string;
}

/**
 * Upload a .csv/.ofx file and get the parsed preview.
 * Sends multipart FormData WITHOUT a manual Content-Type: the browser sets
 * `multipart/form-data; boundary=...` automatically. This must bypass
 * `apiClient.post` because the shared axios instance defaults to
 * `Content-Type: application/json`, under which axios would JSON-stringify
 * the FormData and destroy the file upload. The response interceptor
 * (formatted {message, status} Error) still applies since it lives on
 * the shared axios instance.
 */
export function useImportPreview() {
  return useMutation({
    mutationFn: async ({ householdId, accountId, file }: ImportPreviewParams) => {
      const formData = new FormData();
      formData.append('accountId', accountId);
      if (householdId) {
        formData.append('householdId', householdId);
      }
      formData.append('file', file);

      const response = await axiosInstance.post<ApiResponse<ImportPreview>>(
        '/transactions/import/preview',
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
 * Confirm the import of previously previewed rows.
 */
export function useConfirmImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ householdId, accountId, rows, importId }: ConfirmImportParams) => {
      const response = await apiClient.post<ImportResult>('/transactions/import/confirm', {
        ...(householdId ? { householdId } : {}),
        accountId,
        ...(rows ? { rows } : {}),
        ...(importId ? { importId } : {}),
      });
      return response.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/**
 * Alias consumed by ImportTransactionsDialog (parallel lane).
 * Same mutation as useConfirmImport.
 */
export const useImportTransactions = useConfirmImport;

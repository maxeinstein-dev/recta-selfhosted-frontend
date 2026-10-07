import type {
  ConfirmImportRow,
  ImportPreview,
  ImportPreviewRow,
  ImportSkipReason,
} from '../hooks/api/useImportTransactions';

/** Extensions the backend statement importer reads. Keep in sync with POST /transactions/import/preview. */
export const STATEMENT_EXTENSIONS = ['.csv', '.ofx'] as const;

export function isStatementFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return STATEMENT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Rows to send on confirm: only the ones the preview flagged as new. The server checks duplicates again when it
 * writes, so this is a courtesy to the user, not the safety net. Extra preview fields (index, duplicate) are dropped.
 */
export function rowsToConfirm(rows: readonly ImportPreviewRow[]): ConfirmImportRow[] {
  return rows
    .filter((row) => !row.duplicate)
    .map(({ date, description, amount, type }) => ({ date, description, amount, type }));
}

/** Counts shown in the preview badges; trusts the server totals and recomputes them if the response omits them. */
export function previewCounts(preview: ImportPreview): { newCount: number; duplicateCount: number } {
  const duplicates = preview.rows.filter((row) => row.duplicate).length;
  return {
    newCount: preview.newCount ?? preview.rows.length - duplicates,
    duplicateCount: preview.duplicateCount ?? duplicates,
  };
}

/**
 * True when the server has no importer at all (an older backend without the route). The app answers every error with
 * a code (a missing account is `NOT_FOUND`); a 404 or 405 without one comes from the framework's own router, so it is
 * the route that is missing, not the account.
 */
export function isImporterMissing(error: unknown): boolean {
  const { status, code } = (error as { status?: unknown; code?: unknown } | null) ?? {};
  return (status === 404 || status === 405) && code === undefined;
}

/** Rows drawn in the preview table; the rest are still imported, the table only says how many are hidden. */
export const MAX_RENDERED_ROWS = 200;

/** Translation key of the message for each reason the server can give for a skipped line. */
export const SKIP_REASON_KEYS = {
  'invalid-date': 'importStatementSkipInvalidDate',
  'invalid-amount': 'importStatementSkipInvalidAmount',
  'ambiguous-amount': 'importStatementSkipAmbiguousAmount',
  'column-count': 'importStatementSkipColumnCount',
  'repeated-id': 'importStatementSkipRepeatedId',
} as const satisfies Record<ImportSkipReason, string>;

// The importer is probed by use: the first 404 from the server hides the entry point for the rest of the session, so
// a backend without the feature does not keep offering a button that cannot work.
let importerMissing = false;
const listeners = new Set<() => void>();

export function markImporterMissing(): void {
  if (importerMissing) return;
  importerMissing = true;
  listeners.forEach((listener) => listener());
}

export function subscribeImporterMissing(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getImporterMissing = (): boolean => importerMissing;

/** Test hook: the flag otherwise lives for the whole page session. */
export function resetImporterMissing(): void {
  importerMissing = false;
  listeners.forEach((listener) => listener());
}

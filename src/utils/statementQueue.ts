/**
 * Bank statements imported as a queue: what a confirm sends for a preview and whether "apply the default to the
 * rest" can go on with it. Pure, like cardOfxQueue.ts.
 */
import { countLabel } from './maxfinPayload';
import type { ConfirmImportRow, ImportPreview } from '../hooks/api/useImportTransactions';

/** Only the rows the preview marked as new go in (the server checks duplicates again when it writes). */
export function statementConfirmRows(preview: Pick<ImportPreview, 'rows'>): ConfirmImportRow[] {
  return preview.rows.filter((row) => !row.duplicate).map(({ date, description, amount, type }) => ({ date, description, amount, type }));
}

export const STATEMENT_EMPTY_FILE = 'Nenhuma transação encontrada no arquivo.';
export const STATEMENT_NOTHING_NEW = 'Nenhuma transação nova neste arquivo: todas as linhas já estão no Recta.';

export type StatementDefaultPlan = { ok: true; rows: ConfirmImportRow[] } | { ok: false; reason: string };

/** The default for a statement is every new row. A file with no rows, or with nothing new, cannot proceed. */
export function planStatementDefaultApply(preview: Pick<ImportPreview, 'rows'>): StatementDefaultPlan {
  if (preview.rows.length === 0) return { ok: false, reason: STATEMENT_EMPTY_FILE };
  const rows = statementConfirmRows(preview);
  if (rows.length === 0) return { ok: false, reason: STATEMENT_NOTHING_NEW };
  return { ok: true, rows };
}

/** "3 transações importadas" for the progress list. */
export function statementImportNote(imported: number): string {
  return countLabel(imported, 'transação importada', 'transações importadas');
}

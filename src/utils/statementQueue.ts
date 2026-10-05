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

export type StatementDefaultPlan =
  | { ok: true; rows: ConfirmImportRow[] }
  /** Every row is already in Recta: nothing to import (left out). */
  | { ok: false; code: 'nothing-new'; reason: string }
  /** No row at all: the file is empty or could not be parsed (stops the loop). */
  | { ok: false; code: 'empty'; reason: string };

/** The default for a statement is every new row. A file with only duplicates is up to date; one with no rows at all is an error. */
export function planStatementDefaultApply(preview: Pick<ImportPreview, 'rows'>): StatementDefaultPlan {
  if (preview.rows.length === 0) return { ok: false, code: 'empty', reason: STATEMENT_EMPTY_FILE };
  const rows = statementConfirmRows(preview);
  if (rows.length === 0) return { ok: false, code: 'nothing-new', reason: STATEMENT_NOTHING_NEW };
  return { ok: true, rows };
}

export const STATEMENT_NOTHING_NEW_NOTE = 'Este arquivo não tem novidades: todas as linhas já estão no Recta.';
export const STATEMENT_NOTHING_NEW_QUEUE_NOTE = 'Sem novidades: nada a importar';

export interface StatementQueueControls {
  canContinue: boolean;
  applyRestEnabled: boolean;
  note: string | null;
  blockerText: string | null;
}

/**
 * What the buttons of the statement queue do for the file on screen. A file whose rows are all in Recta never stalls the
 * queue: "Continuar para o próximo" and "aplicar o padrão nas restantes" stay available. A file with no row at all (empty,
 * unparseable) or a failed confirm keeps them disabled, with the reason as text.
 */
export function statementQueueControls(input: {
  busy: boolean;
  preview: Pick<ImportPreview, 'rows'> | null;
  confirmError: string | null;
}): StatementQueueControls {
  if (input.busy || !input.preview) return { canContinue: false, applyRestEnabled: false, note: null, blockerText: null };
  if (input.confirmError !== null) {
    return { canContinue: false, applyRestEnabled: false, note: null, blockerText: 'Atualize a pré-visualização antes de confirmar de novo.' };
  }
  const plan = planStatementDefaultApply(input.preview);
  if (plan.ok) return { canContinue: false, applyRestEnabled: true, note: null, blockerText: null };
  if (plan.code === 'nothing-new') return { canContinue: true, applyRestEnabled: true, note: STATEMENT_NOTHING_NEW_NOTE, blockerText: null };
  return { canContinue: false, applyRestEnabled: false, note: null, blockerText: plan.reason };
}

/** "3 transações importadas" for the progress list. */
export function statementImportNote(imported: number): string {
  return countLabel(imported, 'transação importada', 'transações importadas');
}

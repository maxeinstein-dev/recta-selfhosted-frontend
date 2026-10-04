/**
 * Pure logic of the MaxFin workbook (.xlsx) flow: month keys and labels, the options sent to the workbook
 * preview, the row selection of each month, the confirm plan (one monthly confirm per month, oldest first),
 * the footer totals, the blocker and the summary of a run. Like maxfinPayload.ts: no React, no axios and no
 * `import.meta`, so it also runs under `tsx`. Every request of the plan comes from buildConfirmPayload, so a
 * month confirmed from the workbook is exactly what the .csv flow would send for that month.
 */
import {
  MAXFIN_MAX_ROWS, buildConfirmPayload, buildConfirmSummary, confirmResultNeedsReview, countLabel, monthToInputValue, parseMonthInput,
  reconcileSelection, toCents,
} from './maxfinPayload';
import type { MaxFinBuiltConfirm, MaxFinConfirmContext, MaxFinConfirmTotals } from './maxfinPayload';
import type {
  MaxFinCategoryTargetInput, MaxFinConfirmRequest, MaxFinConfirmResponse, MaxFinPreviewResponse, MaxFinPreviewRow, MaxFinWorkbookOptions,
  MaxFinWorkbookPreviewResponse, MaxFinWorkbookSheet,
} from '../hooks/api/useImportMaxFin';

// ---- Month keys and labels --------------------------------------------------------------------------------

const MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** True for a 'YYYY-MM' the server accepts (years 2000..2100, months 01..12). */
export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && parseMonthInput(value) !== null;
}

/** 'março/2026', lowercase as in running pt-BR text; anything that is not a month key comes back as is. */
export function monthKeyLabel(key: string): string {
  const month = parseMonthInput(key);
  return month ? `${MONTH_NAMES[month.month - 1]}/${month.year}` : key;
}

/** 'YYYY-MM' strings sort chronologically: sorted, without repeats. */
export function sortMonthKeys(keys: readonly string[]): string[] {
  return [...new Set(keys)].sort();
}

/** Key of a month preview: from `month` (what confirm sends), else `monthKey`; null when the month is unknown. */
export function previewMonthKey(preview: Pick<MaxFinPreviewResponse, 'month' | 'monthKey'>): string | null {
  if (preview.month) return monthToInputValue(preview.month);
  return preview.monthKey ?? null;
}

/** Identity of a month inside a workbook response: its key, or its position when the month is unknown. */
export function workbookMonthId(preview: Pick<MaxFinPreviewResponse, 'month' | 'monthKey'>, index: number): string {
  return previewMonthKey(preview) ?? `#${index + 1}`;
}

// ---- Sheets and options -----------------------------------------------------------------------------------

/** A sheet the user can tick: read as a month (selected or available) with a valid month key. Unknown statuses never are. */
export function isSelectableSheet(sheet: Pick<MaxFinWorkbookSheet, 'status' | 'monthKey'>): boolean {
  return (sheet.status === 'selected' || sheet.status === 'available') && isMonthKey(sheet.monthKey);
}

/** Values of "Meses fechados até" besides "nenhum": the months of the workbook plus the current value, sorted. */
export function closedThroughChoices(sheets: ReadonlyArray<Pick<MaxFinWorkbookSheet, 'status' | 'monthKey'>>, current: string | null): string[] {
  const keys = sheets.filter(isSelectableSheet).map((sheet) => sheet.monthKey as string);
  // The current value is always listed, so the select never shows something else than what is applied.
  return sortMonthKeys(current ? [...keys, current] : keys);
}

/**
 * Options of the next workbook preview, every field explicit (an omitted field would fall back to the server
 * default, e.g. the default months). Only the contract fields are copied; months are sorted without repeats.
 */
export function nextWorkbookOptions(current: MaxFinWorkbookOptions, patch: Partial<MaxFinWorkbookOptions> = {}): MaxFinWorkbookOptions {
  const merged = { ...current, ...patch };
  return {
    months: sortMonthKeys(merged.months ?? []),
    closedThrough: merged.closedThrough ?? null,
    payInvoice: merged.payInvoice,
    generateFutureInstallments: merged.generateFutureInstallments,
  };
}

/** Months after ticking or unticking one; null when that would leave no month (the last one cannot be unticked). */
export function toggleWorkbookMonth(months: readonly string[], key: string, checked: boolean): string[] | null {
  const next = checked ? sortMonthKeys([...months, key]) : sortMonthKeys(months.filter((month) => month !== key));
  return next.length > 0 ? next : null;
}

// ---- Row selection per month ------------------------------------------------------------------------------

/** workbookMonthId -> rowKey -> ticked. */
export type MaxFinWorkbookSelection = Record<string, Record<string, boolean>>;
/** workbookMonthId -> rows of the last preview that had the month. */
export type MaxFinWorkbookRowsByMonth = Record<string, MaxFinPreviewRow[]>;

/** Rows of every month seen so far, the newest response winning (input of the next reconcile). */
export function rowsByMonth(
  prev: Readonly<MaxFinWorkbookRowsByMonth>,
  months: ReadonlyArray<Pick<MaxFinPreviewResponse, 'month' | 'monthKey' | 'rows'>>,
): MaxFinWorkbookRowsByMonth {
  const next: MaxFinWorkbookRowsByMonth = { ...prev };
  months.forEach((month, index) => {
    next[workbookMonthId(month, index)] = month.rows;
  });
  return next;
}

/**
 * Selection after a workbook preview: every month of the response goes through reconcileSelection (a row whose
 * status did not change keeps the user's choice, anything else gets the default), and a month that left the
 * response keeps its choices for when it is ticked again.
 */
export function reconcileWorkbookSelection(
  prevRows: Readonly<MaxFinWorkbookRowsByMonth>,
  prevSelection: Readonly<MaxFinWorkbookSelection>,
  nextMonths: ReadonlyArray<Pick<MaxFinPreviewResponse, 'month' | 'monthKey' | 'rows'>>,
): MaxFinWorkbookSelection {
  const next: MaxFinWorkbookSelection = { ...prevSelection };
  nextMonths.forEach((month, index) => {
    const id = workbookMonthId(month, index);
    next[id] = reconcileSelection(prevRows[id] ?? [], prevSelection[id] ?? {}, month.rows);
  });
  return next;
}

/** Month shown in the detail: the current one while the response still has it, else the first (oldest). */
export function pickDetailMonth(current: string | null, monthIds: readonly string[]): string | null {
  if (current !== null && monthIds.includes(current)) return current;
  return monthIds[0] ?? null;
}

// ---- Confirm plan -----------------------------------------------------------------------------------------

export interface MaxFinWorkbookMonthPlan {
  /** workbookMonthId: the key of the row selection of this month. */
  id: string;
  /** 'YYYY-MM'; null when the month is unknown. */
  monthKey: string | null;
  label: string;
  preview: MaxFinPreviewResponse;
  /** What the .csv flow would send for this month, and its footer numbers. */
  built: MaxFinBuiltConfirm;
}

export interface MaxFinWorkbookStep {
  monthKey: string;
  label: string;
  payload: MaxFinConfirmRequest;
  totals: MaxFinConfirmTotals;
}

export interface MaxFinWorkbookTotals {
  /** Months that will be sent, one confirm each. */
  months: number;
  rows: number;
  incomeCount: number;
  incomeCents: number;
  /** Sum of the INCOME rows (receitas), from integer cents. */
  incomeTotal: number;
  expenseCount: number;
  expenseCents: number;
  /** Sum of the EXPENSE rows (despesas), from integer cents. */
  expenseTotal: number;
  /** Stored transactions that will be replaced (ticked changed + replaces-future rows). */
  replacements: number;
  /** Invoice payments that will be recorded (closed months with credit rows sent) and their sum. */
  invoiceCount: number;
  invoiceCents: number;
  invoiceTotal: number;
  /** Labels of the selected months with nothing to send (every row duplicated or unticked), oldest first. */
  emptyMonths: string[];
}

export interface MaxFinWorkbookPlan {
  /** Every month of the response, oldest first. */
  months: MaxFinWorkbookMonthPlan[];
  /** One monthly confirm per month with rows to send, oldest first. */
  steps: MaxFinWorkbookStep[];
  totals: MaxFinWorkbookTotals;
  /** Labels of months with rows to send that cannot be confirmed (unknown or repeated month). */
  unsendable: string[];
}

const UNKNOWN_LAST = '~';

/**
 * The confirm plan of a workbook. For every month: buildConfirmPayload with that month's preview (and its own
 * options), its own row selection and the category choices shared by all months, i.e. the request the .csv
 * flow would send for it. Months with rows to send become the steps, oldest first.
 */
export function buildWorkbookPlan(
  workbook: Pick<MaxFinWorkbookPreviewResponse, 'months'>,
  selection: Readonly<MaxFinWorkbookSelection>,
  categoryChoices: Readonly<Record<string, MaxFinCategoryTargetInput>>,
  context: MaxFinConfirmContext,
): MaxFinWorkbookPlan {
  const months: MaxFinWorkbookMonthPlan[] = workbook.months
    .map((preview, index) => {
      const id = workbookMonthId(preview, index);
      const monthKey = previewMonthKey(preview);
      return {
        id,
        monthKey,
        label: monthKey ? monthKeyLabel(monthKey) : `mês não identificado (${index + 1})`,
        preview,
        built: buildConfirmPayload(preview, selection[id] ?? {}, categoryChoices, context),
      };
    })
    // Array.prototype.sort is stable: equal keys keep the order of the response.
    .sort((a, b) => {
      const ka = a.monthKey ?? UNKNOWN_LAST;
      const kb = b.monthKey ?? UNKNOWN_LAST;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

  const seen = new Set<string>();
  const steps: MaxFinWorkbookStep[] = [];
  const unsendable: string[] = [];
  const emptyMonths: string[] = [];
  const totals: MaxFinWorkbookTotals = {
    months: 0, rows: 0, incomeCount: 0, incomeCents: 0, incomeTotal: 0, expenseCount: 0, expenseCents: 0, expenseTotal: 0,
    replacements: 0, invoiceCount: 0, invoiceCents: 0, invoiceTotal: 0, emptyMonths,
  };
  for (const month of months) {
    const { built, monthKey } = month;
    const repeated = monthKey !== null && seen.has(monthKey);
    if (monthKey !== null) seen.add(monthKey);
    if (built.rowsSent.length === 0) {
      emptyMonths.push(month.label);
      continue;
    }
    if (!built.payload || monthKey === null || repeated) {
      unsendable.push(month.label);
      continue;
    }
    steps.push({ monthKey, label: month.label, payload: built.payload, totals: built.totals });
    for (const row of built.rowsSent) {
      if (row.type === 'INCOME') {
        totals.incomeCount += 1;
        totals.incomeCents += toCents(row.amount);
      } else {
        totals.expenseCount += 1;
        totals.expenseCents += toCents(row.amount);
      }
    }
    totals.rows += built.rowsSent.length;
    totals.replacements += built.totals.replacements;
    if (built.totals.invoice.willPay) {
      totals.invoiceCount += 1;
      totals.invoiceCents += built.totals.invoice.cents;
    }
  }
  totals.months = steps.length;
  totals.incomeTotal = totals.incomeCents / 100;
  totals.expenseTotal = totals.expenseCents / 100;
  totals.invoiceTotal = totals.invoiceCents / 100;
  return { months, steps, totals, unsendable };
}

export interface MaxFinWorkbookBlocker {
  code: 'needs-refresh' | 'no-month' | 'none-selected' | 'too-many';
  message: string;
}

/**
 * Why "Importar" must stay disabled; null when the plan can go. `needsRefresh` (a run failed and the preview was
 * not refreshed since) is required on purpose, as in confirmBlocker: the stored part would be sent again.
 */
export function workbookConfirmBlocker(plan: MaxFinWorkbookPlan | null, needsRefresh: boolean): MaxFinWorkbookBlocker | null {
  if (needsRefresh) return { code: 'needs-refresh', message: 'Atualize a pré-visualização antes de confirmar de novo.' };
  if (!plan || plan.months.length === 0) return { code: 'none-selected', message: 'Marque ao menos um mês.' };
  if (plan.unsendable.length > 0) {
    return {
      code: 'no-month',
      message: `Mês não identificado ou repetido (${plan.unsendable.join(', ')}): atualize a pré-visualização.`,
    };
  }
  if (plan.steps.length === 0) return { code: 'none-selected', message: 'Selecione ao menos uma transação.' };
  const over = plan.steps.find((step) => step.totals.count > MAXFIN_MAX_ROWS);
  if (over) {
    return {
      code: 'too-many',
      message: `Selecione no máximo ${MAXFIN_MAX_ROWS} linhas por mês: ${over.label} tem ${over.totals.count} selecionadas.`,
    };
  }
  return null;
}

// ---- Run --------------------------------------------------------------------------------------------------

/** 'Importando março/2026 (3 de 10)…' */
export function workbookProgressLabel(label: string, index: number, total: number): string {
  return `Importando ${label} (${index + 1} de ${total})…`;
}

export interface MaxFinWorkbookMonthOutcome {
  monthKey: string;
  label: string;
  status: 'imported' | 'failed' | 'not-sent';
  result: MaxFinConfirmResponse | null;
  /** 'março/2026: 12 transações importadas, ...' for an imported month; null otherwise. */
  line: string | null;
}

export interface MaxFinWorkbookRunSummary {
  months: MaxFinWorkbookMonthOutcome[];
  /** Labels of the months stored, in the order they were sent. */
  imported: string[];
  /** The month whose request failed (it may be partially stored); null when no request failed. */
  failed: { label: string; reason: string; invoicePromised: boolean } | null;
  /** Labels of the months never sent (after a failure, or after the dialog went away). */
  notSent: string[];
  /** Server warnings of the imported months, each prefixed with its month label. */
  warnings: string[];
  totals: { imported: number; replaced: number; skipped: number; invoices: number; invoiceCents: number };
  /** Some imported month has something to read (warnings, skipped rows, consumed future installments). */
  needsReview: boolean;
}

/**
 * Summary of a run: `results[i]` is the response of `steps[i]`; the step right after the last result failed when
 * `failure` is given; every other step was not sent.
 */
export function summarizeWorkbookRun(
  steps: ReadonlyArray<Pick<MaxFinWorkbookStep, 'monthKey' | 'label' | 'totals'>>,
  results: readonly MaxFinConfirmResponse[],
  failure: { reason: string } | null,
  formatAmount: (value: number) => string,
): MaxFinWorkbookRunSummary {
  const summary: MaxFinWorkbookRunSummary = {
    months: [], imported: [], failed: null, notSent: [], warnings: [],
    totals: { imported: 0, replaced: 0, skipped: 0, invoices: 0, invoiceCents: 0 },
    needsReview: false,
  };
  steps.forEach((step, index) => {
    const result = index < results.length ? results[index] : null;
    if (result) {
      summary.months.push({
        monthKey: step.monthKey, label: step.label, status: 'imported', result,
        line: `${step.label}: ${buildConfirmSummary(result, formatAmount)}`,
      });
      summary.imported.push(step.label);
      for (const warning of result.warnings ?? []) summary.warnings.push(`${step.label}: ${warning}`);
      summary.totals.imported += result.imported;
      summary.totals.replaced += result.replaced;
      summary.totals.skipped += result.skipped;
      if (result.invoicePayment) {
        summary.totals.invoices += 1;
        summary.totals.invoiceCents += toCents(result.invoicePayment.amount);
      }
      if (confirmResultNeedsReview(result)) summary.needsReview = true;
    } else if (failure && index === results.length) {
      summary.months.push({ monthKey: step.monthKey, label: step.label, status: 'failed', result: null, line: null });
      summary.failed = { label: step.label, reason: failure.reason, invoicePromised: step.totals.invoice.willPay };
    } else {
      summary.months.push({ monthKey: step.monthKey, label: step.label, status: 'not-sent', result: null, line: null });
      summary.notSent.push(step.label);
    }
  });
  return summary;
}

/** Toast after a run where every month went through. */
export function workbookRunToast(summary: MaxFinWorkbookRunSummary): string {
  const { totals } = summary;
  const parts = [countLabel(totals.imported, 'transação importada', 'transações importadas')];
  if (totals.replaced > 0) parts.push(countLabel(totals.replaced, 'substituída', 'substituídas'));
  if (totals.invoices > 0) parts.push(countLabel(totals.invoices, 'fatura registrada', 'faturas registradas'));
  if (totals.skipped > 0) parts.push(countLabel(totals.skipped, 'linha ignorada', 'linhas ignoradas'));
  let text = `${countLabel(summary.imported.length, 'mês importado', 'meses importados')}: ${parts.join(', ')}.`;
  if (summary.warnings.length > 0) text += ` ${countLabel(summary.warnings.length, 'aviso', 'avisos')}.`;
  return text;
}

/**
 * Text of the toast and of the alert when a run stops early: the months stored, the month that failed (it may
 * be partial), the months not sent and what to do next.
 */
export function workbookStopMessage(summary: MaxFinWorkbookRunSummary): string {
  const done = summary.imported.length > 0 ? `Meses importados: ${summary.imported.join(', ')}.` : 'Nenhum mês foi importado.';
  const notSent = summary.notSent.length > 0 ? ` Não enviados: ${summary.notSent.join(', ')}.` : '';
  const { failed } = summary;
  if (!failed) return `Importação interrompida. ${done}${notSent}`;
  const reason = failed.reason.trim() || 'Não foi possível confirmar a importação.';
  const head = `Falha ao importar ${failed.label}: ${/[.!?]$/.test(reason) ? reason : `${reason}.`}`;
  const invoice = failed.invoicePromised
    ? ` O pagamento da fatura só soma as linhas importadas na mesma confirmação: confira a fatura de ${failed.label}.`
    : '';
  return `${head} ${done} A importação de ${failed.label} pode ter sido parcial.${notSent}`
    + ` Atualize a pré-visualização: as linhas já importadas aparecem como duplicadas.${invoice}`;
}

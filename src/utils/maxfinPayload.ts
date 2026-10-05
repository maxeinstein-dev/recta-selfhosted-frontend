/**
 * Pure logic of the MaxFin importer: row selection, confirm payload, invoice preview, category mapping,
 * option rules and input limits. No React, no axios and no `import.meta`, so it also runs outside Vite
 * (e.g. under `tsx`). Types come from the hook module through type-only imports (erased at runtime).
 */
import { AccountType, CategoryType, getCategoriesByType } from '../lib/enums';
import type { CategoryName } from '../lib/enums';
import type {
  MaxFinAccountsInput, MaxFinCategoryMapEntry, MaxFinCategoryMapInput, MaxFinCategorySuggestion, MaxFinCategoryTargetInput,
  MaxFinConfirmRequest, MaxFinConfirmResponse, MaxFinConfirmRow, MaxFinImportOptions, MaxFinMonth, MaxFinPreviewResponse,
  MaxFinPreviewRow, MaxFinRowStatus, MaxFinSectionKey, MaxFinTransactionType,
} from '../hooks/api/useImportMaxFin';

// ---- Limits (zod limits of the confirm endpoint, and of the upload) ---------------------------------------

export const MAXFIN_MAX_ROWS = 500;
export const MAXFIN_MAX_CATEGORY_NAME = 100;
export const MAXFIN_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAXFIN_MIN_YEAR = 2000;
export const MAXFIN_MAX_YEAR = 2100;

export const MAXFIN_SECTION_ORDER: readonly MaxFinSectionKey[] = ['income', 'bills', 'credit', 'debit'];

/** "1 linha" / "3 linhas" */
export function countLabel(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Same algorithm as the server for category keys: NFD, drop combining marks, lowercase, collapse spaces, trim. */
export function normalizeLabel(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ---- Month and file ---------------------------------------------------------------------------------------

/** Parses an `<input type="month">` value (YYYY-MM). Only years the server accepts (2000..2100). */
export function parseMonthInput(value: string): MaxFinMonth | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || year < MAXFIN_MIN_YEAR || year > MAXFIN_MAX_YEAR) return null;
  return { year, month };
}

export function monthToInputValue(month: MaxFinMonth): string {
  return `${month.year}-${String(month.month).padStart(2, '0')}`;
}

const MB = 1024 * 1024;

/** Size shown to the user, rounded UP to one decimal so a file over the limit never reads as the limit itself. */
function sizeLabel(bytes: number): string {
  return `${(Math.ceil((bytes / MB) * 10 - 1e-9) / 10).toFixed(1).replace('.', ',')} MB`;
}

/** One monthly tab exported as .csv, or the whole workbook as .xlsx. */
export type MaxFinFileKind = 'csv' | 'xlsx';

/** Kind of upload, from the file name (case-insensitive); null for anything else (.xls, .ods, ...). */
export function maxfinFileKind(name: string): MaxFinFileKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  return null;
}

/** Message when the file cannot be uploaded (not .csv/.xlsx, or over the 5 MB limit); null when it is fine. */
export function validateMaxFinFile(file: { name: string; size: number }): string | null {
  const kind = maxfinFileKind(file.name);
  if (!kind) return 'Formato inválido. Envie a aba do mês exportada como .csv ou a planilha inteira como .xlsx.';
  if (file.size > MAXFIN_MAX_FILE_BYTES) {
    const hint = kind === 'csv' ? 'exporte só a aba do mês' : 'remova as abas que não são meses ou envie cada mês como .csv';
    return `Arquivo muito grande (${sizeLabel(file.size)}). O limite é ${MAXFIN_MAX_FILE_BYTES / MB} MB: ${hint}.`;
  }
  return null;
}

// ---- Options ----------------------------------------------------------------------------------------------

/** closedMonth gates payInvoice and excludes future installments. */
export function normalizeOptions(options: MaxFinImportOptions): MaxFinImportOptions {
  return {
    closedMonth: options.closedMonth,
    payInvoice: options.closedMonth && options.payInvoice,
    generateFutureInstallments: !options.closedMonth && options.generateFutureInstallments,
  };
}

/**
 * Applies one option toggle. Switching "Mês fechado" moves the two dependent options to that mode defaults
 * (closed: pay the invoice, no future installments; open: the opposite); the user may change them afterwards.
 */
export function applyOptionPatch(current: MaxFinImportOptions, patch: Partial<MaxFinImportOptions>): MaxFinImportOptions {
  if (patch.closedMonth !== undefined && patch.closedMonth !== current.closedMonth) {
    return patch.closedMonth
      ? { closedMonth: true, payInvoice: true, generateFutureInstallments: false }
      : { closedMonth: false, payInvoice: false, generateFutureInstallments: true };
  }
  return normalizeOptions({ ...current, ...patch });
}

// ---- Row status and selection -----------------------------------------------------------------------------

export type MaxFinSendableStatus = Exclude<MaxFinRowStatus, 'duplicate'>;

const SENDABLE_STATUSES: readonly string[] = ['new', 'changed', 'replaces-future', 'legacy-duplicate', 'matches-recurring'];

/** Only these statuses can be sent. `duplicate` never is, and neither is a status this client does not know. */
export function isSendableStatus(status: string): status is MaxFinSendableStatus {
  return SENDABLE_STATUSES.includes(status);
}

/**
 * Ticked by default: new rows, rows that supersede generated future installments and rows that a recurrence generated
 * for the month (the sheet takes the pending bill over: real amount, paid, no duplicate).
 */
export function defaultRowSelected(status: string): boolean {
  return status === 'new' || status === 'replaces-future' || status === 'matches-recurring';
}

/**
 * Statuses whose row overwrites data already stored (the confirm needs `replace: true` and the button arms a second
 * click): a changed row, generated future installments, or the pending bill a recurrence generated for the month.
 */
export function replacesStoredData(status: string): boolean {
  return status === 'changed' || status === 'replaces-future' || status === 'matches-recurring';
}

/**
 * The detail line of a row. For a `matches-recurring` row whose stored amount is known (`existingAmount`) it ends with
 * "R$ old → R$ new", so the user sees what the sheet changes; with no stored amount (older server) it is the server text.
 */
export function rowDetailText(
  row: Pick<MaxFinPreviewRow, 'status' | 'statusDetail' | 'amount'> & { existingAmount?: number | null },
  formatAmount: (value: number) => string,
): string | null {
  const base = row.statusDetail || null;
  if (row.status !== 'matches-recurring' || typeof row.existingAmount !== 'number' || !Number.isFinite(row.existingAmount)) return base;
  const change = `${formatAmount(row.existingAmount)} → ${formatAmount(row.amount)}`;
  return base ? `${base}: ${change}` : change;
}

/** Stable identity of a preview row across re-runs of the preview. */
export function rowKey(row: Pick<MaxFinPreviewRow, 'section' | 'sourceLine' | 'sourceRef'>): string {
  return `${row.section}|${row.sourceLine}|${row.sourceRef}`;
}

/**
 * Selection after a preview re-run: rows that cannot be sent (duplicates, unknown statuses) are never selected;
 * a row whose status did not change keeps the choice made by the user; everything else gets the default.
 */
export function reconcileSelection(
  prevRows: readonly MaxFinPreviewRow[],
  prevSelected: Readonly<Record<string, boolean>>,
  nextRows: readonly MaxFinPreviewRow[],
): Record<string, boolean> {
  const prevStatus = new Map(prevRows.map((row) => [rowKey(row), row.status]));
  const next: Record<string, boolean> = {};
  for (const row of nextRows) {
    const key = rowKey(row);
    if (!isSendableStatus(row.status)) {
      next[key] = false;
      continue;
    }
    const keep = prevStatus.get(key) === row.status && key in prevSelected;
    next[key] = keep ? prevSelected[key] : defaultRowSelected(row.status);
  }
  return next;
}

/** Rows confirm will receive: ticked AND sendable. Duplicates and unknown statuses never go, ticked or not. */
export function selectRowsToSend(
  rows: readonly MaxFinPreviewRow[],
  selected: Readonly<Record<string, boolean>>,
): MaxFinPreviewRow[] {
  return rows.filter((row) => selected[rowKey(row)] === true && isSendableStatus(row.status));
}

export interface MaxFinStatusCounts {
  new: number;
  duplicate: number;
  changed: number;
  replacesFuture: number;
  legacyDuplicate: number;
  /** Rows the sheet takes over from a recurrence (the bill it generated, or the recurrence itself). */
  matchesRecurring: number;
  /** Statuses this client does not know. */
  unknown: number;
}

export function countByStatus(rows: ReadonlyArray<Pick<MaxFinPreviewRow, 'status'>>): MaxFinStatusCounts {
  const counts: MaxFinStatusCounts = { new: 0, duplicate: 0, changed: 0, replacesFuture: 0, legacyDuplicate: 0, matchesRecurring: 0, unknown: 0 };
  for (const { status } of rows) {
    switch (status as string) {
      case 'new':
        counts.new += 1;
        break;
      case 'duplicate':
        counts.duplicate += 1;
        break;
      case 'changed':
        counts.changed += 1;
        break;
      case 'replaces-future':
        counts.replacesFuture += 1;
        break;
      case 'legacy-duplicate':
        counts.legacyDuplicate += 1;
        break;
      case 'matches-recurring':
        counts.matchesRecurring += 1;
        break;
      default:
        counts.unknown += 1;
    }
  }
  return counts;
}

/** Strips preview-only fields; `replace` is sent only for rows that replace stored data (changed, replaces-future, matches-recurring). */
export function toConfirmRow(row: MaxFinPreviewRow): MaxFinConfirmRow {
  const base: MaxFinConfirmRow = {
    sourceRef: row.sourceRef,
    section: row.section,
    type: row.type,
    description: row.description,
    categoryKey: row.categoryKey,
    amount: row.amount,
    paid: row.paid,
    date: row.date,
    notes: row.notes,
    installment: row.installment,
  };
  return replacesStoredData(row.status) ? { ...base, replace: true } : base;
}

// ---- Credit card invoice ----------------------------------------------------------------------------------

/** Integer cents, rounded exactly like the invoice sum computed by the server. */
export function toCents(amount: number): number {
  return Number.isFinite(amount) ? Math.round(Math.abs(amount) * 100 + 1e-6) : 0;
}

/** Like toCents, keeping the sign (net amounts, such as an invoice whose refunds exceed the purchases). */
export function toSignedCents(amount: number): number {
  return amount < 0 ? -toCents(amount) : toCents(amount);
}

/**
 * Negative sheet values arrive as credits: in the bills, credit and debit blocks as INCOME rows (a refund, an
 * estorno), in the income block as an EXPENSE row. 'credit' / 'debit' for those rows, null for the usual ones.
 */
export function reversedRowKind(row: Pick<MaxFinPreviewRow, 'section' | 'type'>): 'credit' | 'debit' | null {
  if (row.section !== 'income' && row.type === 'INCOME') return 'credit';
  if (row.section === 'income' && row.type === 'EXPENSE') return 'debit';
  return null;
}

export interface MaxFinAccountRef {
  id: string;
  type: string;
}

export interface MaxFinInvoiceContext {
  /** Account the invoice is paid from (the "contas fixas" account). */
  sourceAccountId: string;
  /** Credit card account the invoice belongs to. */
  creditAccountId: string;
  accounts: readonly MaxFinAccountRef[];
  /** The invoice payment of this card and month already exists (the server never records a second one). */
  alreadyPaid?: boolean;
  /** The preview carries an invoice: the server produces none when the month is unknown or the card account is not a credit account. */
  hasInvoice: boolean;
}

export interface MaxFinInvoiceSelection {
  /**
   * Net invoice of the credit-section rows that will be sent, in integer cents: purchases (EXPENSE) minus
   * refunds (INCOME, negative values of the sheet). Zero or negative when the refunds cover the purchases.
   */
  cents: number;
  amount: number;
  /** Credit-section EXPENSE rows that will be sent, in integer cents. */
  purchaseCents: number;
  /** Credit-section INCOME rows (refunds) that will be sent, in integer cents. */
  refundCents: number;
  /** Credit-section rows that will be sent, purchases and refunds. */
  rowCount: number;
  /** The source account can pay: it exists, is not a credit account and is not the card itself. */
  canPay: boolean;
  /** Confirm will record the invoice payment, for `amount`. */
  willPay: boolean;
  /** Why the payment will not be recorded; null when it will. */
  reason: string | null;
}

export const INVOICE_REASON = {
  openMonth: 'mês aberto',
  optionOff: 'opção desligada',
  alreadyPaid: 'a fatura deste mês já foi paga',
  noInvoice: 'a conta do cartão não é de crédito ou o mês não foi identificado',
  noCardRows: 'nenhuma compra de cartão selecionada',
  creditsCover: 'os créditos igualam ou superam as compras selecionadas',
  sourceMissing: 'a conta de contas fixas não foi encontrada',
  sourceIsCard: 'a conta de contas fixas é um cartão',
  sourceIsThisCard: 'a conta de contas fixas é o próprio cartão',
} as const;

/**
 * Net invoice of the credit-section rows among the rows given (purchases minus refunds, integer cents), plus
 * whether the payment gets recorded: only for a positive net.
 */
export function invoiceForRows(
  rowsSent: readonly MaxFinPreviewRow[],
  options: MaxFinImportOptions,
  ctx: MaxFinInvoiceContext,
): MaxFinInvoiceSelection {
  let purchaseCents = 0;
  let refundCents = 0;
  let rowCount = 0;
  for (const row of rowsSent) {
    if (row.section !== 'credit' || !isSendableStatus(row.status)) continue;
    if (row.type === 'INCOME') refundCents += toCents(row.amount);
    else purchaseCents += toCents(row.amount);
    rowCount += 1;
  }
  const cents = purchaseCents - refundCents;
  const source = ctx.accounts.find((account) => account.id === ctx.sourceAccountId);
  const accountProblem = !source
    ? INVOICE_REASON.sourceMissing
    : source.type === AccountType.CREDIT
      ? INVOICE_REASON.sourceIsCard
      : ctx.sourceAccountId === ctx.creditAccountId
        ? INVOICE_REASON.sourceIsThisCard
        : null;
  const canPay = accountProblem === null;
  const alreadyPaid = ctx.alreadyPaid === true;
  const hasInvoice = ctx.hasInvoice === true;
  const willPay = options.closedMonth && options.payInvoice && cents > 0 && canPay && !alreadyPaid && hasInvoice;
  const reason = willPay
    ? null
    : !options.closedMonth
      ? INVOICE_REASON.openMonth
      : !options.payInvoice
        ? INVOICE_REASON.optionOff
        : !hasInvoice
          ? INVOICE_REASON.noInvoice
          : alreadyPaid
            ? INVOICE_REASON.alreadyPaid
            : accountProblem ?? (rowCount === 0 ? INVOICE_REASON.noCardRows : INVOICE_REASON.creditsCover);
  return { cents, amount: cents / 100, purchaseCents, refundCents, rowCount, canPay, willPay, reason };
}

// ---- Category mapping -------------------------------------------------------------------------------------

/** `${type}|${normalized key}`: the server keys its category map the same way, so spelling variants share an entry. */
export function categoryChoiceKey(type: MaxFinTransactionType, key: string): string {
  return `${type}|${normalizeLabel(key)}`;
}

export function systemCategoryNames(type: MaxFinTransactionType): CategoryName[] {
  return getCategoriesByType(type === 'INCOME' ? CategoryType.INCOME : CategoryType.EXPENSE);
}

/** The server rejects names over 100 characters; a surrogate pair is never cut in half. */
export function clampCategoryName(name: string): string {
  if (name.length <= MAXFIN_MAX_CATEGORY_NAME) return name;
  const cut = name.slice(0, MAXFIN_MAX_CATEGORY_NAME);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

export function suggestionToTarget(suggestion: MaxFinCategorySuggestion, key: string): MaxFinCategoryTargetInput {
  switch (suggestion.kind) {
    case 'system':
      return suggestion.categoryName ? { kind: 'system', categoryName: suggestion.categoryName } : { kind: 'default' };
    case 'custom':
      return suggestion.categoryId ? { kind: 'custom', categoryId: suggestion.categoryId } : { kind: 'default' };
    case 'create':
      return key ? { kind: 'create', name: clampCategoryName(suggestion.name || key) } : { kind: 'default' };
    default:
      return { kind: 'default' };
  }
}

/** `<select>` value encoding: system:<CategoryName> | custom:<id> | create | default */
export function targetToSelectValue(target: MaxFinCategoryTargetInput): string {
  switch (target.kind) {
    case 'system':
      return `system:${target.categoryName}`;
    case 'custom':
      return `custom:${target.categoryId}`;
    case 'create':
      return 'create';
    default:
      return 'default';
  }
}

export function selectValueToTarget(value: string, key: string): MaxFinCategoryTargetInput {
  if (value.startsWith('system:')) return { kind: 'system', categoryName: value.slice('system:'.length) };
  if (value.startsWith('custom:')) return { kind: 'custom', categoryId: value.slice('custom:'.length) };
  if (value === 'create' && key) return { kind: 'create', name: clampCategoryName(key) };
  return { kind: 'default' };
}

/** True when the target has a matching option in the select (and respects the server limits). */
export function isCategoryTargetValid(
  target: MaxFinCategoryTargetInput,
  type: MaxFinTransactionType,
  key: string,
  customIdsOfType: ReadonlySet<string>,
): boolean {
  switch (target.kind) {
    case 'system':
      return (systemCategoryNames(type) as string[]).includes(target.categoryName);
    case 'custom':
      return customIdsOfType.has(target.categoryId);
    case 'create':
      return key !== '' && target.name !== '' && target.name.length <= MAXFIN_MAX_CATEGORY_NAME;
    case 'default':
      return true;
  }
}

/**
 * Target taken from the server suggestion, checked like any other choice. A custom id this dialog does not
 * know falls back to creating a category named after the sheet key (the server reuses an existing custom
 * category with the same normalized name), or to the default category when the key is empty.
 */
export function suggestedTarget(entry: MaxFinCategoryMapEntry, customIdsOfType: ReadonlySet<string>): MaxFinCategoryTargetInput {
  const target = suggestionToTarget(entry.suggestion, entry.key);
  if (isCategoryTargetValid(target, entry.type, entry.key, customIdsOfType)) return target;
  if (target.kind === 'custom' && entry.key) return { kind: 'create', name: clampCategoryName(entry.key) };
  return { kind: 'default' };
}

/** What the select shows and the request sends for one entry: the choice while still valid, else the suggestion. */
export function effectiveCategoryTarget(
  entry: MaxFinCategoryMapEntry,
  choices: Readonly<Record<string, MaxFinCategoryTargetInput>>,
  customIdsByType: Readonly<Record<MaxFinTransactionType, ReadonlySet<string>>>,
): MaxFinCategoryTargetInput {
  const customIds = customIdsByType[entry.type];
  const chosen = choices[categoryChoiceKey(entry.type, entry.key)];
  return chosen && isCategoryTargetValid(chosen, entry.type, entry.key, customIds) ? chosen : suggestedTarget(entry, customIds);
}

/**
 * Precedence per entry: in-session choice, then saved choice, then server suggestion. Saved and in-session
 * choices only apply while still valid (for example the custom category still exists for that type).
 */
export function resolveCategoryChoices(
  entries: readonly MaxFinCategoryMapEntry[],
  inSession: Readonly<Record<string, MaxFinCategoryTargetInput>>,
  saved: Readonly<Record<string, MaxFinCategoryTargetInput>>,
  customIdsByType: Readonly<Record<MaxFinTransactionType, ReadonlySet<string>>>,
): Record<string, MaxFinCategoryTargetInput> {
  const out: Record<string, MaxFinCategoryTargetInput> = {};
  for (const entry of entries) {
    const key = categoryChoiceKey(entry.type, entry.key);
    const customIds = customIdsByType[entry.type];
    const candidate = [inSession[key], saved[key]].find(
      (target): target is MaxFinCategoryTargetInput => !!target && isCategoryTargetValid(target, entry.type, entry.key, customIds),
    );
    out[key] = candidate ?? suggestedTarget(entry, customIds);
  }
  return out;
}

/**
 * Category map for the request: only entries some row being sent refers to (the server creates every
 * `create` target it receives, used or not). Rows and entries are matched by normalized key, so
 * "Saúde" and "saude" meet in the same entry.
 */
export function categoryMapForRows(
  preview: Pick<MaxFinPreviewResponse, 'categoryMap'>,
  choices: Readonly<Record<string, MaxFinCategoryTargetInput>>,
  rowsSent: ReadonlyArray<Pick<MaxFinPreviewRow, 'type' | 'categoryKey'>>,
  customIdsByType: Readonly<Record<MaxFinTransactionType, ReadonlySet<string>>>,
): MaxFinCategoryMapInput[] {
  const used = new Set(rowsSent.map((row) => categoryChoiceKey(row.type, row.categoryKey)));
  return preview.categoryMap
    .filter((entry) => used.has(categoryChoiceKey(entry.type, entry.key)))
    .map((entry) => ({ key: entry.key, type: entry.type, target: effectiveCategoryTarget(entry, choices, customIdsByType) }));
}

// ---- Confirm payload (single source for the footer and the request) ---------------------------------------

export interface MaxFinConfirmContext {
  /** The accounts of the household, used to decide whether the invoice can be paid. */
  accounts: readonly MaxFinAccountRef[];
  customIdsByType: Readonly<Record<MaxFinTransactionType, ReadonlySet<string>>>;
}

export interface MaxFinConfirmTotals {
  /** Rows that will be sent. */
  count: number;
  incomeCount: number;
  /** Sum of the INCOME rows (receitas). */
  incomeTotal: number;
  expenseCount: number;
  /** Sum of the EXPENSE rows (despesas). */
  expenseTotal: number;
  /** Stored transactions that will be replaced: ticked `changed`, `replaces-future` and `matches-recurring` rows. */
  replacements: number;
  /** Of those, the ticked rows that take a recurrence over (`matches-recurring`). */
  recurring: number;
  invoice: MaxFinInvoiceSelection;
}

export interface MaxFinBuiltConfirm {
  /** Null while the month is unknown (the request needs it). */
  payload: MaxFinConfirmRequest | null;
  rowsSent: MaxFinPreviewRow[];
  totals: MaxFinConfirmTotals;
}

/**
 * Builds what confirm sends AND the numbers the footer shows, from the same rows, so they cannot diverge.
 * Options come from the preview (the server echo). Duplicates and unknown statuses are filtered out here.
 */
export function buildConfirmPayload(
  preview: MaxFinPreviewResponse,
  selected: Readonly<Record<string, boolean>>,
  categoryChoices: Readonly<Record<string, MaxFinCategoryTargetInput>>,
  context: MaxFinConfirmContext,
): MaxFinBuiltConfirm {
  const rowsSent = selectRowsToSend(preview.rows, selected);
  let incomeCents = 0;
  let expenseCents = 0;
  let incomeCount = 0;
  let expenseCount = 0;
  let replacements = 0;
  let recurring = 0;
  for (const row of rowsSent) {
    if (row.type === 'INCOME') {
      incomeCents += toCents(row.amount);
      incomeCount += 1;
    } else {
      expenseCents += toCents(row.amount);
      expenseCount += 1;
    }
    if (replacesStoredData(row.status)) replacements += 1;
    if (row.status === 'matches-recurring') recurring += 1;
  }
  // Derived from the very rows that are sent, so the invoice line and the request cannot disagree.
  const invoice = invoiceForRows(rowsSent, preview.options, {
    sourceAccountId: preview.invoice?.sourceAccountId ?? preview.accounts.bills,
    creditAccountId: preview.invoice?.creditAccountId ?? preview.accounts.credit,
    accounts: context.accounts,
    alreadyPaid: preview.invoice?.alreadyPaid === true,
    // An absent invoice counts as none: nothing is promised unless the server sent one.
    hasInvoice: Boolean(preview.invoice),
  });
  const payload: MaxFinConfirmRequest | null = preview.month
    ? {
        month: preview.month,
        accounts: preview.accounts,
        options: preview.options,
        categoryMap: categoryMapForRows(preview, categoryChoices, rowsSent, context.customIdsByType),
        rows: rowsSent.map(toConfirmRow),
      }
    : null;
  return {
    payload,
    rowsSent,
    totals: {
      count: rowsSent.length,
      incomeCount,
      incomeTotal: incomeCents / 100,
      expenseCount,
      expenseTotal: expenseCents / 100,
      replacements,
      recurring,
      invoice,
    },
  };
}

export interface MaxFinConfirmBlocker {
  code: 'no-month' | 'none-selected' | 'too-many' | 'needs-refresh';
  message: string;
}

/**
 * Why Confirm must stay disabled (client side checks of the confirm limits); null when it can go.
 * `needsRefresh` (a confirm failed and the preview was not refreshed since) is required on purpose:
 * a caller that forgets it would let a stale preview be confirmed again.
 */
export function confirmBlocker(built: MaxFinBuiltConfirm | null, needsRefresh: boolean): MaxFinConfirmBlocker | null {
  // A failed confirm may have stored part of the rows: the preview on screen is stale until it is run again.
  if (needsRefresh) return { code: 'needs-refresh', message: 'Atualize a pré-visualização antes de confirmar de novo.' };
  if (!built || !built.payload) {
    return { code: 'no-month', message: 'Informe o mês de referência antes de confirmar.' };
  }
  const count = built.rowsSent.length;
  if (count === 0) return { code: 'none-selected', message: 'Selecione ao menos uma transação.' };
  if (count > MAXFIN_MAX_ROWS) {
    return {
      code: 'too-many',
      message: `Selecione no máximo ${MAXFIN_MAX_ROWS} linhas por vez: desmarque algumas (${count} selecionadas).`,
    };
  }
  return null;
}

// ---- Result of a confirmed import -------------------------------------------------------------------------

/** Toast text after a confirmed import; zero-valued parts are omitted. */
export function buildConfirmSummary(result: MaxFinConfirmResponse, formatAmount: (value: number) => string): string {
  const parts: string[] = [countLabel(result.imported, 'transação importada', 'transações importadas')];
  if (result.replaced > 0) parts.push(countLabel(result.replaced, 'substituída', 'substituídas'));
  const consumed = result.consumedFutureInstallments ?? 0;
  if (consumed > 0) parts.push(countLabel(consumed, 'parcela futura substituída', 'parcelas futuras substituídas'));
  const assumed = result.assumedRecurring ?? 0;
  if (assumed > 0) parts.push(`assumiu ${countLabel(assumed, 'recorrente', 'recorrentes')}`);
  const created = result.createdCategories?.length ?? 0;
  if (created > 0) parts.push(countLabel(created, 'categoria criada', 'categorias criadas'));
  if (result.futureInstallments > 0) {
    parts.push(countLabel(result.futureInstallments, 'parcela futura', 'parcelas futuras'));
  }
  if (result.invoicePayment) parts.push(`fatura de ${formatAmount(result.invoicePayment.amount)} registrada`);
  if (result.skipped > 0) parts.push(countLabel(result.skipped, 'linha ignorada', 'linhas ignoradas'));

  let text = `${parts.join(', ')}.`;
  const warnings = result.warnings?.length ?? 0;
  if (warnings > 0) text += ` ${countLabel(warnings, 'aviso', 'avisos')}.`;
  return text;
}

/** The dialog stays open on a result step when there is something to read: warnings, skipped rows, consumed installments. */
export function confirmResultNeedsReview(
  result: Pick<MaxFinConfirmResponse, 'warnings' | 'skipped' | 'consumedFutureInstallments'>,
): boolean {
  return (result.warnings?.length ?? 0) > 0 || result.skipped > 0 || (result.consumedFutureInstallments ?? 0) > 0;
}

export const PARTIAL_IMPORT_NOTICE =
  'A importação pode ter sido parcial: atualize a pré-visualização para ver o que já foi importado (as linhas já importadas aparecem como duplicadas). O pagamento da fatura só soma as linhas importadas na mesma confirmação: confira a fatura do mês.';

/** Error text for a failed confirm: the reason plus the warning that part of the rows may already be stored. */
export function confirmFailureMessage(reason: string): string {
  const head = reason.trim() || 'Não foi possível confirmar a importação.';
  return `${/[.!?]$/.test(head) ? head : `${head}.`} ${PARTIAL_IMPORT_NOTICE}`;
}

// ---- Remembered choices (pure part of the localStorage helpers) -------------------------------------------

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    // Corrupted value: behave as if nothing was saved.
    return {};
  }
}

function isCategoryTarget(value: unknown): value is MaxFinCategoryTargetInput {
  if (!value || typeof value !== 'object') return false;
  const t = value as { kind?: unknown; categoryName?: unknown; categoryId?: unknown; name?: unknown };
  switch (t.kind) {
    case 'system':
      return typeof t.categoryName === 'string';
    case 'custom':
      return typeof t.categoryId === 'string';
    case 'create':
      return typeof t.name === 'string';
    case 'default':
      return true;
    default:
      return false;
  }
}

/**
 * Saved category choices of one household (`{ [householdId]: { [categoryChoiceKey]: target } }` is stored);
 * anything malformed is dropped. Households never see each other's choices.
 */
export function parseSavedCategoryChoices(
  raw: string | null | undefined,
  householdId: string,
): Record<string, MaxFinCategoryTargetInput> {
  const out: Record<string, MaxFinCategoryTargetInput> = {};
  const own = parseJsonObject(raw)[householdId];
  if (!own || typeof own !== 'object' || Array.isArray(own)) return out;
  for (const [key, target] of Object.entries(own as Record<string, unknown>)) {
    if (isCategoryTarget(target)) out[key] = target;
  }
  return out;
}

/** JSON to store after merging `choices` into the household's saved ones; a corrupt stored value starts over. */
export function mergeSavedCategoryChoices(
  raw: string | null | undefined,
  householdId: string,
  choices: Readonly<Record<string, MaxFinCategoryTargetInput>>,
): string {
  return JSON.stringify({
    ...parseJsonObject(raw),
    [householdId]: { ...parseSavedCategoryChoices(raw, householdId), ...choices },
  });
}

/** Last destination accounts of one household (`{ [householdId]: MaxFinAccountsInput }` is stored). */
export function parseSavedAccountIds(raw: string | null | undefined, householdId: string): Partial<MaxFinAccountsInput> {
  const own = parseJsonObject(raw)[householdId];
  if (!own || typeof own !== 'object' || Array.isArray(own)) return {};
  const out: Partial<MaxFinAccountsInput> = {};
  for (const key of MAXFIN_SECTION_ORDER) {
    const value = (own as Record<string, unknown>)[key];
    if (typeof value === 'string' && value) out[key] = value;
  }
  return out;
}

/** JSON to store after saving `ids` for the household; a corrupt stored value starts over from `{}`. */
export function mergeSavedAccountIds(raw: string | null | undefined, householdId: string, ids: MaxFinAccountsInput): string {
  return JSON.stringify({ ...parseJsonObject(raw), [householdId]: ids });
}

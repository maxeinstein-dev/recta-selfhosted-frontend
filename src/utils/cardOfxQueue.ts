/**
 * Card invoices imported as a queue: the default plan for a file ("apply the default to the rest"), the notice
 * for a card with no closing day, and the totals of the final summary. Pure, like cardOfx.ts.
 */
import {
  buildCardOfxConfirm, buildCardOfxSections, cardOfxConfirmBlocker, isPaymentActionable, paymentNeedsSource, reconcileGroupSelection,
} from './cardOfx';
import type { CardOfxBuiltConfirm, CardOfxConfirmContext } from './cardOfx';
import { countLabel, resolveCategoryChoices } from './maxfinPayload';
import type { CardOfxConfirmResponse, CardOfxPreviewResponse } from '../hooks/api/useImportCardOfx';
import type { MaxFinCategoryTargetInput } from '../hooks/api/useImportMaxFin';

// ---- Default plan -----------------------------------------------------------------------------------------

export const QUEUE_PAYMENT_SOURCE_MISSING =
  'O pagamento da fatura anterior precisa de uma conta de origem: escolha a conta no topo da fila.';

export type CardDefaultPlan =
  | { ok: true; built: CardOfxBuiltConfirm }
  | { ok: false; code: 'payment-source' | 'nothing-to-do' | 'blocker'; reason: string };

/**
 * What "apply the default" sends for a preview: the groups the server marks (never an ambiguous one or one this
 * client cannot send), the suggested categories (or the household's remembered ones), and the payment of the
 * previous invoice when there is one to apply, from the account chosen once for the queue. It says why the file
 * cannot go on when the confirm would be blocked or the payment needs a source account that was not chosen.
 */
export function planCardDefaultApply(
  preview: CardOfxPreviewResponse,
  context: CardOfxConfirmContext,
  options: { sourceAccountId: string; savedChoices?: Readonly<Record<string, MaxFinCategoryTargetInput>> },
): CardDefaultPlan {
  const groups = buildCardOfxSections(preview).groups;
  const selection = reconcileGroupSelection([], {}, groups);
  const choices = resolveCategoryChoices(preview.categoryMap ?? [], {}, options.savedChoices ?? {}, context.customIdsByType);
  const payment = preview.payment ?? null;
  const apply = isPaymentActionable(payment);
  if (apply && paymentNeedsSource(payment) && !options.sourceAccountId) {
    return { ok: false, code: 'payment-source', reason: QUEUE_PAYMENT_SOURCE_MISSING };
  }
  const sourceAccountId = apply && paymentNeedsSource(payment) ? options.sourceAccountId : '';
  const built = buildCardOfxConfirm(preview, selection, choices, { apply, sourceAccountId }, context);
  const blocker = cardOfxConfirmBlocker(built, false);
  if (blocker) return { ok: false, code: blocker.code === 'nothing-to-do' ? 'nothing-to-do' : 'blocker', reason: blocker.message };
  return { ok: true, built };
}

// ---- Warnings of the preview --------------------------------------------------------------------------------

/** The server's own warning that the card has no closing day (the dialog shows its own notice for it). */
export const isClosingDayServerWarning = (warning: string): boolean => /não tem dia de fechamento configurado/.test(warning);

/** Warnings to list: the server one about the closing day is left out while the dialog's notice is on screen. */
export function visibleCardWarnings(warnings: readonly string[], noticeShown: boolean): string[] {
  return noticeShown ? warnings.filter((w) => !isClosingDayServerWarning(w)) : [...warnings];
}

// ---- Closing day ------------------------------------------------------------------------------------------

export const NO_CLOSING_DAY_NOTICE =
  'Este cartão não tem dia de fechamento: o mês da fatura segue o mês do calendário. Para definir o dia, edite a conta do cartão (campo Dia de fechamento).';

/** The card has no closing day (absent, null or 0): the invoice month follows the calendar month. */
export function lacksClosingDay(account: { closingDay?: number | null } | null | undefined): boolean {
  return !!account && !(typeof account.closingDay === 'number' && account.closingDay >= 1 && account.closingDay <= 31);
}

// ---- Final summary ----------------------------------------------------------------------------------------

export interface CardQueueTotals {
  enriched: number;
  /** Sheet rows deleted by merges. */
  absorbedRows: number;
  consumedFutures: number;
  created: number;
  futureInstallments: number;
  reversalsImported: number;
  payments: number;
  createdCategories: number;
  skippedProposals: number;
  warnings: number;
}

export function sumCardOfxResults(results: ReadonlyArray<CardOfxConfirmResponse>): CardQueueTotals {
  const totals: CardQueueTotals = {
    enriched: 0, absorbedRows: 0, consumedFutures: 0, created: 0, futureInstallments: 0, reversalsImported: 0, payments: 0, createdCategories: 0,
    skippedProposals: 0, warnings: 0,
  };
  for (const r of results) {
    totals.enriched += r.enriched ?? 0;
    totals.absorbedRows += r.absorbedRows ?? 0;
    totals.consumedFutures += r.consumedFutures ?? 0;
    totals.created += r.created ?? 0;
    totals.futureInstallments += r.futureInstallments ?? 0;
    totals.reversalsImported += r.reversalsImported ?? 0;
    totals.payments += r.payment ? 1 : 0;
    totals.createdCategories += r.createdCategories?.length ?? 0;
    totals.skippedProposals += r.skipped ?? 0;
    totals.warnings += r.warnings?.length ?? 0;
  }
  return totals;
}

/** One line for the whole queue; zero-valued parts are left out. */
export function cardQueueTotalsLine(totals: CardQueueTotals): string {
  const parts: string[] = [];
  if (totals.enriched > 0) parts.push(countLabel(totals.enriched, 'lançamento enriquecido', 'lançamentos enriquecidos'));
  if (totals.absorbedRows > 0) parts.push(countLabel(totals.absorbedRows, 'lançamento absorvido', 'lançamentos absorvidos'));
  if (totals.consumedFutures > 0) parts.push(countLabel(totals.consumedFutures, 'parcela futura consumida', 'parcelas futuras consumidas'));
  if (totals.created > 0) parts.push(countLabel(totals.created, 'transação criada', 'transações criadas'));
  if (totals.futureInstallments > 0) parts.push(countLabel(totals.futureInstallments, 'parcela futura gerada', 'parcelas futuras geradas'));
  if (totals.reversalsImported > 0) parts.push(countLabel(totals.reversalsImported, 'compra/estorno importado', 'compras/estornos importados'));
  if (totals.payments > 0) parts.push(countLabel(totals.payments, 'pagamento registrado ou ajustado', 'pagamentos registrados ou ajustados'));
  if (totals.createdCategories > 0) parts.push(countLabel(totals.createdCategories, 'categoria criada', 'categorias criadas'));
  if (totals.skippedProposals > 0) parts.push(countLabel(totals.skippedProposals, 'proposta ignorada', 'propostas ignoradas'));
  if (totals.warnings > 0) parts.push(countLabel(totals.warnings, 'aviso', 'avisos'));
  return parts.length > 0 ? parts.join(', ') : 'nada foi alterado';
}

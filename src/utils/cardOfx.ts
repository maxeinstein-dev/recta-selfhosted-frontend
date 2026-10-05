/**
 * Pure logic of the card invoice (.ofx) import: file checks, the sections of the preview, the selection by group,
 * the payment decision, the confirm payload and the numbers shown next to it (one source for both), the blocker
 * and the result texts. Like maxfinPayload.ts: no React, no axios and no `import.meta`, so it also runs under `tsx`.
 * Types come from the hook modules through type-only imports (erased at runtime).
 */
import { AccountType } from '../lib/enums';
import { categoryChoiceKey, countLabel, effectiveCategoryTarget, toCents, toSignedCents } from './maxfinPayload';
import type {
  MaxFinCategoryMapEntry, MaxFinCategoryMapInput, MaxFinCategoryTargetInput, MaxFinTransactionType,
} from '../hooks/api/useImportMaxFin';
import type {
  CardOfxConfirmLine, CardOfxConfirmRequest, CardOfxConfirmResponse, CardOfxLine, CardOfxPayment, CardOfxPaymentDecision,
  CardOfxPreviewResponse, CardOfxProposal, CardOfxProposalKind, CardOfxSheetOnly,
} from '../hooks/api/useImportCardOfx';

// ---- Limits (of the upload and of the confirm endpoint) ---------------------------------------------------

export const CARD_OFX_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const CARD_OFX_MAX_LINES = 1000;

// ---- File and entry points --------------------------------------------------------------------------------

const MB = 1024 * 1024;

/** Size shown to the user, rounded UP to one decimal so a file over the limit never reads as the limit itself. */
function sizeLabel(bytes: number): string {
  return `${(Math.ceil((bytes / MB) * 10 - 1e-9) / 10).toFixed(1).replace('.', ',')} MB`;
}

/** Case-insensitive. */
export function isOfxFileName(name: string): boolean {
  return name.toLowerCase().endsWith('.ofx');
}

/** Message when the file cannot be uploaded (not .ofx, or over the 5 MB limit); null when it is fine. */
export function validateCardOfxFile(file: { name: string; size: number }): string | null {
  if (!isOfxFileName(file.name)) return 'Formato inválido. Envie a fatura do cartão exportada como .ofx.';
  if (file.size > CARD_OFX_MAX_FILE_BYTES) {
    return `Arquivo muito grande (${sizeLabel(file.size)}). O limite é ${CARD_OFX_MAX_FILE_BYTES / MB} MB.`;
  }
  return null;
}

/**
 * The generic "Importar" hands a .ofx of a credit card account to the card invoice flow: the raw statement
 * import would record every line again and duplicate what came from the monthly sheet.
 */
export function isCardOfxHandoff(accountType: string | null | undefined, fileName: string): boolean {
  return accountType === AccountType.CREDIT && isOfxFileName(fileName);
}

// ---- Proposal kinds ---------------------------------------------------------------------------------------

/** Where a group is shown. `other`: a kind this client does not know (shown, never sent). */
export type CardOfxGroupSection = 'matched' | 'futures' | 'new' | 'reversal' | 'other';

const KIND_SECTION: Record<CardOfxProposalKind, Exclude<CardOfxGroupSection, 'other'>> = {
  'enrich-exact': 'matched',
  'enrich-plan': 'matched',
  'enrich-sum': 'matched',
  'consume-future': 'futures',
  create: 'new',
  reversal: 'reversal',
};

export const PROPOSAL_KIND_LABEL: Record<CardOfxProposalKind, string> = {
  'enrich-exact': 'exata',
  'enrich-plan': 'plano antecipado',
  'enrich-sum': 'soma',
  'consume-future': 'parcela futura',
  create: 'nova',
  reversal: 'compra e estorno',
};

export function isKnownProposalKind(kind: string): kind is CardOfxProposalKind {
  return Object.prototype.hasOwnProperty.call(KIND_SECTION, kind);
}

export function proposalSection(kind: string): CardOfxGroupSection {
  return isKnownProposalKind(kind) ? KIND_SECTION[kind] : 'other';
}

// ---- Amounts ----------------------------------------------------------------------------------------------

/** Integer cents with the direction of the invoice: EXPENSE adds, INCOME (refund, discount, credit) subtracts. */
export function signedCents(amount: number, type: string): number {
  return type === 'INCOME' ? -toCents(amount) : toCents(amount);
}

function sumSignedCents(items: ReadonlyArray<{ amount: number; type: string }>): number {
  return items.reduce((sum, item) => sum + signedCents(item.amount, item.type), 0);
}

// ---- Sections of the preview ------------------------------------------------------------------------------

export interface CardOfxGroupView {
  proposal: CardOfxProposal;
  section: CardOfxGroupSection;
  /** Lines of the group, in statement order. */
  lines: CardOfxLine[];
  /** Refs of the proposal missing from the lines (confirm would reject the group). */
  missingRefs: string[];
  /** Can be sent: a known kind, at least one ref, every ref among the lines, the first proposal with its id. */
  sendable: boolean;
  /** Net of the lines in integer cents (purchases minus credits). */
  netCents: number;
  /** A payment line is in the group (an advance payment paired with a credit row of the sheet). */
  hasPayment: boolean;
}

export interface CardOfxSections {
  /** Every proposal, in the order of the server. */
  groups: CardOfxGroupView[];
  matched: CardOfxGroupView[];
  futures: CardOfxGroupView[];
  created: CardOfxGroupView[];
  reversal: CardOfxGroupView[];
  other: CardOfxGroupView[];
  /** Lines already in Recta and in no proposal. */
  reconciled: CardOfxLine[];
  /** The "Pagamento recebido" line that pays the previous invoice (`payment.ref`). */
  paymentLine: CardOfxLine | null;
  /** Other payment lines in no proposal: advance payments, information only in this phase. */
  advancePayments: CardOfxLine[];
  /** Advance payments paired with a credit row of the sheet (they sit in an enrich group). */
  pairedAdvancePayments: CardOfxLine[];
  /** Lines in no proposal and of no known status (shown so nothing is hidden). */
  orphans: CardOfxLine[];
  sheetOnly: CardOfxSheetOnly[];
}

/** Groups and lines of the preview by section. Proposals point to lines through `refs`. */
export function buildCardOfxSections(
  preview: Pick<CardOfxPreviewResponse, 'lines' | 'proposals' | 'sheetOnly' | 'payment'>,
): CardOfxSections {
  const indexByRef = new Map<string, number>();
  preview.lines.forEach((line, index) => {
    if (!indexByRef.has(line.ref)) indexByRef.set(line.ref, index);
  });
  const paymentRef = preview.payment?.ref ?? null;
  const claimed = new Set<string>();
  const seenIds = new Set<string>();
  const groups: CardOfxGroupView[] = preview.proposals.map((proposal) => {
    const indexes = new Set<number>();
    const missingRefs: string[] = [];
    for (const ref of proposal.refs ?? []) {
      const index = indexByRef.get(ref);
      if (index === undefined) missingRefs.push(ref);
      else indexes.add(index);
    }
    const lines = [...indexes].sort((a, b) => a - b).map((index) => preview.lines[index]);
    for (const line of lines) claimed.add(line.ref);
    const repeated = seenIds.has(proposal.group);
    seenIds.add(proposal.group);
    const section = proposalSection(proposal.kind);
    return {
      proposal,
      section,
      lines,
      missingRefs,
      sendable: section !== 'other' && !!proposal.group && lines.length > 0 && missingRefs.length === 0 && !repeated,
      netCents: sumSignedCents(lines),
      hasPayment: lines.some((line) => line.kind === 'payment'),
    };
  });

  const sections: CardOfxSections = {
    groups,
    matched: groups.filter((g) => g.section === 'matched'),
    futures: groups.filter((g) => g.section === 'futures'),
    created: groups.filter((g) => g.section === 'new'),
    reversal: groups.filter((g) => g.section === 'reversal'),
    other: groups.filter((g) => g.section === 'other'),
    reconciled: [],
    paymentLine: null,
    advancePayments: [],
    pairedAdvancePayments: [],
    orphans: [],
    sheetOnly: preview.sheetOnly ?? [],
  };
  for (const line of preview.lines) {
    if (line.ref === paymentRef) {
      if (!sections.paymentLine) sections.paymentLine = line;
      continue;
    }
    if (claimed.has(line.ref)) {
      if (line.kind === 'payment') sections.pairedAdvancePayments.push(line);
      continue;
    }
    if (line.status === 'reconciled') sections.reconciled.push(line);
    else if (line.kind === 'payment') sections.advancePayments.push(line);
    else sections.orphans.push(line);
  }
  return sections;
}

// ---- Selection by group -----------------------------------------------------------------------------------

/** group id -> ticked. A group goes in with all of its lines: there is no selection per line. */
export type CardOfxSelection = Record<string, boolean>;

/** Ticked by default: what the server marks, never an ambiguous proposal, never one this client cannot send. */
export function defaultGroupSelected(group: Pick<CardOfxGroupView, 'proposal' | 'sendable'>): boolean {
  return group.sendable && group.proposal.defaultSelected === true && group.proposal.ambiguous !== true;
}

export function isGroupSelected(selection: Readonly<CardOfxSelection>, group: Pick<CardOfxGroupView, 'proposal' | 'sendable'>): boolean {
  return group.sendable && selection[group.proposal.group] === true;
}

const proposalSignature = (p: Pick<CardOfxProposal, 'kind' | 'defaultSelected' | 'ambiguous'>): string =>
  `${p.kind}|${p.defaultSelected === true}|${p.ambiguous === true}`;

/**
 * Selection after a preview (re-)run: a group that is still there with the same kind and defaults keeps the
 * choice of the user; any other group gets its default; groups that cannot be sent are never ticked.
 */
export function reconcileGroupSelection(
  prevProposals: ReadonlyArray<Pick<CardOfxProposal, 'group' | 'kind' | 'defaultSelected' | 'ambiguous'>>,
  prevSelection: Readonly<CardOfxSelection>,
  nextGroups: ReadonlyArray<Pick<CardOfxGroupView, 'proposal' | 'sendable'>>,
): CardOfxSelection {
  const prev = new Map(prevProposals.map((p) => [p.group, proposalSignature(p)]));
  const next: CardOfxSelection = {};
  for (const group of nextGroups) {
    const id = group.proposal.group;
    if (Object.prototype.hasOwnProperty.call(next, id)) continue;
    if (!group.sendable) {
      next[id] = false;
      continue;
    }
    const keep = prev.get(id) === proposalSignature(group.proposal) && Object.prototype.hasOwnProperty.call(prevSelection, id);
    next[id] = keep ? prevSelection[id] === true : defaultGroupSelected(group);
  }
  return next;
}

/** Ticks or unticks one group (a group that cannot be sent stays unticked). */
export function setGroupSelected(
  selection: Readonly<CardOfxSelection>,
  group: Pick<CardOfxGroupView, 'proposal' | 'sendable'>,
  checked: boolean,
): CardOfxSelection {
  return { ...selection, [group.proposal.group]: group.sendable && checked };
}

/** "Marcar todas": every group that can be sent, except ambiguous ones (those are ticked one by one). */
export function selectAllGroups(
  selection: Readonly<CardOfxSelection>,
  groups: ReadonlyArray<Pick<CardOfxGroupView, 'proposal' | 'sendable'>>,
): CardOfxSelection {
  const next = { ...selection };
  for (const group of groups) if (group.sendable && group.proposal.ambiguous !== true) next[group.proposal.group] = true;
  return next;
}

/** "Desmarcar todas". */
export function clearGroups(
  selection: Readonly<CardOfxSelection>,
  groups: ReadonlyArray<Pick<CardOfxGroupView, 'proposal'>>,
): CardOfxSelection {
  const next = { ...selection };
  for (const group of groups) next[group.proposal.group] = false;
  return next;
}

// ---- Payment of the previous invoice ----------------------------------------------------------------------

export interface CardOfxPaymentChoice {
  /** The checkbox of the payment block. */
  apply: boolean;
  /** Account the payment comes from: only used (and required) when `paymentNeedsSource`. */
  sourceAccountId: string;
}

/**
 * The payment needs a source account chosen by the user: a payment to create, and an adjustment whose recorded
 * payment has no source account (the server answers 400 for that one without it; with a recorded account it
 * reuses that one).
 */
export function paymentNeedsSource(payment: Pick<CardOfxPayment, 'proposal' | 'recorded'> | null | undefined): boolean {
  if (payment?.proposal === 'create') return true;
  return payment?.proposal === 'adjust' && !payment.recorded?.sourceAccountId;
}

/** adjust and create are the only proposals there is something to apply for ('ok' or an unknown value: nothing). */
export function isPaymentActionable(payment: Pick<CardOfxPayment, 'proposal'> | null | undefined): boolean {
  return payment?.proposal === 'adjust' || payment?.proposal === 'create';
}

/** Ticked by default when there is something to apply; the source account starts empty (an explicit choice). */
export function defaultPaymentChoice(payment: Pick<CardOfxPayment, 'proposal'> | null | undefined): CardOfxPaymentChoice {
  return { apply: isPaymentActionable(payment), sourceAccountId: '' };
}

/**
 * Choice after a preview (re-)run: the tick stays while the payment line and its proposal are the same; the
 * source account the user picked is always kept (it only matters for `create`).
 */
export function reconcilePaymentChoice(
  prevPayment: Pick<CardOfxPayment, 'ref' | 'proposal'> | null | undefined,
  prevChoice: CardOfxPaymentChoice,
  nextPayment: Pick<CardOfxPayment, 'ref' | 'proposal'> | null | undefined,
): CardOfxPaymentChoice {
  const same = !!prevPayment && !!nextPayment && prevPayment.ref === nextPayment.ref && prevPayment.proposal === nextPayment.proposal;
  return {
    apply: isPaymentActionable(nextPayment) && (same ? prevChoice.apply : true),
    sourceAccountId: prevChoice.sourceAccountId,
  };
}

/** What confirm receives: `sourceAccountId` only when the payment is applied and needs a source account. */
export function paymentDecision(
  payment: Pick<CardOfxPayment, 'proposal' | 'recorded'> | null | undefined,
  choice: CardOfxPaymentChoice,
): CardOfxPaymentDecision | null {
  if (payment?.proposal !== 'adjust' && payment?.proposal !== 'create') return null;
  if (!choice.apply) return { apply: false };
  return paymentNeedsSource(payment) ? { apply: true, sourceAccountId: choice.sourceAccountId } : { apply: true };
}

export const PAYMENT_SOURCE_PROBLEM = {
  missing: 'Escolha a conta de origem do pagamento da fatura anterior (ou desmarque o pagamento).',
  notFound: 'A conta de origem do pagamento não foi encontrada: escolha outra.',
  isCard: 'A conta de origem do pagamento não pode ser um cartão de crédito.',
  inactive: 'A conta de origem do pagamento está inativa: escolha outra.',
} as const;

export interface CardOfxAccountRef {
  id: string;
  type: string;
  /** Inactive accounts cannot pay; absent counts as active. */
  isActive?: boolean;
}

/** Why the chosen account cannot pay the invoice; null when it can. */
export function paymentSourceProblem(sourceAccountId: string, accounts: readonly CardOfxAccountRef[]): string | null {
  if (!sourceAccountId) return PAYMENT_SOURCE_PROBLEM.missing;
  const account = accounts.find((a) => a.id === sourceAccountId);
  if (!account) return PAYMENT_SOURCE_PROBLEM.notFound;
  if (account.type === AccountType.CREDIT) return PAYMENT_SOURCE_PROBLEM.isCard;
  if (account.isActive === false) return PAYMENT_SOURCE_PROBLEM.inactive;
  return null;
}

/** Accounts the payment can come from: every active account that is not a credit card (the card itself included). */
export function paymentSourceAccounts<T extends CardOfxAccountRef>(accounts: readonly T[]): T[] {
  return accounts.filter((a) => a.type !== AccountType.CREDIT && a.isActive !== false);
}

// ---- Category map -----------------------------------------------------------------------------------------

/**
 * Category map for the request: only the merchants of the ticked create proposals (the server creates every
 * `create` target it receives, used or not). Lines and entries meet by type and normalized key, like the
 * monthly sheet; the choices are the ones the sheet importer remembers for the household.
 */
export function categoryMapForCreates(
  categoryMap: readonly MaxFinCategoryMapEntry[],
  selectedCreates: ReadonlyArray<Pick<CardOfxGroupView, 'lines'>>,
  choices: Readonly<Record<string, MaxFinCategoryTargetInput>>,
  customIdsByType: Readonly<Record<MaxFinTransactionType, ReadonlySet<string>>>,
): MaxFinCategoryMapInput[] {
  const used = new Set<string>();
  for (const group of selectedCreates) {
    for (const line of group.lines) used.add(categoryChoiceKey(line.type, line.merchant));
  }
  return categoryMap
    .filter((entry) => used.has(categoryChoiceKey(entry.type, entry.key)))
    .map((entry) => ({ key: entry.key, type: entry.type, target: effectiveCategoryTarget(entry, choices, customIdsByType) }));
}

// ---- Confirm payload (single source for the numbers on screen and the request) ----------------------------

/** A preview line as confirm takes it back: the statement fields, without status and group. */
export function toConfirmLine(line: CardOfxLine): CardOfxConfirmLine {
  return {
    ref: line.ref,
    fitid: line.fitid,
    date: line.date,
    amount: line.amount,
    type: line.type,
    kind: line.kind,
    memo: line.memo,
    merchant: line.merchant,
    installment: line.installment ? { number: line.installment.number, total: line.installment.total } : null,
  };
}

export interface CardOfxConfirmContext {
  /** The accounts of the household, used to check the source account of a payment. */
  accounts: readonly CardOfxAccountRef[];
  customIdsByType: Readonly<Record<MaxFinTransactionType, ReadonlySet<string>>>;
}

export interface CardOfxKindTotals {
  /** Ticked groups of the kind. */
  groups: number;
  /** OFX lines they cover. */
  lines: number;
  /** Net of those lines, integer cents (purchases minus credits). */
  cents: number;
}

export interface CardOfxTotals {
  /** Groups that will be sent. */
  groups: number;
  enriched: CardOfxKindTotals;
  consumed: CardOfxKindTotals;
  created: CardOfxKindTotals & { futureInstallments: number };
  reversal: CardOfxKindTotals;
  /** Lines already in Recta (payments excluded), at the OFX amounts. */
  reconciled: { lines: number; cents: number };
  /** Card transactions of the month that no OFX line matched (they stay as they are). */
  sheetOnly: { count: number; cents: number };
  /** The statement as the server totals it: purchases minus refunds and discounts, payments excluded. */
  ofxCents: number;
  /**
   * The invoice in Recta after the confirm, on the same basis (payments excluded): the lines already reconciled
   * (at their OFX amounts: the stored amounts are not in the preview), every sheet row and future installment
   * a proposal points to, ticked or not (it exists either way: ticking only links and enriches it), the lines of
   * the ticked create and reversal groups (they become new transactions), and the transactions of the month that
   * no OFX line matched.
   */
  rectaCents: number;
  /** ofxCents − rectaCents. */
  differenceCents: number;
  /** What confirm does to the payment of the previous invoice. */
  payment: { action: 'adjust' | 'create' | null; cents: number };
}

export interface CardOfxBuiltConfirm {
  payload: CardOfxConfirmRequest;
  sections: CardOfxSections;
  /** Groups that will be sent, in the order of the proposals. */
  selected: CardOfxGroupView[];
  totals: CardOfxTotals;
  /** There is something that could be sent at all: a group, or a payment to adjust or create. */
  hasSelectable: boolean;
  /** Why the payment cannot go as chosen; null when it can or when it is not applied. */
  paymentProblem: string | null;
  /** Ticked groups that share an OFX line or a stored transaction with another ticked group. */
  conflicts: string[];
}

const emptyKindTotals = (): CardOfxKindTotals => ({ groups: 0, lines: 0, cents: 0 });

/**
 * Builds what confirm sends AND the numbers the dialog shows, from the same groups, so they cannot diverge.
 * Every line of the preview is echoed (the server recomputes the reconciliation from them); only ticked groups
 * that can be sent go in `selectedGroups`.
 */
export function buildCardOfxConfirm(
  preview: CardOfxPreviewResponse,
  selection: Readonly<CardOfxSelection>,
  categoryChoices: Readonly<Record<string, MaxFinCategoryTargetInput>>,
  paymentChoice: CardOfxPaymentChoice,
  context: CardOfxConfirmContext,
): CardOfxBuiltConfirm {
  const sections = buildCardOfxSections(preview);
  const selected = sections.groups.filter((group) => isGroupSelected(selection, group));

  const enriched = emptyKindTotals();
  const consumed = emptyKindTotals();
  const created = { ...emptyKindTotals(), futureInstallments: 0 };
  const reversal = emptyKindTotals();
  for (const group of selected) {
    const bucket = group.section === 'matched' ? enriched : group.section === 'futures' ? consumed : group.section === 'new' ? created : reversal;
    bucket.groups += 1;
    bucket.lines += group.lines.length;
    bucket.cents += group.netCents;
    if (group.section === 'new') created.futureInstallments += Math.max(0, group.proposal.futureInstallments ?? 0);
  }

  // Ticked groups must not claim the same OFX line or the same stored transaction (e.g. two ambiguous sums).
  const conflicts = new Set<string>();
  const lineOwner = new Map<string, string>();
  const targetOwner = new Map<string, string>();
  const claim = (owners: Map<string, string>, key: string, id: string) => {
    const owner = owners.get(key);
    if (owner === undefined) owners.set(key, id);
    else if (owner !== id) {
      conflicts.add(owner);
      conflicts.add(id);
    }
  };
  for (const group of selected) {
    for (const line of group.lines) claim(lineOwner, line.ref, group.proposal.group);
    const targetId = group.proposal.target?.transactionId;
    if (targetId) claim(targetOwner, targetId, group.proposal.group);
  }

  const reconciledLines = sections.reconciled.filter((line) => line.kind !== 'payment');
  const reconciledCents = sumSignedCents(reconciledLines);
  const targets = new Set<string>();
  let rectaCents = reconciledCents;
  for (const group of sections.groups) {
    // An advance payment paired with a sheet credit: payments are outside the OFX total, so outside this one too.
    if (group.hasPayment) continue;
    if (group.section === 'matched' || group.section === 'futures') {
      const target = group.proposal.target;
      if (target && !targets.has(target.transactionId)) {
        const consumed = group.section === 'futures';
        const ticked = isGroupSelected(selection, group);
        // A future installment left alone belongs to the month of its own date, not to this invoice.
        if (consumed && !ticked && !(target.date >= preview.period.start && target.date <= preview.period.end)) continue;
        targets.add(target.transactionId);
        // Consuming a future writes the bank amount into it; every other target keeps the amount it has.
        const written = consumed && ticked ? group.lines.find((line) => line.type === target.type)?.amount : undefined;
        rectaCents += signedCents(written ?? target.amount, target.type);
      }
    } else if ((group.section === 'new' || group.section === 'reversal') && isGroupSelected(selection, group)) {
      rectaCents += group.netCents;
    }
  }
  const sheetOnly = sections.sheetOnly.filter((row) => !targets.has(row.transactionId));
  const sheetOnlyCents = sumSignedCents(sheetOnly);
  rectaCents += sheetOnlyCents;
  const ofxCents = toSignedCents(preview.ofxTotal);

  const payment = preview.payment ?? null;
  const decision = paymentDecision(payment, paymentChoice);
  const paymentAction = decision?.apply ? (payment?.proposal === 'create' ? 'create' : 'adjust') : null;
  const paymentProblem = paymentNeedsSource(payment) && paymentChoice.apply
    ? paymentSourceProblem(paymentChoice.sourceAccountId, context.accounts)
    : null;

  const payload: CardOfxConfirmRequest = {
    accountId: preview.accountId,
    monthKey: preview.monthKey,
    lines: preview.lines.map(toConfirmLine),
    selectedGroups: selected.map((group) => group.proposal.group),
    categoryMap: categoryMapForCreates(
      preview.categoryMap ?? [],
      selected.filter((group) => group.section === 'new'),
      categoryChoices,
      context.customIdsByType,
    ),
    payment: decision,
  };

  return {
    payload,
    sections,
    selected,
    totals: {
      groups: selected.length,
      enriched,
      consumed,
      created,
      reversal,
      reconciled: { lines: reconciledLines.length, cents: reconciledCents },
      sheetOnly: { count: sheetOnly.length, cents: sheetOnlyCents },
      ofxCents,
      rectaCents,
      differenceCents: ofxCents - rectaCents,
      payment: { action: paymentAction, cents: payment ? toCents(payment.amount) : 0 },
    },
    hasSelectable: sections.groups.some((group) => group.sendable) || isPaymentActionable(payment),
    paymentProblem,
    conflicts: [...conflicts],
  };
}

export interface CardOfxBlocker {
  code: 'needs-refresh' | 'too-many' | 'nothing-to-do' | 'none-selected' | 'conflict' | 'payment-source';
  message: string;
}

/**
 * Why Confirm must stay disabled; null when it can go. `needsRefresh` (a confirm failed and the preview was not
 * refreshed since) is required on purpose: a caller that forgets it would let a stale preview be confirmed again.
 */
export function cardOfxConfirmBlocker(built: CardOfxBuiltConfirm | null, needsRefresh: boolean): CardOfxBlocker | null {
  // A failed confirm may have applied part of the proposals: the preview on screen is stale until it runs again.
  if (needsRefresh) return { code: 'needs-refresh', message: 'Atualize a pré-visualização antes de confirmar de novo.' };
  if (!built) return { code: 'none-selected', message: 'Selecione ao menos uma proposta.' };
  const lineCount = built.payload.lines.length;
  if (lineCount > CARD_OFX_MAX_LINES) {
    return {
      code: 'too-many',
      message: `O arquivo tem ${lineCount} lançamentos: o limite por importação é ${CARD_OFX_MAX_LINES}.`,
    };
  }
  if (!built.hasSelectable) return { code: 'nothing-to-do', message: 'Nada a importar: não há proposta nem pagamento a aplicar.' };
  if (built.selected.length === 0 && built.payload.payment?.apply !== true) {
    return { code: 'none-selected', message: 'Selecione ao menos uma proposta ou o pagamento da fatura anterior.' };
  }
  if (built.conflicts.length > 0) {
    return {
      code: 'conflict',
      message: 'Duas propostas marcadas usam a mesma linha do OFX ou a mesma transação: desmarque uma delas.',
    };
  }
  if (built.paymentProblem) return { code: 'payment-source', message: built.paymentProblem };
  return null;
}

// ---- "Novas" in a month that already has sheet rows -------------------------------------------------------

export interface CardOfxNewLinesNotice {
  /** OFX lines left without a match (the lines of the create proposals) and their net. */
  ofxLines: number;
  ofxCents: number;
  /** Transactions of the month left without a match and their net. */
  sheetRows: number;
  sheetCents: number;
}

/**
 * The server leaves the new lines unticked when the month already has sheet rows (it warns comparing what is
 * left on each side): the same comparison for the "Novas" section. Null when no create proposal comes unticked.
 */
export function newLinesNotice(sections: Pick<CardOfxSections, 'created' | 'sheetOnly'>): CardOfxNewLinesNotice | null {
  if (!sections.created.some((group) => group.sendable && group.proposal.defaultSelected !== true)) return null;
  return {
    ofxLines: sections.created.reduce((sum, group) => sum + group.lines.length, 0),
    ofxCents: sections.created.reduce((sum, group) => sum + group.netCents, 0),
    sheetRows: sections.sheetOnly.length,
    sheetCents: sumSignedCents(sections.sheetOnly),
  };
}

// ---- Labels -----------------------------------------------------------------------------------------------

export function cardOfxMonthSourceLabel(source: string): string {
  switch (source) {
    case 'statement':
      return 'pelo fechamento do extrato';
    case 'override':
      return 'informado manualmente';
    default:
      return '';
  }
}

/** Marker of a credit or payment line; null for a purchase (or a kind this client does not know). */
export function lineKindLabel(kind: string): string | null {
  switch (kind) {
    case 'refund':
      return 'estorno';
    case 'discount':
      return 'desconto';
    case 'payment':
      return 'pagamento';
    default:
      return null;
  }
}

// ---- Result of a confirmed import -------------------------------------------------------------------------

/** One item per thing that changed, for the result step; empty when nothing did. */
export function cardOfxResultLines(
  result: CardOfxConfirmResponse,
  formatAmount: (value: number) => string,
  formatDate: (isoDate: string) => string,
): string[] {
  const lines: string[] = [];
  if (result.enriched > 0) {
    lines.push(countLabel(result.enriched, 'lançamento da planilha enriquecido com os dados do banco', 'lançamentos da planilha enriquecidos com os dados do banco'));
  }
  if (result.consumedFutures > 0) {
    lines.push(countLabel(result.consumedFutures, 'parcela futura substituída pela compra real', 'parcelas futuras substituídas pelas compras reais'));
  }
  const futures = result.futureInstallments > 0
    ? countLabel(result.futureInstallments, 'parcela futura gerada', 'parcelas futuras geradas')
    : null;
  if (result.created > 0) {
    const created = countLabel(result.created, 'transação criada', 'transações criadas');
    lines.push(futures ? `${created}, mais ${countLabel(result.futureInstallments, 'parcela futura', 'parcelas futuras')}` : created);
  } else if (futures) {
    lines.push(futures);
  }
  if (result.reversalsImported > 0) {
    lines.push(countLabel(result.reversalsImported, 'lançamento de compra e estorno importado', 'lançamentos de compra e estorno importados'));
  }
  if (result.payment) {
    const verb = result.payment.action === 'adjusted' ? 'ajustado' : 'registrado';
    lines.push(`Pagamento da fatura anterior ${verb}: ${formatAmount(result.payment.amount)} em ${formatDate(result.payment.date)}`);
  }
  const categories = result.createdCategories ?? [];
  if (categories.length > 0) {
    lines.push(`${countLabel(categories.length, 'categoria criada', 'categorias criadas')}: ${categories.map((c) => c.name).join(', ')}`);
  }
  if (result.skipped > 0) {
    lines.push(countLabel(result.skipped, 'proposta ignorada (mudou desde a pré-visualização)', 'propostas ignoradas (mudaram desde a pré-visualização)'));
  }
  return lines;
}

/** Toast text after a confirmed import; zero-valued parts are omitted. */
export function buildCardOfxSummary(result: CardOfxConfirmResponse, formatAmount: (value: number) => string): string {
  const parts: string[] = [];
  if (result.enriched > 0) parts.push(countLabel(result.enriched, 'lançamento enriquecido', 'lançamentos enriquecidos'));
  if (result.consumedFutures > 0) parts.push(countLabel(result.consumedFutures, 'parcela futura consumida', 'parcelas futuras consumidas'));
  if (result.created > 0) parts.push(countLabel(result.created, 'transação criada', 'transações criadas'));
  if (result.futureInstallments > 0) parts.push(countLabel(result.futureInstallments, 'parcela futura gerada', 'parcelas futuras geradas'));
  if (result.reversalsImported > 0) parts.push(countLabel(result.reversalsImported, 'compra/estorno importado', 'compras/estornos importados'));
  if (result.payment) {
    parts.push(`pagamento ${result.payment.action === 'adjusted' ? 'ajustado' : 'registrado'} (${formatAmount(result.payment.amount)})`);
  }
  const categories = result.createdCategories?.length ?? 0;
  if (categories > 0) parts.push(countLabel(categories, 'categoria criada', 'categorias criadas'));
  if (result.skipped > 0) parts.push(countLabel(result.skipped, 'proposta ignorada', 'propostas ignoradas'));
  let text = parts.length > 0 ? `Fatura importada: ${parts.join(', ')}.` : 'Fatura importada: nada foi alterado.';
  const warnings = result.warnings?.length ?? 0;
  if (warnings > 0) text += ` ${countLabel(warnings, 'aviso', 'avisos')}.`;
  return text;
}

export const CARD_OFX_REFRESH_NOTICE =
  'Atualize a pré-visualização antes de confirmar de novo: o que já tiver sido aplicado aparece como conciliado.';

/** Error text for a failed confirm: the reason plus what to do next. */
export function cardOfxFailureMessage(reason: string): string {
  const head = reason.trim() || 'Não foi possível confirmar a importação.';
  return `${/[.!?]$/.test(head) ? head : `${head}.`} ${CARD_OFX_REFRESH_NOTICE}`;
}

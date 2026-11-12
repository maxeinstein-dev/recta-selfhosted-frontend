/**
 * Pure logic of the shifted-rows realignment of the MaxFin importer: which proposals a preview carries, the default
 * and the coherent selection (`requires`), the decisions confirm sends, the rows a pending block holds back, the counts
 * and texts of the cards, the footer and the result. No React, no axios and no `import.meta`, so it also runs under
 * `tsx`. Types come from the hook module through type-only imports (erased at runtime).
 *
 * Contract (backend maxfin-realign.ts / maxfin-realign.service.ts):
 * - a proposal moves only the `sourceRef` of its transactions; value, date, description and links stay;
 * - `requires` lists proposals that must be applied together with this one: the server skips a proposal whose
 *   requirement was not applied. The requirement runs one way (the upper block lands on lines the lower one vacates);
 * - a block without a decision, unticked, refused or stale is "pending": the server writes none of its refs, so a new
 *   row that sits on one of them is not imported either;
 * - confirm takes at most 50 decisions, 500 moves and 60 removed rows per decision, and |shift| <= 60.
 */
import type {
  MaxFinPreviewRow, MaxFinRealignDecision, MaxFinRealignOutcome, MaxFinRealignProposal,
} from '../hooks/api/useImportMaxFin';
import { realignPlural, realignTextPt } from './maxfinRealignTexts';
import type { MaxFinRealignTextFn } from './maxfinRealignTexts';

export const MAXFIN_MAX_REALIGN_DECISIONS = 50;
export const MAXFIN_MAX_REALIGN_MOVES = 500;
export const MAXFIN_MAX_REALIGN_REMOVED = 60;
export const MAXFIN_MAX_REALIGN_SHIFT = 60;
const MAX_DESCRIPTION = 255;

/** The line number of a sheet ref ('maxfin:2026-09:credit:12' -> '12'); the ref itself when it has no line. */
const lineOfRef = (ref: string): string => {
  const last = ref.split(':').pop() ?? ref;
  return /^\d+$/.test(last) ? last : ref;
};

/** Same labels as MAXFIN_SECTION_LABELS of the hook module (not imported: it pulls axios in). */
const SECTION_LABELS: Record<string, string> = {
  income: 'Entradas',
  bills: 'Contas fixas',
  credit: 'Cartão',
  debit: 'Débito/pix',
};

export const realignSectionLabel = (section: string): string => SECTION_LABELS[section] ?? section;

/** proposal id -> ticked. */
export type MaxFinRealignSelection = Record<string, boolean>;

// ---- Proposals --------------------------------------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * The proposals of a preview, as far as they are usable: an older server sends none; an entry without an id or
 * without moves (nothing to decide on) is dropped, and so is a repeated id.
 */
export function realignProposals(preview: { realignments?: unknown } | null | undefined): MaxFinRealignProposal[] {
  const list = preview?.realignments;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: MaxFinRealignProposal[] = [];
  for (const item of list) {
    if (!isObject(item) || typeof item.id !== 'string' || item.id === '' || seen.has(item.id)) continue;
    if (!Array.isArray(item.moves) || item.moves.length === 0) continue;
    seen.add(item.id);
    const proposal = item as unknown as MaxFinRealignProposal;
    out.push({
      ...proposal,
      removed: Array.isArray(item.removed) ? proposal.removed : [],
      insertedRefs: Array.isArray(item.insertedRefs) ? proposal.insertedRefs : [],
      requires: Array.isArray(item.requires) ? proposal.requires : [],
    });
  }
  return out;
}

/**
 * Why a proposal cannot go in a request (the server validates shape and limits of the whole request: one decision
 * over them would refuse every decision). Such a proposal is never sent and never applied: it stays pending.
 * Null when it can.
 */
export function realignLimitProblem(proposal: MaxFinRealignProposal): 'limits' | null {
  if (!Number.isInteger(proposal.shift) || proposal.shift === 0 || Math.abs(proposal.shift) > MAXFIN_MAX_REALIGN_SHIFT) return 'limits';
  if (proposal.moves.length === 0 || proposal.moves.length > MAXFIN_MAX_REALIGN_MOVES) return 'limits';
  if (proposal.removed.length > MAXFIN_MAX_REALIGN_REMOVED) return 'limits';
  if (proposal.id.length > 120 || proposal.requires.length > MAXFIN_MAX_REALIGN_DECISIONS) return 'limits';
  for (const move of proposal.moves) {
    if (typeof move.transactionId !== 'string' || typeof move.from !== 'string' || typeof move.to !== 'string') return 'limits';
    if (move.verified && !move.sheet) return 'limits';
    if (move.sheet) {
      const { amount, description } = move.sheet;
      if (!(typeof amount === 'number' && Number.isFinite(amount) && amount > 0)) return 'limits';
      if (typeof description !== 'string' || description.length > MAX_DESCRIPTION) return 'limits';
    }
  }
  return null;
}

// ---- Selection --------------------------------------------------------------------------------------------

/** Ticked by default as the server says; an ambiguous proposal never is. */
export function defaultRealignChoice(proposal: Pick<MaxFinRealignProposal, 'defaultSelected' | 'ambiguous'>): boolean {
  return proposal.defaultSelected === true && proposal.ambiguous !== true;
}

/**
 * Makes a selection coherent: a proposal that cannot be applied (limits) or whose requirement is not ticked, or is not
 * among the proposals, is unticked, to a fixpoint. A proposal without an entry takes its default.
 */
export function normalizeRealignSelection(
  proposals: readonly MaxFinRealignProposal[],
  selection: Readonly<MaxFinRealignSelection> | null | undefined,
): MaxFinRealignSelection {
  const chosen: MaxFinRealignSelection = {};
  for (const p of proposals) {
    const own = selection?.[p.id];
    chosen[p.id] = realignLimitProblem(p) === null && (typeof own === 'boolean' ? own : defaultRealignChoice(p));
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of proposals) {
      if (chosen[p.id] && p.requires.some((dep) => chosen[dep] !== true)) {
        chosen[p.id] = false;
        changed = true;
      }
    }
  }
  return chosen;
}

export const defaultRealignSelection = (proposals: readonly MaxFinRealignProposal[]): MaxFinRealignSelection =>
  normalizeRealignSelection(proposals, null);

/** The requirements of a proposal that are not ticked (ids; one that is not among the proposals counts as not ticked). */
export function unmetRequirements(
  proposals: readonly MaxFinRealignProposal[],
  selection: Readonly<MaxFinRealignSelection>,
  id: string,
): string[] {
  const proposal = proposals.find((p) => p.id === id);
  if (!proposal) return [];
  const effective = normalizeRealignSelection(proposals, selection);
  return proposal.requires.filter((dep) => effective[dep] !== true);
}

/** Ids a proposal requires that the preview does not carry: it can never be applied. */
export function missingRequirements(proposals: readonly MaxFinRealignProposal[], id: string): string[] {
  const proposal = proposals.find((p) => p.id === id);
  if (!proposal) return [];
  return proposal.requires.filter((dep) => !proposals.some((p) => p.id === dep));
}

/** Can the proposal be ticked now? Not while a requirement is unticked, nor when it exceeds the limits of a request. */
export function canTickRealign(
  proposals: readonly MaxFinRealignProposal[],
  selection: Readonly<MaxFinRealignSelection>,
  id: string,
): boolean {
  const proposal = proposals.find((p) => p.id === id);
  if (!proposal || realignLimitProblem(proposal) !== null) return false;
  return unmetRequirements(proposals, selection, id).length === 0;
}

/**
 * Selection after ticking or unticking one proposal. Ticking is refused (the selection comes back unchanged) while a
 * requirement is unticked: the user ticks the requirement first, so an ambiguous one is never ticked as a side effect.
 * Unticking also unticks, transitively, every proposal that requires this one.
 */
export function toggleRealign(
  proposals: readonly MaxFinRealignProposal[],
  selection: Readonly<MaxFinRealignSelection>,
  id: string,
  checked: boolean,
): MaxFinRealignSelection {
  const current = normalizeRealignSelection(proposals, selection);
  if (!(id in current)) return current;
  if (checked) {
    if (!canTickRealign(proposals, current, id)) return current;
    return normalizeRealignSelection(proposals, { ...current, [id]: true });
  }
  return normalizeRealignSelection(proposals, { ...current, [id]: false });
}

/** Same moves, same refs: the proposal means the same thing as before. */
function realignSignature(p: MaxFinRealignProposal): string {
  return JSON.stringify([p.shift, p.section, p.moves.map((m) => [m.transactionId, m.from, m.to]), p.removed.map((r) => [r.transactionId, r.from, r.to]), p.requires]);
}

/**
 * Selection after a preview re-run: a proposal that is the same as before keeps the choice of the user, anything else
 * takes its default.
 */
export function reconcileRealignSelection(
  prevProposals: readonly MaxFinRealignProposal[],
  prevSelection: Readonly<MaxFinRealignSelection>,
  nextProposals: readonly MaxFinRealignProposal[],
): MaxFinRealignSelection {
  const before = new Map(prevProposals.map((p) => [p.id, p]));
  const kept: MaxFinRealignSelection = {};
  for (const p of nextProposals) {
    const old = before.get(p.id);
    if (old && realignSignature(old) === realignSignature(p) && typeof prevSelection[p.id] === 'boolean') kept[p.id] = prevSelection[p.id];
  }
  return normalizeRealignSelection(nextProposals, kept);
}

// ---- Rows held back and shifted rows ----------------------------------------------------------------------

/** Every ref the server leaves alone while the block is pending: the `from` and `to` of its moves and removed rows, and the inserted rows. */
function proposalRefs(p: MaxFinRealignProposal): string[] {
  return [...p.moves.flatMap((m) => [m.from, m.to]), ...p.removed.flatMap((r) => [r.from, r.to]), ...p.insertedRefs];
}

/**
 * Refs the server leaves alone while a block is pending: a new row on one of them is not imported, neither is it
 * replaced. Only the proposals not ticked count.
 */
export function pendingRealignRefs(
  proposals: readonly MaxFinRealignProposal[],
  selection: Readonly<MaxFinRealignSelection> | null | undefined,
): Set<string> {
  const effective = normalizeRealignSelection(proposals, selection);
  const refs = new Set<string>();
  for (const p of proposals) if (!effective[p.id]) for (const ref of proposalRefs(p)) refs.add(ref);
  return refs;
}

/** True for a row the sheet only moved (status `shifted`): no checkbox of its own, the block decides. */
export const isShiftedRow = (row: Pick<MaxFinPreviewRow, 'status'>): boolean => (row.status as string) === 'shifted';

/** What a shifted row says about itself: 'Mesmo lançamento que está hoje na linha 3; vai para a linha 5 ao realinhar'; null when no proposal moves it. */
export function shiftedRowDetail(
  row: Pick<MaxFinPreviewRow, 'status' | 'sourceRef'>,
  proposals: readonly MaxFinRealignProposal[],
  tx: MaxFinRealignTextFn = realignTextPt,
): string | null {
  if (!isShiftedRow(row)) return null;
  for (const p of proposals) {
    const move = p.moves.find((m) => m.to === row.sourceRef);
    if (move) return tx('maxfinRealignRowShiftedDetail', { from: lineOfRef(move.from), to: lineOfRef(move.to) });
  }
  return null;
}

export function countShiftedRows(rows: ReadonlyArray<Pick<MaxFinPreviewRow, 'status'>>): number {
  let n = 0;
  for (const row of rows) if (isShiftedRow(row)) n += 1;
  return n;
}

/** The proposal that holds a row back, or null: only a row that could be sent (status new) is ever held. */
export function proposalHoldingRow(
  row: Pick<MaxFinPreviewRow, 'status' | 'sourceRef'>,
  proposals: readonly MaxFinRealignProposal[],
  selection: Readonly<MaxFinRealignSelection>,
): MaxFinRealignProposal | null {
  if (row.status !== 'new' || proposals.length === 0) return null;
  const effective = normalizeRealignSelection(proposals, selection);
  for (const p of proposals) {
    if (effective[p.id]) continue;
    if (proposalRefs(p).includes(row.sourceRef)) return p;
  }
  return null;
}

// ---- Request ----------------------------------------------------------------------------------------------

/**
 * One decision for every proposal that can go in a request, ticked or not (a block without a decision is refused by
 * the server). The proposal is echoed as it came: the server checks it again against the stored data. Proposals over
 * the limits are left out (their block stays pending).
 */
export function buildRealignDecisions(
  proposals: readonly MaxFinRealignProposal[],
  selection: Readonly<MaxFinRealignSelection> | null | undefined,
): MaxFinRealignDecision[] {
  const effective = normalizeRealignSelection(proposals, selection);
  const out: MaxFinRealignDecision[] = [];
  for (const p of proposals) {
    if (realignLimitProblem(p) !== null) continue;
    const decision: MaxFinRealignDecision = {
      id: p.id,
      apply: effective[p.id] === true,
      section: p.section,
      shift: p.shift,
      moves: p.moves.map((m) => ({
        transactionId: m.transactionId,
        from: m.from,
        to: m.to,
        sheetLine: m.sheetLine,
        verified: m.verified,
        sheet: m.sheet
          ? { description: m.sheet.description, type: m.sheet.type, amount: m.sheet.amount, installment: m.sheet.installment }
          : null,
      })),
      requires: [...p.requires],
    };
    if (p.removed.length > 0) decision.removed = p.removed.map((r) => ({ transactionId: r.transactionId, from: r.from, to: r.to }));
    out.push(decision);
  }
  return out;
}

export interface MaxFinRealignTotals {
  /** Proposals of the preview. */
  total: number;
  /** Ticked (and coherent): the decisions with apply true. */
  applied: number;
  /** Not ticked: they stay pending. */
  declined: number;
  /** Transactions the ticked proposals move (moves and removed rows; generated installments come on top at the server). */
  moves: number;
}

export function realignTotals(
  proposals: readonly MaxFinRealignProposal[],
  selection: Readonly<MaxFinRealignSelection> | null | undefined,
): MaxFinRealignTotals {
  const effective = normalizeRealignSelection(proposals, selection);
  const totals: MaxFinRealignTotals = { total: proposals.length, applied: 0, declined: 0, moves: 0 };
  for (const p of proposals) {
    if (effective[p.id]) {
      totals.applied += 1;
      totals.moves += p.moves.length + p.removed.length;
    } else totals.declined += 1;
  }
  return totals;
}

// ---- Texts ------------------------------------------------------------------------------------------------

/** 'Cartão, linhas 12 a 18' */
export function realignRangeLabel(
  p: Pick<MaxFinRealignProposal, 'section' | 'firstLine' | 'lastLine'>,
  tx: MaxFinRealignTextFn = realignTextPt,
): string {
  return tx('maxfinRealignOutcomeLabel', { section: realignSectionLabel(p.section), first: p.firstLine, last: p.lastLine });
}

export interface MaxFinRealignCardView {
  id: string;
  section: string;
  /** 'Cartão' */
  sectionLabel: string;
  /** 'linhas 12 a 18 da planilha' */
  range: string;
  /** '3 lançamentos descem 2 linhas (linhas inseridas acima)' */
  movesText: string;
  /** What leaves the sheet and stays in the ledger (removal); null when nothing. */
  removedText: string | null;
  /** New rows that only enter after this realignment; null when none. */
  insertedText: string | null;
  ambiguous: boolean;
  /** 'Vem desmarcada: ...' for an ambiguous proposal; null otherwise. */
  ambiguousText: string | null;
  /** Labels of the proposals that must be applied together; empty when none. */
  requires: string[];
  /** 'Precisa ser aplicado junto com: ...'; null when none. */
  requiresText: string | null;
  /** The requirements still unticked ('Marque antes: ...'); null when the proposal can be ticked or cannot be for another reason. */
  tickFirstText: string | null;
  /** The preview does not carry a required block, or the proposal is over the limits of a request. */
  unavailableText: string | null;
  checked: boolean;
  /** The checkbox cannot be ticked now (it can always be unticked). */
  tickDisabled: boolean;
}

/** What one card shows. `proposals` and `selection` are the whole preview's: the requirements are looked up in them. */
export function realignCardView(
  proposals: readonly MaxFinRealignProposal[],
  selection: Readonly<MaxFinRealignSelection>,
  id: string,
  tx: MaxFinRealignTextFn = realignTextPt,
): MaxFinRealignCardView | null {
  const p = proposals.find((x) => x.id === id);
  if (!p) return null;
  const effective = normalizeRealignSelection(proposals, selection);
  const lines = realignPlural(tx, 'maxfinRealignLines', Math.abs(p.shift));
  const movesText = realignPlural(tx, p.kind === 'insertion' ? 'maxfinRealignInsertion' : 'maxfinRealignRemoval', p.moves.length, { lines });
  const labelOf = (dep: string): string => {
    const other = proposals.find((x) => x.id === dep);
    return other
      ? tx('maxfinRealignRequiresItem', { section: realignSectionLabel(other.section), first: other.firstLine, last: other.lastLine })
      : dep;
  };
  const missing = missingRequirements(proposals, p.id);
  const unmet = unmetRequirements(proposals, effective, p.id).filter((dep) => !missing.includes(dep));
  const limits = realignLimitProblem(p) !== null;
  const canTick = canTickRealign(proposals, effective, p.id);
  return {
    id: p.id,
    section: p.section,
    sectionLabel: realignSectionLabel(p.section),
    range: tx('maxfinRealignRange', { first: p.firstLine, last: p.lastLine }),
    movesText,
    removedText: p.removed.length > 0 ? realignPlural(tx, 'maxfinRealignRemoved', p.removed.length) : null,
    insertedText: p.insertedRefs.length > 0 ? realignPlural(tx, 'maxfinRealignInserted', p.insertedRefs.length) : null,
    ambiguous: p.ambiguous === true,
    ambiguousText: p.ambiguous === true ? tx('maxfinRealignAmbiguousReason', { reason: (p.reason ?? '').trim() || '—' }) : null,
    requires: p.requires.map(labelOf),
    requiresText: p.requires.length > 0 ? tx('maxfinRealignRequires', { list: p.requires.map(labelOf).join('; ') }) : null,
    tickFirstText: !effective[p.id] && unmet.length > 0 && missing.length === 0 && !limits
      ? tx('maxfinRealignTickFirst', { list: unmet.map(labelOf).join('; ') })
      : null,
    unavailableText: missing.length > 0 ? tx('maxfinRealignMissingRequirement') : limits ? tx('maxfinRealignUnsupported') : null,
    checked: effective[p.id] === true,
    tickDisabled: !canTick,
  };
}

export interface MaxFinRealignMoveView {
  /** transactionId plus the line: unique inside a proposal. */
  key: string;
  /** 'Linha 3 → 5: Compra · R$ 10,00' */
  text: string;
}

/** The transactions a proposal moves (and the removed ones), one line each, for the "ver os lançamentos" list. */
export function realignMoveLines(
  proposal: Pick<MaxFinRealignProposal, 'moves' | 'removed'>,
  formatAmount: (value: number) => string,
  tx: MaxFinRealignTextFn = realignTextPt,
): MaxFinRealignMoveView[] {
  const line = (id: string, from: string, to: string, description: string | null, amount: number): MaxFinRealignMoveView => ({
    key: `${id}|${from}|${to}`,
    text: tx('maxfinRealignMoveLine', {
      from: lineOfRef(from), to: lineOfRef(to), description: (description ?? '').trim() || '—', amount: formatAmount(amount),
    }),
  });
  return [
    ...proposal.moves.map((m) => line(m.transactionId, m.from, m.to, m.storedDescription, m.storedAmount)),
    ...proposal.removed.map((r) => line(r.transactionId, r.from, r.to, r.description, r.amount)),
  ];
}

/** Footer lines: what will be realigned and what stays pending; empty when the preview has no proposal. */
export function realignFooterLines(totals: MaxFinRealignTotals, tx: MaxFinRealignTextFn = realignTextPt): string[] {
  const lines: string[] = [];
  if (totals.applied > 0) {
    lines.push(realignPlural(tx, 'maxfinRealignFooterApply', totals.applied, { moves: realignPlural(tx, 'maxfinRealignFooterMoves', totals.moves) }));
  }
  if (totals.declined > 0) lines.push(realignPlural(tx, 'maxfinRealignFooterPending', totals.declined));
  return lines;
}

// ---- Result -----------------------------------------------------------------------------------------------

/** '3 lançamentos realinhados'; null when none was. */
export function realignedSummaryPart(realigned: number | undefined, tx: MaxFinRealignTextFn = realignTextPt): string | null {
  return typeof realigned === 'number' && realigned > 0 ? realignPlural(tx, 'maxfinRealignRealigned', realigned) : null;
}

const OUTCOME_TEXT: Record<string, 'maxfinRealignOutcomeApplied' | 'maxfinRealignOutcomeAlreadyApplied' | 'maxfinRealignOutcomeDeclined' | 'maxfinRealignOutcomeSkipped'> = {
  applied: 'maxfinRealignOutcomeApplied',
  'already-applied': 'maxfinRealignOutcomeAlreadyApplied',
  declined: 'maxfinRealignOutcomeDeclined',
  skipped: 'maxfinRealignOutcomeSkipped',
};

/** Block label from what the request carried (decisions) or the preview: 'Cartão, linhas 12 a 18'; the id when unknown. */
function outcomeLabel(
  id: string,
  decisions: ReadonlyArray<Pick<MaxFinRealignDecision, 'id' | 'section' | 'moves'>>,
  tx: MaxFinRealignTextFn,
): string {
  const decision = decisions.find((d) => d.id === id);
  if (decision && decision.moves.length > 0) {
    const lines = decision.moves.map((m) => m.sheetLine).filter((n) => Number.isFinite(n));
    if (lines.length > 0) {
      return tx('maxfinRealignOutcomeLabel', { section: realignSectionLabel(decision.section), first: Math.min(...lines), last: Math.max(...lines) });
    }
  }
  return tx('maxfinRealignOutcomeLabelUnknown', { id });
}

/**
 * One line per decision of the response: 'Cartão, linhas 12 a 18: Realinhado (7)'. A skipped block adds the reason of
 * the server (pt-BR); a block stays readable even when its status is one this client does not know.
 */
export function realignOutcomeLines(
  outcomes: readonly MaxFinRealignOutcome[] | undefined,
  decisions: ReadonlyArray<Pick<MaxFinRealignDecision, 'id' | 'section' | 'moves'>> | undefined,
  tx: MaxFinRealignTextFn = realignTextPt,
): string[] {
  if (!Array.isArray(outcomes)) return [];
  return outcomes.map((outcome) => {
    const key = OUTCOME_TEXT[outcome.status as string];
    const status = key ? tx(key, { moved: outcome.moved ?? 0 }) : tx('maxfinRealignOutcomeUnknown');
    const label = outcomeLabel(outcome.id, decisions ?? [], tx);
    const reason = outcome.status === 'skipped' || outcome.status === 'declined' ? (outcome.reason ?? '').trim() : '';
    return reason ? tx('maxfinRealignOutcomeLineReason', { label, status, reason }) : tx('maxfinRealignOutcomeLine', { label, status });
  });
}

/**
 * The result has something to read as soon as the server decided on a block (realigned, already realigned, left
 * pending, skipped or a status this client does not know): the status of each block is shown, not only a count.
 * An older server answers with none.
 */
export function realignResultNeedsReview(outcomes: readonly MaxFinRealignOutcome[] | undefined): boolean {
  return Array.isArray(outcomes) && outcomes.length > 0;
}


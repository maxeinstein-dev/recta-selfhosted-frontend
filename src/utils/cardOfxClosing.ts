/**
 * "Fechamento da fatura" of the card OFX preview: the OFX total against what the card holds in the statement period,
 * the delta between them and its explanation. The server computes it for the proposals ticked by default
 * (`preview.closing`); this module recomputes it for the selection on screen from the same contract, so the numbers
 * move as the user ticks and unticks. Pure, like cardOfx.ts: no React, no axios, integer cents.
 *
 * The server's formula (card-ofx-closing.ts): delta = ofxTotal - recordedTotal, and
 *   delta = uncreated + heldMatches - sheetOnlyInPeriod - foreignInPeriod - advancePayments + residual.
 * Ticking or unticking a proposal only moves what that proposal contributes to recordedTotal, uncreated, heldMatches
 * and advancePayments (sheetOnlyInPeriod and foreignInPeriod concern rows no proposal points to), so the live value is
 * the server value plus, per proposal whose tick differs from the server default, the difference of its contributions.
 * Where that cannot be done exactly (a kind this client does not know, a proposal with a ref missing from the lines,
 * a match with no target) the server value is shown and labelled "com a seleção padrão".
 */
import { signedCents } from './cardOfx';
import type { CardOfxGroupView, CardOfxSelection } from './cardOfx';
import { countLabel, toSignedCents } from './maxfinPayload';
import type { CardOfxClosing } from '../hooks/api/useImportCardOfx';

/** |residual| up to this is "explained" (the server's CLOSING_TOLERANCE_CENTS). */
export const CLOSING_TOLERANCE_CENTS = 5;

export interface ClosingComponentsCents {
  uncreated: number;
  heldMatches: number;
  sheetOnlyInPeriod: number;
  foreignInPeriod: number;
  advancePayments: number;
  residual: number;
}

/**
 * default: the selection is the server's default, the numbers are the server's. live: recomputed for the selection.
 * server-default: the selection differs but cannot be recomputed exactly; the numbers are the server's, for the default.
 */
export type ClosingBasis = 'default' | 'live' | 'server-default';

export interface ClosingView {
  periodStart: string;
  periodEnd: string;
  endInclusive: boolean;
  ofxCents: number;
  recordedCents: number;
  /** ofxCents - recordedCents: positive = the card holds less than the bank charged. */
  deltaCents: number;
  components: ClosingComponentsCents;
  sheetOnlyOutsideCents: number;
  /** |residual| within the tolerance. */
  explained: boolean;
  basis: ClosingBasis;
  /** Proposals whose tick differs from the server default. */
  changedGroups: number;
}

const toCentsView = (closing: CardOfxClosing): Omit<ClosingView, 'basis' | 'changedGroups'> => {
  const c = closing.components ?? ({} as CardOfxClosing['components']);
  const residual = toSignedCents(c.residual ?? 0);
  return {
    periodStart: closing.periodStart,
    periodEnd: closing.periodEnd,
    endInclusive: closing.endInclusive === true,
    ofxCents: toSignedCents(closing.ofxTotal),
    recordedCents: toSignedCents(closing.recordedTotal),
    deltaCents: toSignedCents(closing.delta),
    components: {
      uncreated: toSignedCents(c.uncreated ?? 0),
      heldMatches: toSignedCents(c.heldMatches ?? 0),
      sheetOnlyInPeriod: toSignedCents(c.sheetOnlyInPeriod ?? 0),
      foreignInPeriod: toSignedCents(c.foreignInPeriod ?? 0),
      advancePayments: toSignedCents(c.advancePayments ?? 0),
      residual,
    },
    sheetOnlyOutsideCents: toSignedCents(closing.sheetOnlyOutsidePeriod ?? 0),
    explained: Math.abs(residual) <= CLOSING_TOLERANCE_CENTS,
  };
};

/** What the server's own numbers say, with no recomputation. */
export function serverClosingView(closing: CardOfxClosing, basis: ClosingBasis = 'default', changedGroups = 0): ClosingView {
  return { ...toCentsView(closing), basis, changedGroups };
}

interface Effect {
  recorded: number;
  uncreated: number;
  held: number;
  advance: number;
}

const NO_EFFECT: Effect = { recorded: 0, uncreated: 0, held: 0, advance: 0 };

/** The proposal can be recomputed exactly: known kind, every ref among the lines, and a target when it is a match. */
function recomputable(group: CardOfxGroupView): boolean {
  if (group.section === 'other' || group.missingRefs.length > 0) return false;
  if (group.section === 'new' || group.section === 'reversal') return true;
  return !!group.proposal.target;
}

/**
 * What a proposal contributes to the closing when it is ticked (`selected`) or not, mirroring the server: a created
 * purchase adds its lines dated in the period to the card, an unticked one is `uncreated`; a ticked match writes
 * the result date (and, for merges and consumed futures, the bank amount) into the target and drops the absorbed
 * rows, an unticked one leaves the rows as they are and counts the difference as `heldMatches`.
 */
function effectOf(group: CardOfxGroupView, selected: boolean, inPeriod: (date: string) => boolean): Effect {
  const { proposal } = group;
  if (group.section === 'new') {
    if (!selected) return { ...NO_EFFECT, uncreated: group.netCents };
    const recorded = group.lines.reduce((sum, line) => sum + (inPeriod(line.date) ? signedCents(line.amount, line.type) : 0), 0);
    return { ...NO_EFFECT, recorded };
  }
  if (group.section === 'reversal') return selected ? NO_EFFECT : { ...NO_EFFECT, uncreated: group.netCents };
  const target = proposal.target;
  if (!target) return NO_EFFECT;
  if (selected) {
    // Merges, consumed futures and near-amount adoptions write the bank amount into the row; the other matches keep the sheet's.
    const cents = proposal.kind === 'enrich-merge' || proposal.kind === 'consume-future' || proposal.kind === 'enrich-near' ? group.netCents : signedCents(target.amount, target.type);
    const counted = inPeriod(proposal.result?.date ?? target.date) ? cents : 0;
    // An advance payment line is not in the OFX total; the sheet credit it pairs with stays in the card total.
    const advance = group.lines.length > 0 && group.lines.every((line) => line.kind === 'payment') ? counted : 0;
    return { ...NO_EFFECT, recorded: counted, advance };
  }
  const standing = [target, ...(proposal.absorbed ?? [])]
    .filter((row) => inPeriod(row.date))
    .reduce((sum, row) => sum + signedCents(row.amount, row.type), 0);
  return { ...NO_EFFECT, recorded: standing, held: group.netCents - standing };
}

/**
 * The closing for the selection on screen. Null when the server sent none (an older server). With the default
 * selection the numbers are the server's own; with another they are recomputed, or, when a changed proposal cannot be
 * recomputed exactly, the server's with `basis: 'server-default'`.
 */
export function buildClosingView(
  closing: CardOfxClosing | null | undefined,
  groups: ReadonlyArray<CardOfxGroupView>,
  selection: Readonly<CardOfxSelection>,
): ClosingView | null {
  if (!closing) return null;
  const changed = groups.filter((group) => {
    const current = group.sendable && selection[group.proposal.group] === true;
    return current !== (group.proposal.defaultSelected === true);
  });
  if (changed.length === 0) return serverClosingView(closing, 'default', 0);
  if (!changed.every(recomputable)) return serverClosingView(closing, 'server-default', changed.length);

  const base = toCentsView(closing);
  const start = closing.periodStart;
  const end = closing.periodEnd;
  const inPeriod = (date: string) => date >= start && (closing.endInclusive ? date <= end : date < end);
  let recorded = base.recordedCents;
  const components = { ...base.components };
  for (const group of changed) {
    const was = effectOf(group, group.proposal.defaultSelected === true, inPeriod);
    const now = effectOf(group, group.sendable && selection[group.proposal.group] === true, inPeriod);
    recorded += now.recorded - was.recorded;
    components.uncreated += now.uncreated - was.uncreated;
    components.heldMatches += now.held - was.held;
    components.advancePayments += now.advance - was.advance;
  }
  const deltaCents = base.ofxCents - recorded;
  components.residual = deltaCents - (components.uncreated + components.heldMatches - components.sheetOnlyInPeriod - components.foreignInPeriod - components.advancePayments);
  return {
    ...base,
    recordedCents: recorded,
    deltaCents,
    components,
    explained: Math.abs(components.residual) <= CLOSING_TOLERANCE_CENTS,
    basis: 'live',
    changedGroups: changed.length,
  };
}

// ---- Texts --------------------------------------------------------------------------------------------------------

export type ClosingRowKey = keyof ClosingComponentsCents;

export interface ClosingRow {
  key: ClosingRowKey;
  label: string;
  hint: string;
  /** Its contribution to the delta, with sign (+ makes the card hold less than the bank, - more). */
  cents: number;
}

const ROW_TEXT: Record<ClosingRowKey, { label: string; hint: string; sign: 1 | -1 }> = {
  uncreated: {
    label: 'Compras do OFX não importadas',
    hint: 'Linhas de propostas desmarcadas (compras novas, pares de compra e estorno): ficam faltando no cartão.',
    sign: 1,
  },
  heldMatches: {
    label: 'Pareamentos desmarcados',
    hint: 'Linhas do OFX de pareamentos desmarcados, menos as linhas da planilha que as representam (essas ficam no cartão com o valor da planilha).',
    sign: 1,
  },
  sheetOnlyInPeriod: {
    label: 'Planilha sem par dentro do período',
    hint: 'Linhas da planilha do mês sem linha no OFX, datadas dentro do período: sobram no cartão.',
    sign: -1,
  },
  foreignInPeriod: {
    label: 'Outros lançamentos do cartão no período',
    hint: 'Lançamentos do cartão dentro do período que esta fatura não explica (linha de outro mês da planilha, lançamento manual).',
    sign: -1,
  },
  advancePayments: {
    label: 'Créditos da planilha de pagamentos antecipados',
    hint: 'Créditos da planilha pareados com pagamentos antecipados: estão no total do cartão e não no total do OFX.',
    sign: -1,
  },
  residual: {
    label: 'Resto sem explicação',
    hint: 'O que nada acima explica: centavos de arredondamento e linhas pareadas datadas fora do período.',
    sign: 1,
  },
};

/** The rows that explain the delta: the ones with a value, and always the residual (the last line of the account). */
export function closingRows(view: Pick<ClosingView, 'components'>): ClosingRow[] {
  const order: ClosingRowKey[] = ['uncreated', 'heldMatches', 'sheetOnlyInPeriod', 'foreignInPeriod', 'advancePayments', 'residual'];
  return order
    .filter((key) => key === 'residual' || view.components[key] !== 0)
    .map((key) => ({ key, label: ROW_TEXT[key].label, hint: ROW_TEXT[key].hint, cents: ROW_TEXT[key].sign * view.components[key] }));
}

/** Where the numbers come from, next to the title. */
export function closingBasisLabel(view: Pick<ClosingView, 'basis' | 'changedGroups'>): string {
  switch (view.basis) {
    case 'live':
      return `recalculado com a sua seleção (${countLabel(view.changedGroups, 'proposta diferente', 'propostas diferentes')} do padrão do servidor)`;
    case 'server-default':
      return 'com a seleção padrão do servidor (não recalculado: a sua seleção tem uma proposta que o cálculo não cobre)';
    default:
      return 'com a seleção padrão do servidor';
  }
}

/** One line on the state of the account: closes, or by how much and which way it does not. */
export function closingHeadline(view: Pick<ClosingView, 'deltaCents'>, formatCents: (cents: number) => string): string {
  if (view.deltaCents === 0) return 'Fecha com o OFX: o cartão guarda exatamente o total da fatura.';
  const amount = formatCents(Math.abs(view.deltaCents));
  return view.deltaCents > 0
    ? `O cartão fica ${amount} a menos que o total do OFX.`
    : `O cartão fica ${amount} a mais que o total do OFX.`;
}

export interface ClosingResidualStatus {
  tone: 'green' | 'yellow' | 'orange';
  /** The chip: "explicada" only when nothing is left; the cents that remain are named. */
  chip: string;
  /** The sentence under the rows. */
  verdict: string;
}

/**
 * The residual in words. `explained` is the server's flag (|residual| within 5 cents; for a recomputed selection the
 * same rule): it is shown as it is, but "explicada" is said only when no cent is left, so a residual of a few cents
 * never reads as fully accounted for.
 */
export function closingResidualStatus(
  view: Pick<ClosingView, 'explained' | 'components'>,
  formatCents: (cents: number) => string,
): ClosingResidualStatus {
  const left = Math.abs(view.components.residual);
  if (left === 0 && view.explained) return { tone: 'green', chip: 'explicada', verdict: 'Diferença explicada pelos itens acima.' };
  if (view.explained) {
    return {
      tone: 'yellow',
      chip: `dentro da tolerância: restam ${formatCents(left)}`,
      verdict: `Os itens acima explicam a diferença, exceto ${formatCents(left)} (arredondamento do banco, dentro da tolerância de ${CLOSING_TOLERANCE_CENTS} centavos).`,
    };
  }
  return {
    tone: 'orange',
    chip: `não explicada: restam ${formatCents(left)}`,
    verdict: 'Parte da diferença não é explicada pelos itens acima: confira as datas e as linhas do cartão no período.',
  };
}

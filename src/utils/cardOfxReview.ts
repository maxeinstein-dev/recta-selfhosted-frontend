/**
 * Pure logic of "Revisar lançamentos sem comprovante": the rows of a credit card's sheet that found no line in the
 * bank's OFX. The decisions per row (keep without receipt, move to another account, delete), the bulk choice, the
 * request, the blocker, the honest reading of a partial answer (done / skipped / blocked / failed, row by row), the
 * months with their totals and the "kept" view. Like cardOfx.ts: no React, no axios, integer cents.
 */
import { AccountType } from '../lib/enums';
import { countLabel, toSignedCents } from './maxfinPayload';
import { monthKeyLabel } from './maxfinWorkbook';
import { signedCents } from './cardOfx';
import type {
  CardOfxReviewAction, CardOfxReviewActionsRequest, CardOfxReviewActionsResponse, CardOfxReviewItem,
  CardOfxReviewQueue, CardOfxReviewStatus, CardOfxReviewView,
} from '../hooks/api/useCardOfxReview';

// ---- Limits (of the endpoint) -----------------------------------------------------------------------------

/** Rows asked for per read: the endpoint's default. A longer queue comes back `truncated` and is reloaded after each apply. */
export const REVIEW_LIMIT = 200;
/** Actions per request (the endpoint's cap). The list is read with REVIEW_LIMIT, so a request never needs more. */
export const REVIEW_MAX_ACTIONS = 200;

// ---- Choices ----------------------------------------------------------------------------------------------

export type ReviewChoiceAction = 'none' | 'keep' | 'move' | 'delete';

export interface ReviewChoice {
  action: ReviewChoiceAction;
  /** Account that receives the row; only used (and required) for `move`. */
  targetAccountId: string;
}

/** transaction id -> choice. A row without an entry has no decision. */
export type ReviewDraft = Readonly<Record<string, ReviewChoice>>;

export const EMPTY_REVIEW_DRAFT: ReviewDraft = {};

export const REVIEW_ACTION_LABEL: Record<ReviewChoiceAction, string> = {
  none: 'Sem ação',
  keep: 'Manter sem comprovante',
  move: 'Mover para outra conta',
  delete: 'Excluir',
};

export const NO_CHOICE: ReviewChoice = { action: 'none', targetAccountId: '' };

export const choiceOf = (draft: ReviewDraft, id: string): ReviewChoice => draft[id] ?? NO_CHOICE;

/** A row with shares, a split, a settlement, a recurrence or an attachment only accepts "keep". */
export const allowedActions = (item: Pick<CardOfxReviewItem, 'blocked'>): ReviewChoiceAction[] =>
  item.blocked ? ['none', 'keep'] : ['none', 'keep', 'move', 'delete'];

export const isActionAllowed = (item: Pick<CardOfxReviewItem, 'blocked'>, action: ReviewChoiceAction): boolean =>
  allowedActions(item).includes(action);

/** Sets the decision of one row; an action the row does not accept (move/delete on a blocked row) leaves it as it was. */
export function setRowChoice(
  draft: ReviewDraft,
  item: Pick<CardOfxReviewItem, 'transactionId' | 'blocked'>,
  action: ReviewChoiceAction,
  targetAccountId?: string,
): ReviewDraft {
  if (!isActionAllowed(item, action)) return draft;
  const previous = choiceOf(draft, item.transactionId);
  const next: ReviewChoice = { action, targetAccountId: targetAccountId ?? previous.targetAccountId };
  if (action === 'none') {
    const rest = { ...draft };
    delete rest[item.transactionId];
    return rest;
  }
  return { ...draft, [item.transactionId]: next };
}

/** Sets only the destination of a row already marked to move. */
export function setRowTarget(draft: ReviewDraft, id: string, targetAccountId: string): ReviewDraft {
  const previous = draft[id];
  if (!previous || previous.action !== 'move') return draft;
  return { ...draft, [id]: { ...previous, targetAccountId } };
}

export interface BulkResult {
  draft: ReviewDraft;
  /** Rows the bulk choice reached. */
  applied: number;
  /** Blocked rows left out because they only accept "keep". */
  blockedSkipped: number;
}

/**
 * One choice for every row of `items` (the visible ones). Blocked rows only take "keep"; for move and delete they stay as
 * they are and are counted, so the screen can say so.
 */
export function setBulkChoice(
  draft: ReviewDraft,
  items: ReadonlyArray<Pick<CardOfxReviewItem, 'transactionId' | 'blocked'>>,
  action: ReviewChoiceAction,
  targetAccountId = '',
): BulkResult {
  let next = draft;
  let applied = 0;
  let blockedSkipped = 0;
  for (const item of items) {
    if (!isActionAllowed(item, action)) {
      blockedSkipped += 1;
      continue;
    }
    next = setRowChoice(next, item, action, action === 'move' ? targetAccountId : undefined);
    applied += 1;
  }
  return { draft: next, applied, blockedSkipped };
}

/** After the list was read again: decisions of rows that are no longer listed are dropped, a blocked row loses move/delete. */
export function reconcileReviewDraft(draft: ReviewDraft, items: ReadonlyArray<Pick<CardOfxReviewItem, 'transactionId' | 'blocked'>>): ReviewDraft {
  const byId = new Map(items.map((item) => [item.transactionId, item]));
  const next: Record<string, ReviewChoice> = {};
  for (const [id, choice] of Object.entries(draft)) {
    const item = byId.get(id);
    if (item && isActionAllowed(item, choice.action)) next[id] = choice;
  }
  return next;
}

// ---- Accounts a row can move to ---------------------------------------------------------------------------

export interface ReviewAccountRef {
  id: string;
  type: string;
  isActive?: boolean;
}

/** Same household, active, not a credit card. The card the list is about is a credit card, so it is never offered. */
export function moveTargetAccounts<T extends ReviewAccountRef>(accounts: readonly T[]): T[] {
  return accounts.filter((a) => a.type !== AccountType.CREDIT && a.isActive !== false);
}

export const MOVE_TARGET_PROBLEM = {
  missing: 'Escolha a conta de destino.',
  notFound: 'A conta de destino não foi encontrada: escolha outra.',
  isCard: 'A conta de destino não pode ser um cartão de crédito.',
  inactive: 'A conta de destino está inativa: escolha outra.',
} as const;

export function moveTargetProblem(targetAccountId: string, accounts: readonly ReviewAccountRef[]): string | null {
  if (!targetAccountId) return MOVE_TARGET_PROBLEM.missing;
  const account = accounts.find((a) => a.id === targetAccountId);
  if (!account) return MOVE_TARGET_PROBLEM.notFound;
  if (account.type === AccountType.CREDIT) return MOVE_TARGET_PROBLEM.isCard;
  if (account.isActive === false) return MOVE_TARGET_PROBLEM.inactive;
  return null;
}

// ---- Request ----------------------------------------------------------------------------------------------

export interface ReviewCounts {
  keep: number;
  move: number;
  delete: number;
  total: number;
  /** Net amount of the rows to delete, integer cents (purchases positive). */
  deleteCents: number;
  /** Rows to move per destination account. */
  moveByTarget: Record<string, number>;
}

export interface BuiltReview {
  payload: CardOfxReviewActionsRequest;
  counts: ReviewCounts;
  /** One problem per row that cannot be sent (a move with no valid destination), in list order. */
  problems: Array<{ transactionId: string; message: string }>;
}

/**
 * What the apply sends: one action per row with a decision, in list order. A decision on a row that is not in the
 * list any more, or that the row does not accept, is not sent. The destination goes only with `move`.
 */
export function buildReviewActions(
  accountId: string,
  items: ReadonlyArray<CardOfxReviewItem>,
  draft: ReviewDraft,
  accounts: readonly ReviewAccountRef[],
): BuiltReview {
  const actions: CardOfxReviewAction[] = [];
  const problems: BuiltReview['problems'] = [];
  const counts: ReviewCounts = { keep: 0, move: 0, delete: 0, total: 0, deleteCents: 0, moveByTarget: {} };
  for (const item of items) {
    const choice = choiceOf(draft, item.transactionId);
    if (choice.action === 'none' || !isActionAllowed(item, choice.action)) continue;
    if (choice.action === 'move') {
      const problem = moveTargetProblem(choice.targetAccountId, accounts);
      if (problem) {
        problems.push({ transactionId: item.transactionId, message: problem });
        continue;
      }
      actions.push({ transactionId: item.transactionId, action: 'move', targetAccountId: choice.targetAccountId });
      counts.move += 1;
      counts.moveByTarget[choice.targetAccountId] = (counts.moveByTarget[choice.targetAccountId] ?? 0) + 1;
    } else if (choice.action === 'delete') {
      actions.push({ transactionId: item.transactionId, action: 'delete' });
      counts.delete += 1;
      counts.deleteCents += signedCents(item.amount, item.type);
    } else {
      actions.push({ transactionId: item.transactionId, action: 'keep' });
      counts.keep += 1;
    }
    counts.total += 1;
  }
  return { payload: { accountId, actions }, counts, problems };
}

export interface ReviewBlocker {
  code: 'needs-refresh' | 'busy' | 'nothing' | 'problem' | 'too-many';
  message: string;
}

export const REVIEW_REFRESH_NOTICE = 'Atualize a lista antes de aplicar de novo: o que já tiver sido tratado sai dela.';

/**
 * Why "Aplicar" must stay disabled; null when it can go. `needsRefresh` (a request failed, or the list could not be
 * read again after an apply) is required on purpose: a caller that forgets it would let a stale list be applied again.
 */
export function reviewBlocker(
  built: BuiltReview | null,
  state: { needsRefresh: boolean; busy: boolean },
): ReviewBlocker | null {
  if (state.busy) return { code: 'busy', message: 'Aguarde a operação em andamento.' };
  if (state.needsRefresh) return { code: 'needs-refresh', message: REVIEW_REFRESH_NOTICE };
  if (!built || (built.counts.total === 0 && built.problems.length === 0)) {
    return { code: 'nothing', message: 'Escolha uma ação para ao menos um lançamento.' };
  }
  if (built.problems.length > 0) return { code: 'problem', message: built.problems[0].message };
  if (built.payload.actions.length > REVIEW_MAX_ACTIONS) {
    return { code: 'too-many', message: `Só ${REVIEW_MAX_ACTIONS} decisões por vez: desfaça algumas e aplique o restante depois.` };
  }
  return null;
}

// ---- Confirmation -----------------------------------------------------------------------------------------

export const DELETE_WARNING =
  'Excluir apaga o lançamento do cartão e o saldo é recalculado. Importar a planilha de novo pode trazer a linha de volta: o servidor avisa, depois de aplicar, se conseguiu registrar um marcador que impede isso.';

/** The lines of the confirmation, one per kind of decision that has rows. */
export function confirmLines(
  counts: ReviewCounts,
  accountName: (id: string) => string,
  formatCents: (cents: number) => string,
): string[] {
  const lines: string[] = [];
  if (counts.keep > 0) lines.push(`Manter sem comprovante: ${countLabel(counts.keep, 'lançamento', 'lançamentos')}.`);
  if (counts.move > 0) {
    const where = Object.entries(counts.moveByTarget).map(([id, n]) => `${accountName(id)}: ${n}`).join('; ');
    lines.push(`Mover para outra conta: ${countLabel(counts.move, 'lançamento', 'lançamentos')} (${where}).`);
  }
  if (counts.delete > 0) {
    lines.push(`Excluir: ${countLabel(counts.delete, 'lançamento', 'lançamentos')} (${formatCents(counts.deleteCents)} no total).`);
  }
  return lines;
}

// ---- The answer, row by row -------------------------------------------------------------------------------

export const REVIEW_STATUS_LABEL: Record<CardOfxReviewStatus, string> = {
  done: 'feito',
  skipped: 'já tratado',
  blocked: 'bloqueado',
  failed: 'falhou',
};

const REASON_TEXT: Record<string, string> = {
  'changed-meanwhile': 'mudou enquanto era aplicado',
  'not-in-queue': 'não está mais na lista',
  'blocked': 'tem partilha, divisão, acerto, recorrência ou anexo',
};

/** A reason code of the server in words; an unknown code is shown as it came. */
export function reviewReasonText(reason: string | undefined): string {
  if (!reason) return '';
  return REASON_TEXT[reason] ?? reason;
}

export interface ReviewOutcome {
  transactionId: string;
  action: string;
  status: CardOfxReviewStatus;
  reason?: string;
}

export interface ReviewApplySummary {
  /** Counted from the results themselves, not from the totals the server also sends. */
  done: number;
  skipped: number;
  blocked: number;
  failed: number;
  /** Actions that were sent and have no result in the answer (nothing is assumed about them). */
  missing: string[];
  /** Results of rows that were not sent, or a status this client does not know: shown, never counted as done. */
  unexpected: number;
  /** The totals of the server disagree with its own results. */
  inconsistent: boolean;
  results: ReviewOutcome[];
  warnings: string[];
}

const KNOWN_STATUS = new Set<string>(['done', 'skipped', 'blocked', 'failed']);

/** Reads the answer honestly: what each row got, what the answer does not say, and what the server warns about. */
export function summarizeReviewResponse(
  sent: ReadonlyArray<CardOfxReviewAction>,
  response: Pick<CardOfxReviewActionsResponse, 'results' | 'done' | 'skipped' | 'blocked' | 'failed' | 'warnings'>,
): ReviewApplySummary {
  const sentKey = new Set(sent.map((a) => `${a.transactionId}|${a.action}`));
  const seen = new Set<string>();
  const summary: ReviewApplySummary = {
    done: 0, skipped: 0, blocked: 0, failed: 0, missing: [], unexpected: 0, inconsistent: false, results: [], warnings: [...(response.warnings ?? [])],
  };
  for (const r of response.results ?? []) {
    const key = `${r.transactionId}|${r.action}`;
    if (!sentKey.has(key) || seen.has(key) || !KNOWN_STATUS.has(r.status)) {
      summary.unexpected += 1;
      continue;
    }
    seen.add(key);
    summary[r.status] += 1;
    summary.results.push({ transactionId: r.transactionId, action: r.action, status: r.status, reason: r.reason });
  }
  summary.missing = sent.filter((a) => !seen.has(`${a.transactionId}|${a.action}`)).map((a) => a.transactionId);
  summary.inconsistent =
    response.done !== summary.done || response.skipped !== summary.skipped || response.blocked !== summary.blocked || response.failed !== summary.failed;
  return summary;
}

/** One line for the toast and the panel; zero-valued parts are left out. */
export function reviewSummaryLine(summary: Pick<ReviewApplySummary, 'done' | 'skipped' | 'blocked' | 'failed' | 'missing'>): string {
  const parts: string[] = [];
  if (summary.done > 0) parts.push(countLabel(summary.done, 'feito', 'feitos'));
  if (summary.skipped > 0) parts.push(countLabel(summary.skipped, 'já tratado (nada a fazer)', 'já tratados (nada a fazer)'));
  if (summary.blocked > 0) parts.push(countLabel(summary.blocked, 'bloqueado', 'bloqueados'));
  if (summary.failed > 0) parts.push(countLabel(summary.failed, 'com falha', 'com falha'));
  if (summary.missing.length > 0) parts.push(countLabel(summary.missing.length, 'sem resposta do servidor', 'sem resposta do servidor'));
  return parts.length > 0 ? parts.join(', ') : 'nada foi alterado';
}

/** Outcomes that stay next to their row after the list is read again: what failed or was refused. */
export function lingeringOutcomes(summary: Pick<ReviewApplySummary, 'results'>): Record<string, ReviewOutcome> {
  const out: Record<string, ReviewOutcome> = {};
  for (const r of summary.results) if (r.status === 'failed' || r.status === 'blocked') out[r.transactionId] = r;
  return out;
}

/** The decisions that are left after an answer: the ones that failed stay to be tried again; every other row is settled. */
export function draftAfterResults(draft: ReviewDraft, summary: Pick<ReviewApplySummary, 'results' | 'missing'>): ReviewDraft {
  const keep = new Set<string>([...summary.missing]);
  for (const r of summary.results) if (r.status === 'failed') keep.add(r.transactionId);
  const next: Record<string, ReviewChoice> = {};
  for (const [id, choice] of Object.entries(draft)) if (keep.has(id)) next[id] = choice;
  return next;
}

/** The reason shown next to a refused or failed row: the server's own, or the standard one for a blocked row. */
export function reviewOutcomeReason(outcome: Pick<ReviewOutcome, 'status' | 'reason'>): string {
  return reviewReasonText(outcome.reason ?? (outcome.status === 'blocked' ? 'blocked' : undefined));
}

/** A 4xx answer is a refusal before any write; anything else (network, 5xx) may have applied part of the request. */
export const isRefusedBeforeWriting = (status: number | undefined): boolean => status !== undefined && status >= 400 && status < 500;

export function reviewFailureMessage(reason: string, status?: number): string {
  const head = reason.trim() || 'Não foi possível aplicar as decisões.';
  const sentence = /[.!?]$/.test(head) ? head : `${head}.`;
  if (isRefusedBeforeWriting(status)) return `${sentence} Nenhuma decisão foi aplicada.`;
  return `${sentence} Algumas podem ter sido aplicadas. ${REVIEW_REFRESH_NOTICE}`;
}

// ---- The list ---------------------------------------------------------------------------------------------

export interface ReviewMonthSection {
  monthKey: string;
  label: string;
  /** Rows of the month still in the list, as the server counts them. */
  count: number;
  /** Their net amount, integer cents (purchases positive). */
  netCents: number;
  items: CardOfxReviewItem[];
}

/** The rows by sheet month, oldest first, with the month totals of the server (the rows of the month if it sent none). */
export function reviewSections(
  queue: Pick<CardOfxReviewQueue, 'items' | 'months'>,
): ReviewMonthSection[] {
  const byMonth = new Map<string, CardOfxReviewItem[]>();
  for (const item of queue.items ?? []) {
    const list = byMonth.get(item.monthKey);
    if (list) list.push(item);
    else byMonth.set(item.monthKey, [item]);
  }
  const totals = new Map((queue.months ?? []).map((m) => [m.monthKey, m]));
  const keys = [...new Set([...byMonth.keys(), ...totals.keys()])].sort();
  return keys
    .map((monthKey) => {
      const items = byMonth.get(monthKey) ?? [];
      const server = totals.get(monthKey);
      return {
        monthKey,
        label: monthKeyLabel(monthKey),
        count: server ? server.count : items.length,
        netCents: server ? toSignedCents(server.net) : items.reduce((sum, item) => sum + signedCents(item.amount, item.type), 0),
        items,
      };
    })
    .filter((section) => section.items.length > 0 || section.count > 0);
}

export interface ReviewHeadline {
  text: string;
  /** The list was cut at the limit. */
  truncatedNote: string | null;
}

export function reviewHeadline(
  queue: Pick<CardOfxReviewQueue, 'totals' | 'view' | 'truncated' | 'items'>,
  formatCents: (cents: number) => string,
): ReviewHeadline {
  const count = queue.totals?.count ?? queue.items.length;
  const net = formatCents(toSignedCents(queue.totals?.net ?? 0));
  const kept = queue.view === 'kept';
  const text = count === 0
    ? kept ? 'Nenhum lançamento mantido sem comprovante.' : 'Nenhum lançamento sem comprovante.'
    : kept
      ? `${countLabel(count, 'lançamento mantido sem comprovante', 'lançamentos mantidos sem comprovante')} (${net} no total).`
      : `${countLabel(count, 'lançamento sem comprovante', 'lançamentos sem comprovante')} (${net} no total).`;
  const truncatedNote = queue.truncated
    ? `A lista mostra os primeiros ${queue.items.length}; o resto aparece depois que estes forem tratados.`
    : null;
  return { text, truncatedNote };
}

export const REVIEW_EXPLANATION =
  'Lançamentos da planilha deste cartão, de meses cuja fatura já foi importada, que não têm linha correspondente no OFX do banco. Decida o que fazer com cada um: manter (sem comprovante), mover para outra conta ou excluir.';

export const KEPT_EXPLANATION =
  'Lançamentos que você marcou como “sem comprovante”. Desfazer devolve o lançamento à lista de revisão.';

export function reviewViewLabel(view: CardOfxReviewView): string {
  return view === 'kept' ? 'Ver mantidos' : 'Ver pendentes';
}

/** The action of "Desfazer": a single unkeep, sent at once (it changes nothing but the mark). */
export function unkeepRequest(accountId: string, transactionId: string): CardOfxReviewActionsRequest {
  return { accountId, actions: [{ transactionId, action: 'unkeep' }] };
}

/** Rows of a month section that carry a decision. */
export function decidedCount(items: ReadonlyArray<Pick<CardOfxReviewItem, 'transactionId'>>, draft: ReviewDraft): number {
  return items.filter((item) => choiceOf(draft, item.transactionId).action !== 'none').length;
}

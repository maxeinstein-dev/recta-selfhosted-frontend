/**
 * Queue of files imported one after the other (card invoices, bank statements): the state machine of the
 * progress list and the loop of "apply the default to the rest". Pure (no React, no axios): the dialogs own the
 * requests and hand them in as callbacks, so the rules below run under `tsx` too.
 */
import { countLabel } from './maxfinPayload';

/**
 * pending: waiting, or the file on screen.
 * done: confirmed.
 * skipped: left out by the user.
 * uptodate: the loop found nothing to import in it (already imported, or nothing new): left out on its own.
 * failed: the confirm failed (it may have been applied in part): the file stays blocked until it is refreshed.
 */
export type QueueStatus = 'pending' | 'done' | 'skipped' | 'uptodate' | 'failed';

export interface QueueItem {
  /** Stable key (position at creation). */
  id: string;
  name: string;
  status: QueueStatus;
  /** done: what was imported; skipped/failed: why. */
  note: string | null;
}

export interface QueueState {
  items: QueueItem[];
  /** The file on screen; `items.length` once every file was done or skipped. */
  index: number;
}

export function createQueue(names: readonly string[]): QueueState {
  return { items: names.map((name, i) => ({ id: `q${i}`, name, status: 'pending', note: null })), index: 0 };
}

export const isQueueFinished = (state: QueueState): boolean => state.index >= state.items.length;

export const currentItem = (state: QueueState): QueueItem | null => state.items[state.index] ?? null;

/** "Fatura 3 de 10" (the noun is the caller's). Empty once the queue is finished. */
export function queueLabel(state: QueueState, noun: string): string {
  return isQueueFinished(state) ? '' : `${noun} ${state.index + 1} de ${state.items.length}`;
}

/** The file on screen plus the ones after it that are still waiting. */
export function remainingCount(state: QueueState): number {
  return state.items.slice(state.index).filter((item) => item.status === 'pending' || item.status === 'failed').length;
}

/** Files after the one on screen that are still waiting. */
export function followingCount(state: QueueState): number {
  return state.items.slice(state.index + 1).filter((item) => item.status === 'pending').length;
}

export interface QueueTotals {
  done: number;
  skipped: number;
  uptodate: number;
  failed: number;
  pending: number;
}

export function queueTotals(state: QueueState): QueueTotals {
  const totals: QueueTotals = { done: 0, skipped: 0, uptodate: 0, failed: 0, pending: 0 };
  for (const item of state.items) totals[item.status] += 1;
  return totals;
}

const withItem = (state: QueueState, index: number, patch: Partial<QueueItem>): QueueState => ({
  ...state,
  items: state.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
});

/**
 * The file on screen was confirmed: it is done and the next one comes up. Refused (state unchanged) for a file
 * that failed and was not refreshed, and once the queue is finished.
 */
export function completeCurrent(state: QueueState, note: string | null): QueueState {
  const item = currentItem(state);
  if (!item || item.status !== 'pending') return state;
  return { ...withItem(state, state.index, { status: 'done', note }), index: state.index + 1 };
}

/** The user leaves the file on screen out; allowed after a failure too (the way out of a blocked file). */
export function skipCurrent(state: QueueState, note: string | null = null): QueueState {
  const item = currentItem(state);
  if (!item || (item.status !== 'pending' && item.status !== 'failed')) return state;
  return { ...withItem(state, state.index, { status: 'skipped', note }), index: state.index + 1 };
}

/** The loop found nothing to import in the file on screen: it is left out and the next one comes up. */
export function markUpToDateCurrent(state: QueueState, note: string | null = null): QueueState {
  const item = currentItem(state);
  if (!item || item.status !== 'pending') return state;
  return { ...withItem(state, state.index, { status: 'uptodate', note }), index: state.index + 1 };
}

/** The confirm of the file on screen failed: it stays on screen, blocked. */
export function failCurrent(state: QueueState, reason: string): QueueState {
  const item = currentItem(state);
  if (!item || item.status !== 'pending') return state;
  return withItem(state, state.index, { status: 'failed', note: reason });
}

/** The file on screen was refreshed after a failure: it can be confirmed again. */
export function retryCurrent(state: QueueState): QueueState {
  const item = currentItem(state);
  if (!item || item.status !== 'failed') return state;
  return withItem(state, state.index, { status: 'pending', note: null });
}

/** The file on screen may be confirmed (it exists and is not blocked by an earlier failure). */
export const canConfirmCurrent = (state: QueueState): boolean => currentItem(state)?.status === 'pending';

// ---- "Apply the default to the rest" ----------------------------------------------------------------------

/** What happened to one file of the loop. */
export type ApplyOutcome =
  /** Previewed and confirmed. */
  | { ok: true; note: string }
  /** Previewed and nothing to import (already imported / nothing new): left out, the loop goes on. */
  | { ok: true; upToDate: true; note: string }
  /** Nothing was written: the file cannot go on as it is (a blocker, an error, a payment with no source account). */
  | { ok: false; reason: string; written: false }
  /** The confirm failed: it may have been applied in part, so the file is blocked until it is refreshed. */
  | { ok: false; reason: string; written: true };

export interface ApplyRun {
  state: QueueState;
  /** Why the loop stopped before the end; null when every file went through. */
  stop: { index: number; name: string; reason: string } | null;
}

/**
 * Runs `applyOne` on the file on screen and on each one after it, in order, one at a time (the next preview only
 * starts after the previous confirm succeeded: futures and payments depend on it). Stops at the first file that
 * cannot proceed and says why; `shouldStop` ends it early (the dialog went away). `onProgress` sees every state.
 */
export async function applyDefaultsToRemaining(
  start: QueueState,
  applyOne: (index: number, item: QueueItem) => Promise<ApplyOutcome>,
  options: { shouldStop?: () => boolean; onProgress?: (state: QueueState) => void } = {},
): Promise<ApplyRun> {
  let state = start;
  while (!isQueueFinished(state)) {
    if (options.shouldStop?.()) return { state, stop: null };
    const index = state.index;
    const item = state.items[index];
    // A file that failed must be refreshed first: the loop does not walk over it.
    if (item.status === 'failed') {
      return { state, stop: { index, name: item.name, reason: item.note ?? 'A confirmação falhou: atualize a pré-visualização.' } };
    }
    let outcome: ApplyOutcome;
    try {
      outcome = await applyOne(index, item);
    } catch (err) {
      outcome = { ok: false, reason: err instanceof Error && err.message ? err.message : 'Erro inesperado.', written: false };
    }
    if (outcome.ok) {
      const next = 'upToDate' in outcome ? markUpToDateCurrent(state, outcome.note) : completeCurrent(state, outcome.note);
      // The queue refused to move on (it cannot happen for a pending file): stop, never ask for the same file again.
      if (next.index === state.index) {
        return { state, stop: { index, name: item.name, reason: 'A fila não avançou depois de importar este arquivo.' } };
      }
      state = next;
      options.onProgress?.(state);
      continue;
    }
    if (outcome.written) state = failCurrent(state, outcome.reason);
    options.onProgress?.(state);
    return { state, stop: { index, name: item.name, reason: outcome.reason } };
  }
  return { state, stop: null };
}

/** "3 importadas, 1 pulada" for the final summary. */
export function queueSummaryLine(
  state: QueueState,
  nouns: { done: [string, string]; skipped: [string, string]; uptodate: [string, string]; failed: [string, string] },
): string {
  const totals = queueTotals(state);
  const parts: string[] = [];
  if (totals.done > 0) parts.push(countLabel(totals.done, ...nouns.done));
  if (totals.skipped > 0) parts.push(countLabel(totals.skipped, ...nouns.skipped));
  if (totals.uptodate > 0) parts.push(countLabel(totals.uptodate, ...nouns.uptodate));
  if (totals.failed > 0) parts.push(countLabel(totals.failed, ...nouns.failed));
  return parts.join(', ');
}

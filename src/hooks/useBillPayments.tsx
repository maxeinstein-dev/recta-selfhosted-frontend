import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../context/I18nContext';
import { useToastContext } from '../context/ToastContext';
import { useConfirmReceipt } from './useConfirmReceipt';
import { useBillActions } from './api/useBillsChecklist';
import { earlyPaymentDay, type Bill, type BillAction } from '../utils/billsChecklist';
import { billsText, type BillsTextKey } from '../utils/billsChecklistTexts';
import { usePayNow } from '../components/cashflow/EarlyDiscountBits';
import { useKeepNow } from '../components/goals/KeepNow';
import { reserveText } from '../utils/savingsGoalsPlan';

export interface BillPayments {
  /** Key of the bill whose call is running (one at a time), or null. */
  busyKey: string | null;
  /** True while any payment call runs: every pay control is disabled (no double tap). */
  busy: boolean;
  /** Lines just marked: hidden until the cash flow answer catches up. */
  doneKeys: ReadonlySet<string>;
  /** Transactions the marked lines became (for the "N of M paid" counter). */
  markedIds: ReadonlySet<string>;
  /** Pays a bill with the action `billAction` chose for it. */
  mark: (bill: Bill, action: BillAction, today: string | undefined) => Promise<void>;
  /** The confirmation dialog of an estimated value; render it once on the screen. */
  dialog: ReactNode;
  tx: (key: BillsTextKey, vars?: Record<string, string | number>) => string;
}

/**
 * Paying a bill of the "Contas a pagar" list, shared by the desktop checklist and the mobile Início: pending entry,
 * not-yet-generated occurrence (execute) and the early-discount "pay now" (pay-next). Every write invalidates balances,
 * transactions, recurrences and the dashboard keys (cash flow, overview), so balances, next invoice, free limit and
 * the Fluxo refresh at once. One call at a time: `busy` stays true until it ends.
 */
export function useBillPayments(): BillPayments {
  const { t } = useI18n();
  const tx = useCallback((key: BillsTextKey, vars?: Record<string, string | number>) => billsText(t, key, vars), [t]);
  const { success, error: showError, info } = useToastContext();
  const confirmReceipt = useConfirmReceipt();
  const { payPending, generateOccurrence } = useBillActions();
  const pay = usePayNow();
  // "Guardar" lines: record the contribution (no entry, the account balance does not change); a 409 asks first
  const keepNow = useKeepNow({ successText: () => tx('billsReserveDoneToast') });

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [doneKeys, setDoneKeys] = useState<ReadonlySet<string>>(new Set());
  const [markedIds, setMarkedIds] = useState<ReadonlySet<string>>(new Set());

  const markDone = (bill: Bill, transactionId: string | null) => {
    setDoneKeys((prev) => new Set(prev).add(bill.key));
    if (transactionId) setMarkedIds((prev) => new Set(prev).add(transactionId));
  };

  const run = async (bill: Bill, action: BillAction, today: string | undefined) => {
    if (action.type === 'reserve') {
      setBusyKey(bill.key);
      try {
        const ok = await keepNow.keep({ goalId: action.goalId, name: reserveText(bill.description, null), date: action.date });
        if (ok) markDone(bill, null);
      } finally {
        setBusyKey(null);
      }
      return;
    }
    if (action.type === 'payNext') {
      // Not generated yet and with a discount: the route creates the occurrence already paid (discounted until the limit)
      // and moves the recurrence on, so the job does not generate another one at the due date.
      setBusyKey(bill.key);
      try {
        const id = await pay.payNow(action.recurringId);
        if (id) markDone(bill, id);
      } finally {
        setBusyKey(null);
      }
      return;
    }
    if (action.type !== 'pay' && action.type !== 'execute') return;
    setBusyKey(bill.key);
    // A bill not due yet is paid today, never on its future due day
    const early = today ? earlyPaymentDay(bill.dueDate, today) : null;
    try {
      if (action.type === 'pay') {
        if (action.confirm) {
          // An estimated value is confirmed with the real amount and day, in the dialog the app already has
          confirmReceipt.request({ id: bill.sourceId, type: 'EXPENSE', amount: bill.amountCents / 100, date: early ?? bill.dueDate, paid: false, description: bill.description });
          return;
        }
        await payPending(bill.sourceId, early);
        markDone(bill, bill.sourceId);
        success(tx('billsPaidToast'));
        return;
      }
      // The occurrence is generated once by the route (paid at once, or pending to be confirmed when its value is an estimate)
      // Generated pending when the value is an estimate (confirmed next) or when it must be moved to today first
      const result = await generateOccurrence(bill.sourceId, !action.confirm && !early);
      const created = result.transaction;
      if (created.paid) {
        if (result.skipped) info(tx('billsAlreadyGenerated'));
        else {
          markDone(bill, created.id);
          success(tx('billsPaidToast'));
        }
        return;
      }
      if (action.confirm) {
        confirmReceipt.request({
          id: created.id,
          type: 'EXPENSE',
          amount: Number(created.amount),
          date: early ?? String(created.date).slice(0, 10),
          paid: false,
          recurringTransactionId: created.recurringTransactionId,
          description: created.description,
        });
        info(tx('billsConfirmValueToast'));
        return;
      }
      // Pending still (not due yet, or the month already held a pending occurrence): pay that one, on today when early
      await payPending(created.id, early);
      markDone(bill, created.id);
      success(tx('billsPaidToast'));
    } catch {
      showError(tx('billsMarkError'));
    } finally {
      setBusyKey(null);
    }
  };

  const inFlight = useRef(false);
  const mark = async (bill: Bill, action: BillAction, today: string | undefined) => {
    // A second tap while a call runs is ignored (the buttons are disabled too); the ref closes the gap before the re-render
    if (inFlight.current || pay.busy || keepNow.busy) return;
    inFlight.current = true;
    try {
      await run(bill, action, today);
    } finally {
      inFlight.current = false;
    }
  };

  return { busyKey, busy: busyKey !== null || pay.busy || keepNow.busy,
    doneKeys,
    markedIds,
    mark,
    dialog: (
      <>
        {confirmReceipt.dialog}
        {keepNow.dialog}
      </>
    ),
    tx,
  };
}

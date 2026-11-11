import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Circle, Clock, Loader2 } from 'lucide-react';
import { useI18n } from '../../context/I18nContext';
import { useCurrency } from '../../context/CurrencyContext';
import { useToastContext } from '../../context/ToastContext';
import { useConfirmReceipt } from '../../hooks/useConfirmReceipt';
import { useBillActions, useBillsCashFlow, useBillsRecurrences, usePaidMonthExpenses } from '../../hooks/api/useBillsChecklist';
import { formatCurrency } from '../../utils/format';
import { allEvents, monthLabel, shortDate } from '../../utils/cashFlow';
import {
  FILTER_ALL,
  FILTER_OVERDUE,
  billAction,
  billSourceTextKey,
  buildBills,
  buildDayPills,
  billsProgress,
  billsTotalCents,
  dayNumber,
  filterBills,
  monthEnd,
  monthStart,
  normalizeFilter,
  paidIds,
  recurrenceMap,
  type Bill,
  type BillAction,
} from '../../utils/billsChecklist';
import { billsText, type BillsTextKey } from '../../utils/billsChecklistTexts';

const CARD_CLS = 'rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3';
const CHIP_CLS = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-light';
/** 44 px touch targets everywhere: the checklist is used on the phone first. */
const PILL_CLS = 'min-h-[44px] min-w-[44px] shrink-0 rounded-lg border px-3 text-sm transition-colors';

export interface BillsChecklistProps {
  householdId?: string;
  /** One cash account; omit it for all the cash accounts of the household. */
  accountId?: string;
}

/**
 * "Contas a pagar": the expenses and card invoices still to pay this month (and the overdue ones), from the cash flow
 * answer, with a due-day filter, the total, the "N of M paid" counter and a control to mark each one as paid.
 */
export default function BillsChecklist({ householdId, accountId }: BillsChecklistProps) {
  const { t } = useI18n();
  const tx = (key: BillsTextKey, vars?: Record<string, string | number>) => billsText(t, key, vars);
  const { baseCurrency } = useCurrency();
  const { success, error: showError, info } = useToastContext();
  const navigate = useNavigate();
  const confirmReceipt = useConfirmReceipt();
  const { payPending, generateOccurrence } = useBillActions();

  const [filter, setFilter] = useState<string>(FILTER_ALL);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // Lines just marked (hidden until the answer catches up) and the transactions they became (for the counter)
  const [doneKeys, setDoneKeys] = useState<ReadonlySet<string>>(new Set());
  const [markedIds, setMarkedIds] = useState<ReadonlySet<string>>(new Set());

  const query = useBillsCashFlow({ householdId, accountId });
  const data = query.data;
  const today = data?.period.from;
  const paidQuery = usePaidMonthExpenses({ householdId, accountId, today });
  const recurrences = useBillsRecurrences(householdId);
  const recurrenceById = useMemo(() => recurrenceMap(recurrences.data), [recurrences.data]);

  const bills = useMemo(() => (data && today ? buildBills(allEvents(data), today, doneKeys) : []), [data, today, doneKeys]);
  const pills = useMemo(() => buildDayPills(bills), [bills]);
  const activeFilter = normalizeFilter(filter, bills);
  const visible = useMemo(() => filterBills(bills, activeFilter), [bills, activeFilter]);

  const paidKnown = !!today && !paidQuery.isPending && !paidQuery.isError;
  const paidCount = useMemo(
    () => (today ? paidIds(paidQuery.data?.data ?? [], monthStart(today), monthEnd(today), markedIds).size : 0),
    [paidQuery.data, markedIds, today],
  );
  const progress = billsProgress(bills, paidCount);

  const currency = data?.currency ?? baseCurrency;
  const noun = (count: number) => tx(count === 1 ? 'billsNounOne' : 'billsNounMany');

  const markDone = (bill: Bill, transactionId: string | null) => {
    setDoneKeys((prev) => new Set(prev).add(bill.key));
    if (transactionId) setMarkedIds((prev) => new Set(prev).add(transactionId));
  };

  const mark = async (bill: Bill, action: BillAction) => {
    if (action.type !== 'pay' && action.type !== 'execute') return;
    setBusyKey(bill.key);
    try {
      if (action.type === 'pay') {
        if (action.confirm) {
          // An estimated value is confirmed with the real amount and day, in the dialog the app already has
          confirmReceipt.request({ id: bill.sourceId, type: 'EXPENSE', amount: bill.amountCents / 100, date: bill.dueDate, paid: false, description: bill.description });
          return;
        }
        await payPending(bill.sourceId);
        markDone(bill, bill.sourceId);
        success(tx('billsPaidToast'));
        return;
      }
      // The occurrence is generated once by the route (paid at once, or pending to be confirmed when its value is an estimate)
      const result = await generateOccurrence(bill.sourceId, !action.confirm);
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
          date: String(created.date).slice(0, 10),
          paid: false,
          recurringTransactionId: created.recurringTransactionId,
          description: created.description,
        });
        info(tx('billsConfirmValueToast'));
        return;
      }
      // The month already held a pending occurrence: the route did not create another, so pay that one
      await payPending(created.id);
      markDone(bill, created.id);
      success(tx('billsPaidToast'));
    } catch {
      showError(tx('billsMarkError'));
    } finally {
      setBusyKey(null);
    }
  };

  const goToInvoice = (bill: Bill) => {
    const params = new URLSearchParams({ card: bill.sourceId });
    if (bill.invoiceMonth) params.set('month', bill.invoiceMonth);
    navigate(`/app/credit-cards?${params.toString()}`);
  };

  let body: ReactNode;
  if (!householdId || query.isPending) {
    body = <p role="status" className="text-sm font-light text-gray-500 dark:text-gray-400">{tx('billsLoading')}</p>;
  } else if (query.isError || !data) {
    body = (
      <div className="space-y-3">
        <p role="alert" className="text-sm font-light text-red-600 dark:text-red-400">{tx('billsLoadError')}</p>
        <button type="button" onClick={() => void query.refetch()} className="min-h-[44px] rounded-lg border border-gray-200 dark:border-gray-800 px-4 py-2 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-900">
          {tx('billsRetry')}
        </button>
      </div>
    );
  } else {
    body = (
      <div className="space-y-3">
        <div>
          <p className="text-2xl font-medium text-gray-900 dark:text-white">{formatCurrency(billsTotalCents(bills) / 100, currency)}</p>
          <p className="text-xs font-light text-gray-500 dark:text-gray-400">
            {tx('billsTotalCaption')}
            {paidKnown ? ` · ${tx('billsPaidCounter', { paid: progress.paid, total: progress.total })}` : ''}
          </p>
        </div>

        {bills.length === 0 ? (
          <p className="text-sm font-light text-gray-500 dark:text-gray-400">{paidKnown && progress.paid > 0 ? tx('billsEmptyAllPaid') : tx('billsEmpty')}</p>
        ) : (
          <>
            <div role="group" aria-label={tx('billsFilterLabel')} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              <button type="button" aria-pressed={activeFilter === FILTER_ALL} onClick={() => setFilter(FILTER_ALL)} className={`${PILL_CLS} ${activeFilter === FILTER_ALL ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900' : 'border-gray-200 text-gray-700 dark:border-gray-800 dark:text-gray-300'}`}>
                {tx('billsFilterAll')}
              </button>
              {pills.overdue && (
                <button
                  type="button"
                  aria-pressed={activeFilter === FILTER_OVERDUE}
                  aria-label={tx('billsOverdueLabel', { count: pills.overdue.count, noun: noun(pills.overdue.count) })}
                  onClick={() => setFilter(FILTER_OVERDUE)}
                  className={`${PILL_CLS} ${activeFilter === FILTER_OVERDUE ? 'border-red-600 bg-red-600 text-white' : 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300'}`}
                >
                  {tx('billsFilterOverdue')} · {pills.overdue.count}
                </button>
              )}
              {pills.days.map((pill) => (
                <button
                  key={pill.date}
                  type="button"
                  aria-pressed={activeFilter === pill.date}
                  aria-label={tx('billsPillLabel', { day: dayNumber(pill.date), count: pill.count, noun: noun(pill.count) })}
                  onClick={() => setFilter(pill.date)}
                  className={`${PILL_CLS} ${activeFilter === pill.date ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 text-gray-700 dark:border-gray-800 dark:text-gray-300'}`}
                >
                  {dayNumber(pill.date)}
                </button>
              ))}
            </div>

            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {visible.map((bill) => {
                const action = billAction(bill, recurrenceById);
                const name = bill.description || tx('billsNoDescription');
                return (
                  <li key={bill.key} className="flex min-h-[44px] items-start gap-2 py-2">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center">
                      {action.type === 'pay' || action.type === 'execute' ? (
                        <button
                          type="button"
                          disabled={busyKey !== null}
                          aria-label={tx('billsMarkPaid', { name })}
                          onClick={() => void mark(bill, action)}
                          className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 hover:text-emerald-600 disabled:opacity-60 dark:text-gray-500 dark:hover:text-emerald-400"
                        >
                          {busyKey === bill.key ? <Loader2 className="h-6 w-6 animate-spin" aria-label={tx('billsMarking')} /> : <Circle className="h-6 w-6" aria-hidden="true" />}
                        </button>
                      ) : (
                        <Clock className="h-5 w-5 text-gray-300 dark:text-gray-600" aria-hidden="true" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 pt-2.5">
                      <p className="break-words text-sm text-gray-900 dark:text-white">{name}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span className={`${CHIP_CLS} bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300`}>
                          {tx(billSourceTextKey(bill.kind))}
                          {bill.kind === 'invoice' && bill.invoiceMonth ? ` ${monthLabel(bill.invoiceMonth)}` : ''}
                        </span>
                        {bill.estimated && <span className={`${CHIP_CLS} bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300`}>{tx('billsBadgeEstimated')}</span>}
                        {bill.overdue ? (
                          <span className={`${CHIP_CLS} bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300`}>
                            {tx('billsBadgeOverdue')} · {tx('billsOverdueFrom', { date: shortDate(bill.dueDate) })}
                          </span>
                        ) : (
                          <span className={`${CHIP_CLS} bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300`}>{tx('billsDueOn', { date: shortDate(bill.date) })}</span>
                        )}
                      </div>
                      {action.type === 'none' && (
                        <p className="mt-1 text-xs font-light text-gray-500 dark:text-gray-400">{action.reason === 'later' ? tx('billsRecurrenceLater') : tx('billsNoAction')}</p>
                      )}
                      {action.type === 'invoice' && (
                        <button
                          type="button"
                          aria-label={tx('billsPayInvoiceFor', { name })}
                          onClick={() => goToInvoice(bill)}
                          className="mt-2 min-h-[44px] rounded-lg border border-gray-200 px-4 text-sm text-gray-900 dark:border-gray-800 dark:text-white"
                        >
                          {tx('billsPayInvoice')}
                        </button>
                      )}
                    </div>
                    <p className="whitespace-nowrap pt-2.5 text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(bill.amountCents / 100, currency)}</p>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    );
  }

  return (
    <section aria-label={tx('billsTitle')} className={`${CARD_CLS} space-y-3`}>
      <h2 className="text-sm font-medium text-gray-900 dark:text-white">{tx('billsTitle')}</h2>
      {body}
      {confirmReceipt.dialog}
    </section>
  );
}

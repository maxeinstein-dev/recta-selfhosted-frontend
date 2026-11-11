import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import CashFlowChart from '../components/cashflow/CashFlowChart';
import BillsChecklist from '../components/bills/BillsChecklist';
import { useI18n } from '../context/I18nContext';
import { useCurrency } from '../context/CurrencyContext';
import { useDefaultHousehold } from '../hooks/useDefaultHousehold';
import { useAccounts } from '../hooks/api/useAccounts';
import { useCashFlow } from '../hooks/api/useCashFlow';
import { formatCurrency } from '../utils/format';
import {
  CASH_FLOW_PERIODS,
  DEFAULT_CASH_FLOW_DAYS,
  allEvents,
  buildDailySeries,
  cashAccounts,
  certaintyTextKey,
  estimatedNotice,
  eventTone,
  firstNegativeDate,
  groupEventsByDay,
  isEstimated,
  lowestPoint,
  monthLabel,
  normalizePeriod,
  overdueDetail,
  reasonTextKey,
  shortDate,
  sourceTextKey,
  type CashFlowEvent,
  type CashFlowPoint,
} from '../utils/cashFlow';
import { cashFlowText, type CashFlowTextKey } from '../utils/cashFlowTexts';

/** 44 px touch targets on the period switch and the account select (the screen is used on the phone first). */
const TAB_CLS = 'min-h-[44px] flex-1 px-3 py-2 text-sm font-light rounded-md transition-colors';
const CARD_CLS = 'rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3';
const CHIP_CLS = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-light';

const signedAmount = (amount: number, currency: string): string => {
  const tone = eventTone(amount);
  const sign = tone === 'income' ? '+' : tone === 'expense' ? '-' : '';
  return `${sign}${formatCurrency(Math.abs(amount), currency)}`;
};

/** A balance in the screen: negative values in red, the rest in the normal text colour. */
const moneyClass = (amount: number): string =>
  amount < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white';

/** The cash flow page: the balance of the cash accounts day by day from today, from what is already known. */
const CashFlow = () => {
  const { t } = useI18n();
  const tx = (key: CashFlowTextKey, vars?: Record<string, string | number>) => cashFlowText(t, key, vars);
  const { householdId } = useDefaultHousehold();
  const { baseCurrency } = useCurrency();

  const [days, setDays] = useState<number>(DEFAULT_CASH_FLOW_DAYS);
  const [accountId, setAccountId] = useState<string>('');

  const accounts = useAccounts({ householdId: householdId ?? '' });
  const cashList = useMemo(() => cashAccounts(accounts.data?.accounts ?? []), [accounts.data]);
  const query = useCashFlow({ householdId, accountId: accountId || undefined, days });
  const data = query.data;
  const currency = data?.currency ?? baseCurrency;

  const points: CashFlowPoint[] = useMemo(() => (data ? buildDailySeries(data) : []), [data]);
  const pointByDate = useMemo(() => new Map(points.map((p) => [p.date, p])), [points]);
  const lowest = useMemo(() => lowestPoint(points), [points]);
  const negativeDate = useMemo(() => firstNegativeDate(points), [points]);
  const dayGroups = useMemo(() => (data ? groupEventsByDay(allEvents(data)) : []), [data]);

  const selectPeriod = (value: number) => setDays(normalizePeriod(value));

  let body: ReactNode;
  if (!householdId || query.isPending) {
    body = <p role="status" className="text-sm font-light text-gray-500 dark:text-gray-400">{tx('cashFlowLoading')}</p>;
  } else if (query.isError || !data) {
    const mismatch = (query.error as { status?: number } | null)?.status === 400;
    body = (
      <div className="space-y-3">
        <p role="alert" className="text-sm font-light text-red-600 dark:text-red-400">
          {mismatch ? tx('cashFlowCurrencyMismatch') : tx('cashFlowLoadError')}
        </p>
        <button type="button" onClick={() => void query.refetch()} className="min-h-[44px] rounded-lg border border-gray-200 dark:border-gray-800 px-4 py-2 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-900">
          {tx('cashFlowRetry')}
        </button>
      </div>
    );
  } else {
    const notice = estimatedNotice(data.summary.estimatedCount);
    const endLabel = tx('cashFlowEndBalance', { date: shortDate(data.period.to) });
    body = (
      <div className="space-y-6">
        {/* Summary */}
        <section aria-label={tx('cashFlowTitle')} className="space-y-3">
          {negativeDate && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-sm font-light text-red-700 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{tx('cashFlowNegativeWarning', { date: shortDate(negativeDate) })}</span>
            </div>
          )}
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className={CARD_CLS}>
              <dt className="text-xs font-light text-gray-500 dark:text-gray-400">{tx('cashFlowTodayBalance')}</dt>
              <dd className={`mt-1 text-base font-medium ${moneyClass(data.startingBalance)}`}>{formatCurrency(data.startingBalance, currency)}</dd>
            </div>
            <div className={CARD_CLS}>
              <dt className="text-xs font-light text-gray-500 dark:text-gray-400">{tx('cashFlowLowestBalance')}</dt>
              <dd className={`mt-1 text-base font-medium ${lowest ? moneyClass(lowest.amount) : ''}`}>
                {lowest ? formatCurrency(lowest.amount, currency) : '-'}
              </dd>
              {lowest && <dd className="text-xs font-light text-gray-500 dark:text-gray-400">{tx('cashFlowOnDate', { date: shortDate(lowest.date) })}</dd>}
            </div>
            <div className={`${CARD_CLS} ${negativeDate ? 'border-red-300 dark:border-red-800' : ''}`}>
              <dt className="text-xs font-light text-gray-500 dark:text-gray-400">{tx('cashFlowFirstNegative')}</dt>
              <dd className={`mt-1 text-base font-medium ${negativeDate ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                {negativeDate ? shortDate(negativeDate) : tx('cashFlowNoNegativeDay')}
              </dd>
            </div>
            <div className={CARD_CLS}>
              <dt className="text-xs font-light text-gray-500 dark:text-gray-400">{endLabel}</dt>
              <dd className={`mt-1 text-base font-medium ${moneyClass(data.summary.endingBalance)}`}>{formatCurrency(data.summary.endingBalance, currency)}</dd>
            </div>
          </dl>
        </section>

        {/* Chart */}
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-gray-900 dark:text-white">{tx('cashFlowChartTitle')}</h2>
          <CashFlowChart
            points={points}
            lowest={lowest}
            currency={currency}
            zeroLabel={tx('cashFlowZeroLine')}
            label={tx('cashFlowChartLabel', {
              amount: lowest ? formatCurrency(lowest.amount, currency) : '-',
              date: lowest ? shortDate(lowest.date) : '',
            })}
          />
        </section>

        {/* Notes: estimated values and what is left out */}
        <section className="space-y-2">
          {notice && (
            <p className="flex items-start gap-2 text-sm font-light text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{tx(notice.key, notice.vars)}</span>
            </p>
          )}
          <p className="flex items-start gap-2 text-xs font-light text-gray-500 dark:text-gray-400">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{tx('cashFlowNotIncluded')}</span>
          </p>
        </section>

        {/* Events by day */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-gray-900 dark:text-white">{tx('cashFlowEventsTitle')}</h2>
          {dayGroups.length === 0 ? (
            <p className="text-sm font-light text-gray-500 dark:text-gray-400">{tx('cashFlowNoEvents')}</p>
          ) : (
            dayGroups.map((group) => (
              <section key={group.date} className="space-y-1">
                <header className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-gray-200 dark:border-gray-800 pb-1">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white">{shortDate(group.date)}</h3>
                  <p className="text-xs font-light text-gray-500 dark:text-gray-400">
                    {tx('cashFlowDayInflow')} {formatCurrency(group.inflow, currency)} · {tx('cashFlowDayOutflow')} {formatCurrency(group.outflow, currency)}
                  </p>
                </header>
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {group.events.map((event) => (
                    <EventRow key={`${event.source}:${event.sourceId}:${event.date}:${event.amount}:${event.description}`} event={event} currency={currency} tx={tx} />
                  ))}
                </ul>
                <p className="text-right text-xs font-light text-gray-500 dark:text-gray-400">
                  {tx('cashFlowEndOfDay')}: <span className={moneyClass(pointByDate.get(group.date)?.balance ?? 0)}>{formatCurrency(pointByDate.get(group.date)?.balance ?? 0, currency)}</span>
                </p>
              </section>
            ))
          )}
        </section>

        {/* Invoices without a payer */}
        {data.unassignedInvoices.length > 0 && (
          <section className="space-y-2 rounded-lg border border-gray-200 dark:border-gray-800 p-3">
            <h2 className="text-sm font-medium text-gray-900 dark:text-white">{tx('cashFlowUnassignedTitle')}</h2>
            <p className="text-xs font-light text-gray-500 dark:text-gray-400">{tx('cashFlowUnassignedIntro')}</p>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {data.unassignedInvoices.map((invoice) => (
                <li key={`${invoice.accountId}:${invoice.month}`} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm text-gray-900 dark:text-white">
                      {tx('cashFlowUnassignedLine', { card: invoice.accountName, month: monthLabel(invoice.month) })}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {invoice.dueDate && <span className={`${CHIP_CLS} bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300`}>{tx('cashFlowUnassignedDue', { date: shortDate(invoice.dueDate) })}</span>}
                      <span className={`${CHIP_CLS} bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300`}>{tx(reasonTextKey(invoice.reason))}</span>
                    </div>
                  </div>
                  <p className="whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(invoice.amount, currency)}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={tx('cashFlowTitle')} description={tx('cashFlowDescription')} />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end max-w-2xl">
        <div role="radiogroup" aria-label={tx('cashFlowPeriodLabel')} className="flex gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1 sm:w-auto">
          {CASH_FLOW_PERIODS.map((option) => {
            const active = days === option;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => selectPeriod(option)}
                className={`${TAB_CLS} ${active ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm' : 'text-gray-600 dark:text-gray-400'}`}
              >
                {`${option} ${tx('cashFlowDaysUnit')}`}
              </button>
            );
          })}
        </div>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-light text-gray-600 dark:text-gray-400">
          {tx('cashFlowAccountLabel')}
          <select
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            className="min-h-[44px] w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 text-sm text-gray-900 dark:text-white"
          >
            <option value="">{tx('cashFlowAllAccounts')}</option>
            {cashList.map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="max-w-2xl space-y-6">
        <BillsChecklist householdId={householdId ?? undefined} accountId={accountId || undefined} />
        {body}
      </div>
    </div>
  );
};

/** One event: description, source and badges, signed amount. Wraps on a narrow screen; no table. */
function EventRow({ event, currency, tx }: { event: CashFlowEvent; currency: string; tx: (key: CashFlowTextKey, vars?: Record<string, string | number>) => string }) {
  const overdue = overdueDetail(event);
  const tone = eventTone(event.amount);
  return (
    <li className="flex min-h-[44px] items-start justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm text-gray-900 dark:text-white">{event.description || tx('cashFlowNoDescription')}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <span className={`${CHIP_CLS} bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300`}>{tx(sourceTextKey(event.source))}</span>
          {isEstimated(event) && (
            <span title={tx(certaintyTextKey(event.certainty))} className={`${CHIP_CLS} bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300`}>
              {tx('cashFlowBadgeEstimated')}
            </span>
          )}
          {event.overdue && (
            <span className={`${CHIP_CLS} bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300`}>
              {tx('cashFlowBadgeOverdue')}
              {overdue ? ` · ${tx('cashFlowOverdueFrom', { date: overdue.date })}` : ''}
            </span>
          )}
        </div>
      </div>
      <p
        className={`whitespace-nowrap text-sm font-medium ${
          tone === 'income' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'expense' ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'
        }`}
      >
        {signedAmount(event.amount, currency)}
      </p>
    </li>
  );
}

export default CashFlow;

import { useMemo, type ReactNode } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import CashFlowChart from './CashFlowChart';
import { formatCurrency } from '../../utils/format';
import {
  CASH_FLOW_PERIODS,
  certaintyTextKey,
  estimatedNotice,
  eventTone,
  isEstimated,
  monthLabel,
  overdueDetail,
  reasonTextKey,
  shortDate,
  sourceTextKey,
  type CashFlowDayGroup,
  type CashFlowEvent,
  type CashFlowPoint,
  type CashFlowResponse,
} from '../../utils/cashFlow';
import { cashFlowWarningFacts, cashFlowWarningLines, dayHeadingLabel } from '../../utils/cashFlowMobile';
import type { CashFlowTextKey } from '../../utils/cashFlowTexts';

export interface MobileCashFlowProps {
  /** Still waiting for the household or the projection. */
  loading: boolean;
  /** The projection failed (or came back empty). */
  failed: boolean;
  /** The request answered 400: the cash accounts use different currencies. */
  mismatch: boolean;
  onRetry: () => void;
  data: CashFlowResponse | undefined;
  points: CashFlowPoint[];
  lowest: { date: string; amount: number } | null;
  negativeDate: string | null;
  dayGroups: CashFlowDayGroup[];
  pointByDate: Map<string, CashFlowPoint>;
  currency: string;
  days: number;
  onSelectDays: (days: number) => void;
  accountId: string;
  onSelectAccount: (accountId: string) => void;
  accounts: Array<{ id: string; name: string }>;
  /** The bills checklist, shown at the end of the screen until the Início takes it (lote R5). */
  footer: ReactNode;
  tx: (key: CashFlowTextKey, vars?: Record<string, string | number>) => string;
}

const CARD = 'rounded-2xl border border-rc-line bg-rc-card p-4';
const LABEL = 'text-xs font-medium text-rc-ink2';
const MUTED = 'text-sm text-rc-ink2';
const CHIP = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';
const TOUCH = 'min-h-[44px]';

const signedAmount = (amount: number, currency: string): string => {
  const tone = eventTone(amount);
  const sign = tone === 'income' ? '+' : tone === 'expense' ? '-' : '';
  return `${sign}${formatCurrency(Math.abs(amount), currency)}`;
};

/** A balance: negative in red (with the sign in the text), the rest in the normal ink. */
const moneyTone = (amount: number): string => (amount < 0 ? 'text-rc-red' : 'text-rc-ink');

/**
 * The Fluxo tab below 768 px (lote R4): the balance day by day from today, for 30, 60 or 90 days, and under the chart
 * only the facts of the warning. The data and the calculations come from the page (CashFlow.tsx); this only shows them.
 */
export default function MobileCashFlow({
  loading,
  failed,
  mismatch,
  onRetry,
  data,
  points,
  lowest,
  negativeDate,
  dayGroups,
  pointByDate,
  currency,
  days,
  onSelectDays,
  accountId,
  onSelectAccount,
  accounts,
  footer,
  tx,
}: MobileCashFlowProps) {
  const facts = useMemo(() => cashFlowWarningFacts(points), [points]);
  const warning = useMemo(
    () => cashFlowWarningLines(facts, (amount) => formatCurrency(amount, currency)),
    [facts, currency],
  );

  let body: ReactNode;
  if (loading) {
    body = <p role="status" className={MUTED}>{tx('cashFlowLoading')}</p>;
  } else if (failed || !data) {
    body = (
      <div role="alert" className="space-y-3">
        <p className="text-sm text-rc-red">{mismatch ? tx('cashFlowCurrencyMismatch') : tx('cashFlowLoadError')}</p>
        <button type="button" onClick={onRetry} className={`${TOUCH} rounded-xl border border-rc-line bg-rc-card px-4 text-sm font-medium text-rc-ink`}>
          {tx('cashFlowRetry')}
        </button>
      </div>
    );
  } else {
    const notice = estimatedNotice(data.summary.estimatedCount);
    const negativeBalance = negativeDate ? pointByDate.get(negativeDate)?.balance ?? 0 : 0;
    body = (
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3">
          <div className={CARD}>
            <dt className={LABEL}>{tx('cashFlowLowestBalance')}</dt>
            <dd className={`mt-1 text-lg font-semibold tabular-nums ${lowest ? moneyTone(lowest.amount) : 'text-rc-ink'}`}>
              {lowest ? formatCurrency(lowest.amount, currency) : '-'}
            </dd>
            {lowest && <dd className={`${MUTED} text-xs`}>{tx('cashFlowOnDate', { date: shortDate(lowest.date) })}</dd>}
          </div>
          <div className={`${CARD} ${negativeDate ? 'border-rc-red' : ''}`}>
            <dt className={LABEL}>{tx('cashFlowFirstNegative')}</dt>
            <dd className={`mt-1 text-lg font-semibold tabular-nums ${negativeDate ? 'text-rc-red' : 'text-rc-ink'}`}>
              {negativeDate ? shortDate(negativeDate) : tx('cashFlowNoNegativeDay')}
            </dd>
            {negativeDate && (
              <dd className={`${MUTED} text-xs tabular-nums`}>{tx('cashFlowMissingAmount', { amount: formatCurrency(-negativeBalance, currency) })}</dd>
            )}
          </div>
        </dl>

        <section className={`${CARD} space-y-3`} aria-labelledby="cash-flow-chart-title">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 id="cash-flow-chart-title" className="text-sm font-semibold text-rc-ink">{tx('cashFlowChartTitle')}</h2>
            <p className={`${MUTED} text-xs tabular-nums`}>
              {tx('cashFlowTodayBalance')} {formatCurrency(data.startingBalance, currency)}
            </p>
          </div>
          <CashFlowChart
            points={points}
            lowest={lowest}
            currency={currency}
            label={tx('cashFlowChartLabel', {
              amount: lowest ? formatCurrency(lowest.amount, currency) : '-',
              date: lowest ? shortDate(lowest.date) : '',
            })}
          />
          {warning.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl bg-rc-redSoft p-3 text-sm text-rc-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-rc-red" aria-hidden="true" />
              <div className="min-w-0 space-y-1">
                {warning.map((line) => (
                  <p key={line.key} className="break-words">{tx(line.key, line.vars)}</p>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="space-y-2">
          {notice && (
            <p className="flex items-start gap-2 text-sm text-rc-amber">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
              <span>{tx(notice.key, notice.vars)}</span>
            </p>
          )}
          <p className="flex items-start gap-2 text-xs text-rc-ink2">
            <Info className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
            <span>{tx('cashFlowNotIncluded')}</span>
          </p>
        </section>

        <section className="space-y-3" aria-labelledby="cash-flow-events-title">
          <h2 id="cash-flow-events-title" className="text-sm font-semibold text-rc-ink">{tx('cashFlowEventsTitle')}</h2>
          {dayGroups.length === 0 ? (
            <p className={MUTED}>{tx('cashFlowNoEvents')}</p>
          ) : (
            dayGroups.map((group) => (
              <section key={group.date} className={CARD} aria-label={dayHeadingLabel(group.date, data.period.from, tx('cashFlowTodayWord'))}>
                <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className="text-sm font-semibold text-rc-ink">
                    {dayHeadingLabel(group.date, data.period.from, tx('cashFlowTodayWord'))}
                  </h3>
                  <p className={`${MUTED} text-xs tabular-nums`}>
                    {tx('cashFlowEndOfDay')}{' '}
                    <span className={moneyTone(pointByDate.get(group.date)?.balance ?? 0)}>
                      {formatCurrency(pointByDate.get(group.date)?.balance ?? 0, currency)}
                    </span>
                  </p>
                </header>
                <ul className="mt-2 divide-y divide-rc-line">
                  {group.events.map((event) => (
                    <EventRow key={`${event.source}:${event.sourceId}:${event.date}:${event.amount}:${event.description}`} event={event} currency={currency} tx={tx} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </section>

        {data.unassignedInvoices.length > 0 && (
          <section className={`${CARD} space-y-2`} aria-labelledby="cash-flow-unassigned-title">
            <h2 id="cash-flow-unassigned-title" className="text-sm font-semibold text-rc-ink">{tx('cashFlowUnassignedTitle')}</h2>
            <p className={`${MUTED} text-xs`}>{tx('cashFlowUnassignedIntro')}</p>
            <ul className="divide-y divide-rc-line">
              {data.unassignedInvoices.map((invoice) => (
                <li key={`${invoice.accountId}:${invoice.month}`} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm text-rc-ink">
                      {tx('cashFlowUnassignedLine', { card: invoice.accountName, month: monthLabel(invoice.month) })}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {invoice.dueDate && (
                        <span className={`${CHIP} bg-rc-card2 text-rc-ink2`}>{tx('cashFlowUnassignedDue', { date: shortDate(invoice.dueDate) })}</span>
                      )}
                      <span className={`${CHIP} bg-rc-amberSoft text-rc-amber`}>{tx(reasonTextKey(invoice.reason))}</span>
                    </div>
                  </div>
                  <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-rc-ink">{formatCurrency(invoice.amount, currency)}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className={MUTED}>{tx('cashFlowDescription')}</p>

      <div role="radiogroup" aria-label={tx('cashFlowPeriodLabel')} className="flex gap-1 rounded-xl bg-rc-card2 p-1">
        {CASH_FLOW_PERIODS.map((option) => {
          const active = days === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelectDays(option)}
              className={`${TOUCH} flex-1 rounded-lg px-2 text-sm font-medium transition-colors ${
                active ? 'bg-rc-card text-rc-ink shadow-sm' : 'text-rc-ink2'
              }`}
            >
              {`${option} ${tx('cashFlowDaysUnit')}`}
            </button>
          );
        })}
      </div>

      <label className="flex flex-col gap-1 text-sm text-rc-ink2">
        {tx('cashFlowAccountLabel')}
        <select
          value={accountId}
          onChange={(event) => onSelectAccount(event.target.value)}
          className={`${TOUCH} w-full rounded-xl border border-rc-line bg-rc-card px-3 text-base text-rc-ink`}
        >
          <option value="">{tx('cashFlowAllAccounts')}</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>{account.name}</option>
          ))}
        </select>
      </label>

      {body}

      {footer}
    </div>
  );
}

/** One event: description, source and badges, signed amount. Wraps on a narrow screen; no table. */
function EventRow({ event, currency, tx }: { event: CashFlowEvent; currency: string; tx: MobileCashFlowProps['tx'] }) {
  const overdue = overdueDetail(event);
  const tone = eventTone(event.amount);
  return (
    <li className="flex min-h-[44px] items-start justify-between gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm text-rc-ink">{event.description || tx('cashFlowNoDescription')}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <span className={`${CHIP} bg-rc-card2 text-rc-ink2`}>{tx(sourceTextKey(event.source))}</span>
          {isEstimated(event) && (
            <span title={tx(certaintyTextKey(event.certainty))} className={`${CHIP} bg-rc-amberSoft text-rc-amber`}>
              {tx('cashFlowBadgeEstimated')}
            </span>
          )}
          {event.overdue && (
            <span className={`${CHIP} bg-rc-redSoft text-rc-red`}>
              {tx('cashFlowBadgeOverdue')}
              {overdue ? ` · ${tx('cashFlowOverdueFrom', { date: overdue.date })}` : ''}
            </span>
          )}
        </div>
      </div>
      <p
        className={`whitespace-nowrap text-sm font-semibold tabular-nums ${
          tone === 'income' ? 'text-rc-green' : tone === 'expense' ? 'text-rc-red' : 'text-rc-ink'
        }`}
      >
        {signedAmount(event.amount, currency)}
      </p>
    </li>
  );
}

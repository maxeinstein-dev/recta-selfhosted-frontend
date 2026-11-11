import { useMemo, useState, type ReactNode } from 'react';
import { useI18n } from '../../context/I18nContext';
import { useCardCommitment } from '../../hooks/api/useCardCommitment';
import { formatCurrency } from '../../utils/format';
import {
  COMMITMENT_MONTH_OPTIONS,
  DEFAULT_COMMITMENT_MONTHS,
  buildCommitmentRows,
  commitmentState,
  normalizeMonths,
  percentText,
  summarizeCommitment,
  type CommitmentRow,
} from '../../utils/cardCommitment';
import { cardCommitmentText, type CardCommitmentTextKey } from '../../utils/cardCommitmentTexts';

interface CreditCardCommitmentPanelProps {
  householdId?: string;
  accountId: string | null;
  baseCurrency: string;
  className?: string;
}

const CHIP_CLS = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium';

/**
 * How much of the next invoices of one card is already committed: per invoice, what is posted, what the recurrences
 * still add, and the share of the income expected for the same month. The heaviest invoice and the months above the
 * expected income are marked. Sits on the credit card page, above the invoice of the selected card. Mobile first: one
 * column of rows, 44 px touch targets on the month choice.
 */
export default function CreditCardCommitmentPanel({ householdId, accountId, baseCurrency, className = '' }: CreditCardCommitmentPanelProps) {
  const { t, locale } = useI18n();
  const tx = (key: CardCommitmentTextKey, vars?: Record<string, string | number>) => cardCommitmentText(t, key, vars);
  const [months, setMonths] = useState<number>(DEFAULT_COMMITMENT_MONTHS);
  const query = useCardCommitment({ householdId, accountId, months });
  const rows = useMemo(() => buildCommitmentRows(query.data), [query.data]);
  const summary = useMemo(() => summarizeCommitment(rows), [rows]);
  const state = commitmentState(rows);
  const money = (value: number) => formatCurrency(value, baseCurrency);

  if (!accountId || !householdId) return null;

  let body: ReactNode;
  if (query.isPending) {
    body = <p role="status" className="text-sm font-light text-gray-500 dark:text-gray-400">{tx('cardCommitLoading')}</p>;
  } else if (query.isError || !query.data) {
    body = (
      <div className="space-y-3">
        <p role="alert" className="text-sm font-light text-red-600 dark:text-red-400">{tx('cardCommitLoadError')}</p>
        <button
          type="button"
          onClick={() => query.refetch()}
          className="min-h-[44px] px-4 py-2 text-sm font-light rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200"
        >
          {tx('cardCommitRetry')}
        </button>
      </div>
    );
  } else if (state === 'empty') {
    body = <p className="text-sm font-light text-gray-500 dark:text-gray-400">{tx('cardCommitEmpty')}</p>;
  } else {
    body = (
      <>
        <div className="grid grid-cols-2 gap-3 pb-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <div className="text-xs font-light text-gray-500 dark:text-gray-400">{tx('cardCommitTotal')}</div>
            <div className="text-lg font-medium text-gray-900 dark:text-white tabular-nums">{money(summary.total)}</div>
          </div>
          <div>
            {summary.share !== null ? (
              <>
                <div className="text-xs font-light text-gray-500 dark:text-gray-400">
                  {tx('cardCommitShareOfIncome', { share: percentText(summary.share, locale) })}
                </div>
                <div className="text-lg font-medium text-gray-900 dark:text-white tabular-nums">{money(summary.income)}</div>
              </>
            ) : (
              <div className="text-xs font-light text-gray-500 dark:text-gray-400">{tx('cardCommitNoIncome')}</div>
            )}
          </div>
        </div>

        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map((row) => (
            <MonthRow key={row.month} row={row} money={money} percent={(s) => percentText(s, locale)} tx={tx} />
          ))}
        </ul>

        {summary.heaviestLabel && (
          <p className="mt-3 text-xs font-light text-gray-500 dark:text-gray-400">
            {tx('cardCommitHeaviestMonth', { month: summary.heaviestLabel })}
          </p>
        )}
      </>
    );
  }

  return (
    <section
      aria-label={tx('cardCommitTitle')}
      data-testid="card-commitment-panel"
      className={`rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 sm:p-5 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">{tx('cardCommitTitle')}</h3>
          <p className="mt-1 text-xs font-light text-gray-500 dark:text-gray-400">{tx('cardCommitDescription')}</p>
        </div>
        <div role="group" aria-label={tx('cardCommitMonthsLabel')} className="flex gap-1 rounded-md bg-gray-100 dark:bg-gray-800 p-1">
          {COMMITMENT_MONTH_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={months === option}
              onClick={() => setMonths(normalizeMonths(option))}
              className={`min-h-[44px] px-3 text-xs font-light rounded transition-colors ${
                months === option
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {tx('cardCommitMonthsOption', { count: option })}
            </button>
          ))}
        </div>
      </div>

      {body}

      <p className="mt-4 text-[11px] font-light text-gray-400 dark:text-gray-500">{tx('cardCommitNotIncluded')}</p>
    </section>
  );
}

function MonthRow({
  row,
  money,
  percent,
  tx,
}: {
  row: CommitmentRow;
  money: (value: number) => string;
  percent: (share: number) => string;
  tx: (key: CardCommitmentTextKey, vars?: Record<string, string | number>) => string;
}) {
  const shareText = row.share !== null ? tx('cardCommitShareOfIncome', { share: percent(row.share) }) : tx('cardCommitNoIncome');
  return (
    <li
      data-testid="commitment-row"
      className={`py-3 ${row.heaviest ? 'bg-primary-50/60 dark:bg-primary-900/20 -mx-2 px-2 rounded-md' : ''}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-gray-900 dark:text-white tabular-nums">{row.label}</span>
        <span className="text-sm font-medium text-gray-900 dark:text-white tabular-nums">{money(row.total)}</span>
      </div>

      <div aria-hidden="true" className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div className="h-full bg-primary-600 dark:bg-primary-500" style={{ width: `${row.postedBar}%` }} />
        <div className="h-full bg-primary-200 dark:bg-primary-800" style={{ width: `${row.forecastBar}%` }} />
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs font-light text-gray-500 dark:text-gray-400">
        <span>{tx('cardCommitPosted')}: {money(row.posted)}</span>
        <span>{tx('cardCommitForecast')}: {money(row.forecast)}</span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs font-light text-gray-500 dark:text-gray-400">
        <span>{shareText}</span>
        {row.heaviest && (
          <span className={`${CHIP_CLS} bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300`}>
            {tx('cardCommitHeaviest')}
          </span>
        )}
        {row.overIncome && (
          <span className={`${CHIP_CLS} bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300`}>
            {tx('cardCommitOverIncome')}
          </span>
        )}
      </div>
    </li>
  );
}

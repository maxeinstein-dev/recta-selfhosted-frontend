import { useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import NetWorthChart from '../components/networth/NetWorthChart';
import ValuationForm from '../components/networth/ValuationForm';
import { useI18n } from '../context/I18nContext';
import { useCurrency } from '../context/CurrencyContext';
import { useDefaultHousehold } from '../hooks/useDefaultHousehold';
import { useAccounts } from '../hooks/api/useAccounts';
import { useNetWorth } from '../hooks/api/useNetWorth';
import { formatCurrency } from '../utils/format';
import {
  DEFAULT_NET_WORTH_MONTHS,
  NET_WORTH_PERIODS,
  chartSeries,
  compositionGroups,
  estimatedKinds,
  investmentAccounts,
  latest,
  monthLabel,
  rateText,
  savingsMonth,
  variation,
  type NetWorthItem,
  type NetWorthKind,
} from '../utils/netWorth';
import { netWorthText, type NetWorthTextKey } from '../utils/netWorthTexts';
import { fmtDate } from '../components/people/ui';

const CARD_CLS = 'rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4';
const TAB_CLS = 'min-h-[44px] flex-1 px-3 py-2 text-sm font-light rounded-md transition-colors';
const CHIP_CLS = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-light bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200';

const GROUP_TITLE: Record<NetWorthKind, NetWorthTextKey> = {
  cash: 'netWorthGroupCash',
  investment: 'netWorthGroupInvestment',
  reserve: 'netWorthGroupReserve',
  fgts: 'netWorthGroupFgts',
  card: 'netWorthGroupCard',
};
const KIND_WORDS: Record<NetWorthKind, NetWorthTextKey> = {
  cash: 'netWorthKindCash',
  investment: 'netWorthKindInvestment',
  reserve: 'netWorthKindReserve',
  fgts: 'netWorthKindFgts',
  card: 'netWorthKindCard',
};

const moneyClass = (amount: number): string => (amount < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white');

/** The net worth page: what the household has, minus the card debt, month by month. Numbers come from the server. */
const NetWorth = () => {
  const { t } = useI18n();
  const tx = (key: NetWorthTextKey, vars?: Record<string, string | number>) => netWorthText(t, key, vars);
  const { householdId } = useDefaultHousehold();
  const { baseCurrency } = useCurrency();
  const [months, setMonths] = useState<number>(DEFAULT_NET_WORTH_MONTHS);

  const query = useNetWorth({ householdId, months });
  const accounts = useAccounts({ householdId: householdId ?? '' });
  const investAccounts = useMemo(() => investmentAccounts(accounts.data?.accounts ?? []), [accounts.data]);

  const data = query.data;
  const currency = data?.currency ?? baseCurrency;
  const money = (amount: number) => formatCurrency(amount, currency);
  const last = data ? latest(data) : null;
  const change = data ? variation(data) : null;
  const series = useMemo(() => (data ? chartSeries(data) : []), [data]);
  const groups = useMemo(() => (data ? compositionGroups(data.composition) : []), [data]);
  const estimated = data ? estimatedKinds(data) : [];
  const savings = data ? savingsMonth(data) : null;
  const previous = data && data.months.length > 1 ? data.months[data.months.length - 2]! : null;

  const itemNote = (item: NetWorthItem): string | null => {
    if (item.kind === 'investment') {
      return item.valuationDate ? tx('netWorthValueOn', { date: fmtDate(item.valuationDate) }) : tx('netWorthNoValue');
    }
    if (item.kind === 'fgts') return tx('netWorthFgtsHint');
    return null;
  };

  return (
    <div className="space-y-4">
      <PageHeader title={tx('netWorthTitle')} description={tx('netWorthDescription')} />

      <div role="tablist" aria-label={tx('netWorthPeriodLabel')} className="flex gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1 max-w-sm">
        {NET_WORTH_PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={months === p}
            onClick={() => setMonths(p)}
            className={`${TAB_CLS} ${months === p ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm' : 'text-gray-600 dark:text-gray-300'}`}
          >
            {p} {tx('netWorthMonthsUnit')}
          </button>
        ))}
      </div>

      {query.isLoading && <p className="text-sm text-gray-500" role="status">…</p>}
      {query.isError && (
        <div className={CARD_CLS} role="alert">
          <p className="text-sm text-red-600 dark:text-red-400">{tx('netWorthLoadError')}</p>
          <button type="button" className="mt-2 text-sm text-primary-600 hover:underline" onClick={() => query.refetch()}>{tx('netWorthRetry')}</button>
        </div>
      )}

      {data && last && (
        <>
          <section className={CARD_CLS} aria-labelledby="nw-total-label">
            <p id="nw-total-label" className="text-sm text-gray-500 dark:text-gray-300">{tx('netWorthTotalLabel', { month: monthLabel(last.month, true) })}</p>
            <p className={`mt-1 text-3xl sm:text-4xl font-light tracking-tight tabular-nums ${moneyClass(last.total)}`} data-testid="nw-total">{money(last.total)}</p>
            {change && previous && (
              <p className={`mt-1 text-sm ${change.amount < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                {change.percent === null
                  ? tx('netWorthChange', { amount: `${change.amount > 0 ? '+' : ''}${money(change.amount)}`, month: monthLabel(previous.month) })
                  : tx('netWorthChangePercent', { amount: `${change.amount > 0 ? '+' : ''}${money(change.amount)}`, percent: `${change.percent > 0 ? '+' : ''}${String(change.percent).replace('.', ',')}%`, month: monthLabel(previous.month) })}
              </p>
            )}
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{tx('netWorthFormula')}</p>
            {estimated.length > 0 && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                {tx('netWorthEstimatedNotice', { kinds: estimated.map((k) => tx(KIND_WORDS[k])).join(', ') })}
              </p>
            )}
          </section>

          <section className={CARD_CLS} aria-labelledby="nw-composition-title">
            <h2 id="nw-composition-title" className="text-base font-medium text-gray-900 dark:text-white">{tx('netWorthCompositionTitle')}</h2>
            {groups.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">{tx('netWorthEmpty')}</p>
            ) : (
              <div className="mt-3 space-y-4">
                {groups.map((g) => (
                  <div key={g.kind}>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">{tx(GROUP_TITLE[g.kind])}</h3>
                      {g.estimated && <span className={CHIP_CLS}>{tx('netWorthBadgeEstimated')}</span>}
                      <span className={`ml-auto text-sm font-medium tabular-nums ${moneyClass(g.total)}`}>{money(g.total)}</span>
                    </div>
                    <ul className="mt-1 divide-y divide-gray-100 dark:divide-gray-800">
                      {g.items.map((item) => {
                        const note = itemNote(item);
                        return (
                          <li key={`${item.kind}-${item.id}`} className="flex items-start justify-between gap-3 py-2">
                            <div className="min-w-0">
                              <p className="text-sm text-gray-900 dark:text-white break-words">{item.name}</p>
                              {note && <p className="text-xs text-gray-500 dark:text-gray-400">{note}</p>}
                            </div>
                            <span className={`text-sm tabular-nums whitespace-nowrap ${moneyClass(item.amount)}`}>{money(item.amount)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={CARD_CLS} aria-labelledby="nw-chart-title">
            <h2 id="nw-chart-title" className="mb-2 text-base font-medium text-gray-900 dark:text-white">{tx('netWorthChartTitle')}</h2>
            <NetWorthChart series={series} currency={currency} label={tx('netWorthChartLabel', { amount: money(last.total) })} />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{tx('netWorthHistoryNotice')}</p>
          </section>

          <section className={CARD_CLS} aria-labelledby="nw-savings-title">
            <h2 id="nw-savings-title" className="text-base font-medium text-gray-900 dark:text-white">{tx('netWorthSavingsTitle')}</h2>
            {savings ? (
              <>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{tx('netWorthSavingsBasis', { month: monthLabel(savings.month) })}</p>
                <p className="mt-2 text-3xl font-light tabular-nums text-gray-900 dark:text-white" data-testid="nw-rate">{rateText(savings.savings.rate)}</p>
                <p className="text-xs text-gray-500">{tx('netWorthSavingsRate')}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-gray-600 dark:text-gray-300">{tx('netWorthSavingsIncome')}</dt>
                  <dd className="text-right tabular-nums text-gray-900 dark:text-white">{money(savings.savings.income)}</dd>
                  <dt className="text-gray-600 dark:text-gray-300">{tx('netWorthSavingsExpense')}</dt>
                  <dd className="text-right tabular-nums text-gray-900 dark:text-white">{money(savings.savings.expense)}</dd>
                  <dt className="text-gray-600 dark:text-gray-300">{tx('netWorthSavingsSurplus')}</dt>
                  <dd className={`text-right tabular-nums ${moneyClass(savings.savings.surplus)}`}>{money(savings.savings.surplus)}</dd>
                  <dt className="text-gray-600 dark:text-gray-300">
                    {tx('netWorthSavingsContributed')} <span className="text-xs text-gray-500">({tx('netWorthSavingsContributedHint')})</span>
                  </dt>
                  <dd className="text-right tabular-nums text-gray-900 dark:text-white">{money(savings.savings.contributed)}</dd>
                </dl>
              </>
            ) : (
              <p className="mt-2 text-sm text-gray-500">{tx('netWorthSavingsNone')}</p>
            )}
          </section>
        </>
      )}

      {investAccounts.length > 0 ? (
        <ValuationForm accounts={investAccounts} currency={currency} />
      ) : (
        accounts.data && (
          <section className={CARD_CLS}>
            <h2 className="text-base font-medium text-gray-900 dark:text-white">{tx('netWorthValuationTitle')}</h2>
            <p className="mt-1 text-sm text-gray-500">{tx('netWorthValuationNoAccount')}</p>
          </section>
        )
      )}
    </div>
  );
};

export default NetWorth;

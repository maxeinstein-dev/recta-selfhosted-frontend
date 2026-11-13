import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { useI18n } from '../context/I18nContext';
import { useCurrency } from '../context/CurrencyContext';
import { useDefaultHousehold } from '../hooks/useDefaultHousehold';
import { useMonthClose, useSaveMonthClosing } from '../hooks/api/useMonthClose';
import { formatCurrency } from '../utils/format';
import { monthLabel } from '../utils/cashFlow';
import {
  blockerHref,
  blockerTextKey,
  blockerTotal,
  conferenceState,
  defaultCloseMonth,
  differenceCents,
  monthRange,
  parseInformedBalance,
  shiftMonth,
  type MonthCloseBlocker,
  type MonthCloseConference,
} from '../utils/monthClose';
import { monthCloseText, type MonthCloseTextKey } from '../utils/monthCloseTexts';

const CARD_CLS = 'rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 space-y-3';
const BTN_CLS = 'min-h-[44px] rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 text-sm text-gray-900 dark:text-white disabled:opacity-50';

type Tx = (key: MonthCloseTextKey, vars?: Record<string, string | number>) => string;

const todayKey = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const shortDay = (iso: string): string => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dayLabel = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/** The pending items of a block, each with the link to where it is solved. */
const Blockers = ({ blockers, month, accountId, tx, currency }: { blockers: MonthCloseBlocker[]; month: string; accountId?: string; tx: Tx; currency: string }) => {
  if (blockers.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm font-light text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        {tx('monthCloseOk')}
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {blockers.map((blocker) => {
        const href = blockerHref(blocker.code, { month, accountId });
        const text = tx(blockerTextKey(blocker.code), { count: blocker.count, amount: formatCurrency(blocker.amount ?? 0, currency) });
        return (
          <li key={blocker.code} className="flex flex-wrap items-center justify-between gap-2 text-sm font-light text-amber-800 dark:text-amber-300">
            <span className="flex min-w-0 items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="break-words">{text}</span>
            </span>
            {href && (
              <Link to={href} className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm text-gray-900 underline dark:text-white">
                {tx('monthCloseGo')}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
};

/** What the last recorded conference says, and when. */
const ConferenceNote = ({ closing, tx, currency }: { closing: MonthCloseConference | null; tx: Tx; currency: string }) => {
  const state = conferenceState(closing);
  if (!closing || state === 'none') return null;
  const date = shortDay(closing.closedAt);
  if (state === 'changed') {
    return <p role="status" className="text-sm font-light text-amber-800 dark:text-amber-300">{tx('monthCloseChanged', { date })}</p>;
  }
  if (state === 'differs') {
    return <p role="status" className="text-sm font-light text-red-600 dark:text-red-400">{tx('monthCloseConferredDiffers', { date, amount: formatCurrency(Math.abs(closing.difference), currency) })}</p>;
  }
  return <p role="status" className="text-sm font-light text-emerald-700 dark:text-emerald-400">{tx('monthCloseConferredOn', { date })}</p>;
};

/** The statement balance field, the live difference and the button that records the conference. */
const ConferenceForm = ({
  householdId,
  month,
  accountId,
  systemValue,
  label,
  closing,
  currency,
  tx,
}: {
  householdId: string;
  month: string;
  accountId: string;
  systemValue: number;
  label: string;
  closing: MonthCloseConference | null;
  currency: string;
  tx: Tx;
}) => {
  const [text, setText] = useState('');
  const save = useSaveMonthClosing();
  const inputId = `informed-${accountId}`;
  const typed = text.trim() === '' ? null : parseInformedBalance(text);
  const invalid = text.trim() !== '' && typed === null;
  const diff = typed === null ? null : differenceCents(typed, systemValue);

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (typed === null) return;
        save.mutate({ householdId, month, accountId, informedBalance: typed }, { onSuccess: () => setText('') });
      }}
    >
      <label htmlFor={inputId} className="flex flex-col gap-1 text-sm font-light text-gray-600 dark:text-gray-400">
        {label}
        <input
          id={inputId}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={tx('monthCloseInformedHint')}
          aria-invalid={invalid}
          className="min-h-[44px] w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 text-sm text-gray-900 dark:text-white"
        />
      </label>
      {invalid && <p role="alert" className="text-sm font-light text-red-600 dark:text-red-400">{tx('monthCloseInvalidAmount')}</p>}
      {diff !== null && (
        <p aria-live="polite" className={`text-sm ${diff === 0 ? 'font-light text-emerald-700 dark:text-emerald-400' : 'font-medium text-red-600 dark:text-red-400'}`}>
          {diff === 0
            ? tx('monthCloseMatches')
            : tx('monthCloseDiffers', { amount: formatCurrency(Math.abs(diff) / 100, currency), direction: diff > 0 ? tx('monthCloseMore') : tx('monthCloseLess') })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={typed === null || save.isPending} className={BTN_CLS}>
          {save.isPending ? tx('monthCloseSaving') : tx('monthCloseConfer')}
        </button>
        <ConferenceNote closing={closing} tx={tx} currency={currency} />
      </div>
      {save.isError && <p role="alert" className="text-sm font-light text-red-600 dark:text-red-400">{tx('monthCloseSaveError')}</p>}
    </form>
  );
};

/** The month close page: for a month, is everything conferred? Read-only except for recording a conference. */
const MonthClose = () => {
  const { t } = useI18n();
  const tx: Tx = (key, vars) => monthCloseText(t, key, vars);
  const { householdId } = useDefaultHousehold();
  const { baseCurrency } = useCurrency();
  const [month, setMonth] = useState(() => defaultCloseMonth(todayKey()));
  const query = useMonthClose({ householdId, month });
  const data = query.data;
  const lastDay = dayLabel(monthRange(month).end);
  const stateText = (state: 'open' | 'closed' | 'paid') => tx(state === 'open' ? 'monthCloseStateOpen' : state === 'closed' ? 'monthCloseStateClosed' : 'monthCloseStatePaid');

  let body;
  if (!householdId || query.isPending) {
    body = <p role="status" className="text-sm font-light text-gray-500 dark:text-gray-400">{tx('monthCloseLoading')}</p>;
  } else if (query.isError || !data) {
    body = (
      <div className="space-y-3">
        <p role="alert" className="text-sm font-light text-red-600 dark:text-red-400">{tx('monthCloseLoadError')}</p>
        <button type="button" onClick={() => void query.refetch()} className={BTN_CLS}>{tx('monthCloseRetry')}</button>
      </div>
    );
  } else {
    const total = blockerTotal(data);
    body = (
      <div className="space-y-6">
        <p
          role="status"
          className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${total === 0 ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'}`}
        >
          {total === 0 ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />}
          {total === 0 ? tx('monthCloseAllDone') : tx('monthClosePendingCount', { count: total })}
        </p>

        <section className="space-y-3" aria-label={tx('monthCloseAccountsTitle')}>
          <h2 className="text-sm font-medium text-gray-900 dark:text-white">{tx('monthCloseAccountsTitle')}</h2>
          {data.accounts.length === 0 && <p className="text-sm font-light text-gray-500 dark:text-gray-400">{tx('monthCloseNoAccounts')}</p>}
          {data.accounts.map((account) => (
            <article key={account.accountId} className={CARD_CLS} aria-label={account.name}>
              <header className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white">{account.name}</h3>
                <p className="text-xs font-light text-gray-500 dark:text-gray-400">{tx('monthCloseSystemBalance', { date: lastDay })}</p>
              </header>
              <p className={`text-base font-medium ${account.systemBalance < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{formatCurrency(account.systemBalance, baseCurrency)}</p>
              <Blockers blockers={account.blockers} month={month} accountId={account.accountId} tx={tx} currency={baseCurrency} />
              <ConferenceForm key={`${month}:${account.accountId}`} householdId={householdId} month={month} accountId={account.accountId} systemValue={account.systemBalance} label={tx('monthCloseInformedLabel')} closing={account.closing} currency={baseCurrency} tx={tx} />
            </article>
          ))}
        </section>

        {data.cards.length > 0 && (
          <section className="space-y-3" aria-label={tx('monthCloseCardsTitle')}>
            <h2 className="text-sm font-medium text-gray-900 dark:text-white">{tx('monthCloseCardsTitle')}</h2>
            {data.cards.map((card) => (
              <article key={card.accountId} className={CARD_CLS} aria-label={card.name}>
                <header className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white">{card.name}</h3>
                  <p className="text-xs font-light text-gray-500 dark:text-gray-400">{tx('monthCloseInvoiceState', { state: stateText(card.state) })}</p>
                </header>
                <p className="text-xs font-light text-gray-500 dark:text-gray-400">{tx('monthCloseInvoiceTotal')}</p>
                <p className="text-base font-medium text-gray-900 dark:text-white">{formatCurrency(card.invoiceTotal, baseCurrency)}</p>
                <Blockers blockers={card.blockers} month={month} accountId={card.accountId} tx={tx} currency={baseCurrency} />
                <ConferenceForm key={`${month}:${card.accountId}`} householdId={householdId} month={month} accountId={card.accountId} systemValue={card.invoiceTotal} label={tx('monthCloseInformedLabelCard')} closing={card.closing} currency={baseCurrency} tx={tx} />
              </article>
            ))}
          </section>
        )}

        <section className="space-y-3" aria-label={tx('monthCloseGeneralTitle')}>
          <h2 className="text-sm font-medium text-gray-900 dark:text-white">{tx('monthCloseGeneralTitle')}</h2>
          <div className={CARD_CLS}>
            <Blockers blockers={data.general.blockers} month={month} tx={tx} currency={baseCurrency} />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={tx('monthCloseTitle')} description={tx('monthCloseDescription')} />
      <div className="mb-4 flex max-w-2xl items-center justify-between gap-2" role="group" aria-label={tx('monthCloseTitle')}>
        <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label={tx('monthClosePrevious')} className={`${BTN_CLS} w-11 px-0`}>
          <ChevronLeft className="mx-auto h-5 w-5" aria-hidden="true" />
        </button>
        <p className="text-base font-medium capitalize text-gray-900 dark:text-white" aria-live="polite">{monthLabel(month)}</p>
        <button type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label={tx('monthCloseNext')} className={`${BTN_CLS} w-11 px-0`}>
          <ChevronRight className="mx-auto h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="max-w-2xl">{body}</div>
    </div>
  );
};

export default MonthClose;

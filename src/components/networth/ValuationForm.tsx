import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useI18n } from '../../context/I18nContext';
import { useToastContext } from '../../context/ToastContext';
import { useAccountValuations, useDeleteValuation, useSaveValuation } from '../../hooks/api/useNetWorth';
import { formatCurrency } from '../../utils/format';
import { maskMoneyInput, todayIsoDate } from '../../utils/adjustBalance';
import { suggestedValuationDate, valuationBody, type ValuationError } from '../../utils/netWorth';
import { netWorthText, type NetWorthTextKey } from '../../utils/netWorthTexts';
import { BTN_PRIMARY, ERROR_CLS, INPUT_CLS, LABEL_CLS, MUTED_CLS, fmtDate, getErrorMessage } from '../people/ui';

interface ValuationFormProps {
  accounts: Array<{ id: string; name: string }>;
  currency: string;
}

const ERROR_KEY: Record<ValuationError, NetWorthTextKey> = {
  date: 'netWorthErrorDate',
  future: 'netWorthErrorFuture',
  amount: 'netWorthErrorAmount',
};

/** The market value of an investment account on a day (what the broker statement says), and the values already informed. */
export default function ValuationForm({ accounts, currency }: ValuationFormProps) {
  const { t } = useI18n();
  const tx = (key: NetWorthTextKey, vars?: Record<string, string | number>) => netWorthText(t, key, vars);
  const { success, error: showError } = useToastContext();
  const save = useSaveValuation();
  const remove = useDeleteValuation();

  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [date, setDate] = useState(() => suggestedValuationDate(todayIsoDate()));
  const [amountText, setAmountText] = useState('');
  const [error, setError] = useState<ValuationError | null>(null);

  // The chosen account may disappear (archived elsewhere): fall back to the first one.
  useEffect(() => {
    if (!accounts.some((a) => a.id === accountId)) setAccountId(accounts[0]?.id ?? '');
  }, [accounts, accountId]);

  const history = useAccountValuations(accountId || undefined);
  const existing = useMemo(() => (history.data ?? []).find((v) => v.date === date), [history.data, date]);
  const masked = maskMoneyInput(amountText);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = valuationBody({ date, cents: masked.cents }, todayIsoDate());
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    try {
      await save.mutateAsync({ accountId, ...result.body });
      setAmountText('');
      success(tx('netWorthValuationSaved'));
    } catch (e) {
      showError(getErrorMessage(e, tx('netWorthLoadError')));
    }
  };

  const onDelete = async (valuationId: string) => {
    try {
      await remove.mutateAsync({ accountId, valuationId });
      success(tx('netWorthValuationDeleted'));
    } catch (e) {
      showError(getErrorMessage(e, tx('netWorthLoadError')));
    }
  };

  return (
    <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-4" aria-labelledby="nw-valuation-title">
      <div>
        <h2 id="nw-valuation-title" className="text-base font-medium text-gray-900 dark:text-white">{tx('netWorthValuationTitle')}</h2>
        <p className={`mt-1 text-sm ${MUTED_CLS}`}>{tx('netWorthValuationIntro')}</p>
      </div>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3" noValidate>
        {accounts.length > 1 && (
          <div className="sm:col-span-3">
            <label htmlFor="nw-val-account" className={LABEL_CLS}>{tx('netWorthValuationAccount')}</label>
            <select id="nw-val-account" className={INPUT_CLS} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="nw-val-date" className={LABEL_CLS}>{tx('netWorthValuationDate')}</label>
          <input id="nw-val-date" type="date" className={INPUT_CLS} value={date} max={todayIsoDate()} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor="nw-val-amount" className={LABEL_CLS}>{tx('netWorthValuationAmount')}</label>
          <input
            id="nw-val-amount"
            inputMode="numeric"
            autoComplete="off"
            className={INPUT_CLS}
            placeholder="R$ 0,00"
            value={masked.display}
            onChange={(e) => setAmountText(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <button type="submit" className={`${BTN_PRIMARY} w-full min-h-[44px]`} disabled={save.isPending || !accountId}>
            {save.isPending ? tx('netWorthValuationSaving') : tx('netWorthValuationSave')}
          </button>
        </div>
        {error && <p role="alert" className={`sm:col-span-3 ${ERROR_CLS}`}>{tx(ERROR_KEY[error])}</p>}
        {existing && !error && (
          <p className={`sm:col-span-3 text-xs ${MUTED_CLS}`}>{tx('netWorthValuationReplaceHint')}</p>
        )}
      </form>

      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">{tx('netWorthValuationHistory')}</h3>
        {(history.data ?? []).length === 0 ? (
          <p className={`mt-1 text-sm ${MUTED_CLS}`}>{tx('netWorthValuationNoHistory')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-200 dark:divide-gray-800">
            {(history.data ?? []).map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-gray-900 dark:text-white">{fmtDate(v.date)}</span>
                <span className="ml-auto font-medium tabular-nums text-gray-900 dark:text-white">{formatCurrency(v.amount, currency)}</span>
                <button
                  type="button"
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md text-gray-500 hover:text-red-600"
                  aria-label={tx('netWorthValuationDelete', { date: fmtDate(v.date) })}
                  onClick={() => onDelete(v.id)}
                  disabled={remove.isPending}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

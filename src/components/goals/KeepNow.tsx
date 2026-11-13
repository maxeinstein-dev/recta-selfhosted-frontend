import { useCallback, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import ConfirmModal from '../ConfirmModal';
import { useI18n } from '../../context/I18nContext';
import { useCurrency } from '../../context/CurrencyContext';
import { useToastContext } from '../../context/ToastContext';
import { useContributeToGoal } from '../../hooks/api/useSavingsGoals';
import { formatCurrency } from '../../utils/format';
import type { CashFlowEvent } from '../../utils/cashFlow';
import { cashFlowText } from '../../utils/cashFlowTexts';
import { contributionErrorKey, reserveText, isDuplicateContribution, maxAllowedOf, type AccountSplit } from '../../utils/savingsGoalsPlan';
import { goalsText, type GoalsTextKey } from '../../utils/savingsGoalsTexts';

export interface KeepRequest {
  goalId: string;
  name: string;
  /** Omit to keep the month's planned amount. */
  amountCents?: number | null;
  /** 'YYYY-MM-DD'; omit for today. */
  date?: string | null;
}

/**
 * "Guardar agora": records a contribution of a goal (no entry, the account balance does not change). When the month
 * already has one the server answers 409: the dialog asks and, on yes, sends the same request again with
 * confirmDuplicate. One call at a time. Resolves true when a contribution was recorded.
 */
export function useKeepNow(opts: { successText?: (req: KeepRequest, amount: number) => string } = {}) {
  const { t } = useI18n();
  const { baseCurrency } = useCurrency();
  const { success, error: showError } = useToastContext();
  const { mutateAsync } = useContributeToGoal();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ req: KeepRequest; resolve: (ok: boolean) => void } | null>(null);
  const inFlight = useRef(false);
  const tx = useCallback((key: GoalsTextKey, vars?: Record<string, string | number>) => goalsText(t, key, vars), [t]);
  const successText = opts.successText;

  const send = useCallback(
    async (req: KeepRequest, confirmDuplicate: boolean): Promise<'ok' | 'duplicate' | 'error'> => {
      setBusyId(req.goalId);
      try {
        const result = await mutateAsync({ goalId: req.goalId, amountCents: req.amountCents, date: req.date, confirmDuplicate });
        const amount = Number(result?.contribution?.amount) || 0;
        success(successText ? successText(req, amount) : tx('goalsKeptToast', { amount: formatCurrency(amount, baseCurrency), name: req.name }));
        return 'ok';
      } catch (err) {
        if (!confirmDuplicate && isDuplicateContribution(err)) return 'duplicate';
        const key = contributionErrorKey(err);
        const max = maxAllowedOf(err);
        showError(tx(key, { amount: formatCurrency(max ?? 0, baseCurrency) }));
        return 'error';
      } finally {
        setBusyId(null);
      }
    },
    [mutateAsync, success, showError, tx, baseCurrency, successText],
  );

  const keep = useCallback(
    async (req: KeepRequest): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      try {
        const first = await send(req, false);
        if (first !== 'duplicate') return first === 'ok';
        const confirmed = await new Promise<boolean>((resolve) => setDuplicate({ req, resolve }));
        if (!confirmed) return false;
        return (await send(req, true)) === 'ok';
      } finally {
        inFlight.current = false;
      }
    },
    [send],
  );

  const close = (ok: boolean) => {
    duplicate?.resolve(ok);
    setDuplicate(null);
  };

  const dialog = (
    <ConfirmModal
      isOpen={!!duplicate}
      onClose={() => close(false)}
      onConfirm={() => close(true)}
      title={tx('goalsDuplicateTitle')}
      message={tx('goalsDuplicateMessage', { name: duplicate?.req.name ?? '' })}
      confirmText={tx('goalsDuplicateConfirm')}
      variant="warning"
    />
  );

  return { keep, busyId, busy: busyId !== null || !!duplicate, dialog };
}

/** Balance, free and kept money of one account; a warning when what is kept goes past the balance. */
export function AccountSplitPanel({ split, accountName, currency, variant = 'plain' }: { split: AccountSplit; accountName: string; currency: string; variant?: 'plain' | 'compact' }) {
  const { t } = useI18n();
  const tx = (key: GoalsTextKey, vars?: Record<string, string | number>) => goalsText(t, key, vars);
  const money = (cents: number) => formatCurrency(cents / 100, currency);
  const cell = variant === 'compact' ? 'p-2' : 'p-3';
  return (
    <div className="space-y-2" data-testid="account-split">
      <dl className="grid grid-cols-3 gap-2">
        <div className={`${cell} rounded-lg border border-gray-100 dark:border-gray-800`}>
          <dt className="text-xs font-light text-gray-500 dark:text-gray-400">{tx('goalsAccountBalance')}</dt>
          <dd className="mt-1 text-sm font-medium text-gray-900 dark:text-white tabular-nums">{money(split.balanceCents)}</dd>
        </div>
        <div className={`${cell} rounded-lg border ${split.negative ? 'border-red-300 dark:border-red-800' : 'border-gray-100 dark:border-gray-800'}`}>
          <dt className="text-xs font-light text-gray-500 dark:text-gray-400">{tx('goalsAccountFree')}</dt>
          <dd className={`mt-1 text-sm font-medium tabular-nums ${split.negative ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{money(split.freeCents)}</dd>
        </div>
        <div className={`${cell} rounded-lg border border-gray-100 dark:border-gray-800`}>
          <dt className="text-xs font-light text-gray-500 dark:text-gray-400">{tx('goalsAccountKept')}</dt>
          <dd className="mt-1 text-sm font-medium text-blue-600 dark:text-blue-400 tabular-nums">{money(split.allocatedCents)}</dd>
        </div>
      </dl>
      {split.negative && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-2 text-xs font-light text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{tx('goalsFreeNegative', { account: accountName, amount: money(split.freeCents) })}</span>
        </p>
      )}
    </div>
  );
}

/**
 * "Marcar como feito" of a `reserve` event of the cash flow: records the goal's contribution dated on the event's day
 * (an overdue one is already moved to today by the API). Nothing for any other source.
 */
export function ReserveDoneButton({ event, keepNow, variant = 'plain' }: { event: CashFlowEvent; keepNow: ReturnType<typeof useKeepNow>; variant?: 'plain' | 'rc' }) {
  const { t } = useI18n();
  if (event.source !== 'reserve') return null;
  const name = reserveText(event.description, null);
  const mine = keepNow.busyId === event.sourceId;
  const cls = variant === 'rc' ? 'border-rc-line text-rc-ink' : 'border-gray-200 text-gray-900 dark:border-gray-800 dark:text-white';
  return (
    <button
      type="button"
      disabled={keepNow.busy}
      aria-label={cashFlowText(t, 'cashFlowMarkReserveDoneFor', { name })}
      onClick={() => void keepNow.keep({ goalId: event.sourceId, name, date: event.date })}
      className={`mt-2 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium disabled:opacity-60 ${cls}`}
    >
      {mine && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {cashFlowText(t, 'cashFlowMarkReserveDone')}
    </button>
  );
}

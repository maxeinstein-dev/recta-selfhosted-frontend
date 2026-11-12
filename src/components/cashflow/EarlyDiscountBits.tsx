import { useCallback, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useI18n } from '../../context/I18nContext';
import { useCurrency } from '../../context/CurrencyContext';
import { useToastContext } from '../../context/ToastContext';
import { usePayNextOccurrence } from '../../hooks/api/useRecurringTransactions';
import { formatCurrency } from '../../utils/format';
import { shortDate } from '../../utils/cashFlow';
import { canPayNow, earlyDiscountNotice, noticeLines, payNextErrorKey, type CashFlowEarlyDiscount, type EarlyDiscountQuote } from '../../utils/earlyDiscount';
import { earlyDiscountText, type EarlyDiscountTextKey } from '../../utils/earlyDiscountTexts';

/** 'plain': the gray/blue theme of the desktop pages; 'rc': the tokens of the mobile shell. */
export type DiscountVariant = 'plain' | 'rc';

const NOTICE_CLS: Record<DiscountVariant, { calm: string; urgent: string }> = {
  plain: {
    calm: 'text-emerald-700 dark:text-emerald-400',
    urgent: 'rounded-md bg-amber-100 px-2 py-1 font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  },
  rc: {
    calm: 'text-rc-green',
    urgent: 'rounded-md bg-rc-amberSoft px-2 py-1 font-semibold text-rc-amber',
  },
};

/**
 * "Pague até {data} e economize R$ X": shown while the discount can still be had; from the day after the limit the
 * notice is gone. The last days (the three before the limit and the limit day) are highlighted and say how many are left.
 */
export function EarlyDiscountNotice({ quote, today, currency, variant = 'plain' }: { quote: EarlyDiscountQuote | null | undefined; today: string | undefined; currency: string; variant?: DiscountVariant }) {
  const { t } = useI18n();
  const notice = today ? earlyDiscountNotice(quote, today) : null;
  if (!notice) return null;
  const lines = noticeLines(notice, shortDate, (value) => formatCurrency(value, currency), t);
  const cls = NOTICE_CLS[variant];
  return (
    <p data-testid="early-discount-notice" data-urgent={lines.urgent ? 'true' : 'false'} className={`mt-1.5 inline-block max-w-full break-words text-xs ${lines.urgent ? cls.urgent : `font-light ${cls.calm}`}`}>
      {lines.text}
      {lines.hint ? ` · ${lines.hint}` : ''}
    </p>
  );
}

/**
 * Pays the next occurrence of a recurrence ahead (pay-next). One call at a time: a second tap while one runs is ignored
 * here (the server would refuse it with a 409, but it should not get that far). A 409 or 400 becomes a clear message.
 * Resolves with the created transaction id, or null when nothing was paid.
 */
export function usePayNow() {
  const { t } = useI18n();
  const { baseCurrency } = useCurrency();
  const { success, error: showError } = useToastContext();
  const { mutateAsync } = usePayNextOccurrence();
  const inFlight = useRef(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const text = useCallback((key: EarlyDiscountTextKey, vars?: Record<string, string | number>) => earlyDiscountText(t, key, vars), [t]);

  const payNow = useCallback(
    async (recurringId: string): Promise<string | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setBusyId(recurringId);
      try {
        const result = await mutateAsync({ recurringId });
        const paid = Number(result.transaction?.amount);
        success(Number.isFinite(paid) ? text('earlyPaidToast', { amount: formatCurrency(Math.abs(paid), baseCurrency) }) : text('earlyPaidToastPlain'));
        return result.transaction?.id ?? null;
      } catch (err) {
        showError(text(payNextErrorKey((err as { status?: number } | null)?.status)));
        return null;
      } finally {
        inFlight.current = false;
        setBusyId(null);
      }
    },
    [mutateAsync, success, showError, text, baseCurrency],
  );

  return { payNow, busyId, busy: busyId !== null };
}

/** "Pagar agora": only for an event the API says can be paid now (canPayNow true). 44 px, disabled while the call runs. */
export function PayNowButton({ discount, name, pay, variant = 'plain' }: { discount: CashFlowEarlyDiscount | null | undefined; name: string; pay: ReturnType<typeof usePayNow>; variant?: DiscountVariant }) {
  const { t } = useI18n();
  if (!discount || !canPayNow(discount)) return null;
  const mine = pay.busyId === discount.recurringId;
  const cls =
    variant === 'rc'
      ? 'bg-rc-accent text-rc-onAccent'
      : 'bg-primary-600 text-white dark:bg-primary-500';
  return (
    <button
      type="button"
      disabled={pay.busy}
      aria-label={earlyDiscountText(t, 'earlyPayNowFor', { name })}
      onClick={() => void pay.payNow(discount.recurringId)}
      className={`mt-2 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium disabled:opacity-60 ${cls}`}
    >
      {mine && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {mine ? earlyDiscountText(t, 'earlyPaying') : earlyDiscountText(t, 'earlyPayNow')}
    </button>
  );
}

import { useId } from 'react';
import { useI18n } from '../../context/I18nContext';
import { useCurrency } from '../../context/CurrencyContext';
import { formatCurrency } from '../../utils/format';
import { discountPreview, validateDraft, type EarlyDiscountDraft, type EarlyDiscountType } from '../../utils/earlyDiscount';
import { earlyDiscountText, type EarlyDiscountTextKey } from '../../utils/earlyDiscountTexts';

interface EarlyDiscountFieldProps {
  draft: EarlyDiscountDraft;
  onChange: (draft: EarlyDiscountDraft) => void;
  /** The amount the recurrence carries (money units): the discount is checked and previewed against it. */
  amount: number;
  /** Show the errors even before the fields were touched (after a submit attempt). */
  showErrors?: boolean;
  disabled?: boolean;
}

const INPUT_CLS =
  'block w-full min-h-[44px] px-3 py-2.5 border rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:border-primary-500 dark:focus:border-primary-500 text-base sm:text-sm font-light tracking-tight';
const LABEL_CLS = 'block text-sm font-light text-gray-500 dark:text-gray-400 mb-2';

/**
 * "Desconto se pagar até o dia": the optional early-payment discount of a recurrence (day of the month, fixed reais or
 * percent, value) with the discounted amount shown as it is typed. Blank day and value mean no discount. Used by the
 * Recorrências form and by the recurrence block of the new-transaction form.
 */
export const EarlyDiscountField = ({ draft, onChange, amount, showErrors = false, disabled = false }: EarlyDiscountFieldProps) => {
  const { t } = useI18n();
  const { baseCurrency } = useCurrency();
  const uid = useId();
  const tx = (key: EarlyDiscountTextKey, vars?: Record<string, string | number>) => earlyDiscountText(t, key, vars);

  const result = validateDraft(draft, amount);
  const touched = showErrors || draft.day.trim() !== '' || draft.value.trim() !== '';
  const error = touched && !result.ok ? result : null;
  const preview = discountPreview(draft, amount);

  const set = (patch: Partial<EarlyDiscountDraft>) => onChange({ ...draft, ...patch });
  const border = (field: 'day' | 'value') => (error?.field === field ? 'border-red-300 dark:border-red-600' : 'border-gray-200 dark:border-gray-800');
  const typeBtn = (type: EarlyDiscountType, label: string) => (
    <button
      key={type}
      type="button"
      role="radio"
      aria-checked={draft.type === type}
      disabled={disabled}
      onClick={() => set({ type })}
      className={`min-h-[44px] flex-1 px-3 text-sm font-light rounded-md transition-colors disabled:opacity-60 ${
        draft.type === type ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm' : 'text-gray-600 dark:text-gray-400'
      }`}
    >
      {label}
    </button>
  );

  return (
    <fieldset data-testid="early-discount-field" className="space-y-3 min-w-0">
      <legend className="sr-only">{tx('earlyDiscountTitle')}</legend>
      <div>
        <label htmlFor={`${uid}-day`} className={LABEL_CLS}>
          {tx('earlyDiscountDayLabel')}
        </label>
        <input
          id={`${uid}-day`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={2}
          value={draft.day}
          disabled={disabled}
          onChange={(e) => set({ day: e.target.value.replace(/\D/g, '') })}
          aria-invalid={error?.field === 'day'}
          aria-describedby={`${uid}-help`}
          className={`${INPUT_CLS} ${border('day')}`}
        />
        <p id={`${uid}-help`} className="mt-1 text-xs font-light text-gray-500 dark:text-gray-400">
          {tx('earlyDiscountDayHelp')}
        </p>
      </div>

      <div>
        <span className={LABEL_CLS}>{tx('earlyDiscountTypeLabel')}</span>
        <div role="radiogroup" aria-label={tx('earlyDiscountTypeLabel')} className="flex gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
          {typeBtn('FIXED', tx('earlyDiscountTypeFixed'))}
          {typeBtn('PERCENT', tx('earlyDiscountTypePercent'))}
        </div>
      </div>

      <div>
        <label htmlFor={`${uid}-value`} className={LABEL_CLS}>
          {draft.type === 'PERCENT' ? tx('earlyDiscountValueLabelPercent') : tx('earlyDiscountValueLabelFixed')}
        </label>
        <input
          id={`${uid}-value`}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={draft.value}
          disabled={disabled}
          onChange={(e) => set({ value: e.target.value.replace(/[^\d.,]/g, '') })}
          aria-invalid={error?.field === 'value'}
          className={`${INPUT_CLS} ${border('value')}`}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {tx(error.key)}
        </p>
      )}
      {preview && (
        <p role="status" className="text-sm font-light text-gray-700 dark:text-gray-300">
          {tx('earlyDiscountPreview', {
            day: draft.day.trim(),
            discounted: formatCurrency(preview.discountedCents / 100, baseCurrency),
            savings: formatCurrency(preview.savingsCents / 100, baseCurrency),
          })}
          {draft.type === 'PERCENT' ? ` ${tx('earlyDiscountPreviewPercentNote')}` : ''}
        </p>
      )}
    </fieldset>
  );
};

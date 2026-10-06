import { useI18n } from '../../context/I18nContext';
import SelectCombobox from '../SelectCombobox';
import { OFFSET_OPTIONS, monthLabel, offsetFromSelect, offsetLabel, offsetToSelect, referenceMonthError } from '../../utils/referenceMonth';

interface ReferenceMonthFieldProps {
  enabled: boolean;
  month: string;
  /** The transaction date: the reference month must stay within 24 months of it. */
  date: Date | string;
  onEnabledChange: (enabled: boolean) => void;
  onMonthChange: (month: string) => void;
  disabled?: boolean;
}

/** "Referente a outro mês": an optional reference month for one transaction (default off = the month of its date). */
export const ReferenceMonthField = ({ enabled, month, date, onEnabledChange, onMonthChange, disabled = false }: ReferenceMonthFieldProps) => {
  const { t } = useI18n();
  const error = enabled ? referenceMonthError(month, date) : null;
  return (
    <div data-testid="reference-month-field">
      <div className="flex items-center">
        <input
          type="checkbox"
          id="reference-month-toggle"
          checked={enabled}
          disabled={disabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className={`h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
        />
        <label htmlFor="reference-month-toggle" className="ml-2 block text-sm text-gray-900 dark:text-gray-100 cursor-pointer">
          {t.referenceMonthToggle || 'Referente a outro mês'}
        </label>
      </div>
      {enabled && (
        <div className="mt-2">
          <label htmlFor="reference-month-input" className="block text-sm font-light text-gray-500 dark:text-gray-400 mb-2">
            {t.referenceMonthLabel || 'Mês de referência'}
          </label>
          <input
            id="reference-month-input"
            type="month"
            value={month}
            disabled={disabled}
            onChange={(e) => onMonthChange(e.target.value)}
            aria-invalid={error ? true : undefined}
            className="block w-full px-3 py-2.5 border border-gray-200 dark:border-gray-800 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:border-primary-500 sm:text-sm font-light tracking-tight"
          />
          {error ? (
            <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : (
            <p className="mt-1 text-xs font-light text-gray-500 dark:text-gray-400">
              {t.referenceMonthHelp || 'O saldo muda na data da transação; os totais do mês usam o mês de referência.'}
              {month ? ` (${monthLabel(month)})` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

interface ReferenceOffsetFieldProps {
  /** The offset in months (null = same month). */
  value: number | null;
  onChange: (offset: number | null) => void;
  disabled?: boolean;
}

/** "Referente a: mesmo mês / mês seguinte / em 2 meses" of a recurrence. */
export const ReferenceOffsetField = ({ value, onChange, disabled = false }: ReferenceOffsetFieldProps) => {
  const { t } = useI18n();
  const label = (n: number): string => {
    if (n === 0) return t.referenceSameMonth || offsetLabel(0);
    if (n === 1) return t.referenceNextMonth || offsetLabel(1);
    return (t.referenceInMonths || 'Em {n} meses').replace('{n}', String(n));
  };
  const options = [...OFFSET_OPTIONS.map((o) => ({ value: String(o.value), label: label(o.value) }))];
  // An offset a recurrence already has outside the three common ones (e.g. 3) must stay selectable.
  if (typeof value === 'number' && !OFFSET_OPTIONS.some((o) => o.value === value)) options.push({ value: String(value), label: label(value) });
  return (
    <div data-testid="reference-offset-field">
      <label className="block text-sm font-light text-gray-500 dark:text-gray-400 mb-2">
        {t.referenceToLabel || 'Referente a'}
      </label>
      <SelectCombobox
        value={offsetToSelect(value ?? 0)}
        onValueChange={(v: string) => onChange(offsetFromSelect(v))}
        options={options}
        placeholder={label(0)}
        disabled={disabled}
      />
      <p className="mt-1 text-xs font-light text-gray-500 dark:text-gray-400">
        {t.referenceMonthHelp || 'O saldo muda na data da transação; os totais do mês usam o mês de referência.'}
      </p>
    </div>
  );
};

import type { ReactNode } from 'react';
import SelectCombobox from '../SelectCombobox';
import { maskCents } from '../../utils/confirmReceipt';
import {
  CARNIVAL_LABEL, CORPUS_CHRISTI_LABEL, DAILY_RATE_LABEL, DEFAULT_WINDOW, FORECAST_FIELD_LABEL, FORECAST_STRATEGIES, NON_WORKING_HELP,
  NON_WORKING_LABEL, SAFETY_LABEL, STRATEGY_LABEL, WINDOW_LABEL, explainExpected, fieldsOfDraft, howCalculated, strategyHelp, validateForecast,
} from '../../utils/forecastStrategy';
import type { ForecastDraft, ForecastStrategy, Kind } from '../../utils/forecastStrategy';
import { monthLabel } from '../../utils/referenceMonth';
import { moneyText } from '../../utils/people';

interface ForecastStrategyFieldProps {
  draft: ForecastDraft;
  onChange: (next: ForecastDraft) => void;
  kind: Kind;
  /** Frequency of the recurrence as the form has it ('monthly' ...): the per-business-day mode needs a monthly one. */
  frequency: string;
  /** 'YYYY-MM' the next occurrence counts for: the month of the preview. */
  referenceMonth: string;
  /** Shown in the "último valor" mode only (the "acompanhar o último valor" checkbox). */
  lastExtra?: ReactNode;
  /** Shows the errors of fields not filled in yet (after a submit attempt). */
  showErrors?: boolean;
  format?: (cents: number) => string;
  disabled?: boolean;
}

const LABEL = 'block text-sm font-light text-gray-500 dark:text-gray-400 mb-2';
const INPUT =
  'block w-full px-3 py-2.5 border border-gray-200 dark:border-gray-800 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:border-primary-500 dark:focus:border-primary-500 sm:text-sm font-light tracking-tight';
const HELP = 'mt-1 text-xs font-light text-gray-500 dark:text-gray-400';
const ERR = 'mt-1 text-sm text-red-600 dark:text-red-400';
const CHECK = 'h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded';

/**
 * "Como prever o valor" of a recurrence: the four strategies of the occurrence amount and the fields of each. Controlled
 * by a `ForecastDraft` (pure logic in `utils/forecastStrategy.ts`): the form keeps the draft, validates it and sends it.
 */
export const ForecastStrategyField = ({
  draft, onChange, kind, frequency, referenceMonth, lastExtra, showErrors = false, format = moneyText, disabled = false,
}: ForecastStrategyFieldProps) => {
  const set = (patch: Partial<ForecastDraft>) => onChange({ ...draft, ...patch });
  const check = validateForecast(draft, frequency);
  const options = FORECAST_STRATEGIES.map((s) => ({ value: s, label: STRATEGY_LABEL[s] }));
  const rate = draft.dailyRateCents === null ? 0 : draft.dailyRateCents / 100;
  const preview = draft.strategy === 'PER_BUSINESS_DAY' && rate > 0 ? explainExpected(fieldsOfDraft(draft, rate), kind, [], referenceMonth) : null;
  // A rate not filled in is only an error once the user tried to save; a malformed number or date is one at once.
  const rateError = showErrors ? check.errors.dailyRate : undefined;

  return (
    <div className="space-y-3 min-w-0" data-testid="forecast-field">
      <div>
        <label className={LABEL} id="forecast-strategy-label">{FORECAST_FIELD_LABEL}</label>
        <div aria-labelledby="forecast-strategy-label" data-testid="forecast-strategy">
          <SelectCombobox
            value={draft.strategy}
            onValueChange={(value) => set({ strategy: value as ForecastStrategy })}
            options={options}
            placeholder={STRATEGY_LABEL.LAST}
            disabled={disabled}
          />
        </div>
        <p className={HELP} data-testid="forecast-help">{strategyHelp(draft.strategy, kind)}</p>
      </div>

      {draft.strategy === 'LAST' && lastExtra}

      {draft.strategy === 'CONSERVATIVE' && (
        <div>
          <label htmlFor="forecast-window" className={LABEL}>{WINDOW_LABEL}</label>
          <input
            id="forecast-window" type="text" inputMode="numeric" autoComplete="off" value={draft.windowText} disabled={disabled}
            placeholder={`Padrão: ${kind === 'INCOME' ? DEFAULT_WINDOW.INCOME : DEFAULT_WINDOW.EXPENSE}`}
            aria-invalid={check.errors.window ? true : undefined} className={INPUT}
            onChange={(e) => set({ windowText: e.target.value.replace(/\D/g, '').slice(0, 2) })}
          />
          {check.errors.window && <p role="alert" className={ERR}>{check.errors.window}</p>}
          <p className={HELP}>
            Com menos valores confirmados que isso, usa os que houver; sem nenhum, usa o valor cadastrado.
          </p>
        </div>
      )}

      {draft.strategy === 'PER_BUSINESS_DAY' && (
        <>
          <div>
            <label htmlFor="forecast-daily-rate" className={LABEL}>{DAILY_RATE_LABEL}</label>
            <input
              id="forecast-daily-rate" type="text" inputMode="numeric" autoComplete="off" disabled={disabled} placeholder="R$ 0,00"
              value={draft.dailyRateCents === null ? '' : format(draft.dailyRateCents)}
              aria-invalid={rateError ? true : undefined} className={INPUT}
              onChange={(e) => {
                const masked = maskCents(e.target.value, format);
                // Too many digits: keep what is there instead of clearing the field
                if (masked.cents === null && /\d/.test(e.target.value)) return;
                set({ dailyRateCents: masked.cents });
              }}
            />
            {rateError && <p role="alert" className={ERR}>{rateError}</p>}
          </div>

          <div>
            <label htmlFor="forecast-safety" className={LABEL}>{SAFETY_LABEL}</label>
            <input
              id="forecast-safety" type="text" inputMode="numeric" autoComplete="off" value={draft.safetyText} disabled={disabled} placeholder="0"
              aria-invalid={check.errors.safety ? true : undefined} className={INPUT}
              onChange={(e) => set({ safetyText: e.target.value.replace(/\D/g, '').slice(0, 2) })}
            />
            {check.errors.safety && <p role="alert" className={ERR}>{check.errors.safety}</p>}
            <p className={HELP}>Dias úteis que você prefere não contar, para a previsão ficar abaixo do que pode vir.</p>
          </div>

          <div>
            <label htmlFor="forecast-non-working" className={LABEL}>{NON_WORKING_LABEL}</label>
            <input
              id="forecast-non-working" type="text" autoComplete="off" value={draft.nonWorkingText} disabled={disabled} placeholder="24/06, 08/07"
              aria-invalid={check.errors.nonWorking ? true : undefined} className={INPUT}
              onChange={(e) => set({ nonWorkingText: e.target.value })}
            />
            {check.errors.nonWorking && <p role="alert" className={ERR}>{check.errors.nonWorking}</p>}
            <p className={HELP}>{NON_WORKING_HELP}</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center">
              <input id="forecast-carnival" type="checkbox" checked={draft.carnival} disabled={disabled} className={CHECK}
                onChange={(e) => set({ carnival: e.target.checked })} />
              <label htmlFor="forecast-carnival" className="ml-2 block text-sm font-light text-gray-900 dark:text-white">{CARNIVAL_LABEL}</label>
            </div>
            <div className="flex items-center">
              <input id="forecast-corpus" type="checkbox" checked={draft.corpusChristi} disabled={disabled} className={CHECK}
                onChange={(e) => set({ corpusChristi: e.target.checked })} />
              <label htmlFor="forecast-corpus" className="ml-2 block text-sm font-light text-gray-900 dark:text-white">{CORPUS_CHRISTI_LABEL}</label>
            </div>
            <p className={HELP}>Feriados nacionais e a Paixão de Cristo já ficam de fora dos dias úteis.</p>
          </div>

          {check.errors.frequency && <p role="alert" className={ERR}>{check.errors.frequency}</p>}

          {preview && (
            <p className="text-sm font-light text-gray-700 dark:text-gray-300" data-testid="forecast-preview">
              Previsão{referenceMonth ? ` de ${monthLabel(referenceMonth)}` : ''}: <strong className="font-medium">{format(Math.round(preview.amount * 100))}</strong> ({howCalculated(preview, kind, format)})
            </p>
          )}
        </>
      )}
    </div>
  );
};

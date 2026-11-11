import { useMemo, type ReactNode } from 'react';
import { useI18n } from '../../context/I18nContext';
import { useCurrency } from '../../context/CurrencyContext';
import { useAccounts } from '../../hooks/api/useAccounts';
import { useRecurringTransactions } from '../../hooks/api/useRecurringTransactions';
import { useEmployments } from '../../hooks/api/usePayroll';
import { CategoryType } from '../../lib/enums';
import { formatCurrency } from '../../utils/format';
import { incomeErrorKey, fromCents, recurrencesInUse } from '../../utils/income';
import { incomeText, type IncomeTextKey } from '../../utils/incomeTexts';
import { BTN_PRIMARY, BTN_SECONDARY, ERROR_CLS, INPUT_CLS, LABEL_CLS, MUTED_CLS } from '../people/ui';

// Shared pieces of the Renda screens. Touch targets are 44 px (the screens are used on the phone first).

export const FIELD_CLS = `${INPUT_CLS} min-h-[44px]`;
export const BTN_PRIMARY_TOUCH = `${BTN_PRIMARY} min-h-[44px]`;
export const BTN_SECONDARY_TOUCH = `${BTN_SECONDARY} min-h-[44px]`;
export const CARD_CLS = 'rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4';
export const SECTION_TITLE_CLS = 'text-sm font-medium text-gray-900 dark:text-white';
export const MUTED = MUTED_CLS;

/** The Renda texts bound to the current locale. */
export function useIncomeTexts() {
  const { t } = useI18n();
  return (key: IncomeTextKey, vars?: Record<string, string | number>) => incomeText(t, key, vars);
}

export type IncomeTx = (key: IncomeTextKey, vars?: Record<string, string | number>) => string;

/** A money amount in reais in the base currency (negative values keep their sign). */
export function useMoney() {
  const { baseCurrency } = useCurrency();
  return (reais: number): string => formatCurrency(reais, baseCurrency);
}

/** A money amount in cents, formatted in the base currency. */
export function useMoneyCents() {
  const money = useMoney();
  return (cents: number): string => money(fromCents(cents));
}

/** A recurrence as the screens show it. */
export interface RecurrenceChoice {
  id: string;
  description: string;
}

/** The recurrences of a list answer: a plain array or the envelope { data: [...] } (the route answers both ways). */
export function recurrenceList(raw: unknown): RecurrenceChoice[] {
  const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray((raw as { data?: unknown } | null)?.data) ? (raw as { data: unknown[] }).data : [];
  const out: RecurrenceChoice[] = [];
  for (const item of list) {
    const r = item as { id?: unknown; description?: unknown } | null;
    if (r && typeof r.id === 'string') out.push({ id: r.id, description: typeof r.description === 'string' ? r.description : '' });
  }
  return out;
}

/**
 * What a form picks from: the money accounts (not cards), the income recurrences that are free (no job or benefit holds
 * them yet) and the employments (to know which recurrences are taken). The recurrence a record already holds is added
 * back by the caller (currentRecurrenceId), so it stays selectable while editing.
 */
export function useFormSources(householdId: string) {
  const accounts = useAccounts({ householdId });
  const recurrences = useRecurringTransactions({ householdId, isActive: true, type: CategoryType.INCOME });
  const employments = useEmployments(householdId);
  const moneyAccounts = useMemo(() => (accounts.data?.accounts ?? []).filter((a) => a.isActive && a.type !== 'CREDIT'), [accounts.data]);
  const incomeRecurrences = useMemo(() => recurrenceList(recurrences.data), [recurrences.data]);
  const freeRecurrenceIds = useMemo(() => {
    const used = recurrencesInUse(employments.data ?? []);
    return new Set(incomeRecurrences.map((r) => r.id).filter((id) => !used.has(id)));
  }, [incomeRecurrences, employments.data]);
  return { moneyAccounts, incomeRecurrences, freeRecurrenceIds };
}

/** The text of an API error for the user (never the raw backend sentence). */
export const errorText = (error: unknown, tx: IncomeTx): string => tx(incomeErrorKey(error));

/** The text of a field error key from a validator (undefined when the field is fine). */
export const fieldErrorText = (tx: IncomeTx, key?: IncomeTextKey): string | undefined => (key ? tx(key) : undefined);

/** A labelled field: the label, the control and, under it, the error text when there is one. */
export function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={LABEL_CLS}>{label}</label>
      {children}
      {hint && !error && <p className={`mt-1 text-xs ${MUTED_CLS}`}>{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className={`mt-1 ${ERROR_CLS}`}>{error}</p>}
    </div>
  );
}

/** A small label/value line of a card. */
export function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={`text-xs ${MUTED_CLS}`}>{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-gray-900 dark:text-white">{children}</dd>
    </div>
  );
}

export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className={`text-sm ${MUTED_CLS}`}>{children}</p>;
}

/** A form's footer: cancel and save. */
export function FormActions({ onCancel, saving, saveDisabled, tx }: { onCancel: () => void; saving: boolean; saveDisabled?: boolean; tx: IncomeTx }) {
  return (
    <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
      <button type="button" onClick={onCancel} disabled={saving} className={BTN_SECONDARY_TOUCH}>{tx('incomeFormCancel')}</button>
      <button type="submit" disabled={saving || saveDisabled} className={BTN_PRIMARY_TOUCH}>{saving ? tx('incomeFormSaving') : tx('incomeFormSave')}</button>
    </div>
  );
}

/** The text of the form-level error (an API refusal), shown above the footer. */
export function FormError({ text }: { text: string | null }) {
  if (!text) return null;
  return <p role="alert" className={ERROR_CLS}>{text}</p>;
}

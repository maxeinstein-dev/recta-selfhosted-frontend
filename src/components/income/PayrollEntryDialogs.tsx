import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useToastContext } from '../../context/ToastContext';
import { useI18n } from '../../context/I18nContext';
import { useCreateItemValue, useCreateSub, useUpdateSub } from '../../hooks/api/usePayroll';
import type { CalcMode, FgtsMode, FgtsWithdrawalKind, Item, FgtsModeRecord } from '../../utils/income';
import { todayIso, DialogShell, CHECKBOX_CLS, MUTED_CLS } from '../people/ui';
import {
  DEFAULT_VACATION_DAYS,
  MAX_ITEM_NAME,
  MAX_MARGIN_DAYS,
  MAX_NOTE,
  emptyItemForm,
  parseMoneyText,
  emptyVacationForm,
  fgtsBalanceBody,
  fgtsModeBody,
  fgtsWithdrawalBody,
  hasErrors,
  itemBody,
  itemValueBody,
  salaryBody,
  validateExpectedAmount,
  validateFgtsBalance,
  validateFgtsMode,
  validateFgtsWithdrawal,
  validateItem,
  validateItemValue,
  validateSalary,
  validateVacation,
  vacationBody,
  type FieldErrors,
  type FgtsBalanceForm,
  type FgtsModeForm,
  type FgtsWithdrawalForm,
  type ItemField,
  type ItemForm,
  type ItemValueForm,
  type SalaryForm,
  type VacationField,
  type VacationForm,
} from '../../utils/incomeForms';
import { errorText, Field, FormActions, FormError, FIELD_CLS, fieldErrorText, useFormSources, useIncomeTexts, type IncomeTx } from './shared';

// The forms of the Renda detail page: salary, fixed item or benefit per business day (and its value history), vacation,
// and the three FGTS records. All of them save through the payroll sub-resource routes and refresh the area on success.

interface BaseProps {
  open: boolean;
  onClose: () => void;
  householdId: string;
  employmentId: string;
}

/** Runs one save: one request at a time, the success toast and the close, or the error text (the form stays open). */
function useSaveFlow(onDone: () => void) {
  const tx = useIncomeTexts();
  const { success, error: showError } = useToastContext();
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const busy = useRef(false);
  const run = async (action: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setFormError(null);
    try {
      await action();
      success(tx('incomeSaved'));
      onDone();
    } catch (error: unknown) {
      const message = errorText(error, tx);
      setFormError(message);
      showError(message);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  const reset = () => setFormError(null);
  return { tx, saving, formError, run, reset };
}

function ShellOf({ open, onClose, saving, id, title, children }: { open: boolean; onClose: () => void; saving: boolean; id: string; title: string; children: ReactNode }) {
  return (
    <DialogShell open={open} onClose={onClose} canClose={!saving} titleId={id} title={title} widthClass="max-w-lg">
      {children}
    </DialogShell>
  );
}

/** Field errors of a form, as texts, by field name. */
const errorsOf = <K extends string>(tx: IncomeTx, errors: FieldErrors<K>) => (key: K) => fieldErrorText(tx, errors[key]);

// ---- Salary --------------------------------------------------------------------------------------------------------

export function SalaryFormDialog({ open, onClose, householdId, employmentId }: BaseProps) {
  const [form, setForm] = useState<SalaryForm>({ amount: '', startDate: todayIso() });
  const [errors, setErrors] = useState<FieldErrors<keyof SalaryForm>>({});
  const create = useCreateSub();
  const flow = useSaveFlow(onClose);
  useEffect(() => {
    if (open) {
      setForm({ amount: '', startDate: todayIso() });
      setErrors({});
      flow.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const tx = flow.tx;
  const err = errorsOf(tx, errors);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateSalary(form);
    setErrors(found);
    if (hasErrors(found)) return;
    void flow.run(() => create.mutateAsync({ householdId, employmentId, resource: 'salaries', body: salaryBody(form) }));
  };
  return (
    <ShellOf open={open} onClose={onClose} saving={flow.saving} id="income-salary-title" title={tx('incomeNewSalary')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="salary-amount" label={tx('incomeFormAmount')} error={err('amount')}>
          <input id="salary-amount" inputMode="decimal" type="text" value={form.amount} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </Field>
        <Field id="salary-start" label={tx('incomeFormStart')} error={err('startDate')}>
          <input id="salary-start" type="date" value={form.startDate} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </Field>
        <FormError text={flow.formError} />
        <FormActions onCancel={onClose} saving={flow.saving} tx={tx} />
      </form>
    </ShellOf>
  );
}

// ---- Fixed item or per-business-day benefit ------------------------------------------------------------------------

const toItemForm = (item: Item): ItemForm => ({
  name: item.name,
  kind: item.kind,
  calcMode: item.calcMode,
  inInssBase: item.inInssBase,
  inIrrfBase: item.inIrrfBase,
  inFgtsBase: item.inFgtsBase,
  amount: '',
  startDate: '',
  marginDays: String(item.marginDays),
  payDay: item.payDay ? String(item.payDay) : '',
  referenceMonthOffset: String(item.referenceMonthOffset),
  accountId: item.accountId ?? '',
  isAvailableCash: item.isAvailableCash,
  recurringTransactionId: item.recurringTransactionId ?? '',
});

interface ItemDialogProps extends BaseProps {
  /** The item being edited; null creates one. */
  item: Item | null;
}

/**
 * A payslip item (fixed monthly) or a benefit paid per business day. On create the calc mode is chosen; on edit it is
 * locked and the first value is not asked (values are added in the history).
 */
export function ItemFormDialog({ open, onClose, householdId, employmentId, item }: ItemDialogProps) {
  const sources = useFormSources(householdId);
  const create = useCreateSub();
  const update = useUpdateSub();
  const flow = useSaveFlow(onClose);
  const tx = flow.tx;
  const [form, setForm] = useState<ItemForm>(emptyItemForm());
  const [errors, setErrors] = useState<FieldErrors<ItemField>>({});
  const itemRef = useRef(item);
  itemRef.current = item;
  useEffect(() => {
    if (!open) return;
    const current = itemRef.current;
    setForm(current ? toItemForm(current) : emptyItemForm('FIXED_MONTHLY'));
    setErrors({});
    flow.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);

  const perDay = form.calcMode === 'PER_BUSINESS_DAY';
  const editing = !!item;
  const err = errorsOf(tx, errors);
  const recurrenceChoices = sources.incomeRecurrences.filter((r) => sources.freeRecurrenceIds.has(r.id) || r.id === form.recurringTransactionId);

  const chooseMode = (calcMode: CalcMode) => {
    const next = emptyItemForm(calcMode);
    setForm({ ...next, name: form.name, amount: form.amount, startDate: form.startDate });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateItem(form, {
      moneyAccountIds: new Set(sources.moneyAccounts.map((a) => a.id)),
      freeRecurrenceIds: sources.freeRecurrenceIds,
      currentRecurrenceId: item?.recurringTransactionId ?? null,
      editing,
    });
    setErrors(found);
    if (hasErrors(found)) return;
    if (item) {
      void flow.run(() => update.mutateAsync({ householdId, employmentId, resource: 'items', subId: item.id, body: itemBody(form, 'edit') }));
    } else {
      void flow.run(() => create.mutateAsync({ householdId, employmentId, resource: 'items', body: itemBody(form, 'create') }));
    }
  };

  return (
    <ShellOf open={open} onClose={onClose} saving={flow.saving} id="income-item-title" title={editing ? tx('incomeFormName') : tx('incomeNewItem')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {!editing && (
          <fieldset className="space-y-2">
            <legend className={`mb-1 text-sm font-medium text-gray-700 dark:text-gray-200`}>{tx('incomeFormCalcMode')}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(['FIXED_MONTHLY', 'PER_BUSINESS_DAY'] as const).map((mode) => (
                <label key={mode} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${form.calcMode === mode ? 'border-primary-500 text-gray-900 dark:text-white' : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300'}`}>
                  <input type="radio" name="income-item-mode" value={mode} checked={form.calcMode === mode} disabled={flow.saving} onChange={() => chooseMode(mode)} />
                  {mode === 'FIXED_MONTHLY' ? tx('incomeItemFixed') : tx('incomeItemPerDay')}
                </label>
              ))}
            </div>
            <p className={`text-xs ${MUTED_CLS}`}>{perDay ? tx('incomeItemPerDayNote') : tx('incomeItemFixedNote')}</p>
          </fieldset>
        )}
        {editing && <p className={`text-xs ${MUTED_CLS}`}>{tx('incomeFormCalcLockedHint')}</p>}
        <Field id="item-name" label={tx('incomeFormName')} error={err('name')}>
          <input id="item-name" type="text" maxLength={MAX_ITEM_NAME} value={form.name} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field id="item-kind" label={tx('incomeFormKind')} error={err('kind')}>
          <select id="item-kind" value={form.kind} disabled={flow.saving || perDay} className={FIELD_CLS} onChange={(e) => setForm({ ...form, kind: e.target.value as ItemForm['kind'] })}>
            <option value="EARNING">{tx('incomeItemKindEarning')}</option>
            <option value="DEDUCTION">{tx('incomeItemKindDeduction')}</option>
          </select>
        </Field>
        {!perDay && (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-200">{tx('incomeFormBases')}</legend>
            {(['inInssBase', 'inIrrfBase', 'inFgtsBase'] as const).map((key) => (
              <label key={key} className="inline-flex min-h-[44px] items-center gap-2 text-sm text-gray-900 dark:text-gray-100 cursor-pointer">
                <input type="checkbox" className={CHECKBOX_CLS} checked={form[key]} disabled={flow.saving} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
                {key === 'inInssBase' ? 'INSS' : key === 'inIrrfBase' ? 'IRRF' : 'FGTS'}
              </label>
            ))}
          </fieldset>
        )}
        {!editing && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="item-amount" label={perDay ? tx('incomeFormValuePerDay') : tx('incomeFormValueFixed')} error={err('amount')} hint={tx('incomeFormItemValueRequired')}>
              <input id="item-amount" inputMode="decimal" type="text" value={form.amount} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field id="item-start" label={tx('incomeFormStart')} error={err('startDate')}>
              <input id="item-start" type="date" value={form.startDate} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </Field>
          </div>
        )}
        {perDay && (
          <div className="space-y-4 rounded-md border border-gray-200 dark:border-gray-800 p-3">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="item-pay-day" label={tx('incomeFieldPayDay')} error={err('payDay')}>
                <input id="item-pay-day" type="number" inputMode="numeric" min={1} max={31} value={form.payDay} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, payDay: e.target.value })} />
              </Field>
              <Field id="item-offset" label={tx('incomeFormOffset')} error={err('referenceMonthOffset')}>
                <select id="item-offset" value={form.referenceMonthOffset} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, referenceMonthOffset: e.target.value })}>
                  <option value="1">{tx('incomeItemOffsetNext')}</option>
                  <option value="0">{tx('incomeItemOffsetSame')}</option>
                  <option value="-1">{tx('incomeItemOffsetPrev')}</option>
                </select>
              </Field>
            </div>
            <Field id="item-margin" label={tx('incomeFormMargin')} error={err('marginDays')} hint={`${tx('incomeFormMarginHint')} (0-${MAX_MARGIN_DAYS})`}>
              <input id="item-margin" type="number" inputMode="numeric" min={0} max={MAX_MARGIN_DAYS} value={form.marginDays} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, marginDays: e.target.value })} />
            </Field>
            <Field id="item-account" label={tx('incomeFieldAccount')} error={err('accountId')}>
              <select id="item-account" value={form.accountId} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
                <option value="">{tx('incomeItemAccountSalary')}</option>
                {sources.moneyAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </Field>
            <label className="inline-flex min-h-[44px] items-center gap-2 text-sm text-gray-900 dark:text-gray-100 cursor-pointer">
              <input type="checkbox" className={CHECKBOX_CLS} checked={form.isAvailableCash} disabled={flow.saving}
                onChange={(e) => setForm({ ...form, isAvailableCash: e.target.checked, recurringTransactionId: e.target.checked ? form.recurringTransactionId : '' })} />
              {tx('incomeFormCashAvailable')}
            </label>
            <p className={`text-xs ${MUTED_CLS}`}>{tx('incomeFormCashHint')}</p>
            <Field id="item-recurrence" label={tx('incomeFieldRecurrence')} error={err('recurringTransactionId')}>
              <select id="item-recurrence" value={form.recurringTransactionId} disabled={flow.saving || !form.isAvailableCash} className={FIELD_CLS} onChange={(e) => setForm({ ...form, recurringTransactionId: e.target.value })}>
                <option value="">{tx('incomeNone')}</option>
                {recurrenceChoices.map((r) => (
                  <option key={r.id} value={r.id}>{r.description}</option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <FormError text={flow.formError} />
        <FormActions onCancel={onClose} saving={flow.saving} tx={tx} />
      </form>
    </ShellOf>
  );
}

// ---- New value of an item (value history) --------------------------------------------------------------------------

export function ItemValueDialog({ open, onClose, householdId, employmentId, item }: BaseProps & { item: Item }) {
  const create = useCreateItemValue();
  const flow = useSaveFlow(onClose);
  const tx = flow.tx;
  const perDay = item.calcMode === 'PER_BUSINESS_DAY';
  const [form, setForm] = useState<ItemValueForm>({ amount: '', startDate: todayIso() });
  const [errors, setErrors] = useState<FieldErrors<keyof ItemValueForm>>({});
  useEffect(() => {
    if (open) {
      setForm({ amount: '', startDate: todayIso() });
      setErrors({});
      flow.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const err = errorsOf(tx, errors);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateItemValue(form, perDay);
    setErrors(found);
    if (hasErrors(found)) return;
    void flow.run(() => create.mutateAsync({ householdId, employmentId, resource: 'items', subId: item.id, body: itemValueBody(form) }));
  };
  return (
    <ShellOf open={open} onClose={onClose} saving={flow.saving} id="income-value-title" title={`${tx('incomeItemNewValue')}: ${item.name}`}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="value-amount" label={perDay ? tx('incomeFormValuePerDay') : tx('incomeFormValueFixed')} error={err('amount')}>
          <input id="value-amount" inputMode="decimal" type="text" value={form.amount} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </Field>
        <Field id="value-start" label={tx('incomeFormStart')} error={err('startDate')} hint={tx('incomeFormStart')}>
          <input id="value-start" type="date" value={form.startDate} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </Field>
        <FormError text={flow.formError} />
        <FormActions onCancel={onClose} saving={flow.saving} tx={tx} />
      </form>
    </ShellOf>
  );
}

// ---- Vacation ------------------------------------------------------------------------------------------------------

export function VacationFormDialog({ open, onClose, householdId, employmentId }: BaseProps) {
  const create = useCreateSub();
  const flow = useSaveFlow(onClose);
  const tx = flow.tx;
  const [form, setForm] = useState<VacationForm>(emptyVacationForm());
  const [errors, setErrors] = useState<FieldErrors<VacationField>>({});
  useEffect(() => {
    if (open) {
      setForm(emptyVacationForm());
      setErrors({});
      flow.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const err = errorsOf(tx, errors);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateVacation(form);
    setErrors(found);
    if (hasErrors(found)) return;
    void flow.run(() => create.mutateAsync({ householdId, employmentId, resource: 'vacations', body: vacationBody(form) }));
  };
  return (
    <ShellOf open={open} onClose={onClose} saving={flow.saving} id="income-vacation-title" title={tx('incomeNewVacation')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-200">{tx('incomeFormVacationMode')}</legend>
          {(['dates', 'month'] as const).map((mode) => (
            <label key={mode} className="inline-flex min-h-[44px] items-center gap-2 text-sm text-gray-900 dark:text-gray-100 cursor-pointer">
              <input type="radio" name="vacation-mode" value={mode} checked={form.mode === mode} disabled={flow.saving} onChange={() => setForm({ ...form, mode })} />
              {mode === 'dates' ? tx('incomeFormVacationDates') : tx('incomeFormVacationMonth')}
            </label>
          ))}
        </fieldset>
        {form.mode === 'dates' ? (
          <Field id="vacation-start" label={tx('incomeFormVacationStart')} error={err('startDate')}>
            <input id="vacation-start" type="date" value={form.startDate} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </Field>
        ) : (
          <Field id="vacation-month" label={tx('incomeFormVacationMonthValue')} error={err('month')}>
            <input id="vacation-month" type="month" value={form.month} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, month: e.target.value })} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field id="vacation-days" label={tx('incomeFormVacationDays')} error={err('days')} hint={tx('incomeFormVacationDaysHint')}>
            <input id="vacation-days" type="number" inputMode="numeric" min={1} max={DEFAULT_VACATION_DAYS} value={form.days} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, days: e.target.value })} />
          </Field>
          <Field id="vacation-sell" label={tx('incomeFormSellDays')} error={err('sellDays')}>
            <input id="vacation-sell" type="number" inputMode="numeric" min={0} max={10} value={form.sellDays} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, sellDays: e.target.value })} />
          </Field>
        </div>
        <Field id="vacation-note" label={tx('incomeFormNote')} error={err('note')}>
          <input id="vacation-note" type="text" maxLength={MAX_NOTE} value={form.note} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
        <FormError text={flow.formError} />
        <FormActions onCancel={onClose} saving={flow.saving} tx={tx} />
      </form>
    </ShellOf>
  );
}

// ---- FGTS -----------------------------------------------------------------------------------------------------------

export function FgtsBalanceDialog({ open, onClose, householdId, employmentId }: BaseProps) {
  const create = useCreateSub();
  const flow = useSaveFlow(onClose);
  const tx = flow.tx;
  const [form, setForm] = useState<FgtsBalanceForm>({ amount: '', asOfDate: todayIso() });
  const [errors, setErrors] = useState<FieldErrors<keyof FgtsBalanceForm>>({});
  useEffect(() => {
    if (open) {
      setForm({ amount: '', asOfDate: todayIso() });
      setErrors({});
      flow.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const err = errorsOf(tx, errors);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateFgtsBalance(form);
    setErrors(found);
    if (hasErrors(found)) return;
    void flow.run(() => create.mutateAsync({ householdId, employmentId, resource: 'fgts-balances', body: fgtsBalanceBody(form) }));
  };
  return (
    <ShellOf open={open} onClose={onClose} saving={flow.saving} id="income-fgts-balance-title" title={tx('incomeFgtsNewBalance')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="fgts-balance-amount" label={tx('incomeFormAmount')} error={err('amount')}>
          <input id="fgts-balance-amount" inputMode="decimal" type="text" value={form.amount} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </Field>
        <Field id="fgts-balance-date" label={tx('incomeFormFgtsAsOf')} error={err('asOfDate')}>
          <input id="fgts-balance-date" type="date" value={form.asOfDate} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, asOfDate: e.target.value })} />
        </Field>
        <FormError text={flow.formError} />
        <FormActions onCancel={onClose} saving={flow.saving} tx={tx} />
      </form>
    </ShellOf>
  );
}

export function FgtsWithdrawalDialog({ open, onClose, householdId, employmentId }: BaseProps) {
  const create = useCreateSub();
  const flow = useSaveFlow(onClose);
  const tx = flow.tx;
  const blank: FgtsWithdrawalForm = { amount: '', date: todayIso(), kind: 'BIRTHDAY', note: '' };
  const [form, setForm] = useState<FgtsWithdrawalForm>(blank);
  const [errors, setErrors] = useState<FieldErrors<keyof FgtsWithdrawalForm>>({});
  useEffect(() => {
    if (open) {
      setForm(blank);
      setErrors({});
      flow.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const err = errorsOf(tx, errors);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateFgtsWithdrawal(form);
    setErrors(found);
    if (hasErrors(found)) return;
    void flow.run(() => create.mutateAsync({ householdId, employmentId, resource: 'fgts-withdrawals', body: fgtsWithdrawalBody(form) }));
  };
  return (
    <ShellOf open={open} onClose={onClose} saving={flow.saving} id="income-fgts-withdrawal-title" title={tx('incomeFgtsNewWithdrawal')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="fgts-withdrawal-amount" label={tx('incomeFormAmount')} error={err('amount')}>
          <input id="fgts-withdrawal-amount" inputMode="decimal" type="text" value={form.amount} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </Field>
        <Field id="fgts-withdrawal-date" label={tx('incomeFormFgtsDate')} error={err('date')}>
          <input id="fgts-withdrawal-date" type="date" value={form.date} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Field id="fgts-withdrawal-kind" label={tx('incomeFormFgtsKind')} error={err('kind')}>
          <select id="fgts-withdrawal-kind" value={form.kind} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, kind: e.target.value as FgtsWithdrawalKind })}>
            <option value="BIRTHDAY">{tx('incomeWithdrawalKindBirthday')}</option>
            <option value="TERMINATION">{tx('incomeWithdrawalKindTermination')}</option>
            <option value="OTHER">{tx('incomeWithdrawalKindOther')}</option>
          </select>
        </Field>
        <Field id="fgts-withdrawal-note" label={tx('incomeFormNote')} error={err('note')}>
          <input id="fgts-withdrawal-note" type="text" maxLength={MAX_NOTE} value={form.note} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
        <FormError text={flow.formError} />
        <FormActions onCancel={onClose} saving={flow.saving} tx={tx} />
      </form>
    </ShellOf>
  );
}

/** Month name for the birthday select, in the page locale (January is month 1). */
function monthOptionLabel(month: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, month - 1, 15)));
  } catch {
    return String(month);
  }
}

/** A new FGTS mode: a dated record. Trocar de modalidade cria um registro novo; o histórico fica. */
export function FgtsModeDialog({ open, onClose, householdId, employmentId, current }: BaseProps & { current: FgtsModeRecord | null }) {
  const create = useCreateSub();
  const flow = useSaveFlow(onClose);
  const tx = flow.tx;
  const { locale } = useI18n();
  const blank: FgtsModeForm = { mode: 'BIRTHDAY', birthdayMonth: current?.birthdayMonth ? String(current.birthdayMonth) : '', expectedAmount: '', startDate: todayIso() };
  const [form, setForm] = useState<FgtsModeForm>(blank);
  const [errors, setErrors] = useState<FieldErrors<keyof FgtsModeForm>>({});
  useEffect(() => {
    if (open) {
      setForm({ ...blank, mode: 'BIRTHDAY', birthdayMonth: current?.birthdayMonth ? String(current.birthdayMonth) : '' });
      setErrors({});
      flow.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const err = errorsOf(tx, errors);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateFgtsMode(form);
    setErrors(found);
    if (hasErrors(found)) return;
    void flow.run(() => create.mutateAsync({ householdId, employmentId, resource: 'fgts-modes', body: fgtsModeBody(form) }));
  };
  return (
    <ShellOf open={open} onClose={onClose} saving={flow.saving} id="income-fgts-mode-title" title={tx('incomeFgtsModeChange')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className={`text-xs ${MUTED_CLS}`}>{tx('incomeFormModeHint')}</p>
        <Field id="fgts-mode" label={tx('incomeFormMode')} error={err('mode')}>
          <select id="fgts-mode" value={form.mode} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, mode: e.target.value as FgtsMode })}>
            <option value="BIRTHDAY">{tx('incomeFormModeBirthday')}</option>
            <option value="TERMINATION">{tx('incomeFormModeTermination')}</option>
          </select>
        </Field>
        {form.mode === 'BIRTHDAY' && (
          <>
            <Field id="fgts-birthday-month" label={tx('incomeFormBirthdayMonth')} error={err('birthdayMonth')}>
              <select id="fgts-birthday-month" value={form.birthdayMonth} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, birthdayMonth: e.target.value })}>
                <option value="">—</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{monthOptionLabel(m, locale)}</option>
                ))}
              </select>
            </Field>
            <Field id="fgts-expected" label={tx('incomeFormExpectedOptional')} error={err('expectedAmount')} hint={tx('incomeFgtsExpectedHint')}>
              <input id="fgts-expected" inputMode="decimal" type="text" value={form.expectedAmount} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, expectedAmount: e.target.value })} />
            </Field>
          </>
        )}
        <Field id="fgts-mode-start" label={tx('incomeFormModeStart')} error={err('startDate')}>
          <input id="fgts-mode-start" type="date" value={form.startDate} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </Field>
        <FormError text={flow.formError} />
        <FormActions onCancel={onClose} saving={flow.saving} tx={tx} />
      </form>
    </ShellOf>
  );
}

/** The expected amount of the birthday withdrawal, on the mode record in force (PATCH; an empty value clears it). */
export function FgtsExpectedDialog({ open, onClose, householdId, employmentId, mode }: BaseProps & { mode: FgtsModeRecord }) {
  const update = useUpdateSub();
  const flow = useSaveFlow(onClose);
  const tx = flow.tx;
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    if (open) {
      setText(mode.expectedAmount !== null && mode.expectedAmount !== undefined ? mode.expectedAmount.toFixed(2).replace('.', ',') : '');
      setError(undefined);
      flow.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode.id]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const key = validateExpectedAmount(text);
    setError(key ? tx(key) : undefined);
    if (key) return;
    const value = text.trim() ? parseMoneyText(text) : null;
    void flow.run(() => update.mutateAsync({ householdId, employmentId, resource: 'fgts-modes', subId: mode.id, body: { expectedAmount: value } }));
  };
  return (
    <ShellOf open={open} onClose={onClose} saving={flow.saving} id="income-fgts-expected-title" title={tx('incomeFgtsExpectedLabel')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="fgts-expected-value" label={tx('incomeFgtsExpectedLabel')} error={error} hint={tx('incomeFgtsExpectedHint')}>
          <input id="fgts-expected-value" inputMode="decimal" type="text" value={text} disabled={flow.saving} className={FIELD_CLS} onChange={(e) => setText(e.target.value)} />
        </Field>
        <FormError text={flow.formError} />
        <FormActions onCancel={onClose} saving={flow.saving} tx={tx} />
      </form>
    </ShellOf>
  );
}

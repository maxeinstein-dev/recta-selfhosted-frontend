import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Briefcase } from 'lucide-react';
import { useToastContext } from '../../context/ToastContext';
import { usePeople } from '../../hooks/api/usePeople';
import { useCreateEmployment, useUpdateEmployment } from '../../hooks/api/usePayroll';
import type { Employment } from '../../utils/income';
import {
  MAX_CITY,
  MAX_EMPLOYER,
  emptyEmploymentForm,
  employmentBody,
  hasErrors,
  validateEmployment,
  type EmploymentField,
  type EmploymentForm,
  type FieldErrors,
} from '../../utils/incomeForms';
import { CHECKBOX_CLS, DialogShell, MUTED_CLS } from '../people/ui';
import { Field, FormActions, FormError, FIELD_CLS, errorText, fieldErrorText, useFormSources, useIncomeTexts } from './shared';

interface EmploymentFormDialogProps {
  open: boolean;
  onClose: () => void;
  householdId: string;
  /** The employment being edited; null creates one. */
  employment: Employment | null;
  /** Called with the new employment's id after a create (the screen opens its detail). */
  onCreated?: (id: string) => void;
}

const toForm = (e: Employment): EmploymentForm => ({
  personId: e.personId ?? '',
  employer: e.employer,
  admissionDate: e.admissionDate,
  endDate: e.endDate ?? '',
  uf: e.uf ?? '',
  city: e.city ?? '',
  optionalHolidaysOff: e.optionalHolidaysOff,
  dependents: String(e.dependents),
  payDay: String(e.payDay),
  accountId: e.accountId ?? '',
  recurringTransactionId: e.recurringTransactionId ?? '',
  thirteenthFirstMonth: String(e.thirteenthFirstMonth),
  thirteenthFirstDay: String(e.thirteenthFirstDay),
  thirteenthSecondMonth: String(e.thirteenthSecondMonth),
  thirteenthSecondDay: String(e.thirteenthSecondDay),
});

/**
 * Create or edit a job: owner (from the people list), employer, dates, holiday calendar, pay day, account, salary
 * recurrence and the 13th installments. The recurrence list offers only the free income recurrences.
 */
const EmploymentFormDialog = ({ open, onClose, householdId, employment, onCreated }: EmploymentFormDialogProps) => {
  const tx = useIncomeTexts();
  const { success, error: showError } = useToastContext();
  const people = usePeople(householdId, false);
  const allPeople = usePeople(householdId, true);
  const { moneyAccounts, incomeRecurrences, freeRecurrenceIds } = useFormSources(householdId);
  const createMutation = useCreateEmployment();
  const updateMutation = useUpdateEmployment();

  const [form, setForm] = useState<EmploymentForm>(emptyEmploymentForm());
  const [errors, setErrors] = useState<FieldErrors<EmploymentField>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Seeded when the dialog opens: a refetch must not wipe what the user is typing.
  const employmentRef = useRef(employment);
  employmentRef.current = employment;
  useEffect(() => {
    if (!open) return;
    const current = employmentRef.current;
    setForm(current ? toForm(current) : emptyEmploymentForm(''));
    setErrors({});
    setFormError(null);
  }, [open, employment?.id]);

  // The active people, plus the current owner even when inactive (so editing keeps the owner visible).
  const ownerChoices = useMemo(() => {
    const active = (people.data ?? []).filter((p) => p.isActive);
    const owner = employment?.personId ? (allPeople.data ?? []).find((p) => p.id === employment.personId) : undefined;
    return owner && !owner.isActive ? [...active, owner] : active;
  }, [people.data, allPeople.data, employment]);

  const ctx = useMemo(
    () => ({
      peopleIds: new Set(ownerChoices.map((p) => p.id)),
      moneyAccountIds: new Set(moneyAccounts.map((a) => a.id)),
      freeIncomeRecurrenceIds: freeRecurrenceIds,
      currentRecurrenceId: employment?.recurringTransactionId ?? null,
    }),
    [ownerChoices, moneyAccounts, freeRecurrenceIds, employment?.recurringTransactionId],
  );

  const set = <K extends keyof EmploymentForm>(key: K, value: EmploymentForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };
  const err = (key: EmploymentField) => fieldErrorText(tx, errors[key]);
  const noOwners = ownerChoices.length === 0;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    const found = validateEmployment(form, ctx);
    setErrors(found);
    if (hasErrors(found)) return;
    savingRef.current = true;
    setSaving(true);
    setFormError(null);
    try {
      if (employment) {
        await updateMutation.mutateAsync({ householdId, id: employment.id, body: employmentBody(form, 'edit') });
      } else {
        const created = await createMutation.mutateAsync({ householdId, body: employmentBody(form, 'create', householdId) });
        if (created?.id) onCreated?.(created.id);
      }
      success(tx('incomeSaved'));
      onClose();
    } catch (error: unknown) {
      const message = errorText(error, tx);
      setFormError(message);
      showError(message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      canClose={!saving}
      titleId="income-employment-title"
      widthClass="max-w-xl"
      title={employment ? tx('incomeFormEmploymentEdit') : tx('incomeFormEmploymentNew')}
      icon={<Briefcase className="h-5 w-5 text-gray-500 dark:text-gray-400 mr-3 flex-shrink-0" aria-hidden="true" />}
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 min-w-0" noValidate>
        {noOwners && <p role="status" className={`text-sm ${MUTED_CLS}`}>{tx('incomeNoPeopleText')}</p>}
        <Field id="income-person" label={tx('incomeFormPerson')} error={err('personId')} hint={tx('incomeFormPersonHint')}>
          <select id="income-person" value={form.personId} disabled={saving || noOwners} className={FIELD_CLS} onChange={(e) => set('personId', e.target.value)}>
            <option value="">—</option>
            {ownerChoices.map((p) => (
              <option key={p.id} value={p.id}>{p.isActive ? p.name : `${p.name} (${tx('incomeStatusInactive')})`}</option>
            ))}
          </select>
        </Field>
        <Field id="income-employer" label={tx('incomeFormEmployer')} error={err('employer')}>
          <input id="income-employer" type="text" maxLength={MAX_EMPLOYER} value={form.employer} disabled={saving} className={FIELD_CLS} onChange={(e) => set('employer', e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="income-admission" label={tx('incomeFormAdmission')} error={err('admissionDate')}>
            <input id="income-admission" type="date" value={form.admissionDate} disabled={saving} className={FIELD_CLS} onChange={(e) => set('admissionDate', e.target.value)} />
          </Field>
          <Field id="income-end" label={tx('incomeFormEnd')} error={err('endDate')} hint={tx('incomeFormEndHint')}>
            <input id="income-end" type="date" value={form.endDate} disabled={saving} className={FIELD_CLS} onChange={(e) => set('endDate', e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="income-uf" label={tx('incomeFormUf')} error={err('uf')}>
            <input id="income-uf" type="text" maxLength={2} value={form.uf} disabled={saving} className={FIELD_CLS} onChange={(e) => set('uf', e.target.value.toUpperCase())} />
          </Field>
          <Field id="income-city" label={tx('incomeFormCity')} error={err('city')}>
            <input id="income-city" type="text" maxLength={MAX_CITY} value={form.city} disabled={saving} className={FIELD_CLS} onChange={(e) => set('city', e.target.value)} />
          </Field>
        </div>
        <label htmlFor="income-optional-off" className="inline-flex min-h-[44px] items-center gap-2 text-sm text-gray-900 dark:text-gray-100 cursor-pointer">
          <input id="income-optional-off" type="checkbox" checked={form.optionalHolidaysOff} disabled={saving} className={CHECKBOX_CLS} onChange={(e) => set('optionalHolidaysOff', e.target.checked)} />
          {tx('incomeFormOptionalOff')}
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="income-dependents" label={tx('incomeFormDependents')} error={err('dependents')}>
            <input id="income-dependents" type="number" inputMode="numeric" min={0} max={20} value={form.dependents} disabled={saving} className={FIELD_CLS} onChange={(e) => set('dependents', e.target.value)} />
          </Field>
          <Field id="income-pay-day" label={tx('incomeFormPayDay')} error={err('payDay')}>
            <input id="income-pay-day" type="number" inputMode="numeric" min={1} max={31} value={form.payDay} disabled={saving} className={FIELD_CLS} onChange={(e) => set('payDay', e.target.value)} />
          </Field>
        </div>
        <Field id="income-account" label={tx('incomeFormAccount')} error={err('accountId')}>
          <select id="income-account" value={form.accountId} disabled={saving} className={FIELD_CLS} onChange={(e) => set('accountId', e.target.value)}>
            <option value="">{tx('incomeNone')}</option>
            {moneyAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </Field>
        <Field id="income-recurrence" label={tx('incomeFormRecurrence')} error={err('recurringTransactionId')} hint={tx('incomeFormRecurrenceHint')}>
          <select id="income-recurrence" value={form.recurringTransactionId} disabled={saving} className={FIELD_CLS} onChange={(e) => set('recurringTransactionId', e.target.value)}>
            <option value="">{tx('incomeNone')}</option>
            {incomeRecurrences
              .filter((r) => freeRecurrenceIds.has(r.id) || r.id === form.recurringTransactionId)
              .map((r) => (
                <option key={r.id} value={r.id}>{r.description}</option>
              ))}
          </select>
        </Field>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-200">{tx('incomeFieldThirteenth')}</legend>
          <div className="grid grid-cols-2 gap-3">
            <Field id="income-13-1-month" label={`${tx('incomeFormThirteenthFirst')}: ${tx('incomeFormMonth')}`} error={err('thirteenthFirstMonth')}>
              <input id="income-13-1-month" type="number" inputMode="numeric" min={1} max={12} value={form.thirteenthFirstMonth} disabled={saving} className={FIELD_CLS} onChange={(e) => set('thirteenthFirstMonth', e.target.value)} />
            </Field>
            <Field id="income-13-1-day" label={`${tx('incomeFormThirteenthFirst')}: ${tx('incomeFormDay')}`} error={err('thirteenthFirstDay')}>
              <input id="income-13-1-day" type="number" inputMode="numeric" min={1} max={31} value={form.thirteenthFirstDay} disabled={saving} className={FIELD_CLS} onChange={(e) => set('thirteenthFirstDay', e.target.value)} />
            </Field>
            <Field id="income-13-2-month" label={`${tx('incomeFormThirteenthSecond')}: ${tx('incomeFormMonth')}`} error={err('thirteenthSecondMonth')}>
              <input id="income-13-2-month" type="number" inputMode="numeric" min={1} max={12} value={form.thirteenthSecondMonth} disabled={saving} className={FIELD_CLS} onChange={(e) => set('thirteenthSecondMonth', e.target.value)} />
            </Field>
            <Field id="income-13-2-day" label={`${tx('incomeFormThirteenthSecond')}: ${tx('incomeFormDay')}`} error={err('thirteenthSecondDay')}>
              <input id="income-13-2-day" type="number" inputMode="numeric" min={1} max={31} value={form.thirteenthSecondDay} disabled={saving} className={FIELD_CLS} onChange={(e) => set('thirteenthSecondDay', e.target.value)} />
            </Field>
          </div>
        </fieldset>
        <FormError text={formError} />
        <FormActions onCancel={onClose} saving={saving} saveDisabled={noOwners} tx={tx} />
      </form>
    </DialogShell>
  );
};

export default EmploymentFormDialog;

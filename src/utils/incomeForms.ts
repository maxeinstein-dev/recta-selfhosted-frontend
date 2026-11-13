/**
 * Validation and request bodies of the "Renda" forms. The rules are the ones of payroll.schema.ts and of the service
 * checks (payroll.service.ts), so a form that passes here is not refused by the API for its shape; what the API still
 * refuses (a date already taken, a recurrence already in use elsewhere) comes back as a 409 and is read by incomeErrorKey.
 * Each validator returns the text key of the error per field (translated by the screen), never a string.
 * No React: tools/fe-tests/t31_income.mts runs it under tsx (INCOME_FORMS_MODULE points it at a mutated copy).
 */
import { isDayKey, isMonthKey, type CalcMode, type FgtsMode, type FgtsWithdrawalKind, type ItemKind } from './income';
import type { IncomeTextKey } from './incomeTexts';

/** The API accepts up to this many reais per amount (MAX_AMOUNT of the backend). */
export const INCOME_MAX_AMOUNT = 1_000_000_000;
export const MAX_EMPLOYER = 120;
export const MAX_ITEM_NAME = 100;
export const MAX_NOTE = 200;
export const MAX_CITY = 80;
export const MAX_MARGIN_DAYS = 31;
export const DEFAULT_VACATION_DAYS = 30;
export const MAX_SELL_DAYS = 10;

export type FieldErrors<K extends string> = Partial<Record<K, IncomeTextKey>>;

export const hasErrors = (errors: object): boolean => Object.keys(errors).length > 0;

// ---- Inputs --------------------------------------------------------------------------------------------------------

/**
 * Reais from text: "1234,56" or "1.234,56" (comma decimal, dots as thousands) or "1234.56" (dot decimal). At most two
 * decimals. Null for anything else.
 */
export function parseMoneyText(text: string): number | null {
  const raw = text.trim().replace(/\s/g, '');
  if (!raw) return null;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Reais to the input text with a comma: 5 -> "5,00". Empty for null. */
export const formatMoneyText = (value: number | null | undefined): string => (value === null || value === undefined ? '' : value.toFixed(2).replace('.', ','));

/** An integer from text ("-1" included); null for anything else. */
export function parseIntText(text: string): number | null {
  const raw = text.trim();
  if (!/^-?\d+$/.test(raw)) return null;
  return Number(raw);
}

/** A real calendar day from an input type=date value ('YYYY-MM-DD'); null for anything else (30 Feb included). */
export function parseDayText(text: string): string | null {
  const raw = text.trim();
  if (!isDayKey(raw)) return null;
  const d = new Date(Date.UTC(Number(raw.slice(0, 4)), Number(raw.slice(5, 7)) - 1, Number(raw.slice(8, 10))));
  const real = d.getUTCFullYear() === Number(raw.slice(0, 4)) && d.getUTCMonth() === Number(raw.slice(5, 7)) - 1 && d.getUTCDate() === Number(raw.slice(8, 10));
  return real ? raw : null;
}

// ---- Employment ----------------------------------------------------------------------------------------------------

export interface EmploymentForm {
  personId: string;
  employer: string;
  admissionDate: string;
  endDate: string;
  uf: string;
  city: string;
  optionalHolidaysOff: boolean;
  dependents: string;
  payDay: string;
  accountId: string;
  recurringTransactionId: string;
  thirteenthFirstMonth: string;
  thirteenthFirstDay: string;
  thirteenthSecondMonth: string;
  thirteenthSecondDay: string;
}

export type EmploymentField = keyof EmploymentForm;

/** A new employment starts with the user's habits: 13th on 30/06 and 20/12, pay on day 5, weekends and no UF. */
export function emptyEmploymentForm(personId = ''): EmploymentForm {
  return {
    personId,
    employer: '',
    admissionDate: '',
    endDate: '',
    uf: '',
    city: '',
    optionalHolidaysOff: false,
    dependents: '0',
    payDay: '5',
    accountId: '',
    recurringTransactionId: '',
    thirteenthFirstMonth: '6',
    thirteenthFirstDay: '30',
    thirteenthSecondMonth: '12',
    thirteenthSecondDay: '20',
  };
}

export interface EmploymentContext {
  /** Ids of the active people of the household (the owner must be one of them). */
  peopleIds: ReadonlySet<string>;
  /** Ids of the accounts that can receive money (not credit cards). */
  moneyAccountIds: ReadonlySet<string>;
  /** Ids of the income recurrences that can be linked (not used by another employment or benefit). */
  freeIncomeRecurrenceIds: ReadonlySet<string>;
  /** The recurrence this employment already holds: it stays selectable while editing. */
  currentRecurrenceId?: string | null;
}

const dayNum = (text: string, min: number, max: number): number | null => {
  const n = parseIntText(text);
  return n !== null && n >= min && n <= max ? n : null;
};

/** Field errors of the employment form (create and edit use the same rules). */
export function validateEmployment(form: EmploymentForm, ctx: EmploymentContext): FieldErrors<EmploymentField> {
  const errors: FieldErrors<EmploymentField> = {};
  if (!form.personId || !ctx.peopleIds.has(form.personId)) errors.personId = 'incomeErrPerson';
  const employer = form.employer.trim();
  if (employer.length < 1 || employer.length > MAX_EMPLOYER) errors.employer = 'incomeErrEmployer';
  const admission = parseDayText(form.admissionDate);
  if (!admission) errors.admissionDate = 'incomeErrDate';
  if (form.endDate.trim()) {
    const end = parseDayText(form.endDate);
    if (!end) errors.endDate = 'incomeErrDate';
    else if (admission && end < admission) errors.endDate = 'incomeErrDateOrder';
  }
  const uf = form.uf.trim().toUpperCase();
  if (uf && !/^[A-Z]{2}$/.test(uf)) errors.uf = 'incomeErrUf';
  if (form.city.trim() && !uf) errors.city = 'incomeErrCityNeedsUf';
  if (form.city.trim().length > MAX_CITY) errors.city = 'incomeErrCityLength';
  const dependents = parseIntText(form.dependents);
  if (dependents === null || dependents < 0 || dependents > 20) errors.dependents = 'incomeErrDependents';
  if (dayNum(form.payDay, 1, 31) === null) errors.payDay = 'incomeErrDay';
  if (form.accountId && !ctx.moneyAccountIds.has(form.accountId)) errors.accountId = 'incomeErrAccountCredit';
  if (form.recurringTransactionId) {
    const free = ctx.freeIncomeRecurrenceIds.has(form.recurringTransactionId) || form.recurringTransactionId === ctx.currentRecurrenceId;
    if (!free) errors.recurringTransactionId = 'incomeErrRecurrenceUsed';
  }
  const m1 = dayNum(form.thirteenthFirstMonth, 1, 12);
  const d1 = dayNum(form.thirteenthFirstDay, 1, 31);
  const m2 = dayNum(form.thirteenthSecondMonth, 1, 12);
  const d2 = dayNum(form.thirteenthSecondDay, 1, 31);
  if (m1 === null) errors.thirteenthFirstMonth = 'incomeErrMonth';
  if (d1 === null) errors.thirteenthFirstDay = 'incomeErrDay';
  if (m2 === null) errors.thirteenthSecondMonth = 'incomeErrMonth';
  if (d2 === null) errors.thirteenthSecondDay = 'incomeErrDay';
  if (m1 !== null && d1 !== null && m2 !== null && d2 !== null && m1 * 100 + d1 > m2 * 100 + d2) {
    errors.thirteenthFirstMonth = 'incomeErrThirteenthOrder';
  }
  return errors;
}

/**
 * Body of POST /payroll/employments (create) or PATCH /payroll/employments/:id (edit). The optional calendar fields go as
 * null when empty, so clearing the UF or the city on edit really clears them.
 */
export function employmentBody(form: EmploymentForm, mode: 'create' | 'edit', householdId?: string): Record<string, unknown> {
  const uf = form.uf.trim().toUpperCase();
  const common = {
    personId: form.personId,
    employer: form.employer.trim(),
    admissionDate: form.admissionDate,
    endDate: form.endDate.trim() ? form.endDate : null,
    uf: uf || null,
    city: uf && form.city.trim() ? form.city.trim() : null,
    optionalHolidaysOff: form.optionalHolidaysOff,
    dependents: Number(form.dependents),
    payDay: Number(form.payDay),
    accountId: form.accountId || null,
    recurringTransactionId: form.recurringTransactionId || null,
    thirteenthFirstMonth: Number(form.thirteenthFirstMonth),
    thirteenthFirstDay: Number(form.thirteenthFirstDay),
    thirteenthSecondMonth: Number(form.thirteenthSecondMonth),
    thirteenthSecondDay: Number(form.thirteenthSecondDay),
  };
  return mode === 'create' ? { householdId, regime: 'CLT', isActive: true, ...common } : common;
}

// ---- Salary --------------------------------------------------------------------------------------------------------

export interface SalaryForm {
  amount: string;
  startDate: string;
}

export function validateSalary(form: SalaryForm): FieldErrors<keyof SalaryForm> {
  const errors: FieldErrors<keyof SalaryForm> = {};
  const amount = parseMoneyText(form.amount);
  if (amount === null) errors.amount = 'incomeErrAmount';
  else if (amount <= 0 || amount > INCOME_MAX_AMOUNT) errors.amount = 'incomeErrAmountPositive';
  if (!parseDayText(form.startDate)) errors.startDate = 'incomeErrDate';
  return errors;
}

export const salaryBody = (form: SalaryForm): { amount: number; startDate: string } => ({
  amount: parseMoneyText(form.amount) ?? 0,
  startDate: form.startDate,
});

// ---- Items (fixed monthly or per business day) ---------------------------------------------------------------------

export interface ItemForm {
  name: string;
  kind: ItemKind;
  calcMode: CalcMode;
  inInssBase: boolean;
  inIrrfBase: boolean;
  inFgtsBase: boolean;
  /** The first value: monthly amount, or the value per day. */
  amount: string;
  startDate: string;
  marginDays: string;
  payDay: string;
  /** -1, 0 or 1 as text (the select of the reference month). */
  referenceMonthOffset: string;
  accountId: string;
  isAvailableCash: boolean;
  recurringTransactionId: string;
}

export type ItemField = keyof ItemForm;

export function emptyItemForm(calcMode: CalcMode = 'FIXED_MONTHLY'): ItemForm {
  return {
    name: '',
    kind: 'EARNING',
    calcMode,
    inInssBase: false,
    inIrrfBase: false,
    inFgtsBase: false,
    amount: '',
    startDate: '',
    marginDays: '0',
    payDay: calcMode === 'PER_BUSINESS_DAY' ? '25' : '',
    referenceMonthOffset: '1',
    accountId: '',
    isAvailableCash: true,
    recurringTransactionId: '',
  };
}

export interface ItemContext {
  moneyAccountIds: ReadonlySet<string>;
  freeRecurrenceIds: ReadonlySet<string>;
  /** Recurrence the item already holds (selectable while editing). */
  currentRecurrenceId?: string | null;
  /** Editing: the calc mode cannot change, so the form is checked against the stored one. */
  editing: boolean;
}

/**
 * Field errors of an item. A per-business-day benefit is an earning outside the bases, with a pay day; without a
 * recurrence it may be any account, with one it must be available money (the API refuses the rest).
 */
export function validateItem(form: ItemForm, ctx: ItemContext): FieldErrors<ItemField> {
  const errors: FieldErrors<ItemField> = {};
  const name = form.name.trim();
  if (name.length < 1 || name.length > MAX_ITEM_NAME) errors.name = 'incomeErrName';
  const perDay = form.calcMode === 'PER_BUSINESS_DAY';
  // Editing does not touch the first value (it is changed in the history of values), so it is not checked then.
  if (!ctx.editing) {
    const amount = parseMoneyText(form.amount);
    if (amount === null) errors.amount = 'incomeErrAmount';
    else if (amount > INCOME_MAX_AMOUNT || (perDay && amount <= 0)) errors.amount = 'incomeErrAmountPositive';
    if (!parseDayText(form.startDate)) errors.startDate = 'incomeErrDate';
  }
  if (perDay) {
    if (form.kind !== 'EARNING') errors.kind = 'incomeErrPerDayKind';
    if (form.inInssBase || form.inIrrfBase || form.inFgtsBase) errors.inInssBase = 'incomeErrPerDayBases';
    if (dayNum(form.payDay, 1, 31) === null) errors.payDay = 'incomeErrPayDayRequired';
    const margin = parseIntText(form.marginDays);
    if (margin === null || margin < 0 || margin > MAX_MARGIN_DAYS) errors.marginDays = 'incomeErrMargin';
    const offset = parseIntText(form.referenceMonthOffset);
    if (offset === null || offset < -1 || offset > 1) errors.referenceMonthOffset = 'incomeErrCalcOnlyPerDay';
    if (form.accountId && !ctx.moneyAccountIds.has(form.accountId)) errors.accountId = 'incomeErrAccountCredit';
    if (form.recurringTransactionId) {
      if (!form.isAvailableCash) errors.recurringTransactionId = 'incomeErrNotCashRecurrence';
      else if (!(ctx.freeRecurrenceIds.has(form.recurringTransactionId) || form.recurringTransactionId === ctx.currentRecurrenceId)) {
        errors.recurringTransactionId = 'incomeErrRecurrenceUsed';
      }
    }
  }
  return errors;
}

/**
 * Body of POST /payroll/employments/:id/items (create) or PATCH .../items/:subId (edit). A fixed item sends no per-day
 * field; a per-day one sends them all, with its first value as `value`.
 */
export function itemBody(form: ItemForm, mode: 'create' | 'edit'): Record<string, unknown> {
  const base = {
    name: form.name.trim(),
    kind: form.kind,
    inInssBase: form.calcMode === 'PER_BUSINESS_DAY' ? false : form.inInssBase,
    inIrrfBase: form.calcMode === 'PER_BUSINESS_DAY' ? false : form.inIrrfBase,
    inFgtsBase: form.calcMode === 'PER_BUSINESS_DAY' ? false : form.inFgtsBase,
  };
  if (form.calcMode === 'FIXED_MONTHLY') {
    const fixed = mode === 'create' ? { calcMode: 'FIXED_MONTHLY' } : {};
    const value = mode === 'create' && form.amount.trim() ? { value: { amount: parseMoneyText(form.amount) ?? 0, startDate: form.startDate } } : {};
    return { ...base, ...fixed, ...value };
  }
  const perDay = {
    calcMode: 'PER_BUSINESS_DAY',
    marginDays: Number(form.marginDays),
    payDay: Number(form.payDay),
    referenceMonthOffset: Number(form.referenceMonthOffset),
    accountId: form.accountId || null,
    isAvailableCash: form.isAvailableCash,
    recurringTransactionId: form.recurringTransactionId || null,
  };
  if (mode === 'edit') {
    return {
      ...base,
      marginDays: perDay.marginDays,
      payDay: perDay.payDay,
      referenceMonthOffset: perDay.referenceMonthOffset,
      accountId: perDay.accountId,
      isAvailableCash: perDay.isAvailableCash,
      recurringTransactionId: perDay.recurringTransactionId,
    };
  }
  return { ...base, ...perDay, value: { amount: parseMoneyText(form.amount) ?? 0, startDate: form.startDate } };
}

export interface ItemValueForm {
  amount: string;
  startDate: string;
}

/** A new value of an item: per day it must be positive, monthly it may be zero (the backend accepts zero). */
export function validateItemValue(form: ItemValueForm, perDay: boolean): FieldErrors<keyof ItemValueForm> {
  const errors: FieldErrors<keyof ItemValueForm> = {};
  const amount = parseMoneyText(form.amount);
  if (amount === null) errors.amount = 'incomeErrAmount';
  else if (amount > INCOME_MAX_AMOUNT || (perDay && amount <= 0)) errors.amount = 'incomeErrAmountPositive';
  if (!parseDayText(form.startDate)) errors.startDate = 'incomeErrDate';
  return errors;
}

export const itemValueBody = (form: ItemValueForm): { amount: number; startDate: string } => ({
  amount: parseMoneyText(form.amount) ?? 0,
  startDate: form.startDate,
});

// ---- Vacation ------------------------------------------------------------------------------------------------------

export interface VacationForm {
  mode: 'dates' | 'month';
  startDate: string;
  month: string;
  days: string;
  sellDays: string;
  note: string;
}

export type VacationField = keyof VacationForm;

export function emptyVacationForm(): VacationForm {
  return { mode: 'dates', startDate: '', month: '', days: String(DEFAULT_VACATION_DAYS), sellDays: '0', note: '' };
}

export function validateVacation(form: VacationForm): FieldErrors<VacationField> {
  const errors: FieldErrors<VacationField> = {};
  if (form.mode === 'dates') {
    if (!parseDayText(form.startDate)) errors.startDate = 'incomeErrDate';
  } else if (!isMonthKey(form.month.trim())) {
    errors.month = 'incomeErrMonthFormat';
  }
  const days = parseIntText(form.days);
  if (days === null || days < 1 || days > DEFAULT_VACATION_DAYS) errors.days = 'incomeErrVacationDays';
  const sell = parseIntText(form.sellDays);
  if (sell === null || sell < 0 || sell > MAX_SELL_DAYS) errors.sellDays = 'incomeErrSellDays';
  if (!errors.sellDays && days !== null && sell !== null && days + sell > DEFAULT_VACATION_DAYS) errors.sellDays = 'incomeErrVacationTotal';
  if (form.note.trim().length > MAX_NOTE) errors.note = 'incomeErrNoteLength';
  return errors;
}

/** Body of POST /payroll/employments/:id/vacations: exact start date or only the month (never both). */
export function vacationBody(form: VacationForm): Record<string, unknown> {
  return {
    ...(form.mode === 'dates' ? { startDate: form.startDate, month: null } : { startDate: null, month: form.month.trim() }),
    days: Number(form.days),
    sellDays: Number(form.sellDays),
    note: form.note.trim() || null,
  };
}

// ---- FGTS ----------------------------------------------------------------------------------------------------------

export interface FgtsBalanceForm {
  amount: string;
  asOfDate: string;
}

export function validateFgtsBalance(form: FgtsBalanceForm): FieldErrors<keyof FgtsBalanceForm> {
  const errors: FieldErrors<keyof FgtsBalanceForm> = {};
  const amount = parseMoneyText(form.amount);
  if (amount === null) errors.amount = 'incomeErrAmount';
  else if (amount > INCOME_MAX_AMOUNT) errors.amount = 'incomeErrAmountPositive';
  if (!parseDayText(form.asOfDate)) errors.asOfDate = 'incomeErrDate';
  return errors;
}

export const fgtsBalanceBody = (form: FgtsBalanceForm): { amount: number; asOfDate: string } => ({
  amount: parseMoneyText(form.amount) ?? 0,
  asOfDate: form.asOfDate,
});

export interface FgtsWithdrawalForm {
  amount: string;
  date: string;
  kind: FgtsWithdrawalKind;
  note: string;
}

export function validateFgtsWithdrawal(form: FgtsWithdrawalForm): FieldErrors<keyof FgtsWithdrawalForm> {
  const errors: FieldErrors<keyof FgtsWithdrawalForm> = {};
  const amount = parseMoneyText(form.amount);
  if (amount === null) errors.amount = 'incomeErrAmount';
  else if (amount <= 0 || amount > INCOME_MAX_AMOUNT) errors.amount = 'incomeErrAmountPositive';
  if (!parseDayText(form.date)) errors.date = 'incomeErrDate';
  if (form.note.trim().length > MAX_NOTE) errors.note = 'incomeErrNoteLength';
  return errors;
}

export const fgtsWithdrawalBody = (form: FgtsWithdrawalForm): Record<string, unknown> => ({
  amount: parseMoneyText(form.amount) ?? 0,
  date: form.date,
  kind: form.kind,
  note: form.note.trim() || null,
});

export interface FgtsModeForm {
  mode: FgtsMode;
  birthdayMonth: string;
  expectedAmount: string;
  startDate: string;
}

export function validateFgtsMode(form: FgtsModeForm): FieldErrors<keyof FgtsModeForm> {
  const errors: FieldErrors<keyof FgtsModeForm> = {};
  if (!parseDayText(form.startDate)) errors.startDate = 'incomeErrDate';
  if (form.mode === 'BIRTHDAY') {
    const month = parseIntText(form.birthdayMonth);
    if (month === null || month < 1 || month > 12) errors.birthdayMonth = 'incomeErrBirthdayMonth';
    if (form.expectedAmount.trim()) {
      const expected = parseMoneyText(form.expectedAmount);
      if (expected === null) errors.expectedAmount = 'incomeErrAmount';
      else if (expected <= 0 || expected > INCOME_MAX_AMOUNT) errors.expectedAmount = 'incomeErrAmountPositive';
    }
  } else if (form.birthdayMonth.trim() || form.expectedAmount.trim()) {
    errors.mode = 'incomeErrTerminationExtras';
  }
  return errors;
}

/**
 * The form after the mode select changes. Termination hides the birthday month and the expected amount, so they are
 * cleared with the switch: otherwise the hidden values stay in the form and validateFgtsMode refuses it.
 */
export function fgtsModeAfterSwitch(form: FgtsModeForm, mode: FgtsMode): FgtsModeForm {
  if (mode === 'TERMINATION') return { ...form, mode, birthdayMonth: '', expectedAmount: '' };
  return { ...form, mode };
}

export const fgtsModeBody = (form: FgtsModeForm): Record<string, unknown> =>
  form.mode === 'BIRTHDAY'
    ? {
        mode: 'BIRTHDAY',
        birthdayMonth: Number(form.birthdayMonth),
        expectedAmount: form.expectedAmount.trim() ? (parseMoneyText(form.expectedAmount) ?? null) : null,
        startDate: form.startDate,
      }
    : { mode: 'TERMINATION', startDate: form.startDate };

/** The expected amount of the birthday withdrawal alone (PATCH of the mode record); empty clears it. */
export function validateExpectedAmount(text: string): IncomeTextKey | null {
  if (!text.trim()) return null;
  const value = parseMoneyText(text);
  if (value === null) return 'incomeErrAmount';
  if (value <= 0 || value > INCOME_MAX_AMOUNT) return 'incomeErrAmountPositive';
  return null;
}

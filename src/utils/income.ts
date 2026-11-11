/**
 * Pure logic of the "Renda" area: the types of the payroll routes (GET /payroll/...), the grouping of the employments by
 * person, the totals of a month, the upcoming events, the business-day breakdown of a benefit, the FGTS helpers and the
 * mapping of API errors to text keys. No React and no imports but the texts, so tools/fe-tests/t31_income.mts runs it
 * under tsx (INCOME_MODULE points it at a mutated copy for the bite-checks).
 *
 * Money: the API answers in reais; every sum here is done in whole cents so a float never drifts.
 * Days are 'YYYY-MM-DD' strings and are compared as text; months are 'YYYY-MM'.
 */
import type { IncomeTextKey } from './incomeTexts';

// ---- Shapes of the API (the backend serializes money in reais; see payroll.service.ts) ---------------------------

export type ItemKind = 'EARNING' | 'DEDUCTION';
export type CalcMode = 'FIXED_MONTHLY' | 'PER_BUSINESS_DAY';
export type FgtsMode = 'TERMINATION' | 'BIRTHDAY';
export type FgtsWithdrawalKind = 'BIRTHDAY' | 'TERMINATION' | 'OTHER';

export interface Salary {
  id: string;
  amount: number;
  startDate: string;
}

export interface ItemValue {
  id: string;
  amount: number;
  startDate: string;
}

export interface Item {
  id: string;
  name: string;
  kind: ItemKind;
  inInssBase: boolean;
  inIrrfBase: boolean;
  inFgtsBase: boolean;
  calcMode: CalcMode;
  marginDays: number;
  payDay: number | null;
  referenceMonthOffset: number;
  accountId: string | null;
  isAvailableCash: boolean;
  recurringTransactionId: string | null;
  values: ItemValue[];
}

export interface VacationLine {
  id: string;
  label: string;
  amount: number;
  kind: ItemKind;
  inInssBase: boolean;
  inIrrfBase: boolean;
  inFgtsBase: boolean;
}

export interface Vacation {
  id: string;
  startDate: string | null;
  month: string | null;
  days: number | null;
  sellDays: number;
  note: string | null;
  /** True when only the month is known (the period is 30 days from day 1). */
  estimated: boolean;
  items: VacationLine[];
}

export interface FgtsBalance {
  id: string;
  amount: number;
  asOfDate: string;
}

export interface FgtsWithdrawal {
  id: string;
  amount: number;
  date: string;
  kind: FgtsWithdrawalKind;
  note: string | null;
}

export interface FgtsModeRecord {
  id: string;
  mode: FgtsMode;
  birthdayMonth: number | null;
  expectedAmount: number | null;
  startDate: string;
}

export interface Employment {
  id: string;
  householdId: string;
  personId: string | null;
  regime: string;
  employer: string;
  admissionDate: string;
  endDate: string | null;
  dependents: number;
  payDay: number;
  accountId: string | null;
  recurringTransactionId: string | null;
  bracketMethod: 'DEDUCTION' | 'DIRECT';
  rounding: 'TRUNCATE' | 'ROUND';
  thirteenthFirstMonth: number;
  thirteenthFirstDay: number;
  thirteenthSecondMonth: number;
  thirteenthSecondDay: number;
  uf: string | null;
  city: string | null;
  optionalHolidaysOff: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  salaries: Salary[];
  items: Item[];
  vacations: Vacation[];
  fgtsBalances: FgtsBalance[];
  fgtsWithdrawals: FgtsWithdrawal[];
  fgtsModes: FgtsModeRecord[];
}

export interface PayrollWarning {
  code: 'projection_old_table' | 'before_first_table';
  tax: 'inss' | 'irrf' | 'fgts';
  tableId: string;
}

export interface SalaryEvent {
  competence: string;
  paymentDate: string;
  gross: number;
  workedDays: number;
  vacationDays: number;
  net: number;
  estimated: boolean;
  payroll: {
    salary: number;
    extraEarnings: number;
    fixedDeductions: number;
    inss: number;
    irrfAmount: number;
    fgts: number;
    net: number;
    warnings: PayrollWarning[];
    tables: { inss: string; irrf: string; fgts: string };
  };
}

export interface ThirteenthEvent {
  year: number;
  installment: 1 | 2;
  date: string;
  net: number;
  estimated: boolean;
  thirteenth: {
    avos: number;
    total: number;
    first: { date: string; amount: number };
    second: { date: string; gross: number; inss: number; irrf: number; net: number };
    warnings: PayrollWarning[];
  };
}

export interface VacationEvent {
  id: string;
  paymentDate: string;
  period: { start: string; end: string; days: number; estimated: boolean };
  net: number;
  estimated: boolean;
  vacation: { warnings: PayrollWarning[] };
}

export interface BirthdayForecast {
  year: number;
  date: string;
  amount: number;
  source: 'table' | 'informed';
  balance: number;
  tableId: string | null;
}

export interface FgtsMonth {
  month: string;
  salaryDeposit: number;
  thirteenthDeposit: number;
  vacationDeposit: number;
  withdrawals: number;
  forecastWithdrawal: number;
  accumulated: number;
}

export interface FgtsForecast {
  basis: { asOfDate: string; amount: number } | null;
  months: FgtsMonth[];
  accumulatedToday?: number;
}

export interface BenefitHoliday {
  date: string;
  name: string;
  level: 'national' | 'state' | 'municipal';
  optional: boolean;
}

export interface BenefitWarning {
  code: 'no_state_table' | 'no_city_table' | 'unconfirmed_holiday' | string;
  message?: string;
  date?: string;
}

export interface BenefitEvent {
  itemId: string;
  name: string;
  referenceMonth: string;
  paymentDate: string;
  ratePerDay: number;
  weekdays: number;
  holidayDays: number;
  vacationDays: number;
  marginDays: number;
  countedDays: number;
  amount: number;
  estimated: true;
  isAvailableCash: boolean;
  accountId: string | null;
  recurringTransactionId: string | null;
  holidays: BenefitHoliday[];
  warnings: BenefitWarning[];
}

/** One employment's forecast (GET /payroll/employments/:id/events, or one entry of GET /payroll/events). */
export interface PayrollEvents {
  employmentId: string;
  salary: SalaryEvent[];
  thirteenth: ThirteenthEvent[];
  vacations: VacationEvent[];
  birthdayWithdrawals: BirthdayForecast[];
  fgts: FgtsForecast;
  benefits: BenefitEvent[];
}

/** GET /payroll/events: the events of every active CLT employment of the household (or of one person). */
export interface HouseholdPayrollEvents {
  from: string;
  to: string;
  today: string;
  employments: PayrollEvents[];
}

/** The fields of a recorded transaction the "last real launch" comparison reads. */
export interface LaunchCandidate {
  id: string;
  type?: string;
  amount: number;
  date: string;
  recurringTransactionId?: string | null;
}

// ---- Dates and months ----------------------------------------------------------------------------------------------

const pad = (n: number): string => String(n).padStart(2, '0');

export const isDayKey = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
export const isMonthKey = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/** 'YYYY-MM' of a day. */
export const monthOf = (day: string): string => day.slice(0, 7);

/** 'YYYY-MM' plus n months. */
export function addMonthKey(month: string, n: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** 'YYYY-MM-DD' plus n calendar days (UTC arithmetic, free of daylight saving). */
export function addDayKey(day: string, n: number): string {
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** First and last day of a month, 'YYYY-MM-DD'. */
export function monthRange(month: string): { from: string; to: string } {
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

/** 'dd/mm' of a day ('' for anything else): cut from the string, no Date, so no time zone shift. */
export const shortDay = (day: string | null | undefined): string => (isDayKey(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}` : '');

/** 'dd/mm/yyyy' of a day ('' for anything else). */
export const longDay = (day: string | null | undefined): string => (isDayKey(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : '');

/** Month name and year for a 'YYYY-MM' in a locale ('' for anything else). */
export function monthName(month: string, locale: string): string {
  if (!isMonthKey(month)) return '';
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 15));
  try {
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
  } catch {
    return month;
  }
}

// ---- Money -------------------------------------------------------------------------------------------------------

/** Reais to whole cents (Math.round absorbs the float noise of the API's decimals). */
export const toCents = (reais: number): number => Math.round(reais * 100);
export const fromCents = (cents: number): number => cents / 100;

// ---- People and employments -----------------------------------------------------------------------------------

export interface PersonLike {
  id: string;
  name: string;
  userId: string | null;
  isActive: boolean;
}

export interface EmploymentGroup {
  /** null: the employments without an owner (rows from before the owner existed). */
  personId: string | null;
  person: PersonLike | null;
  employments: Employment[];
}

/** The person of the logged user: the one whose userId is the user's id (null when there is none). */
export function findMyPersonId(people: readonly PersonLike[], userId: string | null | undefined): string | null {
  if (!userId) return null;
  return people.find((p) => p.userId === userId)?.id ?? null;
}

/**
 * Employments grouped by owner, in the order of the people list; the ones without a known owner go last. Only people
 * with at least one employment appear.
 */
export function groupEmploymentsByPerson(people: readonly PersonLike[], employments: readonly Employment[]): EmploymentGroup[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const groups: EmploymentGroup[] = [];
  for (const person of people) {
    const mine = employments.filter((e) => e.personId === person.id);
    if (mine.length > 0) groups.push({ personId: person.id, person, employments: mine });
  }
  const orphans = employments.filter((e) => !e.personId || !byId.has(e.personId));
  if (orphans.length > 0) groups.push({ personId: null, person: null, employments: orphans });
  return groups;
}

/** The "Casal" view makes sense when more than one person has employments. */
export const isCoupleView = (groups: readonly EmploymentGroup[]): boolean => groups.filter((g) => g.personId !== null).length > 1;

export type IncomeScope = 'mine' | 'couple';

/** The personId the scope asks the API for: "Só eu" is the own person; "Casal" asks for everyone (undefined). */
export function scopePersonId(scope: IncomeScope, myPersonId: string | null): string | undefined {
  return scope === 'mine' && myPersonId ? myPersonId : undefined;
}

export type EmploymentStatus = 'active' | 'ended' | 'inactive';

export function employmentStatus(employment: Pick<Employment, 'isActive' | 'endDate'>, today: string): EmploymentStatus {
  if (!employment.isActive) return 'inactive';
  if (employment.endDate && isDayKey(today) && employment.endDate < today) return 'ended';
  return 'active';
}

/** 'dd/mm' of the two 13th installments, as the employment stores them. */
export function thirteenthDays(employment: Pick<Employment, 'thirteenthFirstDay' | 'thirteenthFirstMonth' | 'thirteenthSecondDay' | 'thirteenthSecondMonth'>): { first: string; second: string } {
  return {
    first: `${pad(employment.thirteenthFirstDay)}/${pad(employment.thirteenthFirstMonth)}`,
    second: `${pad(employment.thirteenthSecondDay)}/${pad(employment.thirteenthSecondMonth)}`,
  };
}

/** The salary in force on a day: the latest start not after it (null before the first). */
export function salaryInForce(salaries: readonly Salary[], day: string): Salary | null {
  let best: Salary | null = null;
  for (const s of salaries) if (s.startDate <= day && (!best || s.startDate > best.startDate)) best = s;
  return best;
}

/** The value of a fixed item or per-day benefit in force on a day. */
export function valueInForce(values: readonly ItemValue[], day: string): ItemValue | null {
  let best: ItemValue | null = null;
  for (const v of values) if (v.startDate <= day && (!best || v.startDate > best.startDate)) best = v;
  return best;
}

/** Recurrences that already feed an employment or one of its benefits, except the ones of `exceptEmploymentId` (editing). */
export function recurrencesInUse(employments: readonly Employment[], exceptEmploymentId?: string | null): Set<string> {
  const used = new Set<string>();
  for (const e of employments) {
    if (e.id === exceptEmploymentId) continue;
    if (e.recurringTransactionId) used.add(e.recurringTransactionId);
    for (const item of e.items) if (item.recurringTransactionId) used.add(item.recurringTransactionId);
  }
  return used;
}

// ---- Month totals and upcoming events ------------------------------------------------------------------------

export interface MonthTotals {
  salaryCents: number;
  benefitsCents: number;
  totalCents: number;
}

/**
 * The expected money of a month: the net salary paid in it and the benefits paid in it (both by payment date). The 13th,
 * the vacation and the birthday withdrawal are not in it; they are listed as upcoming events.
 */
export function monthTotals(sets: readonly PayrollEvents[], month: string): MonthTotals {
  let salaryCents = 0;
  let benefitsCents = 0;
  for (const set of sets) {
    for (const s of set.salary) if (monthOf(s.paymentDate) === month) salaryCents += toCents(s.net);
    for (const b of set.benefits) if (monthOf(b.paymentDate) === month) benefitsCents += toCents(b.amount);
  }
  return { salaryCents, benefitsCents, totalCents: salaryCents + benefitsCents };
}

export type UpcomingKind = 'thirteenth' | 'vacation' | 'birthday' | 'benefit';

export interface UpcomingEvent {
  key: string;
  kind: UpcomingKind;
  date: string;
  employmentId: string;
  amountCents: number;
  estimated: boolean;
  /** 13th installment, or the benefit's name and its counted days. */
  installment?: 1 | 2;
  name?: string;
  days?: number;
  /** False for a benefit that is not available money (it stays out of the cash flow). */
  availableCash: boolean;
}

const KIND_ORDER: Record<UpcomingKind, number> = { thirteenth: 0, vacation: 1, birthday: 2, benefit: 3 };

/** Upcoming 13th, vacation, birthday withdrawal and benefit events from `today`, by date then kind then key. */
export function upcomingEvents(sets: readonly PayrollEvents[], today: string): UpcomingEvent[] {
  const out: UpcomingEvent[] = [];
  for (const set of sets) {
    for (const t of set.thirteenth) {
      if (t.date < today) continue;
      out.push({ key: `13:${set.employmentId}:${t.year}:${t.installment}`, kind: 'thirteenth', date: t.date, employmentId: set.employmentId, amountCents: toCents(t.net), estimated: t.estimated, installment: t.installment, availableCash: true });
    }
    for (const v of set.vacations) {
      if (v.paymentDate < today) continue;
      out.push({ key: `vac:${set.employmentId}:${v.id}`, kind: 'vacation', date: v.paymentDate, employmentId: set.employmentId, amountCents: toCents(v.net), estimated: v.estimated, availableCash: true });
    }
    for (const b of set.birthdayWithdrawals) {
      if (b.date < today) continue;
      out.push({ key: `bday:${set.employmentId}:${b.date}`, kind: 'birthday', date: b.date, employmentId: set.employmentId, amountCents: toCents(b.amount), estimated: true, availableCash: true });
    }
    for (const b of set.benefits) {
      if (b.paymentDate < today || b.amount <= 0) continue;
      out.push({
        key: `ben:${set.employmentId}:${b.itemId}:${b.referenceMonth}`,
        kind: 'benefit',
        date: b.paymentDate,
        employmentId: set.employmentId,
        amountCents: toCents(b.amount),
        estimated: true,
        name: b.name,
        days: b.countedDays,
        availableCash: b.isAvailableCash,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.key.localeCompare(b.key));
}

// ---- Benefit paid per business day -----------------------------------------------------------------------------

/** The benefit of one reference month for one item (the one whose payment falls in the range the caller asked for). */
export function benefitForReference(events: readonly BenefitEvent[], itemId: string, referenceMonth: string): BenefitEvent | null {
  return events.find((b) => b.itemId === itemId && b.referenceMonth === referenceMonth) ?? null;
}

/** The business-day count of a benefit month, in the order the screen shows it, and the warnings it carries. */
export function benefitBreakdown(b: BenefitEvent): {
  weekdays: number;
  holidays: BenefitHoliday[];
  holidayDays: number;
  vacationDays: number;
  marginDays: number;
  countedDays: number;
  amountCents: number;
  warnings: BenefitWarning[];
} {
  return {
    weekdays: b.weekdays,
    holidays: b.holidays,
    holidayDays: b.holidayDays,
    vacationDays: b.vacationDays,
    marginDays: b.marginDays,
    countedDays: b.countedDays,
    amountCents: toCents(b.amount),
    warnings: uniqueWarnings(b.warnings),
  };
}

/** Warnings without repeats (the table warnings come once per month, the holiday ones once per day). */
export function uniqueWarnings(warnings: readonly BenefitWarning[]): BenefitWarning[] {
  const seen = new Set<string>();
  const out: BenefitWarning[] = [];
  for (const w of warnings) {
    const key = `${w.code}|${w.date ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

/** The most recent real launch of a recurrence (income, by date); null when none is in the list. */
export function lastRealLaunch(transactions: readonly LaunchCandidate[], recurringId: string): { amountCents: number; date: string } | null {
  let best: LaunchCandidate | null = null;
  for (const t of transactions) {
    if (t.recurringTransactionId !== recurringId) continue;
    if (t.type && t.type !== 'INCOME') continue;
    if (!best || t.date > best.date) best = t;
  }
  return best ? { amountCents: Math.abs(toCents(best.amount)), date: best.date } : null;
}

/** Real minus expected, in cents: negative when the launch came smaller than the forecast. */
export const realMinusExpected = (realCents: number, expectedCents: number): number => realCents - expectedCents;

// ---- FGTS -----------------------------------------------------------------------------------------------------------

/** The deposit of a month: salary, 13th and vacation (cents). */
export function fgtsDepositOfMonth(fgts: FgtsForecast, month: string): number {
  const m = fgts.months.find((x) => x.month === month);
  if (!m) return 0;
  return toCents(m.salaryDeposit) + toCents(m.thirteenthDeposit) + toCents(m.vacationDeposit);
}

/** The FGTS mode in force on a day (the latest start not after it); null when none was recorded. */
export function modeInForce(modes: readonly FgtsModeRecord[], day: string): FgtsModeRecord | null {
  let best: FgtsModeRecord | null = null;
  for (const m of modes) if (m.startDate <= day && (!best || m.startDate > best.startDate)) best = m;
  return best;
}

/** The mode history, oldest first. */
export const modeHistory = (modes: readonly FgtsModeRecord[]): FgtsModeRecord[] => [...modes].sort((a, b) => a.startDate.localeCompare(b.startDate));

/** The next birthday withdrawal forecast from `today` (null when none). */
export function nextBirthdayWithdrawal(list: readonly BirthdayForecast[], today: string): BirthdayForecast | null {
  return [...list].filter((b) => b.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
}

/** The FGTS base the estimate starts from, as a text key and values (no text here). */
export function fgtsBasis(fgts: FgtsForecast): { informed: true; asOfDate: string; amountCents: number } | { informed: false } {
  if (!fgts.basis) return { informed: false };
  return { informed: true, asOfDate: fgts.basis.asOfDate, amountCents: toCents(fgts.basis.amount) };
}

// ---- Warnings of the calculation (texts are in incomeTexts) ----------------------------------------------------

/** The text key of a benefit warning code (the message of the API is not shown: it is in Portuguese only). */
export function benefitWarningKey(code: string): IncomeTextKey {
  if (code === 'no_state_table') return 'incomeWarnNoState';
  if (code === 'no_city_table') return 'incomeWarnNoCity';
  if (code === 'unconfirmed_holiday') return 'incomeWarnUnconfirmed';
  return 'incomeWarnUnknown';
}

/** The text key of a salary/13th/vacation table warning. */
export function payrollWarningKey(code: PayrollWarning['code']): IncomeTextKey {
  return code === 'projection_old_table' ? 'incomeWarnProjection' : 'incomeWarnBeforeTable';
}

// ---- API errors -----------------------------------------------------------------------------------------------------

interface ApiErrorLike {
  status?: number;
  message?: string;
}

/**
 * The text key of an API error. 404 is "not found"; 409 and 400 are read from the backend message (in English, so the
 * fragments are matched, not the whole sentence). Anything else is the generic message.
 */
export function incomeErrorKey(error: unknown): IncomeTextKey {
  const e = (error ?? {}) as ApiErrorLike;
  const message = typeof e.message === 'string' ? e.message : '';
  if (e.status === 404) return 'incomeErrNotFound';
  const rules: Array<[RegExp, IncomeTextKey]> = [
    [/cannot be a credit card/i, 'incomeErrAccountCredit'],
    [/must be an income recurrence/i, 'incomeErrRecurrenceIncome'],
    [/already feeds/i, 'incomeErrRecurrenceUsed'],
    [/already a (salary|value|mode)|already has|for that date|starting that day/i, 'incomeErrDateTaken'],
    [/endDate cannot be before/i, 'incomeErrDateOrder'],
    [/cannot come after the second/i, 'incomeErrThirteenthOrder'],
    [/only the month, not both/i, 'incomeErrVacationChoose'],
    [/days plus sold days cannot exceed 30/i, 'incomeErrVacationTotal'],
    [/payDay is required/i, 'incomeErrPayDayRequired'],
    [/must be an earning/i, 'incomeErrPerDayKind'],
    [/stays outside the INSS/i, 'incomeErrPerDayBases'],
    [/only apply to an item paid per business day/i, 'incomeErrCalcOnlyPerDay'],
    [/not available money/i, 'incomeErrNotCashRecurrence'],
    [/birthday mode needs birthdayMonth/i, 'incomeErrBirthdayMonth'],
    [/termination mode has no/i, 'incomeErrTerminationExtras'],
    [/city needs a uf/i, 'incomeErrCityNeedsUf'],
  ];
  for (const [pattern, key] of rules) if (pattern.test(message)) return key;
  if (e.status === 409) return 'incomeErrConflict';
  return 'incomeErrGeneric';
}

/**
 * Pure logic of the payroll simulator (Renda > Simulador): the form, its validation, the request bodies of
 * POST /payroll/simulate/net and /simulate/gross, the reading of the composition the API answers, the defaults of a
 * salary raise (the job's current gross, dependents and fixed monthly items) and the current x simulated comparison.
 * No React: tools/fe-tests/t32_income_simulator.mts runs it under tsx (SIMULATOR_MODULE points it at a mutated copy).
 *
 * Money: the API answers in reais (moneyDeep turns every *Cents into reais); the readers here convert back to whole
 * cents so the comparisons never drift. Days are 'YYYY-MM-DD'.
 */
import { parseDayText, parseIntText, parseMoneyText, formatMoneyText, INCOME_MAX_AMOUNT, MAX_ITEM_NAME, type FieldErrors } from './incomeForms';
import { payrollWarningKey, salaryInForce, toCents, valueInForce, type Employment, type ItemKind, type PayrollWarning } from './income';
import type { IncomeTextKey } from './incomeTexts';

export type SimMode = 'net' | 'gross';
export type SimBracket = 'DEDUCTION' | 'DIRECT';
export type SimRounding = 'TRUNCATE' | 'ROUND';

/** One line of the form (a verba). The amount is the text the user typed. */
export interface SimLine {
  key: string;
  label: string;
  amount: string;
  kind: ItemKind;
  inInssBase: boolean;
  inIrrfBase: boolean;
  inFgtsBase: boolean;
}

export interface SimForm {
  mode: SimMode;
  /** Gross in net mode; target net in gross mode. */
  amount: string;
  /** Reference day; '' means "today" (the API's default). */
  date: string;
  dependents: string;
  /** '' means the whole month. */
  workedDays: string;
  lines: SimLine[];
  bracketMethod: SimBracket;
  rounding: SimRounding;
}

export type SimField = 'amount' | 'date' | 'dependents' | 'workedDays' | 'lines';

export interface SimLineErrors {
  label?: IncomeTextKey;
  amount?: IncomeTextKey;
}

export interface SimValidation {
  errors: FieldErrors<SimField>;
  lineErrors: Record<string, SimLineErrors>;
  valid: boolean;
}

export const SIM_MAX_LINES = 30;
export const SIM_MAX_DEPENDENTS = 20;
export const SIM_MAX_WORKED_DAYS = 30;

export function emptySimForm(mode: SimMode = 'net'): SimForm {
  return { mode, amount: '', date: '', dependents: '0', workedDays: '', lines: [], bracketMethod: 'DEDUCTION', rounding: 'TRUNCATE' };
}

export function newSimLine(key: string): SimLine {
  return { key, label: '', amount: '', kind: 'EARNING', inInssBase: false, inIrrfBase: false, inFgtsBase: false };
}

/** A positive amount typed by the user: the text key of the problem, or null. */
function positiveMoneyError(text: string): IncomeTextKey | null {
  if (!text.trim()) return 'incomeErrAmountPositive';
  const value = parseMoneyText(text);
  if (value === null) return 'incomeErrAmount';
  if (value <= 0) return 'incomeErrAmountPositive';
  if (value > INCOME_MAX_AMOUNT) return 'incomeErrAmountMax';
  return null;
}

/** Checks the form the way the API does (payroll.schema.ts): the shape is right before anything is sent. */
export function validateSim(form: SimForm): SimValidation {
  const errors: FieldErrors<SimField> = {};
  const lineErrors: Record<string, SimLineErrors> = {};

  const amount = positiveMoneyError(form.amount);
  if (amount) errors.amount = amount;
  if (form.date.trim() && !parseDayText(form.date)) errors.date = 'incomeErrDate';

  const dependents = parseIntText(form.dependents);
  if (dependents === null || dependents < 0 || dependents > SIM_MAX_DEPENDENTS) errors.dependents = 'incomeErrDependents';

  if (form.workedDays.trim()) {
    const days = parseIntText(form.workedDays);
    if (days === null || days < 0 || days > SIM_MAX_WORKED_DAYS) errors.workedDays = 'incomeSimErrWorkedDays';
  }

  if (form.lines.length > SIM_MAX_LINES) errors.lines = 'incomeSimErrLines';
  for (const line of form.lines) {
    const found: SimLineErrors = {};
    const label = line.label.trim();
    if (!label || label.length > MAX_ITEM_NAME) found.label = 'incomeErrName';
    const money = positiveMoneyError(line.amount);
    if (money) found.amount = money;
    if (found.label || found.amount) lineErrors[line.key] = found;
  }

  return { errors, lineErrors, valid: Object.keys(errors).length === 0 && Object.keys(lineErrors).length === 0 };
}

export interface SimBodyLine {
  label: string;
  amount: number;
  kind: ItemKind;
  inInssBase: boolean;
  inIrrfBase: boolean;
  inFgtsBase: boolean;
}

/** The body of POST /payroll/simulate/net (gross) or /simulate/gross (targetNet). Call only on a valid form. */
export interface SimBody {
  gross?: number;
  targetNet?: number;
  date?: string;
  dependents: number;
  items: SimBodyLine[];
  workedDays?: number;
  bracketMethod: SimBracket;
  rounding: SimRounding;
}

/**
 * The request body of the form. The amount goes to `gross` in net mode and to `targetNet` in gross mode. A deduction
 * has no base flags (the API ignores them for it), so they are sent as false.
 */
export function simBody(form: SimForm): SimBody {
  const amount = parseMoneyText(form.amount) ?? 0;
  const body: SimBody = {
    dependents: parseIntText(form.dependents) ?? 0,
    items: form.lines.map((line) => {
      const earning = line.kind === 'EARNING';
      return {
        label: line.label.trim(),
        amount: parseMoneyText(line.amount) ?? 0,
        kind: line.kind,
        inInssBase: earning && line.inInssBase,
        inIrrfBase: earning && line.inIrrfBase,
        inFgtsBase: earning && line.inFgtsBase,
      };
    }),
    bracketMethod: form.bracketMethod,
    rounding: form.rounding,
  };
  if (form.mode === 'net') body.gross = amount;
  else body.targetNet = amount;
  if (form.date.trim()) body.date = form.date.trim();
  if (form.workedDays.trim()) body.workedDays = parseIntText(form.workedDays) ?? 0;
  return body;
}

/** The same body with another gross (the current salary of a raise comparison). */
export function withGross(body: SimBody, gross: number): SimBody {
  const next: SimBody = { ...body, gross };
  delete next.targetNet;
  return next;
}

// ---- The answer ----------------------------------------------------------------------------------------------------

/** The composition of one month as the API answers it (money in reais, the names of moneyDeep). */
export interface SimPayroll {
  tables: { inss: string; irrf: string; fgts: string };
  warnings: PayrollWarning[];
  method: { bracket: 'deduction' | 'direct'; rounding: 'truncate' | 'round' };
  salary: number;
  extraEarnings: number;
  fixedDeductions: number;
  bases: { inss: number; irrfIncome: number; irrf: number; fgts: number };
  inss: number;
  irrf: { deduction: 'legal' | 'simplified'; deductionAmount: number; taxBeforeReduction: number; reduction: number; tax: number };
  irrfAmount: number;
  fgts: number;
  net: number;
}

/** POST /payroll/simulate/net */
export interface SimNetResult {
  payroll: SimPayroll;
}

/** POST /payroll/simulate/gross: the smallest gross that reaches the target; difference is net minus target (>= 0). */
export interface SimGrossResult {
  gross: number;
  payroll: SimPayroll;
  difference: number;
}

/** The composition in cents, ready for the screen. */
export interface SimComposition {
  salaryCents: number;
  extraEarningsCents: number;
  grossCents: number;
  fixedDeductionsCents: number;
  inss: { baseCents: number; valueCents: number };
  irrf: {
    incomeCents: number;
    baseCents: number;
    valueCents: number;
    deduction: 'legal' | 'simplified';
    deductionCents: number;
    taxBeforeReductionCents: number;
    reductionCents: number;
  };
  fgtsCents: number;
  netCents: number;
  tables: { inss: string; irrf: string; fgts: string };
  warnings: PayrollWarning[];
  /** A warning key per distinct warning code, in the order the API gave them. */
  warningKeys: IncomeTextKey[];
  /** True when the tables are a projection (the screen says so in plain text). */
  projection: boolean;
}

/** The composition of a month in cents. Gross = salary (prorated) plus the extra earnings. */
export function compositionOf(p: SimPayroll): SimComposition {
  const warnings = p.warnings ?? [];
  const seen = new Set<string>();
  const warningKeys: IncomeTextKey[] = [];
  for (const w of warnings) {
    if (seen.has(w.code)) continue;
    seen.add(w.code);
    warningKeys.push(payrollWarningKey(w.code));
  }
  const salaryCents = toCents(p.salary);
  const extraEarningsCents = toCents(p.extraEarnings);
  return {
    salaryCents,
    extraEarningsCents,
    grossCents: salaryCents + extraEarningsCents,
    fixedDeductionsCents: toCents(p.fixedDeductions),
    inss: { baseCents: toCents(p.bases.inss), valueCents: toCents(p.inss) },
    irrf: {
      incomeCents: toCents(p.bases.irrfIncome),
      baseCents: toCents(p.bases.irrf),
      valueCents: toCents(p.irrfAmount),
      deduction: p.irrf.deduction,
      deductionCents: toCents(p.irrf.deductionAmount),
      taxBeforeReductionCents: toCents(p.irrf.taxBeforeReduction),
      reductionCents: toCents(p.irrf.reduction),
    },
    fgtsCents: toCents(p.fgts),
    netCents: toCents(p.net),
    tables: p.tables,
    warnings,
    warningKeys,
    projection: warnings.some((w) => w.code === 'projection_old_table'),
  };
}

/** Net of the current salary x net of the simulated one, in cents; the difference is simulated minus current. */
export interface NetComparison {
  currentCents: number;
  simulatedCents: number;
  differenceCents: number;
}

export function compareNet(currentNetCents: number, simulatedNetCents: number): NetComparison {
  return { currentCents: currentNetCents, simulatedCents: simulatedNetCents, differenceCents: simulatedNetCents - currentNetCents };
}

/** A gross simulation reached the exact target only when the difference is zero to the cent. */
export const isExactNet = (differenceCents: number): boolean => differenceCents === 0;

// ---- Raise defaults ------------------------------------------------------------------------------------------------

export interface RaiseStart {
  form: SimForm;
  /** The gross in force today, in reais; null when the job has no salary in force. */
  baselineGross: number | null;
}

/**
 * The simulator opened from a job: net mode, the gross in force today, the dependents, and the fixed monthly items in
 * force today (per-business-day items are not salary and stay out). The base flags come from the item.
 */
export function raiseStart(employment: Pick<Employment, 'dependents' | 'salaries' | 'items'>, today: string): RaiseStart {
  const salary = salaryInForce(employment.salaries, today);
  const lines: SimLine[] = [];
  for (const item of employment.items) {
    if (item.calcMode !== 'FIXED_MONTHLY') continue;
    const value = valueInForce(item.values, today);
    if (!value) continue;
    lines.push({
      key: item.id,
      label: item.name,
      amount: formatMoneyText(value.amount),
      kind: item.kind,
      inInssBase: item.inInssBase,
      inIrrfBase: item.inIrrfBase,
      inFgtsBase: item.inFgtsBase,
    });
  }
  return {
    form: {
      mode: 'net',
      amount: salary ? formatMoneyText(salary.amount) : '',
      date: today,
      dependents: String(employment.dependents),
      workedDays: '',
      lines,
      bracketMethod: 'DEDUCTION',
      rounding: 'TRUNCATE',
    },
    baselineGross: salary ? salary.amount : null,
  };
}

// ---- Errors --------------------------------------------------------------------------------------------------------

/**
 * The text key of a simulation error. "out of reach" is the API's answer for a net nothing reaches; any other 400 is
 * the shape refused (the form is checked before, so this is rare); the rest is a generic failure.
 */
export function simulationErrorKey(error: unknown): IncomeTextKey {
  const e = (error ?? {}) as { status?: number; message?: string };
  if (typeof e.message === 'string' && /out of reach/i.test(e.message)) return 'incomeSimErrOutOfReach';
  if (e.status === 400) return 'incomeSimErrInvalid';
  return 'incomeSimErrGeneric';
}

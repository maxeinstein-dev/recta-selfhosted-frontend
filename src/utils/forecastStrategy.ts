/**
 * Pure logic of the forecast strategies of a recurrence ("Como prever o valor"): the client twin of the server's
 * `expectedAmountFor`, the texts that say how an expected amount was reached, the form draft (with validation and the
 * request fields) and the "dias implícitos" of the confirmation dialog. Everything is integer cents; reais appear only at
 * the edges. No React, no axios and no `import.meta`, so it also runs under `tsx`.
 */
import { businessDaysInMonth, isValidNonWorkingDay } from './businessDays';
import type { OptionalHoliday } from './businessDays';
import { addMonthsKey, isMonthKey, monthKeyOf, monthLabel } from './referenceMonth';
import { centsToReais, moneyText, reaisToCents } from './people';

export type ForecastStrategy = 'LAST' | 'FIXED' | 'CONSERVATIVE' | 'PER_BUSINESS_DAY';
export const FORECAST_STRATEGIES: readonly ForecastStrategy[] = ['LAST', 'FIXED', 'CONSERVATIVE', 'PER_BUSINESS_DAY'];

/** Default size of the conservative window, by the kind of the recurrence (same as the server). */
export const DEFAULT_WINDOW = { INCOME: 6, EXPENSE: 3 } as const;
export const MAX_WINDOW = 36;
export const MAX_SAFETY_DAYS = 31;
/** Most "dias sem vale" a recurrence may list. */
export const MAX_NON_WORKING_DAYS = 60;

export type Kind = 'INCOME' | 'EXPENSE';

/** The fields of a recurrence that decide its forecast (what the server stores and returns). */
export interface ForecastFields {
  amount: number;
  forecastStrategy?: ForecastStrategy | string | null;
  forecastWindow?: number | null;
  dailyRate?: number | null;
  safetyBusinessDays?: number | null;
  nonWorkingDays?: readonly string[] | null;
  optionalHolidays?: readonly string[] | null;
}

export interface ConfirmedValue {
  amount: number;
  date?: string;
}

/** How an expected amount was reached (the server sends the same shape as `forecast` on each recurrence). */
export interface ForecastDetail {
  amount: number;
  strategy: ForecastStrategy;
  businessDays?: number;
  safetyBusinessDays?: number;
  countedBusinessDays?: number;
  dailyRate?: number;
  window?: number;
  usedValues?: number[];
  fellBack?: boolean;
  /** 'YYYY-MM' the amount is for (server `forecast` of a recurrence). */
  referenceMonth?: string;
}

export const normalizeStrategy = (value: unknown): ForecastStrategy =>
  (FORECAST_STRATEGIES as readonly string[]).includes(value as string) ? (value as ForecastStrategy) : 'LAST';

export function windowOf(fields: Pick<ForecastFields, 'forecastWindow'>, kind: Kind): number {
  const own = fields.forecastWindow;
  if (typeof own === 'number' && Number.isInteger(own) && own >= 1) return Math.min(own, MAX_WINDOW);
  return kind === 'INCOME' ? DEFAULT_WINDOW.INCOME : DEFAULT_WINDOW.EXPENSE;
}

/**
 * Client twin of the server's `explainExpectedAmount(recurrence, history, referenceMonth)`. `history` holds the confirmed
 * occurrences, newest first. Same rules as the server (a parity suite compares them): LAST and FIXED carry the recurrence
 * amount, CONSERVATIVE the smallest (income) or largest (expense) of the last N confirmed, PER_BUSINESS_DAY the rate times
 * the business days of the reference month minus the margin (never below zero).
 */
export function explainExpected(
  fields: ForecastFields,
  kind: Kind,
  history: readonly ConfirmedValue[],
  referenceMonth: string,
): ForecastDetail {
  const strategy = normalizeStrategy(fields.forecastStrategy);
  const fallback: ForecastDetail = { amount: fields.amount, strategy, fellBack: true };

  if (strategy === 'CONSERVATIVE') {
    const window = windowOf(fields, kind);
    const used = history.slice(0, window).map((h) => reaisToCents(h.amount)).filter((c) => Number.isFinite(c) && c > 0);
    if (used.length === 0) return { ...fallback, window, usedValues: [] };
    const pick = kind === 'INCOME' ? Math.min(...used) : Math.max(...used);
    return { amount: centsToReais(pick), strategy, window, usedValues: used.map(centsToReais) };
  }

  if (strategy === 'PER_BUSINESS_DAY') {
    const rate = fields.dailyRate;
    if (rate === null || rate === undefined || !(rate > 0) || !isMonthKey(referenceMonth)) return fallback;
    const businessDays = businessDaysInMonth(referenceMonth, { optionalHolidays: fields.optionalHolidays, nonWorkingDays: fields.nonWorkingDays });
    const safety = Math.max(0, Math.trunc(fields.safetyBusinessDays ?? 0));
    const counted = Math.max(0, businessDays - safety);
    return {
      amount: centsToReais(reaisToCents(rate) * counted),
      strategy,
      businessDays,
      safetyBusinessDays: safety,
      countedBusinessDays: counted,
      dailyRate: centsToReais(reaisToCents(rate)),
    };
  }

  return { amount: fields.amount, strategy };
}

export function expectedAmountOf(fields: ForecastFields, kind: Kind, history: readonly ConfirmedValue[], referenceMonth: string): number {
  return explainExpected(fields, kind, history, referenceMonth).amount;
}

// ---- Texts ---------------------------------------------------------------------------------------------------

export const STRATEGY_LABEL: Record<ForecastStrategy, string> = {
  LAST: 'Último valor',
  FIXED: 'Valor fixo',
  CONSERVATIVE: 'Conservador',
  PER_BUSINESS_DAY: 'Por dia útil',
};

export const FORECAST_FIELD_LABEL = 'Como prever o valor';

export function strategyHelp(strategy: ForecastStrategy, kind: Kind): string {
  switch (strategy) {
    case 'LAST':
      return 'O próximo mês usa o valor do último mês. Com "Acompanhar o último valor", o valor que você confirma passa a valer para os próximos.';
    case 'FIXED':
      return 'Sempre o valor que você digitou. O valor confirmado não muda a previsão.';
    case 'CONSERVATIVE':
      return kind === 'INCOME'
        ? 'Prevê o MENOR dos últimos valores recebidos, para não contar com dinheiro que pode não vir.'
        : 'Prevê o MAIOR dos últimos valores pagos, para não ser pego de surpresa.';
    case 'PER_BUSINESS_DAY':
      return 'Valor por dia útil × os dias úteis do mês a que a ocorrência se refere (segunda a sexta, sem feriados). O valor confirmado não muda a previsão.';
  }
}

export const AMOUNT_LABEL: Record<ForecastStrategy, string> = {
  LAST: 'Valor',
  FIXED: 'Valor fixo',
  CONSERVATIVE: 'Valor inicial (usado até haver valores confirmados)',
  PER_BUSINESS_DAY: 'Valor',
};

export const WINDOW_LABEL = 'Quantos valores olhar';
export const DAILY_RATE_LABEL = 'Valor por dia útil';
export const SAFETY_LABEL = 'Descontar dias úteis (margem de segurança)';
export const NON_WORKING_LABEL = 'Dias sem vale';
export const NON_WORKING_HELP = 'Datas em que não há pagamento, separadas por vírgula: 24/06, 08/07 (todo ano) ou 24/06/2026 (só naquele ano).';
export const CARNIVAL_LABEL = 'Carnaval (segunda e terça) não conta';
export const CORPUS_CHRISTI_LABEL = 'Corpus Christi não conta';

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** 17.5 as "17,5", 18 as "18". */
export function formatDays(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return String(rounded).replace('.', ',');
}

/** How the amount was reached, in words: "19 dias úteis × R$ 36,00", "menor dos últimos 3 recebidos: ...". */
export function howCalculated(detail: ForecastDetail, kind: Kind, format: (cents: number) => string = moneyText): string {
  switch (detail.strategy) {
    case 'PER_BUSINESS_DAY': {
      if (detail.fellBack || detail.businessDays === undefined || detail.dailyRate === undefined) return 'sem valor por dia: usa o valor cadastrado';
      const rate = format(reaisToCents(detail.dailyRate));
      const safety = detail.safetyBusinessDays ?? 0;
      const counted = detail.countedBusinessDays ?? detail.businessDays;
      if (safety > 0) return `${plural(detail.businessDays, 'dia útil', 'dias úteis')} − ${safety} de margem = ${plural(counted, 'dia', 'dias')} × ${rate}`;
      return `${plural(detail.businessDays, 'dia útil', 'dias úteis')} × ${rate}`;
    }
    case 'CONSERVATIVE': {
      if (detail.fellBack || !detail.usedValues || detail.usedValues.length === 0) return 'ainda sem valores confirmados: usa o valor cadastrado';
      const word = kind === 'INCOME' ? 'menor' : 'maior';
      const done = kind === 'INCOME' ? 'recebidos' : 'pagos';
      const asked = detail.window ?? detail.usedValues.length;
      const n = detail.usedValues.length;
      const list = detail.usedValues.map((v) => format(reaisToCents(v))).join(', ');
      const scope = n < asked ? `dos ${n} ${done} até agora (olha até ${asked})` : `dos últimos ${n} ${done}`;
      return `${word} ${scope}: ${list}`;
    }
    case 'FIXED':
      return 'valor fixo';
    default:
      return 'último valor';
  }
}

/** The line of the recurrence list: "Previsão de 11/2026: R$ 684,00 (19 dias úteis × R$ 36,00)"; null for the plain last value. */
export function nextForecastText(
  detail: ForecastDetail | null | undefined,
  kind: Kind,
  format: (cents: number) => string = moneyText,
): string | null {
  if (!detail) return null;
  const month = detail.referenceMonth && isMonthKey(detail.referenceMonth) ? ` de ${monthLabel(detail.referenceMonth)}` : '';
  const amount = format(reaisToCents(detail.amount));
  if (detail.strategy === 'LAST' || detail.strategy === 'FIXED') return `Previsão${month}: ${amount}`;
  return `Previsão${month}: ${amount} (${howCalculated(detail, kind, format)})`;
}

/**
 * What the list shows for a recurrence: the server's `forecast` when it sent one, else the twin computed here (no
 * history: a conservative recurrence then shows the registered amount).
 */
export function forecastDetailOf(
  recurrence: ForecastFields & { forecast?: ForecastDetail | null },
  kind: Kind,
  nextReferenceMonth: string,
): ForecastDetail {
  if (recurrence.forecast) return recurrence.forecast;
  return { ...explainExpected(recurrence, kind, [], nextReferenceMonth), referenceMonth: nextReferenceMonth };
}

/** The reference month of the next occurrence of a recurrence: the month of its next date moved by the offset. */
export function nextReferenceMonth(nextDate: Date | string, offset: number | null | undefined): string {
  const own = monthKeyOf(nextDate);
  return own && offset ? addMonthsKey(own, offset) : own;
}

// ---- Form draft ------------------------------------------------------------------------------------------------

export interface ForecastDraft {
  strategy: ForecastStrategy;
  /** N of the conservative strategy, as typed ('' = the default of the kind). */
  windowText: string;
  dailyRateCents: number | null;
  safetyText: string;
  /** "24/06, 08/07" as typed. */
  nonWorkingText: string;
  carnival: boolean;
  corpusChristi: boolean;
}

export const emptyForecastDraft = (): ForecastDraft => ({
  strategy: 'LAST',
  windowText: '',
  dailyRateCents: null,
  safetyText: '',
  nonWorkingText: '',
  carnival: false,
  corpusChristi: false,
});

/** "06-24" as "24/06" and "2026-06-24" as "24/06/2026". */
export function nonWorkingDayText(day: string): string {
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (full) return `${full[3]}/${full[2]}/${full[1]}`;
  const part = /^(\d{2})-(\d{2})$/.exec(day);
  return part ? `${part[2]}/${part[1]}` : day;
}

export interface ParsedNonWorking {
  days: string[];
  /** The pieces that are not a real date, as typed. */
  invalid: string[];
}

/** "24/06, 08/07; 24/06/2026" to ['06-24', '07-08', '2026-06-24'] (sorted, no duplicates) and the pieces that were not dates. */
export function parseNonWorkingText(text: string): ParsedNonWorking {
  const days = new Set<string>();
  const invalid: string[] = [];
  for (const piece of text.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean)) {
    const full = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(piece);
    const part = /^(\d{1,2})\/(\d{1,2})$/.exec(piece);
    const key = full
      ? `${full[3]}-${full[2].padStart(2, '0')}-${full[1].padStart(2, '0')}`
      : part
        ? `${part[2].padStart(2, '0')}-${part[1].padStart(2, '0')}`
        : '';
    if (key && isValidNonWorkingDay(key)) days.add(key);
    else invalid.push(piece);
  }
  return { days: [...days].sort(), invalid };
}

export interface ForecastRecurrenceFields extends ForecastFields {
  frequency?: string;
}

/** The draft of an existing recurrence (an older server, or a recurrence without the fields, is LAST). */
export function draftFromRecurrence(r: ForecastFields | null | undefined): ForecastDraft {
  if (!r) return emptyForecastDraft();
  const optional = r.optionalHolidays ?? [];
  return {
    strategy: normalizeStrategy(r.forecastStrategy),
    windowText: r.forecastWindow ? String(r.forecastWindow) : '',
    dailyRateCents: r.dailyRate && r.dailyRate > 0 ? reaisToCents(r.dailyRate) : null,
    safetyText: r.safetyBusinessDays ? String(r.safetyBusinessDays) : '',
    nonWorkingText: (r.nonWorkingDays ?? []).map(nonWorkingDayText).join(', '),
    carnival: optional.includes('CARNIVAL'),
    corpusChristi: optional.includes('CORPUS_CHRISTI'),
  };
}

export interface ForecastCheck {
  ok: boolean;
  errors: { window?: string; dailyRate?: string; safety?: string; nonWorking?: string; frequency?: string };
}

const WHOLE = /^\d+$/;

/** Only the fields of the chosen strategy are checked. `frequency` is lowercase or uppercase, as the form has it. */
export function validateForecast(draft: ForecastDraft, frequency: string): ForecastCheck {
  const errors: ForecastCheck['errors'] = {};
  if (draft.strategy === 'CONSERVATIVE' && draft.windowText.trim() !== '') {
    const n = WHOLE.test(draft.windowText.trim()) ? Number(draft.windowText.trim()) : NaN;
    if (!(n >= 1 && n <= MAX_WINDOW)) errors.window = `Informe um número de 1 a ${MAX_WINDOW}.`;
  }
  if (draft.strategy === 'PER_BUSINESS_DAY') {
    if (draft.dailyRateCents === null || draft.dailyRateCents <= 0) errors.dailyRate = 'Informe o valor por dia útil.';
    if (draft.safetyText.trim() !== '') {
      const n = WHOLE.test(draft.safetyText.trim()) ? Number(draft.safetyText.trim()) : NaN;
      if (!(n >= 0 && n <= MAX_SAFETY_DAYS)) errors.safety = `Informe um número de 0 a ${MAX_SAFETY_DAYS}.`;
    }
    const parsed = parseNonWorkingText(draft.nonWorkingText);
    if (parsed.invalid.length > 0) errors.nonWorking = `Data inválida: ${parsed.invalid.join(', ')}. Use 24/06 ou 24/06/2026.`;
    else if (parsed.days.length > MAX_NON_WORKING_DAYS) errors.nonWorking = `No máximo ${MAX_NON_WORKING_DAYS} datas.`;
    if (frequency.toLowerCase() !== 'monthly') errors.frequency = 'O modo por dia útil só vale para recorrência mensal.';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * The strategy fields of the create / update request. Only the parameters of the chosen strategy carry values; the
 * others are sent neutral (null / 0 / empty) so switching strategies leaves nothing stale. LAST without the follow flag
 * and FIXED never send a window or a rate.
 */
export function forecastPayload(draft: ForecastDraft): {
  forecastStrategy: ForecastStrategy;
  forecastWindow: number | null;
  dailyRate: number | null;
  safetyBusinessDays: number;
  nonWorkingDays: string[];
  optionalHolidays: OptionalHoliday[];
} {
  const perDay = draft.strategy === 'PER_BUSINESS_DAY';
  const optional: OptionalHoliday[] = [];
  if (perDay && draft.carnival) optional.push('CARNIVAL');
  if (perDay && draft.corpusChristi) optional.push('CORPUS_CHRISTI');
  return {
    forecastStrategy: draft.strategy,
    forecastWindow: draft.strategy === 'CONSERVATIVE' && draft.windowText.trim() !== '' ? Number(draft.windowText.trim()) : null,
    dailyRate: perDay && draft.dailyRateCents !== null ? centsToReais(draft.dailyRateCents) : null,
    safetyBusinessDays: perDay && draft.safetyText.trim() !== '' ? Number(draft.safetyText.trim()) : 0,
    nonWorkingDays: perDay ? parseNonWorkingText(draft.nonWorkingText).days : [],
    optionalHolidays: optional,
  };
}

/** The fields of a draft as the twin reads them (for the live preview of the form). */
export function fieldsOfDraft(draft: ForecastDraft, amount: number): ForecastFields {
  const p = forecastPayload(draft);
  return { amount, forecastStrategy: p.forecastStrategy, forecastWindow: p.forecastWindow, dailyRate: p.dailyRate, safetyBusinessDays: p.safetyBusinessDays, nonWorkingDays: p.nonWorkingDays, optionalHolidays: p.optionalHolidays };
}

/**
 * The amount stored on a per-day recurrence (the server needs a non-zero amount; it is only a reference, the forecast
 * comes from the rate): the forecast of the next month when there is one, else one day of the rate.
 */
export function referenceAmountForPerDay(draft: ForecastDraft, nextReference: string): number {
  const rate = draft.dailyRateCents === null ? 0 : centsToReais(draft.dailyRateCents);
  if (!(rate > 0)) return 0;
  const forecast = explainExpected(fieldsOfDraft(draft, rate), 'INCOME', [], nextReference).amount;
  return forecast > 0 ? forecast : rate;
}

/** The label of the amount field for a strategy ("Valor fixo", "Valor inicial ..."). */
export const amountLabelFor = (strategy: ForecastStrategy, fallback: string): string => (strategy === 'LAST' ? fallback : AMOUNT_LABEL[strategy]);

// ---- Confirmation: "dias implícitos" -----------------------------------------------------------------------------

/** Days a received amount stands for: received ÷ rate, to two decimals; null without a usable rate or amount. */
export function impliedDays(receivedCents: number | null, rateCents: number | null): number | null {
  if (receivedCents === null || receivedCents <= 0 || rateCents === null || rateCents <= 0) return null;
  return Math.round((receivedCents * 100) / rateCents) / 100;
}

export interface ImpliedDaysNote {
  /** "18 dias (R$ 648,00 ÷ R$ 36,00)". */
  implied: string;
  /** Same as the days the calculation used. */
  matches: boolean;
  /** Set when it differs: register a day without voucher / adjust the rate. */
  suggestion: string | null;
}

/**
 * The note under the amount of a per-day recurrence: the days the received amount stands for, and, when they differ
 * from the business days the forecast counted, the suggestion to register a "dia sem vale" or adjust the daily rate.
 */
export function impliedDaysNote(
  receivedCents: number | null,
  rateCents: number | null,
  countedDays: number,
  businessDays: number,
  referenceMonth: string,
  format: (cents: number) => string = moneyText,
): ImpliedDaysNote | null {
  const days = impliedDays(receivedCents, rateCents);
  if (days === null || receivedCents === null || rateCents === null) return null;
  const implied = `${formatDays(days)} ${days === 1 ? 'dia' : 'dias'} (${format(receivedCents)} ÷ ${format(rateCents)})`;
  if (Math.abs(days - countedDays) < 0.005) return { implied, matches: true, suggestion: null };
  const month = isMonthKey(referenceMonth) ? ` de ${monthLabel(referenceMonth)}` : '';
  const used = countedDays !== businessDays
    ? `O cálculo usou ${plural(countedDays, 'dia', 'dias')} (${plural(businessDays, 'dia útil', 'dias úteis')} menos a margem).`
    : `O cálculo usou ${plural(countedDays, 'dia útil', 'dias úteis')}${month}.`;
  const advice = days < countedDays
    ? 'Se algum dia não teve vale, cadastre-o como dia sem vale; se o valor do dia mudou, ajuste o valor por dia.'
    : 'Se um dia que você descontou foi pago, retire-o dos dias sem vale; se o valor do dia mudou, ajuste o valor por dia.';
  return { implied, matches: false, suggestion: `${used} ${advice}` };
}

/**
 * What a confirmed value does to the forecast, for the hint of the dialog: the conservative strategy learns it (it joins
 * the history), FIXED and PER_BUSINESS_DAY never change because of it. Null for the last value (the follow-last hint says it).
 */
export function confirmedValueNote(strategy: ForecastStrategy): string | null {
  switch (strategy) {
    case 'CONSERVATIVE':
      return 'este valor entra no histórico da previsão conservadora';
    case 'FIXED':
      return 'a previsão dos próximos meses continua o valor fixo';
    case 'PER_BUSINESS_DAY':
      return 'a previsão dos próximos meses continua pelo valor por dia útil';
    default:
      return null;
  }
}

/** What the dialog needs to explain a pending occurrence of a recurrence with a strategy. */
export interface ConfirmExplanation {
  strategy: ForecastStrategy;
  /** "19 dias úteis × R$ 36,00 (11/2026)": how the expected amount is reached today. */
  how: string;
  /** The amount the strategy gives today, in cents (it may differ from the stored expected one if the settings changed since). */
  todayCents: number;
  /** Per-day only. */
  perDay: { rateCents: number; countedDays: number; businessDays: number; referenceMonth: string } | null;
}

/** The explanation of an occurrence, or null for the plain last value (nothing to explain). */
export function confirmExplanation(
  recurrence: ForecastFields | null | undefined,
  kind: Kind,
  referenceMonth: string,
  format: (cents: number) => string = moneyText,
): ConfirmExplanation | null {
  if (!recurrence || normalizeStrategy(recurrence.forecastStrategy) === 'LAST') return null;
  const detail = explainExpected(recurrence, kind, [], referenceMonth);
  const month = isMonthKey(referenceMonth) ? ` (${monthLabel(referenceMonth)})` : '';
  const perDay = detail.strategy === 'PER_BUSINESS_DAY' && !detail.fellBack && detail.dailyRate !== undefined
    ? { rateCents: reaisToCents(detail.dailyRate), countedDays: detail.countedBusinessDays ?? 0, businessDays: detail.businessDays ?? 0, referenceMonth }
    : null;
  const how = detail.strategy === 'CONSERVATIVE'
    ? `conservador: ${kind === 'INCOME' ? 'menor' : 'maior'} dos últimos ${windowOf(recurrence, kind)} ${kind === 'INCOME' ? 'recebidos' : 'pagos'}`
    : `${howCalculated(detail, kind, format)}${month}`;
  return { strategy: detail.strategy, how, todayCents: reaisToCents(detail.amount), perDay };
}

/**
 * Pure logic of the early-payment discount of a recurrence ("desconto se pagar até o dia"): the form draft and its
 * validation (the same rules as the server, in whole cents), the discounted amount, the "Pague até {data} e economize"
 * notice with the highlight of the last days, the "Pagar agora" rule and the pay-next error messages. No React and no
 * imports, so tools/fe-tests/t43_early_discount.mts runs it under tsx (EARLY_DISCOUNT_MODULE points at a mutated copy).
 *
 * Days are 'YYYY-MM-DD' strings compared by calendar day (no time zone shifts them).
 */
import { earlyDiscountText, type EarlyDiscountTextKey } from './earlyDiscountTexts';

export type EarlyDiscountType = 'FIXED' | 'PERCENT';

/** What the API sends on a cash flow event (and, without the ids, on the recurrence list). */
export interface EarlyDiscountQuote {
  limitDate: string;
  fullAmount: number;
  discountedAmount: number;
  savings: number;
}

export interface CashFlowEarlyDiscount extends EarlyDiscountQuote {
  recurringId: string;
  occurrenceDate: string;
  canPayNow: boolean;
}

/** The three form fields, as typed. */
export interface EarlyDiscountDraft {
  day: string;
  type: EarlyDiscountType;
  value: string;
}

export const emptyDraft = (): EarlyDiscountDraft => ({ day: '', type: 'FIXED', value: '' });

const toCents = (value: number): number => Math.round(value * 100 + (value < 0 ? -1e-6 : 1e-6));

/** The amount after the discount, in cents; a percentage is rounded UP to the cent (basis points keep it exact). */
export function discountedCents(fullCents: number, type: EarlyDiscountType, value: number): number {
  if (type === 'FIXED') return fullCents - toCents(value);
  return Math.ceil((fullCents * (10_000 - toCents(value))) / 10_000);
}

/** A typed discount value: "40", "40,5", "40.50", "1.234,56"; at most 2 decimals; null for anything else. */
export function parseDiscountValue(text: string): number | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export type EarlyDiscountErrorKey =
  | 'earlyDiscountIncomplete'
  | 'earlyDiscountDayInvalid'
  | 'earlyDiscountValueInvalid'
  | 'earlyDiscountAmountNeeded'
  | 'earlyDiscountPercentRange'
  | 'earlyDiscountFixedPositive'
  | 'earlyDiscountFixedTooBig'
  | 'earlyDiscountNoEffect';

export interface EarlyDiscountPayload {
  earlyDiscountDay: number;
  earlyDiscountType: EarlyDiscountType;
  earlyDiscountValue: number;
}

export type DraftResult =
  | { ok: true; payload: EarlyDiscountPayload | null }
  | { ok: false; field: 'day' | 'value'; key: EarlyDiscountErrorKey };

/**
 * Checks the draft against the recurrence amount, in the order the server does. Blank day and value mean "no discount"
 * (payload null). `amount` is the amount the recurrence will carry (money units).
 */
export function validateDraft(draft: EarlyDiscountDraft, amount: number): DraftResult {
  const dayText = String(draft.day ?? '').trim();
  const valueText = String(draft.value ?? '').trim();
  if (!dayText && !valueText) return { ok: true, payload: null };
  if (!dayText) return { ok: false, field: 'day', key: 'earlyDiscountIncomplete' };
  if (!valueText) return { ok: false, field: 'value', key: 'earlyDiscountIncomplete' };

  const day = /^\d+$/.test(dayText) ? Number(dayText) : NaN;
  if (!Number.isInteger(day) || day < 1 || day > 31) return { ok: false, field: 'day', key: 'earlyDiscountDayInvalid' };

  const value = parseDiscountValue(valueText);
  if (value === null) return { ok: false, field: 'value', key: 'earlyDiscountValueInvalid' };

  if (!(amount > 0)) return { ok: false, field: 'value', key: 'earlyDiscountAmountNeeded' };
  if (draft.type === 'PERCENT') {
    if (!(value > 0 && value < 100)) return { ok: false, field: 'value', key: 'earlyDiscountPercentRange' };
  } else {
    if (!(value > 0)) return { ok: false, field: 'value', key: 'earlyDiscountFixedPositive' };
    if (!(value < amount)) return { ok: false, field: 'value', key: 'earlyDiscountFixedTooBig' };
  }
  const full = toCents(amount);
  const after = discountedCents(full, draft.type, value);
  if (!(after > 0 && after < full)) return { ok: false, field: 'value', key: 'earlyDiscountNoEffect' };
  return { ok: true, payload: { earlyDiscountDay: day, earlyDiscountType: draft.type, earlyDiscountValue: value } };
}

/**
 * The fields the form adds to the request. Create: nothing when there is no discount. Update: null in the three clears a
 * discount the recurrence had. An invalid draft sends nothing (the form does not submit before it is fixed).
 */
export function discountFields(result: DraftResult, mode: 'create' | 'update'): Partial<Record<keyof EarlyDiscountPayload, number | EarlyDiscountType | null>> {
  if (!result.ok) return {};
  if (result.payload) return { ...result.payload };
  return mode === 'update' ? { earlyDiscountDay: null, earlyDiscountType: null, earlyDiscountValue: null } : {};
}

/** The form draft of a stored recurrence (blank when it has no discount). */
export function draftFromRecurrence(r: { earlyDiscountDay?: number | null; earlyDiscountType?: string | null; earlyDiscountValue?: number | null }): EarlyDiscountDraft {
  const { earlyDiscountDay: day, earlyDiscountType: type, earlyDiscountValue: value } = r;
  if (day == null || value == null || (type !== 'FIXED' && type !== 'PERCENT')) return emptyDraft();
  return { day: String(day), type, value: String(value).replace('.', ',') };
}

/** The discounted amount and the savings of a valid draft, in cents; null while the draft is blank or invalid. */
export function discountPreview(draft: EarlyDiscountDraft, amount: number): { fullCents: number; discountedCents: number; savingsCents: number } | null {
  const result = validateDraft(draft, amount);
  if (!result.ok || !result.payload) return null;
  const fullCents = toCents(amount);
  const after = discountedCents(fullCents, result.payload.earlyDiscountType, result.payload.earlyDiscountValue);
  return { fullCents, discountedCents: after, savingsCents: fullCents - after };
}

// ---- the notice -----------------------------------------------------------------------------------------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayNumberOf = (day: string): number => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000;

/** Days that count as "the last days": this many before the limit, and the limit day itself. */
export const URGENT_DAYS = 3;

export interface EarlyDiscountNotice {
  limitDate: string;
  savingsCents: number;
  /** 0 on the limit day. */
  daysLeft: number;
  /** The three days before the limit and the limit day. */
  urgent: boolean;
}

/** The notice while the discount can still be had (today <= limit); null otherwise, or without a usable quote. */
export function earlyDiscountNotice(quote: EarlyDiscountQuote | null | undefined, today: string): EarlyDiscountNotice | null {
  if (!quote || !DAY_RE.test(quote.limitDate) || !DAY_RE.test(today)) return null;
  const daysLeft = dayNumberOf(quote.limitDate) - dayNumberOf(today);
  if (daysLeft < 0) return null;
  return { limitDate: quote.limitDate, savingsCents: toCents(quote.savings), daysLeft, urgent: daysLeft <= URGENT_DAYS };
}

export interface NoticeLines {
  /** "Pague até 08/12 e economize R$ 30,00". */
  text: string;
  /** "Faltam 2 dias" / "Último dia com desconto"; only while highlighted. */
  hint: string | null;
  urgent: boolean;
}

export function noticeLines(
  notice: EarlyDiscountNotice,
  formatDay: (day: string) => string,
  formatMoney: (value: number) => string,
  translations: unknown,
): NoticeLines {
  const t = (key: EarlyDiscountTextKey, vars?: Record<string, string | number>) => earlyDiscountText(translations, key, vars);
  let hint: string | null = null;
  if (notice.urgent) {
    hint = notice.daysLeft === 0 ? t('earlyDiscountLastDay') : notice.daysLeft === 1 ? t('earlyDiscountDaysLeftOne') : t('earlyDiscountDaysLeftMany', { days: notice.daysLeft });
  }
  return {
    text: t('earlyDiscountNotice', { date: formatDay(notice.limitDate), amount: formatMoney(notice.savingsCents / 100) }),
    hint,
    urgent: notice.urgent,
  };
}

// ---- paying now -----------------------------------------------------------------------------------------

/** The "Pagar agora" button shows only when the API says this occurrence can be paid now (never inferred). */
export function canPayNow(discount: Partial<CashFlowEarlyDiscount> | null | undefined): boolean {
  return !!discount && discount.canPayNow === true;
}

export type PayNextErrorKey = 'earlyPayConflict' | 'earlyPayInactive' | 'earlyPayError';

/** 409: already paid or moved on; 400: inactive or ended; anything else the generic message. */
export function payNextErrorKey(status: number | undefined): PayNextErrorKey {
  if (status === 409) return 'earlyPayConflict';
  if (status === 400) return 'earlyPayInactive';
  return 'earlyPayError';
}

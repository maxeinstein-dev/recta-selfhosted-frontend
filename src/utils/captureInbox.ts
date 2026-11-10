/**
 * Pure logic of the captures inbox (web app): what a draft needs before it becomes a transaction, the body of
 * POST /captures/:id/confirm, the labels of the apps and kinds, and the local day of a capture. No React and no imports,
 * so tools/fe-tests/t27_captures_inbox.mts runs it under tsx (CAPTURE_INBOX_MODULE points it at a mutated copy).
 *
 * The backend (captures.schema.ts, confirmCaptureSchema) takes a strict body: only type, accountId, categoryName, amount,
 * description, date, notes, paid and competenceMonth. Anything else is a 400, so the body is built here from scratch.
 */

/** The apps the phone reads. The package names are the ones confirmed on the device (android/ capture plugin). */
export const CAPTURE_APPS = [
  { package: 'com.nu.production', label: 'Nubank' },
  { package: 'com.mercadopago.wallet', label: 'Mercado Pago' },
] as const;

/** The kinds of account rules (captures.schema.ts CAPTURE_KINDS). */
export const CAPTURE_KINDS = ['CARD_PURCHASE', 'PIX_OUT', 'PIX_IN', 'REFUND', 'SAVINGS_MOVE'] as const;

export type CaptureKind = (typeof CAPTURE_KINDS)[number];
export type CaptureStatus = 'PENDING' | 'CONFIRMED' | 'DISMISSED' | 'IGNORED';
export type CaptureTxType = 'INCOME' | 'EXPENSE';

/** What the server pre-fills (buildSuggestion). Only `date` is certain until a parser exists. */
export interface CaptureSuggestion {
  type: CaptureTxType | null;
  accountId: string | null;
  categoryName: string | null;
  amount: number | null;
  description: string | null;
  /** ISO 8601 instant the notification was posted. */
  date: string;
}

/** One row of GET /captures (and of the transition answers, without the suggestion). */
export interface CaptureItem {
  id: string;
  package: string;
  title: string | null;
  text: string;
  postedAt: string;
  status: CaptureStatus;
  parsed: unknown;
  transactionId: string | null;
  suggestion: CaptureSuggestion;
}

/** The form state of a capture. `amount` is null while empty; `date` is YYYY-MM-DD in the device's zone. */
export interface CaptureDraft {
  type: CaptureTxType | null;
  accountId: string;
  categoryName: string;
  amount: number | null;
  description: string;
  date: string;
}

/** The fields the server needs and the form can leave empty. Used to say what is missing. */
export type CaptureDraftField = 'type' | 'accountId' | 'categoryName' | 'amount' | 'date';

/** Exactly the keys POST /captures/:id/confirm accepts (plus nothing else). */
export interface ConfirmBody {
  type: CaptureTxType;
  accountId: string;
  categoryName: string;
  amount: number;
  description?: string;
  date: string;
  paid: true;
}

export type ConfirmBodyResult = { ok: true; body: ConfirmBody } | { ok: false; missing: CaptureDraftField[] };

/** The description the transaction takes (the backend limit). */
export const DESCRIPTION_MAX = 255;

const pad = (n: number): string => String(n).padStart(2, '0');

/** Local calendar day (YYYY-MM-DD) of an ISO instant, in the device's zone; null when the text is not a date. */
export function localDayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The local Date at midnight of a YYYY-MM-DD key; null when the key is not a real calendar day. */
export function dateFromDayKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/** "dd/MM/yyyy HH:mm" in the device's zone; '' when the text is not a date. */
export function formatCaptureDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The app's name for the card ("Nubank"); an unknown package shows as it is. */
export function appLabel(pkg: string): string {
  return CAPTURE_APPS.find((app) => app.package === pkg)?.label ?? pkg;
}

/** The form state a suggestion opens with. `todayKey` is used only when the capture's date does not parse. */
export function draftFromSuggestion(suggestion: CaptureSuggestion, todayKey: string): CaptureDraft {
  return {
    type: suggestion.type,
    accountId: suggestion.accountId ?? '',
    categoryName: suggestion.categoryName ?? '',
    amount: suggestion.amount,
    description: suggestion.description ?? '',
    date: localDayKey(suggestion.date) ?? todayKey,
  };
}

/**
 * The body of POST /captures/:id/confirm for a draft, or the fields still missing. The amount must be positive after
 * rounding to cents (the transaction precision). The description is left out when blank.
 */
export function buildConfirmBody(draft: CaptureDraft): ConfirmBodyResult {
  const missing: CaptureDraftField[] = [];
  if (draft.type !== 'INCOME' && draft.type !== 'EXPENSE') missing.push('type');
  if (!draft.accountId) missing.push('accountId');
  if (!draft.categoryName) missing.push('categoryName');
  const cents = typeof draft.amount === 'number' && Number.isFinite(draft.amount) ? Math.round(draft.amount * 100) : 0;
  if (cents <= 0) missing.push('amount');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) missing.push('date');
  if (missing.length > 0 || (draft.type !== 'INCOME' && draft.type !== 'EXPENSE')) return { ok: false, missing };

  const body: ConfirmBody = {
    type: draft.type,
    accountId: draft.accountId,
    categoryName: draft.categoryName,
    amount: cents / 100,
    date: draft.date,
    paid: true,
  };
  const description = draft.description.trim();
  if (description) body.description = description.slice(0, DESCRIPTION_MAX);
  return { ok: true, body };
}

/**
 * A suggestion is complete when one tap can confirm it: type, account, category and a positive amount are all there
 * and the date parses. The description is optional.
 */
export function isSuggestionComplete(suggestion: CaptureSuggestion): boolean {
  return buildConfirmBody(draftFromSuggestion(suggestion, '')).ok;
}

/** The accounts a transaction can take: active, and not an investment (the same rule as the transaction form). */
export function captureAccountOptions(
  accounts: ReadonlyArray<{ id: string; name: string; type: string; isActive?: boolean }>,
): Array<{ value: string; label: string }> {
  return accounts
    .filter((account) => account.isActive !== false && account.type !== 'INVESTMENT')
    .map((account) => ({ value: account.id, label: account.name }));
}

/** Badge text for a count: "99+" above 99, empty for zero (no badge). */
export function captureBadgeText(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

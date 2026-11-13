/**
 * Pure logic of what the notification reader understood (P01, lote D1c): the reading shown on a capture, the one-tap
 * confirm body, the reparse summary and the card-ending rules. No React, so tools/fe-tests/t49_capture_reading.mts runs
 * it under tsx (CAPTURE_READING_MODULE points it at a mutated copy).
 *
 * Money: the suggestion's `amount` is already in reais (the server derives it from the integer cents). The screen shows
 * it as it came and never computes it again from `parsed.amountCents`.
 */
import { buildConfirmBody, draftFromSuggestion, type CaptureItem, type CaptureSuggestion, type ConfirmBodyResult } from './captureInbox';

/** The only warning the server sends today (buildSuggestion). */
export const CAPTURE_WARNINGS = ['POSSIBLE_OWN_TRANSFER'] as const;
export type CaptureWarning = (typeof CAPTURE_WARNINGS)[number];

const WARNING_TEXT: Record<CaptureWarning, string> = {
  POSSIBLE_OWN_TRANSFER: 'Pode ser transferência entre suas contas',
};

/** How the money moved, as the reader names it (parsed.method). */
export const METHOD_TEXT: Record<string, string> = {
  CREDIT: 'Crédito',
  NUPAY: 'NuPay',
  PIX: 'Pix',
  TRANSFER: 'Transferência',
};

/** The suggestion as GET /captures sends it since backend#52 (older answers have no cardLast4/warning). */
export type ReadSuggestion = CaptureSuggestion & { cardLast4?: string | null; warning?: string | null };

export interface CaptureReading {
  /** Reais, exactly the suggestion's amount. */
  amount: number | null;
  type: 'INCOME' | 'EXPENSE' | null;
  /** Where the money went, only as the reader read it (never the suggested description). */
  merchant: string | null;
  /** What names the capture in a list: the merchant, else the suggested description. */
  title: string | null;
  accountId: string | null;
  cardLast4: string | null;
  method: string | null;
  installments: number | null;
  warning: CaptureWarning | null;
  /** A notice or promotion with no transaction (reader kind IGNORE): the server dismisses it by itself. */
  notice: boolean;
}

const field = (parsed: unknown, key: string): unknown =>
  parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>)[key] : undefined;

const nonEmpty = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const CARD_LAST4 = /^\d{4}$/;

/** What the screen shows of a capture's reading. Fields of the wrong shape are dropped, never guessed. */
export function readingOf(item: Pick<CaptureItem, 'parsed'> & { suggestion: ReadSuggestion }): CaptureReading {
  const s = item.suggestion;
  const installments = field(item.parsed, 'installments');
  const last4 = s.cardLast4;
  return {
    amount: typeof s.amount === 'number' && Number.isFinite(s.amount) ? s.amount : null,
    type: s.type === 'INCOME' || s.type === 'EXPENSE' ? s.type : null,
    merchant: nonEmpty(field(item.parsed, 'merchant')),
    title: nonEmpty(field(item.parsed, 'merchant')) ?? nonEmpty(s.description),
    accountId: s.accountId ?? null,
    cardLast4: typeof last4 === 'string' && CARD_LAST4.test(last4) ? last4 : null,
    method: nonEmpty(field(item.parsed, 'method')),
    installments: typeof installments === 'number' && Number.isInteger(installments) && installments > 0 ? installments : null,
    notice: field(item.parsed, 'kind') === 'IGNORE',
    warning: (CAPTURE_WARNINGS as readonly string[]).includes(s.warning ?? '') ? (s.warning as CaptureWarning) : null,
  };
}

/** The text of a warning, or null when there is none. */
export function warningText(warning: CaptureWarning | null | undefined): string | null {
  return warning ? WARNING_TEXT[warning] ?? null : null;
}

/** The category a one-tap confirm takes when the server suggests none (it never does today). */
export function fallbackCategory(type: 'INCOME' | 'EXPENSE'): string {
  return type === 'INCOME' ? 'OTHER_INCOME' : 'OTHER_EXPENSES';
}

/**
 * The body of a one-tap confirm: value, type and account must be there; the category is the suggested one or "Outras
 * despesas/receitas"; the day is the capture's local day. Otherwise the fields still missing (the form opens).
 */
export function oneTapConfirmBody(suggestion: CaptureSuggestion, todayKey: string): ConfirmBodyResult {
  const draft = draftFromSuggestion(suggestion, todayKey);
  if ((draft.type === 'INCOME' || draft.type === 'EXPENSE') && !draft.categoryName) {
    draft.categoryName = fallbackCategory(draft.type);
  }
  return buildConfirmBody(draft);
}

/** True when one tap can confirm the capture. */
export function canConfirmInOneTap(suggestion: CaptureSuggestion): boolean {
  return oneTapConfirmBody(suggestion, '0000-01-01').ok;
}

export interface ReparseResult {
  scanned: number;
  updated: number;
  understood: number;
  dismissed: number;
  notUnderstood: number;
  parserVersion: number;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The toast after POST /captures/reparse. */
export function reparseSummary(r: ReparseResult): string {
  if (!r.scanned) return `Nada para reprocessar: tudo já foi lido pela versão ${r.parserVersion} do leitor.`;
  const parts = [
    plural(r.understood, 'entendida', 'entendidas'),
    plural(r.dismissed, 'aviso descartado', 'avisos descartados'),
    plural(r.notUnderstood, 'não entendida', 'não entendidas'),
  ];
  return `${r.updated} de ${r.scanned} capturas lidas de novo: ${parts.join(', ')}.`;
}

export interface CardRule {
  package: string;
  cardLast4: string;
  accountId: string;
}

/** The PUT takes at most this many rules. */
export const MAX_CARD_RULES = 100;

/** The rows the screen edits, from the server's rules (only the keys the PUT takes). */
export function cardRulesDraft(rules: ReadonlyArray<CardRule>): CardRule[] {
  return rules.map((rule) => ({ package: rule.package, cardLast4: rule.cardLast4, accountId: rule.accountId }));
}

const clean = (rule: CardRule): CardRule => ({
  package: rule.package.trim(),
  cardLast4: rule.cardLast4.trim(),
  accountId: rule.accountId.trim(),
});

export type CardRuleError = 'digits' | 'account' | 'duplicate' | 'tooMany';

/** The first problem of each row, in row order. An empty list means the PUT can go. */
export function cardRulesErrors(rows: ReadonlyArray<CardRule>): Array<{ index: number; error: CardRuleError }> {
  const errors: Array<{ index: number; error: CardRuleError }> = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const rule = clean(row);
    if (!CARD_LAST4.test(rule.cardLast4)) errors.push({ index, error: 'digits' });
    else if (!rule.accountId) errors.push({ index, error: 'account' });
    else if (seen.has(`${rule.package}|${rule.cardLast4}`)) errors.push({ index, error: 'duplicate' });
    else if (index >= MAX_CARD_RULES) errors.push({ index, error: 'tooMany' });
    seen.add(`${rule.package}|${rule.cardLast4}`);
  });
  return errors;
}

/** The body of PUT /captures/card-rules (it replaces every rule): trimmed, sorted by app then ending. */
export function buildCardRulesBody(rows: ReadonlyArray<CardRule>): { rules: CardRule[] } {
  const rules = rows.map(clean).sort((a, b) => a.package.localeCompare(b.package) || a.cardLast4.localeCompare(b.cardLast4));
  return { rules };
}

/** True when saving the rows would change what the server has. */
export function isCardRulesChanged(rows: ReadonlyArray<CardRule>, server: ReadonlyArray<CardRule>): boolean {
  return JSON.stringify(buildCardRulesBody(rows)) !== JSON.stringify(buildCardRulesBody(cardRulesDraft(server)));
}

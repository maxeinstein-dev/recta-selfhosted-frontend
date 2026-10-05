/**
 * Pure logic of phase 4 (people and shared expenses): money and number parsing in integer cents, the split strategies
 * mirrored for the live preview of the "Dividir" dialog, validation messages, balances, settlements and the person
 * form. Like cardOfx.ts: no React, no axios and no `import.meta`, so it also runs under `tsx`. Types come from the hook
 * module through type-only imports (erased at runtime). The organize wizard has its own module: organizeShares.ts.
 *
 * Every amount here is an integer number of cents; reais (the wire format) appear only at the edges
 * (`centsToReais`, `reaisToCents`).
 */
import { normalizeLabel } from './maxfinPayload';
import type {
  CreateSettlementInput, LedgerEntry, Person, PersonBalance, PutSharesInput, SettlementDirection, ShareDirection,
  SharesPreviewResponse, SplitStrategy, TransactionShare,
} from '../hooks/api/usePeople';

// ---- Money and number inputs ------------------------------------------------------------------------------

const MAX_INT_DIGITS = 9;

/** Reais (2 decimals, as sent by the server) to integer cents. */
export function reaisToCents(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100 + (value < 0 ? -1e-6 : 1e-6)) : 0;
}

/** Integer cents to the number sent on the wire (exact: the division is correctly rounded). */
export function centsToReais(cents: number): number {
  return cents / 100;
}

/**
 * What the user typed in a money field, in cents. Accepts "12", "12,5", "12.50", "1.234,56", "R$ 1.234,56" and a
 * dot-thousands integer ("1.234" is 1234). Null when empty or not an amount (negative, letters, 3 decimals).
 */
export function parseMoneyToCents(text: string): number | null {
  let value = text.replace(/R\$/gi, '').replace(/\s+/g, '');
  if (!value) return null;
  if (value.includes(',')) {
    if (value.indexOf(',') !== value.lastIndexOf(',')) return null;
    value = value.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(value)) {
    value = value.replace(/\./g, '');
  }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match || match[1].length > MAX_INT_DIGITS) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
}

/** Cents as a money field value ("12,50"), without the thousands separator so it stays easy to edit. */
export function formatCentsInput(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** Percent typed by the user, as hundredths of a percent (0.01 to 100.00 -> 1 to 10000); null when invalid. */
export function parsePercentToHundredths(text: string): number | null {
  const value = text.replace(/%/g, '').replace(/\s+/g, '').replace(',', '.');
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const hundredths = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return hundredths >= 1 && hundredths <= 10000 ? hundredths : null;
}

/** Hundredths of a percent as a field value ("33,33"; "50" when whole). */
export function formatHundredthsInput(hundredths: number): string {
  const whole = Math.floor(hundredths / 100);
  const frac = hundredths % 100;
  return frac === 0 ? String(whole) : `${whole},${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/** Shares are whole numbers >= 1 (the server rule for the shares strategy). */
export function parseSharesText(text: string): number | null {
  const value = text.trim();
  if (!/^\d{1,6}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 ? n : null;
}

// ---- Split strategies (mirror of the server rule, for the live preview) ----------------------------------

export const STRATEGY_LABEL: Record<SplitStrategy, string> = {
  equal: 'Igual (eu + as pessoas)',
  exact: 'Valores exatos',
  percent: 'Percentual do total',
  shares: 'Por cotas',
};

export const DIRECTION_LABEL: Record<ShareDirection, string> = {
  THEY_OWE_ME: 'Paguei e elas me devem',
  I_OWE_THEM: 'Eu devo a elas',
};

export const SHARE_MESSAGES = {
  noPerson: 'Escolha a pessoa.',
  duplicate: 'Esta pessoa já aparece nesta divisão.',
  amount: 'Informe um valor maior que zero.',
  percent: 'Informe um percentual entre 0,01 e 100.',
  shares: 'Informe as cotas (número inteiro maior que zero).',
  myShares: 'As suas cotas devem ser um número inteiro maior que zero.',
  percentOver: 'Os percentuais somam mais de 100%.',
  zeroPart: 'A parte ficou zerada: o valor é baixo demais para esta divisão.',
  noRows: 'Adicione ao menos uma pessoa.',
  noTotal: 'A transação não tem valor para dividir.',
} as const;

export interface ShareDraftRow {
  /** Stable React key; never sent. */
  key: string;
  personId: string;
  amountText: string;
  percentText: string;
  sharesText: string;
  note: string;
}

export interface ShareDraft {
  direction: ShareDirection;
  strategy: SplitStrategy;
  /** Shares of my own part (strategy shares). */
  myShares: string;
  rows: ShareDraftRow[];
}

export function emptyRow(key: string): ShareDraftRow {
  return { key, personId: '', amountText: '', percentText: '', sharesText: '1', note: '' };
}

export function emptyDraft(direction: ShareDirection = 'THEY_OWE_ME', strategy: SplitStrategy = 'equal'): ShareDraft {
  return { direction, strategy, myShares: '1', rows: [emptyRow('r1')] };
}

/** The stored shares of one direction as an editable draft (exact values, one row per share). */
export function draftFromShares(shares: readonly TransactionShare[], direction: ShareDirection): ShareDraft {
  const own = shares.filter((s) => s.direction === direction);
  if (own.length === 0) return emptyDraft(direction, 'equal');
  return {
    direction,
    strategy: 'exact',
    myShares: '1',
    rows: own.map((s, index) => ({
      key: `s${index + 1}`,
      personId: s.personId,
      amountText: formatCentsInput(reaisToCents(s.amount)),
      percentText: '',
      sharesText: '1',
      note: s.note ?? '',
    })),
  };
}

/** The direction the dialog opens on: THEY_OWE_ME unless the only stored shares are I_OWE_THEM. */
export function initialDirection(shares: readonly TransactionShare[]): ShareDirection {
  const hasMine = shares.some((s) => s.direction === 'THEY_OWE_ME');
  const hasTheirs = shares.some((s) => s.direction === 'I_OWE_THEM');
  return !hasMine && hasTheirs ? 'I_OWE_THEM' : 'THEY_OWE_ME';
}

export interface SharePartPreview {
  key: string;
  personId: string;
  /** Null while the row is incomplete or invalid. */
  cents: number | null;
  error: string | null;
}

export interface SharePreview {
  parts: SharePartPreview[];
  totalCents: number;
  /** Sum of the parts of the people. */
  sumCents: number;
  /** The total minus the parts: "sua parte" when they owe me. */
  restCents: number;
  /** No row at all: saving it clears the direction. */
  isEmpty: boolean;
  /** Every row is fine and the parts fit in the total. */
  valid: boolean;
  formError: string | null;
}

/** Part of `total` for `numerator / denominator`, rounded down, in exact integer arithmetic. */
function floorShare(total: number, numerator: number, denominator: number): number {
  return Math.floor((total * numerator) / denominator);
}

/**
 * The parts of each person, by strategy, in cents. Rows are valid when complete; the caller checks that. The
 * remainder cents go to the FIRST person of the list (the Stratega rule): the others and I keep the rounded-down
 * part. `exact` parts are the typed amounts.
 */
export function splitCents(totalCents: number, strategy: SplitStrategy, rows: ReadonlyArray<{ amount?: number; hundredths?: number; shares?: number }>, myShares = 1): number[] {
  const n = rows.length;
  if (n === 0) return [];
  if (strategy === 'exact') return rows.map((r) => r.amount ?? 0);
  if (strategy === 'equal') {
    const base = Math.floor(totalCents / (n + 1));
    const remainder = totalCents - base * (n + 1);
    return rows.map((_, index) => base + (index === 0 ? remainder : 0));
  }
  if (strategy === 'shares') {
    const denominator = myShares + rows.reduce((sum, r) => sum + (r.shares ?? 0), 0);
    const parts = rows.map((r) => floorShare(totalCents, r.shares ?? 0, denominator));
    const mine = floorShare(totalCents, myShares, denominator);
    parts[0] += totalCents - mine - parts.reduce((sum, p) => sum + p, 0);
    return parts;
  }
  // percent: of the total; the remainder only exists when the percentages cover the whole transaction
  const parts = rows.map((r) => floorShare(totalCents, r.hundredths ?? 0, 10000));
  const covered = rows.reduce((sum, r) => sum + (r.hundredths ?? 0), 0) === 10000;
  if (covered) parts[0] += totalCents - parts.reduce((sum, p) => sum + p, 0);
  return parts;
}

/** The live preview of a draft: per-row errors, the parts, the sum and what is left for me. */
export function computeSharePreview(totalCents: number, draft: ShareDraft): SharePreview {
  const rows = draft.rows;
  const errors = new Map<string, string>();
  const seen = new Set<string>();
  const parsed = rows.map((row) => {
    let error: string | null = null;
    if (!row.personId) error = SHARE_MESSAGES.noPerson;
    else if (seen.has(row.personId)) error = SHARE_MESSAGES.duplicate;
    seen.add(row.personId);
    let amount: number | undefined;
    let hundredths: number | undefined;
    let shares: number | undefined;
    if (draft.strategy === 'exact') {
      const cents = parseMoneyToCents(row.amountText);
      if (cents === null || cents <= 0) error = error ?? SHARE_MESSAGES.amount;
      else amount = cents;
    } else if (draft.strategy === 'percent') {
      const value = parsePercentToHundredths(row.percentText);
      if (value === null) error = error ?? SHARE_MESSAGES.percent;
      else hundredths = value;
    } else if (draft.strategy === 'shares') {
      const value = parseSharesText(row.sharesText);
      if (value === null) error = error ?? SHARE_MESSAGES.shares;
      else shares = value;
    }
    if (error) errors.set(row.key, error);
    return { amount, hundredths, shares };
  });

  let formError: string | null = null;
  const myShares = parseSharesText(draft.myShares);
  if (draft.strategy === 'shares' && myShares === null) formError = SHARE_MESSAGES.myShares;
  if (draft.strategy === 'percent' && errors.size === 0) {
    const total = parsed.reduce((sum, r) => sum + (r.hundredths ?? 0), 0);
    if (total > 10000) formError = SHARE_MESSAGES.percentOver;
  }
  if (rows.length > 0 && totalCents <= 0) formError = formError ?? SHARE_MESSAGES.noTotal;

  const computable = errors.size === 0 && formError === null && rows.length > 0;
  const cents = computable ? splitCents(totalCents, draft.strategy, parsed, myShares ?? 1) : null;
  if (cents) {
    rows.forEach((row, index) => {
      if (cents[index] <= 0) errors.set(row.key, SHARE_MESSAGES.zeroPart);
    });
  }
  const sumCents = cents ? cents.reduce((sum, c) => sum + c, 0) : 0;
  if (cents && errors.size === 0 && sumCents > totalCents) {
    formError = `As partes somam ${moneyText(sumCents)}, mais que o valor da transação (${moneyText(totalCents)}).`;
  }

  return {
    parts: rows.map((row, index) => ({
      key: row.key,
      personId: row.personId,
      cents: cents && !errors.has(row.key) ? cents[index] : null,
      error: errors.get(row.key) ?? null,
    })),
    totalCents,
    sumCents,
    restCents: totalCents - sumCents,
    isEmpty: rows.length === 0,
    valid: errors.size === 0 && formError === null,
    formError,
  };
}

/** Plain "R$ 1.234,56" without Intl (the dialogs format with the currency context; messages here must be stable). */
export function moneyText(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const int = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}R$ ${int},${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Switching the strategy keeps what the user already has: the computed parts become the exact amounts or the
 * percentages of the new strategy when the current draft is valid; otherwise the draft only changes strategy.
 */
export function convertDraftStrategy(draft: ShareDraft, strategy: SplitStrategy, totalCents: number): ShareDraft {
  if (draft.strategy === strategy) return draft;
  const preview = computeSharePreview(totalCents, draft);
  const usable = preview.valid && !preview.isEmpty && totalCents > 0;
  const rows = draft.rows.map((row, index) => {
    const part = usable ? preview.parts[index].cents : null;
    if (part === null) return row;
    if (strategy === 'exact') return { ...row, amountText: formatCentsInput(part) };
    if (strategy === 'percent') return { ...row, percentText: formatHundredthsInput(Math.round((part * 10000) / totalCents)) };
    return row;
  });
  return { ...draft, strategy, rows };
}

/** The PUT body of a valid draft; null when the draft is invalid or empty (an empty one clears: see clearSharesInput). */
export function buildPutSharesInput(totalCents: number, draft: ShareDraft): PutSharesInput | null {
  const preview = computeSharePreview(totalCents, draft);
  if (!preview.valid || preview.isEmpty) return null;
  const entries = draft.rows.map((row) => {
    const entry: PutSharesInput['entries'][number] = { personId: row.personId };
    if (draft.strategy === 'exact') entry.amount = centsToReais(parseMoneyToCents(row.amountText) ?? 0);
    if (draft.strategy === 'percent') entry.percent = (parsePercentToHundredths(row.percentText) ?? 0) / 100;
    if (draft.strategy === 'shares') entry.shares = parseSharesText(row.sharesText) ?? 0;
    const note = row.note.trim();
    if (note) entry.note = note;
    return entry;
  });
  const input: PutSharesInput = { direction: draft.direction, strategy: draft.strategy, entries };
  if (draft.strategy === 'shares') input.myShares = parseSharesText(draft.myShares) ?? 1;
  return input;
}

/** Removes every share of one direction. */
export function clearSharesInput(direction: ShareDirection): PutSharesInput {
  return { direction, strategy: 'exact', entries: [] };
}

export interface SharesDifference {
  personId: string;
  localCents: number | null;
  serverCents: number | null;
}

/** What differs between the local preview and the server one (empty = the same division). */
export function compareWithServer(preview: SharePreview, server: SharesPreviewResponse): { differences: SharesDifference[]; restDiffers: boolean } {
  const local = new Map(preview.parts.map((p) => [p.personId, p.cents]));
  const remote = new Map(server.shares.map((s) => [s.personId, reaisToCents(s.amount)]));
  const differences: SharesDifference[] = [];
  for (const personId of new Set([...local.keys(), ...remote.keys()])) {
    const l = local.get(personId) ?? null;
    const r = remote.get(personId) ?? null;
    if (l !== r) differences.push({ personId, localCents: l, serverCents: r });
  }
  return { differences, restDiffers: reaisToCents(server.myPart) !== preview.restCents };
}

/** Adopts the amounts the server computed as exact values (when its rule differs from the local preview). */
export function draftFromServerPreview(draft: ShareDraft, server: SharesPreviewResponse): ShareDraft {
  const amounts = new Map(server.shares.map((s) => [s.personId, reaisToCents(s.amount)]));
  return {
    ...draft,
    strategy: 'exact',
    rows: draft.rows.map((row) => {
      const cents = amounts.get(row.personId);
      return cents === undefined ? row : { ...row, amountText: formatCentsInput(cents) };
    }),
  };
}

/** "Sua parte" when they owe me; the whole amount I owe when it is the other direction. */
export function restLabel(direction: ShareDirection): string {
  return direction === 'THEY_OWE_ME' ? 'Sua parte' : 'Sobra da transação';
}

// ---- Balances -----------------------------------------------------------------------------------------------

export type BalanceKind = 'owes-me' | 'i-owe' | 'settled';

export interface BalanceStatus {
  kind: BalanceKind;
  /** "ela te deve" / "você deve" / "quite" */
  label: string;
  cents: number;
}

export function balanceStatus(balance: number): BalanceStatus {
  const cents = reaisToCents(balance);
  if (cents > 0) return { kind: 'owes-me', label: 'ela te deve', cents };
  if (cents < 0) return { kind: 'i-owe', label: 'você deve', cents: -cents };
  return { kind: 'settled', label: 'quite', cents: 0 };
}

/** "Maria te deve R$ 10,00" / "Você deve R$ 10,00 a Maria" / "Quite com Maria". */
export function balanceSentence(name: string, balance: number): string {
  const status = balanceStatus(balance);
  if (status.kind === 'owes-me') return `${name} te deve ${moneyText(status.cents)}`;
  if (status.kind === 'i-owe') return `Você deve ${moneyText(status.cents)} a ${name}`;
  return `Quite com ${name}`;
}

export interface BalancesSummary {
  /** Sum of the positive balances. */
  owedToMeCents: number;
  /** Sum of the negative balances, as a positive number. */
  iOweCents: number;
  /** owedToMe - iOwe. */
  netCents: number;
}

export function summarizeBalances(items: ReadonlyArray<Pick<PersonBalance, 'balance'>>): BalancesSummary {
  let owedToMeCents = 0;
  let iOweCents = 0;
  for (const item of items) {
    const cents = reaisToCents(item.balance);
    if (cents > 0) owedToMeCents += cents;
    else iOweCents += -cents;
  }
  return { owedToMeCents, iOweCents, netCents: owedToMeCents - iOweCents };
}

export interface PersonRow {
  person: Person;
  balance: PersonBalance | null;
  balanceCents: number;
}

/**
 * The rows of the people list: every person that has a balance entry, plus (when inactive people are shown) the
 * ones the balances endpoint leaves out. Active people first, then by name; inactive ones last.
 */
export function mergePeopleRows(balances: readonly PersonBalance[], people: readonly Person[], showInactive: boolean): PersonRow[] {
  const rows = new Map<string, PersonRow>();
  for (const b of balances) rows.set(b.person.id, { person: b.person, balance: b, balanceCents: reaisToCents(b.balance) });
  for (const p of people) {
    if (rows.has(p.id)) continue;
    if (!p.isActive && !showInactive) continue;
    rows.set(p.id, { person: p, balance: null, balanceCents: 0 });
  }
  return [...rows.values()]
    .filter((row) => row.person.isActive || showInactive || row.balanceCents !== 0)
    .sort((a, b) => Number(b.person.isActive) - Number(a.person.isActive) || a.person.name.localeCompare(b.person.name, 'pt-BR'));
}

// ---- Ledger ---------------------------------------------------------------------------------------------------

export function ledgerKindLabel(entry: Pick<LedgerEntry, 'kind' | 'direction'>): string {
  if (entry.kind === 'share') return entry.direction === 'THEY_OWE_ME' ? 'Parte dela' : 'Sua parte';
  return entry.direction === 'RECEIVED' ? 'Ela te pagou' : 'Você pagou a ela';
}

/** "+R$ 10,00" / "-R$ 10,00" for the signed value of a ledger entry (positive = she owes me more). */
export function signedMoneyText(cents: number): string {
  return `${cents > 0 ? '+' : cents < 0 ? '-' : ''}${moneyText(Math.abs(cents))}`;
}

// ---- Settlements ----------------------------------------------------------------------------------------------

export const SETTLEMENT_DIRECTION_LABEL: Record<SettlementDirection, string> = {
  RECEIVED: 'Ela me pagou',
  PAID: 'Eu paguei a ela',
};

/** The transaction type a settlement links to or creates: RECEIVED is an income, PAID an expense. */
export function settlementTransactionType(direction: SettlementDirection): 'INCOME' | 'EXPENSE' {
  return direction === 'RECEIVED' ? 'INCOME' : 'EXPENSE';
}

/** Direction and amount that zero the balance: she owes me (or nothing) -> RECEIVED; I owe her -> PAID. */
export function suggestSettlement(balance: number): { direction: SettlementDirection; amountCents: number } {
  const cents = reaisToCents(balance);
  return cents < 0 ? { direction: 'PAID', amountCents: -cents } : { direction: 'RECEIVED', amountCents: cents };
}

/** The balance (cents; > 0 she owes me) after a settlement: RECEIVED lowers it, PAID raises it. */
export function balanceAfterSettlement(balanceCents: number, direction: SettlementDirection, amountCents: number): number {
  return direction === 'RECEIVED' ? balanceCents - amountCents : balanceCents + amountCents;
}

export type SettlementMode = 'create' | 'link' | 'none';

export interface SettlementDraft {
  direction: SettlementDirection;
  amountText: string;
  /** YYYY-MM-DD */
  date: string;
  note: string;
  mode: SettlementMode;
  accountId: string;
  description: string;
  transactionId: string;
}

export function defaultSettlementDescription(name: string, direction: SettlementDirection): string {
  return direction === 'RECEIVED' ? `Acerto recebido de ${name}` : `Acerto pago a ${name}`;
}

export function defaultSettlementDraft(person: Pick<Person, 'name'>, balance: number, today: string, defaultAccountId: string): SettlementDraft {
  const { direction, amountCents } = suggestSettlement(balance);
  return {
    direction,
    amountText: amountCents > 0 ? formatCentsInput(amountCents) : '',
    date: today,
    note: '',
    mode: defaultAccountId ? 'create' : 'none',
    accountId: defaultAccountId,
    description: defaultSettlementDescription(person.name, direction),
    transactionId: '',
  };
}

export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export interface SettlementValidation {
  ok: boolean;
  amountCents: number | null;
  errors: { amount?: string; date?: string; account?: string; transaction?: string };
}

export function validateSettlement(draft: SettlementDraft): SettlementValidation {
  const errors: SettlementValidation['errors'] = {};
  const amountCents = parseMoneyToCents(draft.amountText);
  if (amountCents === null || amountCents <= 0) errors.amount = 'Informe um valor maior que zero.';
  if (!isValidIsoDate(draft.date)) errors.date = 'Informe uma data válida.';
  if (draft.mode === 'create' && !draft.accountId) errors.account = 'Escolha a conta.';
  if (draft.mode === 'link' && !draft.transactionId) errors.transaction = 'Escolha a transação a vincular.';
  return { ok: Object.keys(errors).length === 0, amountCents: amountCents !== null && amountCents > 0 ? amountCents : null, errors };
}

/** The POST body; only the fields of the chosen mode are sent. Null when the draft is invalid. */
export function buildSettlementInput(draft: SettlementDraft, householdId: string): CreateSettlementInput | null {
  const check = validateSettlement(draft);
  if (!check.ok || check.amountCents === null) return null;
  const input: CreateSettlementInput = {
    householdId,
    direction: draft.direction,
    amount: centsToReais(check.amountCents),
    date: draft.date,
  };
  const note = draft.note.trim();
  if (note) input.note = note;
  if (draft.mode === 'link') input.transactionId = draft.transactionId;
  if (draft.mode === 'create') {
    const description = draft.description.trim();
    input.createTransaction = description ? { accountId: draft.accountId, description } : { accountId: draft.accountId };
  }
  return input;
}

// ---- Remembered account (per household) -----------------------------------------------------------------------

/** The account last used for a settlement in this household; '' when unknown or the stored value is corrupt. */
export function parseSavedSettlementAccount(raw: string | null, householdId: string): string {
  if (!raw) return '';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
    const value = (parsed as Record<string, unknown>)[householdId];
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

/** Storage value with the account of `householdId` set; the other households are kept (a corrupt value is replaced). */
export function mergeSavedSettlementAccount(raw: string | null, householdId: string, accountId: string): string {
  let current: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
  } catch {
    current = {};
  }
  return JSON.stringify({ ...current, [householdId]: accountId });
}

/** Accounts a settlement transaction can be created on: active and not a credit card. */
export function settlementAccounts<T extends { type?: string; isActive?: boolean }>(accounts: readonly T[]): T[] {
  return accounts.filter((a) => a.type !== 'CREDIT' && a.isActive !== false);
}

// ---- Person form ----------------------------------------------------------------------------------------------

/** Aliases typed as a comma or semicolon separated list. */
export function parseAliasText(text: string): string[] {
  return text.split(/[,;]/).map((a) => a.trim()).filter(Boolean);
}

/** Trimmed, without repeats (normalized like the server) and without the name itself. */
export function cleanAliases(name: string, aliases: readonly string[]): string[] {
  const seen = new Set<string>([normalizeLabel(name)]);
  const out: string[] = [];
  for (const raw of aliases) {
    const alias = raw.trim();
    const key = normalizeLabel(alias);
    if (!alias || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

export interface PersonFormValidation {
  ok: boolean;
  name?: string;
  conflict?: string;
}

/**
 * The name must be filled, and neither the name nor an alias may be the name or alias of ANOTHER person (the server
 * answers 409; saying it here saves a round trip). `others` are the people already registered.
 */
export function validatePersonForm(name: string, aliases: readonly string[], others: ReadonlyArray<Pick<Person, 'id' | 'name' | 'aliases'>>, editingId: string | null): PersonFormValidation {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, name: 'Informe o nome.' };
  const mine = [trimmed, ...cleanAliases(trimmed, aliases)];
  for (const other of others) {
    if (other.id === editingId) continue;
    const taken = new Set([normalizeLabel(other.name), ...other.aliases.map(normalizeLabel)]);
    const clash = mine.find((m) => taken.has(normalizeLabel(m)));
    if (clash) return { ok: false, conflict: `"${clash}" já é o nome ou apelido de ${other.name}.` };
  }
  return { ok: true };
}

/** Message for a failed save: the server's 409 says the name or alias is taken. */
export function personSaveFailureMessage(error: unknown): string {
  const status = (error as { status?: number } | null)?.status;
  if (status === 409) return 'Já existe uma pessoa com este nome ou apelido.';
  return error instanceof Error && error.message ? error.message : 'Não foi possível salvar a pessoa.';
}

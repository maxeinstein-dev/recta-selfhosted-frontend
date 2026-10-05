/**
 * Pure logic of the single "Importar" entry point: what a file is (by name and a small sniff of its first bytes),
 * the date used to order card invoices and statements, and whether a selection can go on. Like cardOfx.ts: no
 * React, no axios and no `import.meta`, so it also runs under `tsx`.
 */
import { AccountType } from '../lib/enums';
import { MAXFIN_MAX_FILE_BYTES, MAXFIN_SECTION_ORDER, countLabel, normalizeLabel } from './maxfinPayload';
import { CARD_OFX_MAX_FILE_BYTES } from './cardOfx';
import type { MaxFinAccountsInput } from '../hooks/api/useImportMaxFin';

// ---- Kinds ------------------------------------------------------------------------------------------------

/** What the file is, and so which flow it goes through. */
export type ImportKind = 'card' | 'statement' | 'sheet' | 'workbook';

export const IMPORT_KIND_ORDER: readonly ImportKind[] = ['card', 'statement', 'sheet', 'workbook'];

export const IMPORT_KIND_LABEL: Record<ImportKind, string> = {
  card: 'Fatura do cartão (OFX)',
  statement: 'Extrato (OFX/CSV)',
  sheet: 'Planilha mensal (CSV)',
  workbook: 'Pasta de trabalho (XLSX)',
};

/** Extensions the hub takes (the file picker `accept`). */
export const IMPORT_ACCEPT = '.csv,.ofx,.xlsx';

/** How many bytes of the start of a file are read to sniff it. */
export const SNIFF_BYTES = 64 * 1024;

export type ImportExtension = 'csv' | 'ofx' | 'xlsx';

/** Extension of the file (case-insensitive); null for anything the hub does not take. */
export function importExtension(name: string): ImportExtension | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.ofx')) return 'ofx';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  return null;
}

/** The kinds a file of that extension can be imported as; the first one is what the hub proposes when it cannot tell. */
export function kindsForExtension(ext: ImportExtension | null): ImportKind[] {
  switch (ext) {
    case 'ofx':
      return ['card', 'statement'];
    case 'csv':
      return ['sheet', 'statement'];
    case 'xlsx':
      return ['workbook'];
    default:
      return [];
  }
}

// ---- Sniffing ---------------------------------------------------------------------------------------------

/**
 * Text of the first bytes of a file: UTF-8 when it is valid UTF-8 (a multi-byte character cut by the end of the
 * slice does not count against it), otherwise Windows-1252 (the encoding of old bank exports).
 */
export function decodeSniffBytes(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  try {
    return utf8.decode(bytes.subarray(0, bytes.length - incompleteUtf8Tail(bytes)));
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** How many bytes at the end are the start of a UTF-8 character that the slice cut (0 when the end is whole). */
function incompleteUtf8Tail(bytes: Uint8Array): number {
  for (let back = 1; back <= 3 && back <= bytes.length; back += 1) {
    const byte = bytes[bytes.length - back];
    if (byte < 0x80) return 0;
    if (byte >= 0xc0) {
      const needed = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : 2;
      return needed > back ? back : 0;
    }
  }
  return 0;
}

/** A card statement carries a CCSTMTRS (or CREDITCARDMSGSRSV1) section; a bank statement has STMTRS. */
export function isCardOfxText(text: string): boolean {
  return /CCSTMTRS|CREDITCARDMSGSRSV1/i.test(text);
}

/** RFC 4180 tokenizer for the sniff: quotes, doubled quotes and line breaks inside quotes. At most `maxRows` rows. */
export function parseCsvHead(text: string, delimiter: string, maxRows = 400): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const pushRow = () => {
    row.push(cell);
    cell = '';
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length && rows.length < maxRows; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      pushRow();
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) pushRow();
  return rows;
}

const HEADER_SCAN_ROWS = 40;

/**
 * The monthly sheet: column B of some early row is "Descrição" (the header) and, after it, column B of some row
 * starts with "Total". A bank statement .csv may have a "Descrição" column too, but never the Total rows.
 */
export function isMonthlySheetCsv(text: string): boolean {
  const body = text.replace(/^\uFEFF/, '');
  for (const delimiter of [',', ';']) {
    const rows = parseCsvHead(body, delimiter);
    const header = rows.slice(0, HEADER_SCAN_ROWS).findIndex((cells) => normalizeLabel(cells[1] ?? '') === 'descricao');
    if (header < 0) continue;
    if (rows.slice(header + 1).some((cells) => normalizeLabel(cells[1] ?? '').startsWith('total'))) return true;
  }
  return false;
}

/**
 * What a file is. `head` is the start of the file as text (null when it could not be read); it only decides
 * between card and bank statement for an .ofx and between sheet and statement for a .csv. Null: not a file the hub takes.
 */
export function detectImportKind(name: string, head: string | null): ImportKind | null {
  const ext = importExtension(name);
  if (ext === 'xlsx') return 'workbook';
  if (ext === 'ofx') return head !== null && isCardOfxText(head) ? 'card' : 'statement';
  if (ext === 'csv') return head !== null && isMonthlySheetCsv(head) ? 'sheet' : 'statement';
  return null;
}

// ---- Date used to order the files -------------------------------------------------------------------------

const isoDate = (year: number, month: number, day: number): string | null => {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > last) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

/** DTSTART of the statement header (YYYY-MM-DD), the start of the period; null when there is none. */
export function ofxPeriodStart(text: string): string | null {
  const match = /<DTSTART>\s*(\d{4})(\d{2})(\d{2})/i.exec(text);
  return match ? isoDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

/** A date written in the file name: 2026-09-02, 2026_09_02, 20260902, 02-09-2026 or 2026-09 (day 01). Null when none. */
export function dateFromFileName(name: string): string | null {
  const base = name.replace(/\.[^.]*$/, '');
  const patterns: Array<[RegExp, (m: RegExpExecArray) => string | null]> = [
    [/(?<!\d)(\d{4})[-_.](\d{2})[-_.](\d{2})(?!\d)/, (m) => isoDate(Number(m[1]), Number(m[2]), Number(m[3]))],
    [/(?<!\d)(\d{2})[-_.](\d{2})[-_.](\d{4})(?!\d)/, (m) => isoDate(Number(m[3]), Number(m[2]), Number(m[1]))],
    [/(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/, (m) => isoDate(Number(m[1]), Number(m[2]), Number(m[3]))],
    // A month only: not the beginning of a full date that failed above (2026-02-30 is not "February")
    [/(?<!\d)(\d{4})[-_.](\d{2})(?![-_.]?\d)/, (m) => isoDate(Number(m[1]), Number(m[2]), 1)],
  ];
  for (const [re, build] of patterns) {
    const m = re.exec(base);
    const found = m ? build(m) : null;
    if (found) return found;
  }
  return null;
}

export type PeriodSource = 'ofx' | 'name';

/** Start of the period of the file: the OFX header first, the date in the file name as the fallback. */
export function periodStartOf(name: string, head: string | null): { date: string; source: PeriodSource } | null {
  if (head !== null && importExtension(name) === 'ofx') {
    const fromHeader = ofxPeriodStart(head);
    if (fromHeader) return { date: fromHeader, source: 'ofx' };
  }
  const fromName = dateFromFileName(name);
  return fromName ? { date: fromName, source: 'name' } : null;
}

/** Oldest first; files with no date go last, each group keeping the order of the selection. */
export function orderByPeriod<T extends { periodStart: string | null }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const da = a.item.periodStart;
      const db = b.item.periodStart;
      if (da !== null && db !== null && da !== db) return da < db ? -1 : 1;
      if (da === null && db !== null) return 1;
      if (da !== null && db === null) return -1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

// ---- What the selection needs -----------------------------------------------------------------------------

/** Why this file cannot be imported as `kind`; null when it can. */
export function fileProblem(kind: ImportKind, file: { name: string; size: number }): string | null {
  const ext = importExtension(file.name);
  if (!ext) return 'Formato não suportado. Envie arquivos .csv, .ofx ou .xlsx.';
  if (!kindsForExtension(ext).includes(kind)) return `${IMPORT_KIND_LABEL[kind]} não aceita arquivos .${ext}.`;
  const limit = kind === 'card' ? CARD_OFX_MAX_FILE_BYTES : kind === 'sheet' || kind === 'workbook' ? MAXFIN_MAX_FILE_BYTES : null;
  if (limit !== null && file.size > limit) return `Arquivo acima do limite de ${limit / (1024 * 1024)} MB.`;
  return null;
}

export interface HubEntryLike {
  name: string;
  kind: ImportKind;
  problem: string | null;
}

export type HubSelectionCheck =
  | { ok: true; kind: ImportKind }
  | { ok: false; kind: null; message: string | null };

/**
 * Whether the selection can go on: one kind only (mixed kinds are imported separately), one file for a sheet or a
 * workbook, no file with a problem. `message` is what the user reads; null when there is nothing selected.
 */
export function checkHubSelection(entries: readonly HubEntryLike[]): HubSelectionCheck {
  if (entries.length === 0) return { ok: false, kind: null, message: null };
  const kinds = IMPORT_KIND_ORDER.filter((kind) => entries.some((entry) => entry.kind === kind));
  if (kinds.length > 1) {
    const names = kinds.map((kind) => IMPORT_KIND_LABEL[kind]).join(' e ');
    return {
      ok: false,
      kind: null,
      message: `Os arquivos são de tipos diferentes (${names}). Importe cada tipo separadamente: remova os arquivos que não combinam ou ajuste o Tipo.`,
    };
  }
  const kind = kinds[0];
  const broken = entries.find((entry) => entry.problem);
  if (broken) return { ok: false, kind: null, message: `${broken.name}: ${broken.problem}` };
  if ((kind === 'sheet' || kind === 'workbook') && entries.length > 1) {
    return {
      ok: false,
      kind: null,
      message: `${IMPORT_KIND_LABEL[kind]} é importada um arquivo por vez (${countLabel(entries.length, 'arquivo selecionado', 'arquivos selecionados')}).`,
    };
  }
  return { ok: true, kind };
}

// ---- Destination ------------------------------------------------------------------------------------------

export interface HubAccountRef {
  id: string;
  type: string;
  isActive?: boolean;
}

/** Credit cards that can receive an invoice. */
export const cardAccounts = <T extends HubAccountRef>(accounts: readonly T[]): T[] =>
  accounts.filter((a) => a.type === AccountType.CREDIT && a.isActive !== false);

/** Accounts a bank statement can go to: anything that is not a credit card. */
export const statementAccounts = <T extends HubAccountRef>(accounts: readonly T[]): T[] =>
  accounts.filter((a) => a.type !== AccountType.CREDIT && a.isActive !== false);

/** The account preselected for a kind: the one the hub was opened for when it fits the kind, else the only one there is. */
export function defaultDestination(kind: ImportKind, accounts: readonly HubAccountRef[], preferredId: string | null | undefined): string {
  const fitting = kind === 'card' ? cardAccounts(accounts) : statementAccounts(accounts);
  if (preferredId && fitting.some((a) => a.id === preferredId)) return preferredId;
  return fitting.length === 1 ? fitting[0].id : '';
}

/**
 * The four accounts of a sheet or a workbook: the last choice of the household when it still fits (an existing
 * account of the right kind), otherwise the first credit card for the card block and the first other account for
 * the rest. `current` keeps what the user already chose.
 */
export function defaultSheetAccounts(
  accounts: readonly HubAccountRef[],
  saved: Partial<MaxFinAccountsInput>,
  current: MaxFinAccountsInput,
): MaxFinAccountsInput {
  const usable = accounts.filter((a) => a.isActive !== false);
  const credit = (usable.find((a) => a.type === AccountType.CREDIT) ?? accounts.find((a) => a.type === AccountType.CREDIT))?.id ?? '';
  const other = (usable.find((a) => a.type !== AccountType.CREDIT) ?? accounts.find((a) => a.type !== AccountType.CREDIT))?.id ?? '';
  const pick = (key: keyof MaxFinAccountsInput, fallback: string): string => {
    const id = saved[key];
    const wantsCredit = key === 'credit';
    const fits = !!id && accounts.some((a) => a.id === id && (a.type === AccountType.CREDIT) === wantsCredit);
    return fits && id ? id : fallback;
  };
  const next = { ...current };
  for (const key of MAXFIN_SECTION_ORDER) {
    next[key] = current[key] || pick(key, key === 'credit' ? credit : other);
  }
  return next;
}

export interface HubDestination {
  /** Card account (invoices) or statement account. */
  accountId: string;
  /** The four blocks of a sheet or a workbook. */
  sheetAccounts: MaxFinAccountsInput;
}

/** What is still missing before the hub can hand the files over; null when nothing is. */
export function destinationProblem(kind: ImportKind, destination: HubDestination): string | null {
  if (kind === 'card') return destination.accountId ? null : 'Escolha o cartão de crédito da fatura.';
  if (kind === 'statement') return destination.accountId ? null : 'Escolha a conta de destino do extrato.';
  return MAXFIN_SECTION_ORDER.every((key) => !!destination.sheetAccounts[key]) ? null : 'Escolha uma conta para cada bloco da planilha.';
}

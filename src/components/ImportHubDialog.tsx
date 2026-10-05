import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileUp, Upload, X } from 'lucide-react';
import { useAccounts } from '../hooks/api/useAccounts';
import { useDefaultHousehold } from '../hooks/useDefaultHousehold';
import { MAXFIN_SECTION_LABELS, loadSavedAccountIds } from '../hooks/api/useImportMaxFin';
import type { MaxFinAccountsInput } from '../hooks/api/useImportMaxFin';
import { MAXFIN_SECTION_ORDER, countLabel } from '../utils/maxfinPayload';
import {
  IMPORT_ACCEPT, IMPORT_KIND_LABEL, SNIFF_BYTES, cardAccounts, checkHubSelection, decodeSniffBytes, defaultDestination, defaultSheetAccounts,
  classifyFile, destinationProblem, fileProblem, sniffPlan, importExtension, kindsForExtension, orderByPeriod, periodStartOf, statementAccounts,
} from '../utils/importHub';
import type { ImportKind, PeriodSource } from '../utils/importHub';
import ImportCardOfxDialog from './ImportCardOfxDialog';
import ImportMaxFinDialog from './ImportMaxFinDialog';
import ImportTransactionsDialog from './ImportTransactionsDialog';

// ---------------------------------------------------------------------------
// Styles (mirror the sibling import dialogs)
// ---------------------------------------------------------------------------

const FIELD_CLS =
  'border border-gray-200 dark:border-gray-800 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50';
const INPUT_CLS = `w-full px-3 py-2.5 text-sm ${FIELD_CLS}`;
const SELECT_SM_CLS = `px-2 py-1.5 text-xs ${FIELD_CLS}`;
const LABEL_CLS = 'block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1';
const MUTED_CLS = 'text-gray-600 dark:text-gray-400';
const BTN_BASE = 'inline-flex items-center font-light tracking-tight rounded-md transition-opacity disabled:opacity-50 disabled:cursor-not-allowed';
const BTN_SECONDARY = `${BTN_BASE} px-4 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:opacity-70`;
const BTN_PRIMARY = `${BTN_BASE} px-4 py-2.5 text-sm text-white bg-primary-600 dark:bg-primary-500 border border-primary-600 dark:border-primary-500 hover:opacity-80`;

const PERIOD_SOURCE_TEXT: Record<PeriodSource, string> = { ofx: 'início do período no OFX', name: 'data no nome do arquivo' };

/** YYYY-MM-DD -> dd/mm/yyyy (no Date: no timezone shift). */
const fmtIso = (iso: string): string => iso.split('-').reverse().join('/');

// ---------------------------------------------------------------------------
// Reading the start of a file
// ---------------------------------------------------------------------------

/**
 * The file as text: all of it (an .ofx is a card invoice when CCSTMTRS is anywhere in it) or its first bytes.
 * Null when it cannot be read: the user then has to choose the Tipo, the file is never taken for a statement silently.
 */
async function readFileText(file: File, read: 'full' | 'head'): Promise<string | null> {
  try {
    const slice = read === 'full' ? file.slice(0) : file.slice(0, SNIFF_BYTES);
    const buffer: ArrayBuffer =
      typeof slice.arrayBuffer === 'function'
        ? await slice.arrayBuffer()
        : await new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(slice);
          });
    return decodeSniffBytes(new Uint8Array(buffer));
  } catch {
    return null;
  }
}

interface HubEntry {
  id: string;
  file: File;
  /** What the sniff says the file is; null when the file could not be read. */
  detected: ImportKind | null;
  /** Why the detection is what it is, when that is not obvious (a file too big to be a card invoice). */
  note: string | null;
  /** What the user picked instead, if anything. */
  override: ImportKind | null;
  periodStart: string | null;
  periodSource: PeriodSource | null;
}

const entryKind = (entry: HubEntry): ImportKind | null => entry.override ?? entry.detected;

// The same name, size and modification time is taken for the same file (the content is not hashed: the picker gives
// the same File back, and a different file with all three equal is not a case worth reading every file for).
const fileKey = (file: File): string => `${file.name}|${file.size}|${file.lastModified}`;

/** Where the files go once the user has chosen the destination. */
interface HubRun {
  kind: ImportKind;
  files: File[];
  accountId: string;
  sheetAccounts: MaxFinAccountsInput;
}

const EMPTY_SHEET_ACCOUNTS: MaxFinAccountsInput = { income: '', bills: '', credit: '', debit: '' };

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

interface ImportHubDialogProps {
  open: boolean;
  onClose: () => void;
  /** Defaults to the household from useDefaultHousehold (same as the sibling dialogs). */
  householdId?: string;
  /** Account the hub was opened for (the credit card page): preselected when it fits the kind of the files. */
  defaultAccountId?: string | null;
}

/**
 * The single "Importar" entry point: choose the files, see what each one is (detected from its name and the start
 * of its content, with a "Tipo" select to override), choose where they go, and hand them to the flow of that kind.
 */
const ImportHubDialog = ({ open, onClose, householdId: householdIdProp, defaultAccountId = null }: ImportHubDialogProps) => {
  const { householdId: defaultHouseholdId } = useDefaultHousehold();
  const householdId = householdIdProp ?? defaultHouseholdId;

  const { data: accountsData, isLoading: isLoadingAccounts } = useAccounts({ householdId: householdId ?? '' });
  const accounts = useMemo(() => accountsData?.accounts ?? [], [accountsData]);

  const [entries, setEntries] = useState<HubEntry[]>([]);
  const [reading, setReading] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [sheetAccounts, setSheetAccounts] = useState<MaxFinAccountsInput>(EMPTY_SHEET_ACCOUNTS);
  const [run, setRun] = useState<HubRun | null>(null);
  const nextId = useRef(0);
  const mountedRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset whenever the hub opens.
  useEffect(() => {
    if (!open) return;
    setEntries([]);
    setReading(0);
    setNotice(null);
    setDragging(false);
    setAccountId('');
    setSheetAccounts(EMPTY_SHEET_ACCOUNTS);
    setRun(null);
  }, [open]);

  const rows = useMemo(
    () => entries.map((entry) => ({ entry, kind: entryKind(entry), problem: entryKind(entry) ? fileProblem(entryKind(entry) as ImportKind, entry.file) : null })),
    [entries],
  );
  const check = useMemo(
    () => checkHubSelection(rows.map(({ entry, kind, problem }) => ({ name: entry.file.name, kind, problem }))),
    [rows],
  );
  const kind = check.ok ? check.kind : null;

  // Destination defaults for the kind: the account the hub was opened for, the remembered choices of the household.
  useEffect(() => {
    if (!open || !kind || accounts.length === 0) return;
    if (kind === 'card' || kind === 'statement') {
      setAccountId((prev) => {
        const fitting = kind === 'card' ? cardAccounts(accounts) : statementAccounts(accounts);
        return prev && fitting.some((a) => a.id === prev) ? prev : defaultDestination(kind, accounts, defaultAccountId);
      });
    } else {
      setSheetAccounts((prev) => {
        const next = defaultSheetAccounts(accounts, loadSavedAccountIds(householdId), prev);
        return MAXFIN_SECTION_ORDER.every((key) => next[key] === prev[key]) ? prev : next;
      });
    }
  }, [open, kind, accounts, defaultAccountId, householdId]);

  // Body scroll lock + ESC (same pattern as the sibling dialogs). When a flow took over, it handles both.
  useEffect(() => {
    if (!open || run) return;
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = originalStyle;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open, run, onClose]);

  const addFiles = useCallback(async (picked: File[]) => {
    if (picked.length === 0) return;
    const rejected: string[] = [];
    const accepted: File[] = [];
    for (const file of picked) {
      if (importExtension(file.name)) accepted.push(file);
      else rejected.push(file.name);
    }
    setNotice(rejected.length > 0 ? `Ignorado (formato não suportado, use .csv, .ofx ou .xlsx): ${rejected.join(', ')}.` : null);
    if (accepted.length === 0) return;
    setReading((n) => n + 1);
    try {
      const fresh: HubEntry[] = [];
      for (const file of accepted) {
        const plan = sniffPlan(file.name, file.size);
        const text = plan.read === 'none' ? null : await readFileText(file, plan.read);
        const { kind: detected, note } = classifyFile(file, text);
        const ext = importExtension(file.name);
        const period = ext === 'ofx' || ext === 'csv' ? periodStartOf(file.name, text) : null;
        nextId.current += 1;
        fresh.push({
          id: `hub-${nextId.current}`, file, detected, note, override: null, periodStart: period?.date ?? null, periodSource: period?.source ?? null,
        });
      }
      if (!mountedRef.current) return;
      setEntries((prev) => {
        const known = new Set(prev.map((entry) => fileKey(entry.file)));
        return [...prev, ...fresh.filter((entry) => !known.has(fileKey(entry.file)))];
      });
    } finally {
      if (mountedRef.current) setReading((n) => n - 1);
    }
  }, []);

  if (!open) return null;

  if (run) {
    const common = { open: true, onClose, householdId: householdId ?? undefined };
    if (run.kind === 'card') {
      return run.files.length === 1 ? (
        <ImportCardOfxDialog {...common} accountId={run.accountId} initialFile={run.files[0]} />
      ) : (
        <ImportCardOfxDialog {...common} accountId={run.accountId} files={run.files} />
      );
    }
    if (run.kind === 'statement') {
      return <ImportTransactionsDialog {...common} defaultAccountId={run.accountId} initialFiles={run.files} />;
    }
    return <ImportMaxFinDialog {...common} initialFile={run.files[0]} initialAccountIds={run.sheetAccounts} />;
  }

  // Cards and statements go oldest first; the list shows the order they will be imported in.
  const ordered = kind === 'card' || kind === 'statement' ? orderByPeriod(rows.map((r) => ({ ...r, periodStart: r.entry.periodStart }))) : rows;
  const destProblem = kind ? destinationProblem(kind, { accountId, sheetAccounts }) : null;
  const canContinue = check.ok && !destProblem && reading === 0 && !!householdId;

  const handleContinue = () => {
    if (!check.ok || !canContinue) return;
    setRun({
      kind: check.kind,
      files: ordered.map((row) => row.entry.file),
      accountId,
      sheetAccounts,
    });
  };

  const setOverride = (id: string, value: ImportKind) =>
    setEntries((prev) => prev.map((entry) => (entry.id === id ? { ...entry, override: value === entry.detected ? null : value } : entry)));
  const removeEntry = (id: string) => setEntries((prev) => prev.filter((entry) => entry.id !== id));

  const cards = cardAccounts(accounts);
  const statements = statementAccounts(accounts);

  return createPortal(
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black/40 animate-fade-in transition-opacity duration-300 ease-out" onClick={onClose} aria-hidden="true" />
      <div className="flex min-h-full items-center justify-center p-4">
        <div role="dialog" aria-modal="true" aria-labelledby="import-hub-title"
          className="relative w-full sm:w-[640px] max-w-2xl p-6 border rounded-lg bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800 max-h-[90vh] overflow-y-auto min-w-0 animate-slide-in-bottom">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center min-w-0">
              <Upload className="h-5 w-5 text-gray-500 dark:text-gray-400 mr-3 flex-shrink-0" aria-hidden="true" />
              <h3 id="import-hub-title" className="text-lg font-light tracking-tight text-gray-900 dark:text-white truncate">Importar</h3>
            </div>
            <button type="button" onClick={onClose} aria-label="Fechar modal"
              className="text-gray-400 dark:text-gray-500 hover:opacity-70 transition-opacity p-1">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-4 min-w-0">
            <p className={`text-sm ${MUTED_CLS}`}>
              Envie extratos (.ofx, .csv), faturas de cartão (.ofx), a planilha mensal (.csv) ou a pasta de trabalho (.xlsx). O tipo de cada
              arquivo é reconhecido sozinho; você pode corrigir. Nada é gravado antes da pré-visualização e da confirmação.
            </p>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void addFiles(Array.from(e.dataTransfer?.files ?? []));
              }}
              className={`rounded-md border-2 border-dashed px-4 py-6 text-center text-sm transition-colors ${
                dragging ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-gray-200 dark:border-gray-800'
              }`}
            >
              <FileUp className="mx-auto h-6 w-6 text-gray-400 dark:text-gray-500 mb-2" aria-hidden="true" />
              <p className={MUTED_CLS}>Arraste os arquivos para cá ou</p>
              <label htmlFor="import-hub-file" className={`${BTN_SECONDARY} mt-2 cursor-pointer`}>Escolher arquivos</label>
              <input ref={inputRef} id="import-hub-file" type="file" multiple accept={IMPORT_ACCEPT} className="sr-only"
                aria-label="Arquivos (.csv, .ofx, .xlsx)"
                onChange={(e) => {
                  void addFiles(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }} />
            </div>

            {notice && <p role="note" className="text-sm text-yellow-800 dark:text-yellow-300">{notice}</p>}
            {reading > 0 && <p role="status" className={`text-sm ${MUTED_CLS}`}>Lendo os arquivos…</p>}

            {ordered.length > 0 && (
              <ul aria-label="Arquivos selecionados" className="divide-y divide-gray-200 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded-md">
                {ordered.map(({ entry, kind: rowKind, problem }, index) => {
                  const options = kindsForExtension(importExtension(entry.file.name));
                  return (
                    <li key={entry.id} className="px-3 py-2 space-y-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="text-sm text-gray-900 dark:text-white truncate" title={entry.file.name}>
                          {(kind === 'card' || kind === 'statement') && ordered.length > 1 && <span className={`mr-2 ${MUTED_CLS}`}>{index + 1}.</span>}
                          {entry.file.name}
                        </span>
                        <button type="button" onClick={() => removeEntry(entry.id)} aria-label={`Remover ${entry.file.name}`}
                          className="text-gray-400 dark:text-gray-500 hover:opacity-70 p-1 flex-shrink-0">
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span className={MUTED_CLS}>
                          Detectado: <strong className="font-medium text-gray-900 dark:text-white">{entry.detected ? IMPORT_KIND_LABEL[entry.detected] : 'não foi possível ler o arquivo'}</strong>
                        </span>
                        <label className="inline-flex items-center gap-1">
                          <span className={MUTED_CLS}>Tipo</span>
                          <select value={rowKind ?? ''} aria-label={`Tipo de ${entry.file.name}`} disabled={options.length < 2 && rowKind !== null} className={SELECT_SM_CLS}
                            onChange={(e) => setOverride(entry.id, e.target.value as ImportKind)}>
                            {rowKind === null && <option value="">Escolha o tipo</option>}
                            {options.map((option) => <option key={option} value={option}>{IMPORT_KIND_LABEL[option]}</option>)}
                          </select>
                        </label>
                        {entry.periodStart && entry.periodSource && (
                          <span className={MUTED_CLS}>Período desde {fmtIso(entry.periodStart)} ({PERIOD_SOURCE_TEXT[entry.periodSource]})</span>
                        )}
                        {(rowKind === 'card' || rowKind === 'statement') && !entry.periodStart && (
                          <span className={MUTED_CLS}>Sem data: vai depois dos datados</span>
                        )}
                      </div>
                      {entry.note && <p className={`text-xs ${MUTED_CLS}`}>{entry.note}</p>}
                      {problem && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{problem}</p>}
                    </li>
                  );
                })}
              </ul>
            )}

            {!check.ok && check.message && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">{check.message}</p>
            )}

            {kind === 'card' && (
              <div>
                <label htmlFor="import-hub-card" className={LABEL_CLS}>Cartão de crédito</label>
                <select id="import-hub-card" value={accountId} disabled={isLoadingAccounts} className={INPUT_CLS}
                  onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">{isLoadingAccounts ? 'Carregando contas…' : 'Selecione um cartão'}</option>
                  {cards.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
                {ordered.length > 1 && (
                  <p className={`mt-1 text-xs ${MUTED_CLS}`}>
                    {countLabel(ordered.length, 'fatura', 'faturas')} em ordem de período, da mais antiga para a mais nova: cada uma só é
                    analisada depois que a anterior for confirmada ou pulada.
                  </p>
                )}
                {!isLoadingAccounts && cards.length === 0 && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">Nenhum cartão de crédito cadastrado.</p>
                )}
              </div>
            )}

            {kind === 'statement' && (
              <div>
                <label htmlFor="import-hub-account" className={LABEL_CLS}>Conta de destino</label>
                <select id="import-hub-account" value={accountId} disabled={isLoadingAccounts} className={INPUT_CLS}
                  onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">{isLoadingAccounts ? 'Carregando contas…' : 'Selecione uma conta'}</option>
                  {statements.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
                <p className={`mt-1 text-xs ${MUTED_CLS}`}>
                  Extrato de conta corrente, poupança ou carteira. Para a fatura de um cartão, o tipo é “Fatura do cartão (OFX)”.
                </p>
              </div>
            )}

            {(kind === 'sheet' || kind === 'workbook') && (
              <div>
                <p className={`mb-2 text-sm ${MUTED_CLS}`}>Conta de destino de cada bloco da planilha.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {MAXFIN_SECTION_ORDER.map((key) => (
                    <div key={key}>
                      <label htmlFor={`import-hub-account-${key}`} className={LABEL_CLS}>{MAXFIN_SECTION_LABELS[key]}</label>
                      <select id={`import-hub-account-${key}`} value={sheetAccounts[key]} disabled={isLoadingAccounts} className={INPUT_CLS}
                        onChange={(e) => setSheetAccounts((prev) => ({ ...prev, [key]: e.target.value }))}>
                        <option value="">{isLoadingAccounts ? 'Carregando contas…' : 'Selecione uma conta'}</option>
                        {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 justify-end pt-2">
              <button type="button" onClick={onClose} className={BTN_SECONDARY}>Cancelar</button>
              <button type="button" onClick={handleContinue} disabled={!canContinue} className={BTN_PRIMARY}>Continuar</button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ImportHubDialog;

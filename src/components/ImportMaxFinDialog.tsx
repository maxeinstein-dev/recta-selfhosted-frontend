import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronDown, ChevronRight, FileUp, RefreshCw, Upload, X } from 'lucide-react';
import { useAccounts } from '../hooks/api/useAccounts';
import type { Account } from '../hooks/api/useAccounts';
import { useCategories } from '../hooks/api/useCategories';
import type { Category } from '../hooks/api/useCategories';
import { useDefaultHousehold } from '../hooks/useDefaultHousehold';
import { useToastContext } from '../context/ToastContext';
import { useCurrency } from '../context/CurrencyContext';
import type { CurrencyCode } from '../context/CurrencyContext';
import { formatCurrency, formatDate, parseDateFromAPI } from '../utils/format';
import { AccountType, CATEGORY_NAME_DISPLAY, CategoryType } from '../lib/enums';
import {
  MAXFIN_SECTION_LABELS, describeShareHint, groupRowsBySection, installmentLabel, loadSavedAccountIds, loadSavedCategoryChoices,
  monthLabel, monthSourceLabel, prepaidLabel, saveAccountIds, saveCategoryChoices, useMaxFinConfirm, useMaxFinPreview,
} from '../hooks/api/useImportMaxFin';
import type {
  MaxFinAccountsInput, MaxFinCategoryMapEntry, MaxFinCategoryTargetInput, MaxFinConfirmResponse, MaxFinImportOptions, MaxFinMonth,
  MaxFinPreviewOptionsInput, MaxFinPreviewResponse, MaxFinPreviewRow, MaxFinSectionKey, MaxFinSkippedRow, MaxFinTransactionType,
} from '../hooks/api/useImportMaxFin';
import {
  MAXFIN_MAX_YEAR, MAXFIN_MIN_YEAR, MAXFIN_SECTION_ORDER, applyOptionPatch, buildConfirmPayload, buildConfirmSummary, categoryChoiceKey,
  confirmBlocker, confirmFailureMessage, confirmResultNeedsReview, countByStatus, countLabel, defaultRowSelected, isSendableStatus,
  monthToInputValue, parseMonthInput, reconcileSelection, resolveCategoryChoices, rowKey, selectValueToTarget, systemCategoryNames,
  targetToSelectValue, toCents, validateMaxFinFile,
} from '../utils/maxfinPayload';
import type { MaxFinBuiltConfirm, MaxFinConfirmBlocker, MaxFinInvoiceSelection } from '../utils/maxfinPayload';

// ---------------------------------------------------------------------------
// Shared styles (mirrors ImportTransactionsDialog)
// ---------------------------------------------------------------------------

const FIELD_CLS =
  'border border-gray-200 dark:border-gray-800 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50';
const INPUT_CLS = `w-full px-3 py-2.5 text-sm ${FIELD_CLS}`;
const SELECT_SM_CLS = `w-full min-w-[220px] px-2 py-1.5 text-xs ${FIELD_CLS}`;
const MONTH_INPUT_CLS = `px-2 py-1.5 text-sm ${FIELD_CLS}`;
const FILE_INPUT_CLS =
  'block w-full text-sm text-gray-700 dark:text-gray-200 file:mr-4 file:py-2.5 file:px-4 file:rounded-md file:border file:border-gray-200 dark:file:border-gray-800 file:text-sm file:font-light file:bg-gray-50 dark:file:bg-gray-800 file:text-gray-900 dark:file:text-white hover:file:opacity-80 disabled:opacity-50';
const BTN_BASE = 'inline-flex items-center font-light tracking-tight rounded-md transition-opacity disabled:opacity-50 disabled:cursor-not-allowed';
const BTN_SECONDARY = `${BTN_BASE} px-4 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:opacity-70`;
const BTN_SECONDARY_SM = `${BTN_BASE} px-3 py-1.5 text-xs text-gray-900 dark:text-white bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:opacity-70`;
const BTN_PRIMARY = `${BTN_BASE} px-4 py-2.5 text-sm text-white bg-primary-600 dark:bg-primary-500 border border-primary-600 dark:border-primary-500 hover:opacity-80`;
const BTN_WARN = `${BTN_BASE} px-4 py-2.5 text-sm text-white bg-orange-700 border border-orange-700 hover:opacity-80`;
const LINK_CLS = 'text-xs text-primary-600 dark:text-primary-400 hover:underline disabled:opacity-50';
const LABEL_CLS = 'block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1';
const CHECKBOX_CLS = 'h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60';
const TABLE_WRAP_CLS = 'overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-md';
const THEAD_ROW_CLS = 'bg-gray-50 dark:bg-gray-800/50';
const TBODY_CLS = 'divide-y divide-gray-200 dark:divide-gray-800';
const TH_CLS = 'px-3 py-2 font-medium text-gray-700 dark:text-gray-200 text-left whitespace-nowrap';
const TD_CLS = 'px-3 py-2 text-gray-900 dark:text-white align-top';
const MUTED_CLS = 'text-gray-600 dark:text-gray-400';
const H4_CLS = 'text-sm font-medium text-gray-900 dark:text-white';

const CHIP_TONES = {
  green: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300',
  yellow: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300',
  orange: 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300',
  blue: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300',
  gray: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
} as const;
type ChipTone = keyof typeof CHIP_TONES;

const Chip = ({ tone, title, children }: { tone: ChipTone; title?: string; children: ReactNode }) => (
  <span title={title} className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${CHIP_TONES[tone]}`}>
    {children}
  </span>
);

// Keyed by plain strings on purpose: the server may send a status this client does not know yet.
const STATUS_CHIP: Partial<Record<string, { label: string; tone: ChipTone }>> = {
  new: { label: 'Nova', tone: 'green' },
  duplicate: { label: 'Duplicada', tone: 'yellow' },
  changed: { label: 'Alterada', tone: 'orange' },
  'replaces-future': { label: 'Substitui futuras', tone: 'blue' },
  'legacy-duplicate': { label: 'Possível duplicata', tone: 'yellow' },
};
const FALLBACK_CHIP: { label: string; tone: ChipTone } = { label: 'Status desconhecido', tone: 'gray' };
const ROW_TONE: Partial<Record<string, string>> = {
  duplicate: 'bg-yellow-50/50 dark:bg-yellow-900/10',
  changed: 'bg-orange-50/50 dark:bg-orange-900/10',
  'replaces-future': 'bg-blue-50/50 dark:bg-blue-900/10',
  'legacy-duplicate': 'bg-yellow-50/50 dark:bg-yellow-900/10',
};
/** Statuses whose detail must be readable without hovering: they replace stored data or may duplicate it. */
const INLINE_DETAIL_STATUSES: readonly string[] = ['changed', 'replaces-future', 'legacy-duplicate'];

const EMPTY_ACCOUNTS: MaxFinAccountsInput = { income: '', bills: '', credit: '', debit: '' };
const MONTH_MIN = monthToInputValue({ year: MAXFIN_MIN_YEAR, month: 1 });
const MONTH_MAX = monthToInputValue({ year: MAXFIN_MAX_YEAR, month: 12 });
/** A second click this soon after arming the replace confirmation is a double click, not a decision. */
const ARM_GUARD_MS = 600;
const ERROR_TOAST_MS = 10000;

type PreviewOutcome = 'ok' | 'error' | 'stale';

const getErrorMessage = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

/** YYYY-MM-DD -> dd/mm/yyyy without the UTC-midnight day shift. */
const fmtDate = (value: string): string => {
  try {
    return formatDate(parseDateFromAPI(value));
  } catch {
    return value;
  }
};

const currentMonthInput = (): string => {
  const now = new Date();
  return monthToInputValue({ year: now.getFullYear(), month: now.getMonth() + 1 });
};

// ---------------------------------------------------------------------------
// Step 1: file + one destination account per block
// ---------------------------------------------------------------------------

interface SetupStepProps {
  file: File | null; accountIds: MaxFinAccountsInput; accounts: Account[];
  isLoadingAccounts: boolean; isPreviewing: boolean; canPreview: boolean;
  /** Resolves to whether the file was accepted; a rejected file is also cleared from the input. */
  onFileChange: (file: File | null) => boolean; onAccountChange: (key: MaxFinSectionKey, id: string) => void;
  onPreview: () => void; onCancel: () => void;
}

const SetupStep = ({
  file, accountIds, accounts, isLoadingAccounts, isPreviewing, canPreview, onFileChange, onAccountChange, onPreview, onCancel,
}: SetupStepProps) => (
  <div className="space-y-4 min-w-0">
    <p className={`text-sm ${MUTED_CLS}`}>
      Exporte a aba do mês como CSV (blocos: entradas, contas fixas, cartão, débito/pix) e escolha a conta de destino de cada bloco.
    </p>
    <div>
      <label htmlFor="maxfin-file" className={LABEL_CLS}>Arquivo da planilha (.csv, até 5 MB)</label>
      <input id="maxfin-file" type="file" accept=".csv" disabled={isPreviewing} className={FILE_INPUT_CLS}
        onChange={(e) => {
          if (!onFileChange(e.target.files?.[0] ?? null)) e.target.value = '';
        }} />
      {file && (
        <p className={`mt-2 flex items-center gap-2 text-sm ${MUTED_CLS}`}>
          <FileUp className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span className="truncate">{file.name}</span>
        </p>
      )}
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {MAXFIN_SECTION_ORDER.map((key) => (
        <div key={key}>
          <label htmlFor={`maxfin-account-${key}`} className={LABEL_CLS}>{MAXFIN_SECTION_LABELS[key]}</label>
          <select id={`maxfin-account-${key}`} value={accountIds[key]} disabled={isLoadingAccounts || isPreviewing} className={INPUT_CLS}
            onChange={(e) => onAccountChange(key, e.target.value)}>
            <option value="">{isLoadingAccounts ? 'Carregando contas…' : 'Selecione uma conta'}</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </div>
      ))}
    </div>
    <div className="flex gap-3 justify-end pt-2">
      <button type="button" onClick={onCancel} className={BTN_SECONDARY}>Cancelar</button>
      <button type="button" onClick={onPreview} disabled={!canPreview} className={BTN_PRIMARY}>
        {isPreviewing ? 'Analisando…' : 'Pré-visualizar'}
      </button>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Step 2 pieces
// ---------------------------------------------------------------------------

interface OptionCheckboxProps { id: string; label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }

const OptionCheckbox = ({ id, label, checked, disabled, onChange }: OptionCheckboxProps) => (
  <label htmlFor={id} className={`inline-flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
    <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className={CHECKBOX_CLS} />
    {label}
  </label>
);

interface PreviewHeaderProps {
  preview: MaxFinPreviewResponse; options: MaxFinImportOptions; monthInput: string; isRefreshing: boolean; disabled: boolean;
  onMonthInputChange: (value: string) => void; onReprocess: () => void; onOptionChange: (patch: Partial<MaxFinImportOptions>) => void;
}

const PreviewHeader = ({
  preview, options, monthInput, isRefreshing, disabled, onMonthInputChange, onReprocess, onOptionChange,
}: PreviewHeaderProps) => (
  <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3 text-sm">
      {preview.month ? (
        <span className="font-medium text-gray-900 dark:text-white">
          {monthLabel(preview.month)} <span className={`font-normal ${MUTED_CLS}`}>({monthSourceLabel(preview.monthSource)})</span>
        </span>
      ) : (
        <>
          <span className="text-red-600 dark:text-red-400">Mês não identificado na planilha.</span>
          <input type="month" value={monthInput} min={MONTH_MIN} max={MONTH_MAX} disabled={disabled} aria-label="Mês de referência"
            className={MONTH_INPUT_CLS} onChange={(e) => onMonthInputChange(e.target.value)} />
          <button type="button" onClick={onReprocess} disabled={disabled || !parseMonthInput(monthInput)} className={BTN_SECONDARY_SM}>
            Reprocessar
          </button>
        </>
      )}
      {isRefreshing && (
        <span className={`inline-flex items-center gap-1 text-xs ${MUTED_CLS}`} role="status">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Atualizando…
        </span>
      )}
    </div>
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      <OptionCheckbox id="maxfin-opt-closed" label="Mês fechado (tudo pago; permite registrar a fatura)" checked={options.closedMonth}
        disabled={disabled} onChange={(checked) => onOptionChange({ closedMonth: checked })} />
      <OptionCheckbox id="maxfin-opt-invoice" label="Registrar pagamento da fatura" checked={options.payInvoice}
        disabled={disabled || !options.closedMonth} onChange={(checked) => onOptionChange({ payInvoice: checked })} />
      <OptionCheckbox id="maxfin-opt-future" label="Gerar parcelas futuras" checked={options.generateFutureInstallments}
        disabled={disabled || options.closedMonth} onChange={(checked) => onOptionChange({ generateFutureInstallments: checked })} />
    </div>
  </div>
);

interface SectionSummaryProps { preview: MaxFinPreviewResponse; accountName: (id: string) => string; currency: CurrencyCode }

const SectionSummary = ({ preview, accountName, currency }: SectionSummaryProps) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
    {preview.sections.map((section) => (
      <div key={section.key} className="rounded-md border border-gray-200 dark:border-gray-800 p-3 space-y-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className={H4_CLS}>{section.label || MAXFIN_SECTION_LABELS[section.key]}</span>
          <span className={`text-xs ${MUTED_CLS}`}>{countLabel(section.count, 'linha', 'linhas')}</span>
        </div>
        <p className={`text-xs truncate ${MUTED_CLS}`} title={accountName(section.accountId)}>{accountName(section.accountId)}</p>
        <p className="text-sm text-gray-900 dark:text-white">{formatCurrency(section.sum, currency)}</p>
        {section.sheetTotalPlanned !== null && (
          <p className={`text-xs ${MUTED_CLS}`}>Total na planilha: {formatCurrency(section.sheetTotalPlanned, currency)}</p>
        )}
        <div className="flex flex-wrap gap-1 pt-1">
          <Chip tone="green">{countLabel(section.newCount, 'nova', 'novas')}</Chip>
          <Chip tone="yellow">{countLabel(section.duplicateCount, 'duplicada', 'duplicadas')}</Chip>
          <Chip tone="orange">{countLabel(section.changedCount, 'alterada', 'alteradas')}</Chip>
        </div>
      </div>
    ))}
  </div>
);

interface InvoiceNoticeProps {
  preview: MaxFinPreviewResponse; selection: MaxFinInvoiceSelection; accountName: (id: string) => string; currency: CurrencyCode;
}

/** What confirm will record as the invoice payment, for the credit rows ticked right now. */
const InvoiceNotice = ({ preview, selection, accountName, currency }: InvoiceNoticeProps) => {
  const { invoice } = preview;
  // No invoice from the server (month unknown, card account not of credit type): nothing to promise or to show.
  if (!invoice) return null;
  // The server prices every credit row of the file; the payment recorded only covers the ticked ones.
  const fileDiffers = toCents(invoice.amount) !== selection.cents;
  return (
    <div className="rounded-md border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-900/20 px-4 py-3 text-sm text-blue-900 dark:text-blue-200 space-y-1">
      <p>
        Pagamento da fatura{selection.cents > 0 && <>: <strong>{formatCurrency(selection.amount, currency)}</strong></>}
        <> em {fmtDate(invoice.paymentDate)}, da conta {accountName(invoice.sourceAccountId)}</> —{' '}
        <strong>{selection.willPay ? 'será registrado' : 'não será registrado'}</strong>
        {selection.reason && <> ({selection.reason})</>}.
      </p>
      {fileDiffers && (
        <p className="text-xs">
          No arquivo: {formatCurrency(invoice.amount, currency)} (o registro considera só as compras de cartão selecionadas).
        </p>
      )}
    </div>
  );
};

interface CategoryMapTableProps {
  entries: MaxFinCategoryMapEntry[]; choices: Record<string, MaxFinCategoryTargetInput>; customCategories: Category[];
  disabled: boolean; onChange: (entry: MaxFinCategoryMapEntry, value: string) => void;
}

const CategoryMapTable = ({ entries, choices, customCategories, disabled, onChange }: CategoryMapTableProps) => {
  if (entries.length === 0) return null;
  return (
    <div>
      <h4 className={`${H4_CLS} mb-2`}>Categorias da planilha</h4>
      <div className={TABLE_WRAP_CLS}>
        <table className="w-full text-sm">
          <thead>
            <tr className={THEAD_ROW_CLS}>
              <th className={TH_CLS}>Chave na planilha</th>
              <th className={TH_CLS}>Tipo</th>
              <th className={`${TH_CLS} text-right`}>Linhas</th>
              <th className={TH_CLS}>Destino no Recta</th>
            </tr>
          </thead>
          <tbody className={TBODY_CLS}>
            {entries.map((entry) => {
              const key = categoryChoiceKey(entry.type, entry.key);
              // `choices` holds validated targets only, so the value always has a matching option below.
              const value = targetToSelectValue(choices[key] ?? { kind: 'default' });
              const customs = customCategories.filter((c) => c.type === entry.type);
              const isIncome = entry.type === 'INCOME';
              return (
                <tr key={key}>
                  <td className={`${TD_CLS} max-w-[220px] truncate`} title={entry.key || undefined}>
                    {entry.key || <span className={`italic ${MUTED_CLS}`}>(sem categoria)</span>}
                  </td>
                  <td className={`${TD_CLS} whitespace-nowrap ${MUTED_CLS}`}>{isIncome ? 'Receita' : 'Despesa'}</td>
                  <td className={`${TD_CLS} text-right`}>{entry.count}</td>
                  <td className={TD_CLS}>
                    <select value={value} disabled={disabled} aria-label={`Destino para ${entry.key || 'sem categoria'}`} className={SELECT_SM_CLS}
                      onChange={(e) => onChange(entry, e.target.value)}>
                      <optgroup label="Sistema">
                        {systemCategoryNames(entry.type).map((name) => (
                          <option key={name} value={`system:${name}`}>{CATEGORY_NAME_DISPLAY[name]}</option>
                        ))}
                      </optgroup>
                      {customs.length > 0 && (
                        <optgroup label="Suas categorias">
                          {customs.map((c) => <option key={c.id} value={`custom:${c.id}`}>{c.name}</option>)}
                        </optgroup>
                      )}
                      {entry.key && <option value="create">Criar nova: {entry.key}</option>}
                      <option value="default">{isIncome ? 'Padrão (Outras receitas)' : 'Padrão (Outras despesas)'}</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

interface PreviewRowItemProps {
  row: MaxFinPreviewRow; checked: boolean; disabled: boolean; currency: CurrencyCode; onToggle: (key: string, checked: boolean) => void;
}

/** Accessible name of the row checkbox: what ticking it does, plus the description of the row. */
const rowCheckboxLabel = (row: MaxFinPreviewRow): string => {
  const what = row.description || '(sem descrição)';
  switch (row.status) {
    case 'new':
      return `Importar linha: ${what}`;
    case 'changed':
      return `Substituir transação existente: ${what}`;
    case 'replaces-future':
      return `Importar e substituir parcelas futuras: ${what}`;
    case 'legacy-duplicate':
      return `Importar mesmo assim (possível duplicata): ${what}`;
    case 'duplicate':
      return `Linha já importada: ${what}`;
    default:
      return `Linha com status desconhecido, não pode ser importada: ${what}`;
  }
};

const PreviewRowItem = ({ row, checked, disabled, currency, onToggle }: PreviewRowItemProps) => {
  const key = rowKey(row);
  const knownChip = STATUS_CHIP[row.status];
  const status = knownChip ?? FALLBACK_CHIP;
  const isChanged = row.status === 'changed';
  const replacesFuture = row.status === 'replaces-future';
  const showDetail = !!row.statusDetail && (INLINE_DETAIL_STATUSES.includes(row.status) || !knownChip);
  const prepaid = row.installment ? prepaidLabel(row.installment) : null;
  return (
    <tr className={ROW_TONE[row.status] ?? ''}>
      <td className="px-3 py-2 align-top whitespace-nowrap">
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={checked} disabled={disabled || !isSendableStatus(row.status)} className={CHECKBOX_CLS}
            aria-label={rowCheckboxLabel(row)} onChange={(e) => onToggle(key, e.target.checked)} />
          {isChanged && <span className="text-[11px] text-orange-700 dark:text-orange-300">substituir</span>}
          {replacesFuture && <span className="text-[11px] text-blue-700 dark:text-blue-300">substitui futuras</span>}
        </label>
      </td>
      <td className={`${TD_CLS} max-w-[280px]`}>
        <div className="flex flex-wrap items-center gap-1 min-w-0">
          <span className="truncate max-w-full" title={row.description}>{row.description}</span>
          {row.installment && <Chip tone="gray">{installmentLabel(row.installment)}</Chip>}
          {prepaid && <Chip tone="blue">{prepaid}</Chip>}
          {row.futureInstallments > 0 && <Chip tone="blue">+{row.futureInstallments} futuras</Chip>}
        </div>
        {showDetail && <p className={`mt-0.5 text-[11px] leading-snug ${MUTED_CLS}`}>{row.statusDetail}</p>}
      </td>
      <td className={`${TD_CLS} whitespace-nowrap ${MUTED_CLS}`}>{row.categoryKey || '(sem)'}</td>
      <td className={`${TD_CLS} whitespace-nowrap text-right`}>{formatCurrency(row.amount, currency)}</td>
      <td className={`${TD_CLS} whitespace-nowrap ${MUTED_CLS}`}>{row.paid ? 'pago' : 'pendente'}</td>
      <td className={`${TD_CLS} max-w-[180px]`}>
        <span className={`block truncate ${MUTED_CLS}`} title={row.notes ?? undefined}>{row.notes ?? ''}</span>
      </td>
      <td className={TD_CLS}>{row.shareHint && <Chip tone="gray">{describeShareHint(row.shareHint)}</Chip>}</td>
      <td className={`${TD_CLS} whitespace-nowrap`}>
        <Chip tone={status.tone} title={row.statusDetail ?? undefined}>{status.label}</Chip>
      </td>
    </tr>
  );
};

interface RowsTableProps {
  preview: MaxFinPreviewResponse; selected: Record<string, boolean>; accountName: (id: string) => string; currency: CurrencyCode;
  disabled: boolean; onToggle: (key: string, checked: boolean) => void; onSelectAllNew: () => void; onClear: () => void;
}

const RowsTable = ({ preview, selected, accountName, currency, disabled, onToggle, onSelectAllNew, onClear }: RowsTableProps) => {
  const groups = useMemo(() => groupRowsBySection(preview), [preview]);
  // Counted from the rows themselves, so the chips always match what the table lists.
  const counts = useMemo(() => countByStatus(preview.rows), [preview.rows]);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className={H4_CLS}>Transações ({preview.rows.length})</h4>
          <Chip tone="green">{countLabel(counts.new, 'nova', 'novas')}</Chip>
          <Chip tone="yellow">{countLabel(counts.duplicate, 'duplicada', 'duplicadas')}</Chip>
          <Chip tone="orange">{countLabel(counts.changed, 'alterada', 'alteradas')}</Chip>
          {counts.replacesFuture > 0 && (
            <Chip tone="blue">{countLabel(counts.replacesFuture, 'substitui futuras', 'substituem futuras')}</Chip>
          )}
          {counts.legacyDuplicate > 0 && (
            <Chip tone="yellow">{countLabel(counts.legacyDuplicate, 'possível duplicata', 'possíveis duplicatas')}</Chip>
          )}
          {counts.unknown > 0 && <Chip tone="gray">{countLabel(counts.unknown, 'status desconhecido', 'status desconhecidos')}</Chip>}
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={onSelectAllNew} disabled={disabled} className={LINK_CLS}>Selecionar todas as novas</button>
          <button type="button" onClick={onClear} disabled={disabled} className={LINK_CLS}>Limpar</button>
        </div>
      </div>
      {preview.rows.length === 0 ? (
        <p className={`text-sm ${MUTED_CLS}`}>Nenhuma transação encontrada na planilha.</p>
      ) : (
        <div className={TABLE_WRAP_CLS}>
          <table className="w-full text-sm">
            <thead>
              <tr className={THEAD_ROW_CLS}>
                <th className={`${TH_CLS} w-8`} aria-label="Incluir" />
                <th className={TH_CLS}>Descrição</th>
                <th className={TH_CLS}>Categoria</th>
                <th className={`${TH_CLS} text-right`}>Valor</th>
                <th className={TH_CLS}>Pagamento</th>
                <th className={TH_CLS}>Nota</th>
                <th className={TH_CLS}>Compartilhada</th>
                <th className={TH_CLS}>Status</th>
              </tr>
            </thead>
            <tbody className={TBODY_CLS}>
              {groups.map((group) => (
                <Fragment key={group.key}>
                  <tr className={THEAD_ROW_CLS}>
                    <td colSpan={8} className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-gray-600 dark:text-gray-300">
                      {group.section?.label || MAXFIN_SECTION_LABELS[group.key]} · {accountName(group.section?.accountId ?? group.rows[0].accountId)} ·{' '}
                      {countLabel(group.rows.length, 'linha', 'linhas')}
                    </td>
                  </tr>
                  {group.rows.map((row) => (
                    <PreviewRowItem key={rowKey(row)} row={row} checked={isSendableStatus(row.status) && !!selected[rowKey(row)]}
                      disabled={disabled} currency={currency} onToggle={onToggle} />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const SkippedList = ({ skipped }: { skipped: MaxFinSkippedRow[] }) => {
  const [expanded, setExpanded] = useState(false);
  if (skipped.length === 0) return null;
  const Icon = expanded ? ChevronDown : ChevronRight;
  return (
    <div>
      <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
        className={`inline-flex items-center gap-1 text-sm hover:opacity-70 ${MUTED_CLS}`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
        {countLabel(skipped.length, 'linha ignorada', 'linhas ignoradas')}
      </button>
      {expanded && (
        <ul className={`mt-2 space-y-1 text-xs list-disc list-inside ${MUTED_CLS}`}>
          {skipped.map((item, index) => (
            <li key={`${item.sourceLine}-${index}`}>Linha {item.sourceLine}: {item.description || '(sem descrição)'} — {item.reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

interface PreviewFooterProps {
  built: MaxFinBuiltConfirm; blocker: MaxFinConfirmBlocker | null; armed: boolean; busy: boolean; isConfirming: boolean;
  confirmError: string | null; currency: CurrencyCode; onBack: () => void; onConfirm: () => void; onRefresh: () => void;
}

const REPLACED_ONE = 'linha substitui dados já registrados';
const REPLACED_MANY = 'linhas substituem dados já registrados';

/** Numbers come from buildConfirmPayload, the same rows the request is built from. */
const PreviewFooter = ({ built, blocker, armed, busy, isConfirming, confirmError, currency, onBack, onConfirm, onRefresh }: PreviewFooterProps) => {
  const { totals } = built;
  // After a failed (possibly partial) confirm the preview is stale: nothing about the invoice is promised until it is refreshed.
  const stale = blocker?.code === 'needs-refresh';
  return (
    <div className="pt-3 border-t border-gray-200 dark:border-gray-800 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 text-sm min-w-0">
          <p className="text-gray-900 dark:text-white">
            {countLabel(totals.count, 'linha selecionada', 'linhas selecionadas')}
            {totals.incomeCount > 0 && <> · Receitas: <strong>{formatCurrency(totals.incomeTotal, currency)}</strong></>}
            {totals.expenseCount > 0 && <> · Despesas: <strong>{formatCurrency(totals.expenseTotal, currency)}</strong></>}
          </p>
          {totals.replacements > 0 && (
            <p className="text-orange-700 dark:text-orange-300">{countLabel(totals.replacements, REPLACED_ONE, REPLACED_MANY)}</p>
          )}
          {totals.invoice.willPay && !stale && (
            <p className={MUTED_CLS}>Fatura de {formatCurrency(totals.invoice.amount, currency)} será registrada.</p>
          )}
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={onBack} disabled={busy} className={BTN_SECONDARY}>
            <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
            Voltar
          </button>
          <button type="button" onClick={onConfirm} disabled={busy || blocker !== null} title={blocker?.message}
            aria-describedby={blocker ? 'maxfin-confirm-blocker' : undefined} className={armed ? BTN_WARN : BTN_PRIMARY}>
            {isConfirming ? 'Importando…' : armed ? `Confirmar e substituir ${totals.replacements}` : 'Confirmar importação'}
          </button>
        </div>
      </div>
      {armed && !isConfirming && (
        <p role="alert" className="text-sm text-orange-700 dark:text-orange-300">
          Atenção: dados que já estão registrados serão substituídos. Clique de novo para confirmar.
        </p>
      )}
      {blocker && (
        <p id="maxfin-confirm-blocker" className={`text-xs ${blocker.code === 'none-selected' ? MUTED_CLS : 'text-red-600 dark:text-red-400'}`}>
          {blocker.message}
        </p>
      )}
      {confirmError && (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">{confirmError}</p>
          <button type="button" onClick={onRefresh} disabled={busy} className={BTN_SECONDARY_SM}>Atualizar pré-visualização</button>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Step 3: result (only when there is something to read)
// ---------------------------------------------------------------------------

interface ResultStepProps { result: MaxFinConfirmResponse; summary: string; onClose: () => void }

const ResultStep = ({ result, summary, onClose }: ResultStepProps) => {
  const warnings = result.warnings ?? [];
  const consumed = result.consumedFutureInstallments ?? 0;
  return (
    <div className="space-y-4 min-w-0">
      <div>
        <h4 className={H4_CLS}>Importação concluída</h4>
        <p className="mt-1 text-sm text-gray-900 dark:text-white">{summary}</p>
      </div>
      {warnings.length > 0 && (
        <div>
          <h4 className={`${H4_CLS} mb-1`}>{countLabel(warnings.length, 'aviso', 'avisos')}</h4>
          <ul className="rounded-md border border-yellow-200 dark:border-yellow-900/60 bg-yellow-50 dark:bg-yellow-900/20 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300 list-disc list-inside space-y-1">
            {warnings.map((warning, index) => <li key={index}>{warning}</li>)}
          </ul>
        </div>
      )}
      {(result.skipped > 0 || consumed > 0) && (
        <ul className={`text-sm list-disc list-inside space-y-1 ${MUTED_CLS}`}>
          {result.skipped > 0 && <li>{countLabel(result.skipped, 'linha foi ignorada', 'linhas foram ignoradas')} pelo servidor.</li>}
          {consumed > 0 && (
            <li>{countLabel(consumed, 'parcela futura gerada antes foi substituída', 'parcelas futuras geradas antes foram substituídas')}.</li>
          )}
        </ul>
      )}
      <div className="flex justify-end pt-2">
        <button type="button" onClick={onClose} autoFocus className={BTN_PRIMARY}>Fechar</button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

const INITIAL_OPTIONS: MaxFinImportOptions = { closedMonth: false, payInvoice: false, generateFutureInstallments: false };

interface ImportMaxFinDialogProps {
  open: boolean;
  onClose: () => void;
  /** Defaults to the household from useDefaultHousehold (same as the sibling dialog). */
  householdId?: string;
}

const ImportMaxFinDialog = ({ open, onClose, householdId: householdIdProp }: ImportMaxFinDialogProps) => {
  const { householdId: defaultHouseholdId } = useDefaultHousehold();
  const householdId = householdIdProp ?? defaultHouseholdId;
  const { success, error: showError, showToast } = useToastContext();
  const { baseCurrency } = useCurrency();

  const { data: accountsData, isLoading: isLoadingAccounts } = useAccounts({ householdId: householdId ?? '' });
  const accounts = useMemo(() => accountsData?.accounts ?? [], [accountsData]);
  const { data: categoriesData } = useCategories({ householdId });
  const customCategories = useMemo(() => (categoriesData ?? []).filter((c) => !c.isSystem), [categoriesData]);
  const customIdsByType = useMemo<Record<MaxFinTransactionType, ReadonlySet<string>>>(() => ({
    INCOME: new Set(customCategories.filter((c) => c.type === CategoryType.INCOME).map((c) => c.id)),
    EXPENSE: new Set(customCategories.filter((c) => c.type === CategoryType.EXPENSE).map((c) => c.id)),
  }), [customCategories]);

  const previewMutation = useMaxFinPreview();
  const confirmMutation = useMaxFinConfirm();
  const isPreviewing = previewMutation.isPending;
  const isConfirming = confirmMutation.isPending;

  // Step 1 state (kept when going back from the preview).
  const [file, setFile] = useState<File | null>(null);
  const [accountIds, setAccountIds] = useState<MaxFinAccountsInput>(EMPTY_ACCOUNTS);
  // Step 2 state. preview.options is the source of truth for the options; pendingOptions only shows the
  // toggle the user just made while the preview is being recomputed.
  const [preview, setPreview] = useState<MaxFinPreviewResponse | null>(null);
  const [pendingOptions, setPendingOptions] = useState<MaxFinImportOptions | null>(null);
  const [monthOverride, setMonthOverride] = useState<MaxFinMonth | null>(null);
  const [monthInput, setMonthInput] = useState<string>(currentMonthInput);
  const [categoryChoices, setCategoryChoices] = useState<Record<string, MaxFinCategoryTargetInput>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [armed, setArmed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // Step 3 state: only set when the confirmed import has something to read (warnings, skipped, consumed).
  const [result, setResult] = useState<{ data: MaxFinConfirmResponse; summary: string } | null>(null);
  // Rows of the last preview, used to keep the selection of the user across re-runs.
  const lastRowsRef = useRef<MaxFinPreviewRow[]>([]);
  // Latest-wins guard: a preview run only touches state while it is the newest run of a mounted dialog.
  const seqRef = useRef(0);
  const mountedRef = useRef(true);
  const armedAtRef = useRef(0);
  // Latest custom categories, read after awaits so a refetch that lands mid-preview is not lost.
  const customIdsRef = useRef(customIdsByType);

  useEffect(() => {
    customIdsRef.current = customIdsByType;
  }, [customIdsByType]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset everything whenever the dialog opens; closing it invalidates any preview still in flight.
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setAccountIds(EMPTY_ACCOUNTS);
    setPreview(null);
    setPendingOptions(null);
    setMonthOverride(null);
    setMonthInput(currentMonthInput());
    setCategoryChoices({});
    setSelected({});
    setArmed(false);
    setFormError(null);
    setConfirmError(null);
    setResult(null);
    lastRowsRef.current = [];
    return () => {
      seqRef.current += 1;
    };
  }, [open]);

  // Pre-select accounts: the last choice of the household when it still fits (existing account of the right
  // kind), otherwise credit -> first CREDIT account and the other three -> first non-credit account.
  // Only fills empty slots, so a choice of the user is never overridden by a refetch.
  useEffect(() => {
    if (!open || accounts.length === 0) return;
    const credit = accounts.find((a) => a.type === AccountType.CREDIT)?.id ?? '';
    const other = accounts.find((a) => a.type !== AccountType.CREDIT)?.id ?? '';
    const saved = loadSavedAccountIds(householdId);
    const pick = (key: keyof MaxFinAccountsInput, fallback: string): string => {
      const id = saved[key];
      const wantsCredit = key === 'credit';
      const fits = !!id && accounts.some((a) => a.id === id && (a.type === AccountType.CREDIT) === wantsCredit);
      return fits && id ? id : fallback;
    };
    setAccountIds((prev) => {
      const next = {
        income: prev.income || pick('income', other),
        bills: prev.bills || pick('bills', other),
        credit: prev.credit || pick('credit', credit),
        debit: prev.debit || pick('debit', other),
      };
      return MAXFIN_SECTION_ORDER.every((key) => next[key] === prev[key]) ? prev : next;
    });
  }, [open, accounts, householdId]);

  // Body scroll lock (same pattern as ImportTransactionsDialog).
  useEffect(() => {
    if (!open) return;
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalStyle;
    };
  }, [open]);

  // ESC closes, except while the confirm request is in flight.
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isConfirming) onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [open, onClose, isConfirming]);

  // What each category select shows and the request sends: the choice while it is valid, else the suggestion.
  const effectiveChoices = useMemo(
    () => (preview ? resolveCategoryChoices(preview.categoryMap, categoryChoices, {}, customIdsByType) : {}),
    [preview, categoryChoices, customIdsByType],
  );
  // One source for the footer and the request: the payload and the numbers come from the same rows.
  const built = useMemo(
    () => (preview ? buildConfirmPayload(preview, selected, effectiveChoices, { accounts, customIdsByType }) : null),
    [preview, selected, effectiveChoices, accounts, customIdsByType],
  );

  // Anything that changes what would be sent (rows, targets, accounts, options) cancels a pending "replace" confirmation.
  useEffect(() => {
    setArmed(false);
  }, [built, pendingOptions]);

  if (!open) return null;

  const shownOptions = pendingOptions ?? preview?.options ?? INITIAL_OPTIONS;
  const isRefreshing = isPreviewing && preview !== null;
  const busy = isRefreshing || isConfirming;
  const allAccountsChosen = MAXFIN_SECTION_ORDER.every((key) => !!accountIds[key]);
  const accountName = (id: string): string => accounts.find((a) => a.id === id)?.name ?? '—';
  // A failed confirm may have stored part of the rows: the preview on screen is stale until it is run again.
  const blocker = preview ? confirmBlocker(built, confirmError !== null) : null;
  // Closing is blocked while the confirm request is in flight: the import must not be abandoned halfway.
  const requestClose = () => {
    if (!isConfirming) onClose();
  };

  /** Runs the preview and merges the result into the state, unless a newer run or a close got ahead of it. */
  const runPreview = async (opts?: MaxFinPreviewOptionsInput): Promise<PreviewOutcome> => {
    if (!file) return 'error';
    seqRef.current += 1;
    const run = seqRef.current;
    const isCurrent = () => mountedRef.current && run === seqRef.current;
    try {
      const data = await previewMutation.mutateAsync({ accounts: accountIds, options: opts, file });
      if (!isCurrent()) return 'stale';
      saveAccountIds(householdId, accountIds);
      const prevRows = lastRowsRef.current;
      lastRowsRef.current = data.rows;
      setPreview(data);
      setConfirmError(null);
      setSelected((prev) => reconcileSelection(prevRows, prev, data.rows));
      setCategoryChoices((prev) => resolveCategoryChoices(data.categoryMap, prev, loadSavedCategoryChoices(householdId), customIdsRef.current));
      if (data.month) setMonthInput(monthToInputValue(data.month));
      return 'ok';
    } catch (err: unknown) {
      if (!isCurrent()) return 'stale';
      showError(getErrorMessage(err, 'Não foi possível pré-visualizar a planilha.'));
      return 'error';
    }
  };

  /** Resolves to whether the file was accepted; a rejected file is also cleared from the input. */
  const handleFileChange = (selectedFile: File | null): boolean => {
    const problem = selectedFile ? validateMaxFinFile(selectedFile) : null;
    setFormError(problem);
    // A different file means a different set of rows: forget the old preview and selection.
    seqRef.current += 1;
    setFile(problem ? null : selectedFile);
    setPreview(null);
    setPendingOptions(null);
    setSelected({});
    setMonthOverride(null);
    setConfirmError(null);
    lastRowsRef.current = [];
    return problem === null;
  };

  const handlePreview = () => {
    setFormError(null);
    if (!householdId) return setFormError('Nenhuma household selecionada.');
    if (!file) return setFormError('Selecione o arquivo .csv da planilha.');
    if (!allAccountsChosen) return setFormError('Selecione uma conta para cada bloco da planilha.');
    void runPreview(monthOverride ? { monthOverride } : undefined);
  };

  // Option changes re-run the preview: the server recomputes paid flags, statuses and future installments.
  const handleOptionChange = async (patch: Partial<MaxFinImportOptions>) => {
    const next = applyOptionPatch(shownOptions, patch);
    setPendingOptions(next);
    const outcome = await runPreview(monthOverride ? { ...next, monthOverride } : next);
    // On success preview.options already carries the new options; on error the previous ones come back.
    if (outcome !== 'stale') setPendingOptions(null);
  };

  // After a failed (possibly partial) confirm: run the preview again; rows already stored come back as duplicates.
  const handleRefresh = async () => {
    if (!preview) return;
    await runPreview(monthOverride ? { ...preview.options, monthOverride } : preview.options);
  };

  const handleReprocess = async () => {
    const month = parseMonthInput(monthInput);
    if (!month) return;
    if ((await runPreview({ ...shownOptions, monthOverride: month })) === 'ok') setMonthOverride(month);
  };

  const handleCategoryChange = (entry: MaxFinCategoryMapEntry, value: string) => {
    const key = categoryChoiceKey(entry.type, entry.key);
    const target = selectValueToTarget(value, entry.key);
    setCategoryChoices((prev) => ({ ...prev, [key]: target }));
    saveCategoryChoices(householdId, { [key]: target });
  };

  const handleToggleRow = (key: string, checked: boolean) => setSelected((prev) => ({ ...prev, [key]: checked }));

  const handleSelectAllNew = () => {
    if (!preview) return;
    setSelected((prev) => {
      const next = { ...prev };
      for (const row of preview.rows) if (defaultRowSelected(row.status)) next[rowKey(row)] = true;
      return next;
    });
  };

  const handleClear = () => {
    if (preview) setSelected(Object.fromEntries(preview.rows.map((row) => [rowKey(row), false])));
  };

  const handleBack = () => {
    setPreview(null);
    setPendingOptions(null);
    setFormError(null);
    setConfirmError(null);
  };

  const handleConfirm = async () => {
    if (!built?.payload || blocker || isConfirming) return;
    // Replacing stored transactions takes two clicks: the first one only arms the button.
    if (built.totals.replacements > 0) {
      if (!armed) {
        armedAtRef.current = Date.now();
        setArmed(true);
        return;
      }
      if (Date.now() - armedAtRef.current < ARM_GUARD_MS) return;
    }
    setArmed(false);
    try {
      const data = await confirmMutation.mutateAsync(built.payload);
      const summary = buildConfirmSummary(data, (value) => formatCurrency(value, baseCurrency));
      success(summary);
      if (!mountedRef.current) return;
      if (confirmResultNeedsReview(data)) setResult({ data, summary });
      else onClose();
    } catch (err: unknown) {
      const message = confirmFailureMessage(getErrorMessage(err, 'Não foi possível confirmar a importação.'));
      showToast(message, 'error', ERROR_TOAST_MS);
      if (mountedRef.current) setConfirmError(message);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black/40 animate-fade-in transition-opacity duration-300 ease-out" onClick={requestClose} aria-hidden="true" />
      <div className="flex min-h-full items-center justify-center p-4">
        <div role="dialog" aria-modal="true" aria-labelledby="maxfin-dialog-title"
          className={`relative w-full ${preview && !result ? 'max-w-5xl' : 'max-w-2xl'} p-6 border rounded-lg bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800 max-h-[90vh] overflow-y-auto min-w-0 animate-slide-in-bottom`}>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center min-w-0">
              <Upload className="h-5 w-5 text-gray-500 dark:text-gray-400 mr-3 flex-shrink-0" aria-hidden="true" />
              <h3 id="maxfin-dialog-title" className="text-lg font-light tracking-tight text-gray-900 dark:text-white truncate">
                Importar planilha mensal (MaxFin)
              </h3>
            </div>
            <button type="button" onClick={requestClose} disabled={isConfirming} aria-label="Fechar modal"
              className="text-gray-400 dark:text-gray-500 hover:opacity-70 transition-opacity p-1 disabled:opacity-40 disabled:cursor-not-allowed">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {formError && <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">{formError}</p>}

          {result ? (
            <ResultStep result={result.data} summary={result.summary} onClose={requestClose} />
          ) : preview && built ? (
            <div className="space-y-5 min-w-0">
              <PreviewHeader preview={preview} options={shownOptions} monthInput={monthInput} isRefreshing={isRefreshing} disabled={busy}
                onMonthInputChange={setMonthInput} onReprocess={() => void handleReprocess()} onOptionChange={(patch) => void handleOptionChange(patch)} />

              {preview.warnings.length > 0 && (
                <ul className="rounded-md border border-yellow-200 dark:border-yellow-900/60 bg-yellow-50 dark:bg-yellow-900/20 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300 list-disc list-inside space-y-1">
                  {preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                </ul>
              )}

              {/* Kept visible (dimmed) while the preview is being recomputed. */}
              <div className={`space-y-5 min-w-0 transition-opacity ${isRefreshing ? 'opacity-60' : ''}`} aria-busy={isRefreshing}>
                <SectionSummary preview={preview} accountName={accountName} currency={baseCurrency} />
                {blocker?.code !== 'needs-refresh' && (
                  <InvoiceNotice preview={preview} selection={built.totals.invoice} accountName={accountName} currency={baseCurrency} />
                )}
                <CategoryMapTable entries={preview.categoryMap} choices={effectiveChoices} customCategories={customCategories} disabled={busy}
                  onChange={handleCategoryChange} />
                <RowsTable preview={preview} selected={selected} accountName={accountName} currency={baseCurrency} disabled={busy}
                  onToggle={handleToggleRow} onSelectAllNew={handleSelectAllNew} onClear={handleClear} />
                <SkippedList skipped={preview.skipped} />
              </div>

              <PreviewFooter built={built} blocker={blocker} armed={armed} busy={busy} isConfirming={isConfirming} confirmError={confirmError}
                currency={baseCurrency} onBack={handleBack} onConfirm={() => void handleConfirm()} onRefresh={() => void handleRefresh()} />
            </div>
          ) : (
            <SetupStep file={file} accountIds={accountIds} accounts={accounts} isLoadingAccounts={isLoadingAccounts} isPreviewing={isPreviewing}
              canPreview={!isPreviewing && !!file && allAccountsChosen && !!householdId} onFileChange={handleFileChange}
              onAccountChange={(key, id) => setAccountIds((prev) => ({ ...prev, [key]: id }))} onPreview={handlePreview} onCancel={requestClose} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ImportMaxFinDialog;

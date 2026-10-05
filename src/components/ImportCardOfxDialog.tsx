import { useEffect, useMemo, useRef, useState } from 'react';
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
import { CATEGORY_NAME_DISPLAY, CategoryType } from '../lib/enums';
import { loadSavedCategoryChoices, monthLabel, saveCategoryChoices } from '../hooks/api/useImportMaxFin';
import type { MaxFinCategoryMapEntry, MaxFinCategoryTargetInput, MaxFinMonth, MaxFinTransactionType } from '../hooks/api/useImportMaxFin';
import { useCardOfxConfirm, useCardOfxPreview } from '../hooks/api/useImportCardOfx';
import type {
  CardOfxConfirmResponse, CardOfxLine, CardOfxOptionsInput, CardOfxPayment, CardOfxPreviewResponse, CardOfxResult, CardOfxSheetOnly,
  CardOfxTarget,
} from '../hooks/api/useImportCardOfx';
import {
  MAXFIN_MAX_YEAR, MAXFIN_MIN_YEAR, categoryChoiceKey, countLabel, monthToInputValue, parseMonthInput, resolveCategoryChoices,
  selectValueToTarget, systemCategoryNames, targetToSelectValue,
} from '../utils/maxfinPayload';
import { monthKeyLabel } from '../utils/maxfinWorkbook';
import {
  PROPOSAL_KIND_LABEL, buildCardOfxConfirm, buildCardOfxSections, buildCardOfxSummary, cardOfxConfirmBlocker, cardOfxFailureMessage,
  cardOfxMonthSourceLabel, cardOfxResultLines, clearGroups, defaultPaymentChoice, isGroupSelected, isKnownProposalKind,
  isPaymentActionable, lineKindLabel, newLinesNotice, paymentNeedsSource, paymentSourceAccounts, reconcileGroupSelection, reconcilePaymentChoice,
  selectAllGroups, setGroupSelected, validateCardOfxFile,
} from '../utils/cardOfx';
import type {
  CardOfxBlocker, CardOfxBuiltConfirm, CardOfxGroupSection, CardOfxGroupView, CardOfxNewLinesNotice, CardOfxPaymentChoice, CardOfxSelection,
  CardOfxTotals,
} from '../utils/cardOfx';

// ---------------------------------------------------------------------------
// Shared styles (mirrors ImportMaxFinDialog)
// ---------------------------------------------------------------------------

const FIELD_CLS =
  'border border-gray-200 dark:border-gray-800 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50';
const INPUT_CLS = `w-full px-3 py-2.5 text-sm ${FIELD_CLS}`;
const SELECT_SM_CLS = `w-full min-w-[200px] px-2 py-1.5 text-xs ${FIELD_CLS}`;
const MONTH_INPUT_CLS = `px-2 py-1.5 text-sm ${FIELD_CLS}`;
const FILE_INPUT_CLS =
  'block w-full text-sm text-gray-700 dark:text-gray-200 file:mr-4 file:py-2.5 file:px-4 file:rounded-md file:border file:border-gray-200 dark:file:border-gray-800 file:text-sm file:font-light file:bg-gray-50 dark:file:bg-gray-800 file:text-gray-900 dark:file:text-white hover:file:opacity-80 disabled:opacity-50';
const BTN_BASE = 'inline-flex items-center font-light tracking-tight rounded-md transition-opacity disabled:opacity-50 disabled:cursor-not-allowed';
const BTN_SECONDARY = `${BTN_BASE} px-4 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:opacity-70`;
const BTN_SECONDARY_SM = `${BTN_BASE} px-3 py-1.5 text-xs text-gray-900 dark:text-white bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:opacity-70`;
const BTN_PRIMARY = `${BTN_BASE} px-4 py-2.5 text-sm text-white bg-primary-600 dark:bg-primary-500 border border-primary-600 dark:border-primary-500 hover:opacity-80`;
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
const BOX_CLS = 'rounded-md border border-gray-200 dark:border-gray-800 p-4 space-y-2';
const WARN_BOX_CLS =
  'rounded-md border border-yellow-200 dark:border-yellow-900/60 bg-yellow-50 dark:bg-yellow-900/20 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300 list-disc list-inside space-y-1';
const NOTICE_BOX_CLS =
  'rounded-md border border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 px-4 py-3 text-sm text-orange-900 dark:text-orange-200 space-y-1';

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

const MONTH_MIN = monthToInputValue({ year: MAXFIN_MIN_YEAR, month: 1 });
const MONTH_MAX = monthToInputValue({ year: MAXFIN_MAX_YEAR, month: 12 });
const ERROR_TOAST_MS = 10000;
const BLOCKER_ID = 'card-ofx-confirm-blocker';

type PreviewOutcome = 'ok' | 'error' | 'stale';
type RunPreview = (target: File, opts?: CardOfxOptionsInput) => Promise<PreviewOutcome>;

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

const money = (cents: number, currency: CurrencyCode): string => formatCurrency(cents / 100, currency);

/** "+R$ 10,00" for a credit (refund, discount, payment), "R$ 10,00" for a purchase. */
const signedAmount = (amount: number, type: string, currency: CurrencyCode): string =>
  `${type === 'INCOME' ? '+' : ''}${formatCurrency(amount, currency)}`;

// ---------------------------------------------------------------------------
// Step 1: the file
// ---------------------------------------------------------------------------

interface FileStepProps {
  cardName: string; file: File | null; isPreviewing: boolean; canPreview: boolean;
  /** Resolves to whether the file was accepted; a rejected file is also cleared from the input. */
  onFileChange: (file: File | null) => boolean; onPreview: () => void; onCancel: () => void;
}

const FileStep = ({ cardName, file, isPreviewing, canPreview, onFileChange, onPreview, onCancel }: FileStepProps) => (
  <div className="space-y-4 min-w-0">
    <p className={`text-sm ${MUTED_CLS}`}>
      Envie a fatura do cartão <strong className="font-medium text-gray-900 dark:text-white">{cardName}</strong> exportada como .ofx. As
      compras são conciliadas com as transações do mês (as linhas da planilha ficam, com a data e a descrição do banco); nada é gravado
      antes de confirmar.
    </p>
    <div>
      <label htmlFor="card-ofx-file" className={LABEL_CLS}>Fatura do cartão (.ofx, até 5 MB)</label>
      <input id="card-ofx-file" type="file" accept=".ofx" disabled={isPreviewing} className={FILE_INPUT_CLS}
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

interface PreviewHeaderProps {
  preview: CardOfxPreviewResponse; cardName: string; totals: CardOfxTotals; monthInput: string; isRefreshing: boolean;
  monthDisabled: boolean; currency: CurrencyCode; onMonthInputChange: (value: string) => void; onApplyMonth: () => void;
}

const RECTA_TOTAL_HINT =
  'Linhas já conciliadas, linhas da planilha e parcelas futuras que as propostas apontam (marcadas ou não), novas e pares marcados, e as transações do mês sem par no OFX. Pagamentos ficam fora, como no total do OFX.';

const PreviewHeader = ({
  preview, cardName, totals, monthInput, isRefreshing, monthDisabled, currency, onMonthInputChange, onApplyMonth,
}: PreviewHeaderProps) => {
  const source = cardOfxMonthSourceLabel(preview.monthSource);
  const canApply = !monthDisabled && !!parseMonthInput(monthInput) && monthInput !== preview.monthKey;
  const diff = totals.differenceCents;
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-sm">
        <div className="min-w-0">
          <dt className={`text-xs ${MUTED_CLS}`}>Cartão</dt>
          <dd className="font-medium text-gray-900 dark:text-white truncate" title={cardName}>{cardName}</dd>
        </div>
        <div className="min-w-0">
          <dt className={`text-xs ${MUTED_CLS}`}>Fatura</dt>
          <dd className="font-medium text-gray-900 dark:text-white">
            {monthLabel(preview.month)}
            {source && <span className={`block text-xs font-normal ${MUTED_CLS}`}>{source}</span>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className={`text-xs ${MUTED_CLS}`}>Período do extrato</dt>
          <dd className="text-gray-900 dark:text-white">{fmtDate(preview.period.start)} a {fmtDate(preview.period.end)}</dd>
        </div>
        <div className="min-w-0">
          <dt className={`text-xs ${MUTED_CLS}`}>Total do OFX</dt>
          <dd className="font-medium text-gray-900 dark:text-white">{money(totals.ofxCents, currency)}</dd>
        </div>
        <div className="min-w-0">
          <dt className={`text-xs ${MUTED_CLS}`} title={RECTA_TOTAL_HINT}>Total no Recta após importar</dt>
          <dd className="font-medium text-gray-900 dark:text-white" title={RECTA_TOTAL_HINT}>
            {money(totals.rectaCents, currency)}
            {diff === 0 ? (
              <span className="block text-xs font-normal text-green-700 dark:text-green-400">igual ao OFX</span>
            ) : (
              <span className="block text-xs font-normal text-orange-700 dark:text-orange-300">
                {money(Math.abs(diff), currency)} {diff > 0 ? 'a menos' : 'a mais'} que o OFX
              </span>
            )}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="card-ofx-month" className={MUTED_CLS}>Mês da fatura</label>
        <input id="card-ofx-month" type="month" value={monthInput} min={MONTH_MIN} max={MONTH_MAX} disabled={monthDisabled}
          className={MONTH_INPUT_CLS} onChange={(e) => onMonthInputChange(e.target.value)} />
        <button type="button" onClick={onApplyMonth} disabled={!canApply} className={BTN_SECONDARY_SM}>Reprocessar</button>
        {isRefreshing && (
          <span className={`inline-flex items-center gap-1 text-xs ${MUTED_CLS}`} role="status">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Atualizando…
          </span>
        )}
      </div>
    </div>
  );
};

const LineList = ({ lines, currency }: { lines: CardOfxLine[]; currency: CurrencyCode }) => (
  <ul className="space-y-0.5">
    {lines.map((line, index) => {
      const kind = lineKindLabel(line.kind);
      return (
        <li key={`${index}-${line.ref}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
          <span className={`whitespace-nowrap text-xs ${MUTED_CLS}`}>{fmtDate(line.date)}</span>
          <span className="truncate max-w-[280px]" title={line.memo}>{line.memo}</span>
          {line.installment && <Chip tone="gray">{line.installment.number}/{line.installment.total}</Chip>}
          {kind && <Chip tone={line.kind === 'payment' ? 'blue' : 'green'}>{kind}</Chip>}
          <span className="whitespace-nowrap">{signedAmount(line.amount, line.type, currency)}</span>
        </li>
      );
    })}
  </ul>
);

const TargetCell = ({ target, currency }: { target: CardOfxTarget; currency: CurrencyCode }) => (
  <div className="space-y-0.5 min-w-0">
    <p className="truncate max-w-[240px]" title={target.description}>{target.description}</p>
    <p className={`text-xs ${MUTED_CLS}`}>{fmtDate(target.date)} · {signedAmount(target.amount, target.type, currency)}</p>
  </div>
);

const ResultCell = ({ result }: { result: CardOfxResult }) => (
  <div className="space-y-0.5 min-w-0">
    <p className="truncate max-w-[240px]" title={result.description}>{result.description}</p>
    <p className={`text-xs ${MUTED_CLS}`}>{fmtDate(result.date)}</p>
    {result.notesAppend && (
      <p className={`text-[11px] leading-snug line-clamp-2 break-words ${MUTED_CLS}`} title={result.notesAppend}>Notas: + {result.notesAppend}</p>
    )}
  </div>
);

/** Accessible name of a group checkbox: what ticking it does, plus what it is about. */
const groupCheckboxLabel = (group: CardOfxGroupView): string => {
  const first = group.lines[0];
  const about = group.proposal.target?.description || first?.memo || group.proposal.group;
  switch (group.section) {
    case 'matched':
      return `Enriquecer com o OFX: ${about}`;
    case 'futures':
      return `Consumir parcela futura: ${about}`;
    case 'new':
      return `Importar nova: ${first?.memo ?? about}${group.lines.length > 1 ? ` (+${group.lines.length - 1})` : ''}`;
    case 'reversal':
      return `Importar compra e estorno: ${first?.merchant || first?.memo || about}`;
    default:
      return `Proposta de tipo desconhecido, não pode ser importada: ${about}`;
  }
};

interface GroupRowProps {
  group: CardOfxGroupView; checked: boolean; disabled: boolean; currency: CurrencyCode;
  onToggle: (group: CardOfxGroupView, checked: boolean) => void;
}

const GroupRow = ({ group, checked, disabled, currency, onToggle }: GroupRowProps) => {
  const { proposal, section } = group;
  const twoColumns = section === 'matched' || section === 'futures';
  return (
    <tr className={checked ? '' : 'bg-gray-50/60 dark:bg-gray-800/20'}>
      <td className="px-3 py-2 align-top">
        <input type="checkbox" checked={checked} disabled={disabled || !group.sendable} className={CHECKBOX_CLS}
          aria-label={groupCheckboxLabel(group)} onChange={(e) => onToggle(group, e.target.checked)} />
      </td>
      <td className={`${TD_CLS} min-w-[280px]`}>
        <div className="flex flex-wrap items-center gap-1 mb-1 empty:hidden">
          {section === 'matched' && isKnownProposalKind(proposal.kind) && <Chip tone="blue">{PROPOSAL_KIND_LABEL[proposal.kind]}</Chip>}
          {proposal.ambiguous && <Chip tone="orange" title="Mais de uma combinação de linhas do OFX fecha este valor">ambígua</Chip>}
          {section === 'new' && proposal.futureInstallments > 0 && (
            <Chip tone="blue">+{countLabel(proposal.futureInstallments, 'parcela futura', 'parcelas futuras')}</Chip>
          )}
          {group.missingRefs.length > 0 && (
            <Chip tone="orange" title={group.missingRefs.join('\n')}>
              {countLabel(group.missingRefs.length, 'linha ausente', 'linhas ausentes')}
            </Chip>
          )}
        </div>
        <LineList lines={group.lines} currency={currency} />
      </td>
      {twoColumns && (
        <>
          <td className={`${TD_CLS} min-w-[180px]`}>
            {proposal.target ? <TargetCell target={proposal.target} currency={currency} /> : <span className={MUTED_CLS}>—</span>}
          </td>
          <td className={`${TD_CLS} min-w-[180px]`}>
            {proposal.result ? <ResultCell result={proposal.result} /> : <span className={MUTED_CLS}>—</span>}
          </td>
        </>
      )}
      {section === 'reversal' && <td className={`${TD_CLS} whitespace-nowrap`}>{money(group.netCents, currency)}</td>}
      {section === 'other' && <td className={`${TD_CLS} ${MUTED_CLS}`}>{proposal.kind}</td>}
    </tr>
  );
};

const SECTION_HEADERS: Record<CardOfxGroupSection, string[]> = {
  matched: ['No OFX', 'Na planilha', 'Como fica'],
  futures: ['No OFX', 'Parcela futura', 'Como fica'],
  new: ['No OFX'],
  reversal: ['No OFX', 'Soma'],
  other: ['No OFX', 'Tipo'],
};

interface GroupSectionProps {
  id: string; title: string; groups: CardOfxGroupView[]; selection: CardOfxSelection; disabled: boolean; currency: CurrencyCode;
  hint?: ReactNode; bulk?: { selectAll: string; clear: string }; children?: ReactNode;
  onToggle: (group: CardOfxGroupView, checked: boolean) => void; onSelectAll: (groups: CardOfxGroupView[]) => void;
  onClear: (groups: CardOfxGroupView[]) => void;
}

/** One section of proposals: a checkbox per group (a group goes in with all of its OFX lines). */
const GroupSection = ({
  id, title, groups, selection, disabled, currency, hint, bulk, children, onToggle, onSelectAll, onClear,
}: GroupSectionProps) => {
  if (groups.length === 0) return null;
  const section = groups[0].section;
  const ticked = groups.filter((group) => isGroupSelected(selection, group)).length;
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-2 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h4 id={`${id}-title`} className={H4_CLS}>{title} ({groups.length})</h4>
          {section !== 'other' && <span className={`text-xs ${MUTED_CLS}`}>{countLabel(ticked, 'marcada', 'marcadas')}</span>}
        </div>
        {bulk && (
          <div className="flex gap-3">
            <button type="button" onClick={() => onSelectAll(groups)} disabled={disabled} className={LINK_CLS}>{bulk.selectAll}</button>
            <button type="button" onClick={() => onClear(groups)} disabled={disabled} className={LINK_CLS}>{bulk.clear}</button>
          </div>
        )}
      </div>
      {hint && <p className={`text-xs ${MUTED_CLS}`}>{hint}</p>}
      {children}
      <div className={TABLE_WRAP_CLS}>
        <table className="w-full text-sm">
          <thead>
            <tr className={THEAD_ROW_CLS}>
              <th className={`${TH_CLS} w-8`} aria-label="Incluir" />
              {SECTION_HEADERS[section].map((label) => <th key={label} className={TH_CLS}>{label}</th>)}
            </tr>
          </thead>
          <tbody className={TBODY_CLS}>
            {groups.map((group, index) => (
              <GroupRow key={`${index}-${group.proposal.group}`} group={group} checked={isGroupSelected(selection, group)} disabled={disabled}
                currency={currency} onToggle={onToggle} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

/** The new lines came unticked because the month already has sheet rows: what is left on each side. */
const NewLinesNoticeBox = ({ notice, currency }: { notice: CardOfxNewLinesNotice; currency: CurrencyCode }) => (
  <div role="note" className={NOTICE_BOX_CLS}>
    <p className="font-medium">Este mês já tem linhas da planilha: as novas vieram desmarcadas.</p>
    <p>
      Sobram no OFX {countLabel(notice.ofxLines, 'lançamento', 'lançamentos')} ({money(notice.ofxCents, currency)}); na planilha, sem par no
      OFX, {countLabel(notice.sheetRows, 'transação', 'transações')} ({money(notice.sheetCents, currency)}). Marque as novas que faltam no
      Recta antes de confirmar.
    </p>
  </div>
);

interface CategoryTableProps {
  entries: MaxFinCategoryMapEntry[]; choices: Record<string, MaxFinCategoryTargetInput>; customCategories: Category[];
  disabled: boolean; onChange: (entry: MaxFinCategoryMapEntry, value: string) => void;
}

/** Category of the new lines, per merchant (the choices are remembered with the monthly sheet ones). */
const CategoryTable = ({ entries, choices, customCategories, disabled, onChange }: CategoryTableProps) => {
  if (entries.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-gray-700 dark:text-gray-200 mb-1">Categoria das novas, por comerciante</p>
      <div className={TABLE_WRAP_CLS}>
        <table className="w-full text-sm">
          <thead>
            <tr className={THEAD_ROW_CLS}>
              <th className={TH_CLS}>Comerciante</th>
              <th className={TH_CLS}>Tipo</th>
              <th className={`${TH_CLS} text-right`}>Linhas</th>
              <th className={TH_CLS}>Categoria no Recta</th>
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
                  <td className={`${TD_CLS} max-w-[240px] truncate`} title={entry.key || undefined}>
                    {entry.key || <span className={`italic ${MUTED_CLS}`}>(sem comerciante)</span>}
                  </td>
                  <td className={`${TD_CLS} whitespace-nowrap ${MUTED_CLS}`}>{isIncome ? 'Crédito' : 'Despesa'}</td>
                  <td className={`${TD_CLS} text-right`}>{entry.count}</td>
                  <td className={TD_CLS}>
                    <select value={value} disabled={disabled} aria-label={`Categoria para ${entry.key || 'sem comerciante'}`} className={SELECT_SM_CLS}
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

/** Lines already in Recta: collapsed (a re-import lists every line here). */
const ReconciledSection = ({ lines, currency }: { lines: CardOfxLine[]; currency: CurrencyCode }) => {
  const [expanded, setExpanded] = useState(false);
  if (lines.length === 0) return null;
  const Icon = expanded ? ChevronDown : ChevronRight;
  return (
    <section className="space-y-2 min-w-0">
      <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
        className={`inline-flex items-center gap-1 ${H4_CLS} hover:opacity-70`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
        Já conciliadas ({lines.length})
      </button>
      <p className={`text-xs ${MUTED_CLS}`}>Já estão no Recta: nada muda nelas.</p>
      {expanded && <div className="rounded-md border border-gray-200 dark:border-gray-800 p-3 text-sm"><LineList lines={lines} currency={currency} /></div>}
    </section>
  );
};

const SheetOnlySection = ({ rows, currency }: { rows: CardOfxSheetOnly[]; currency: CurrencyCode }) => {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="card-ofx-sheet-only-title" className="space-y-2 min-w-0">
      <h4 id="card-ofx-sheet-only-title" className={H4_CLS}>Na planilha, mas não na fatura ({rows.length})</h4>
      <p className={`text-xs ${MUTED_CLS}`}>Só aviso: ficam como estão (nada é apagado). Podem ser de outra fatura ou ter sido lançadas à mão.</p>
      <div className={TABLE_WRAP_CLS}>
        <table className="w-full text-sm">
          <thead>
            <tr className={THEAD_ROW_CLS}>
              <th className={TH_CLS}>Data</th>
              <th className={TH_CLS}>Descrição</th>
              <th className={`${TH_CLS} text-right`}>Valor</th>
            </tr>
          </thead>
          <tbody className={TBODY_CLS}>
            {rows.map((row, index) => (
              <tr key={`${index}-${row.transactionId}`}>
                <td className={`${TD_CLS} whitespace-nowrap ${MUTED_CLS}`}>{fmtDate(row.date)}</td>
                <td className={`${TD_CLS} max-w-[320px] truncate`} title={row.description}>{row.description}</td>
                <td className={`${TD_CLS} whitespace-nowrap text-right`}>{signedAmount(row.amount, row.type, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

interface PaymentBlockProps {
  payment: CardOfxPayment; choice: CardOfxPaymentChoice; accounts: Account[]; problem: string | null; disabled: boolean;
  currency: CurrencyCode; accountName: (id: string) => string; onChange: (patch: Partial<CardOfxPaymentChoice>) => void;
}

/** The "Pagamento recebido" that pays the previous invoice: adjust the recorded payment, or create it. */
const PaymentBlock = ({ payment, choice, accounts, problem, disabled, currency, accountName, onChange }: PaymentBlockProps) => {
  const month = monthKeyLabel(payment.invoiceMonthKey);
  const amount = formatCurrency(payment.amount, currency);
  const when = fmtDate(payment.date);
  const { recorded } = payment;
  const sources = paymentSourceAccounts(accounts);
  const actionable = isPaymentActionable(payment);
  const needsSource = paymentNeedsSource(payment);
  return (
    <section aria-labelledby="card-ofx-payment-title" className={BOX_CLS}>
      <h4 id="card-ofx-payment-title" className={H4_CLS}>Pagamento da fatura de {month}</h4>
      <p className="text-sm text-gray-900 dark:text-white">No OFX: <strong className="font-medium">{amount}</strong> em {when} (Pagamento recebido).</p>
      {recorded && (
        <p className={`text-sm ${MUTED_CLS}`}>
          Registrado no Recta: {formatCurrency(recorded.amount, currency)} em {fmtDate(recorded.date)}
          {recorded.sourceAccountId ? `, da conta ${accountName(recorded.sourceAccountId)}` : ''}.
        </p>
      )}
      {payment.proposal === 'ok' && <p className={`text-sm ${MUTED_CLS}`}>Mesmo valor e data: nada a fazer.</p>}
      {actionable && (
        <>
          {payment.proposal === 'create' && !recorded && <p className={`text-sm ${MUTED_CLS}`}>Nenhum pagamento registrado para essa fatura.</p>}
          <label htmlFor="card-ofx-payment" className="inline-flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100 cursor-pointer">
            <input id="card-ofx-payment" type="checkbox" checked={choice.apply} disabled={disabled} className={CHECKBOX_CLS}
              onChange={(e) => onChange({ apply: e.target.checked })} />
            {payment.proposal === 'adjust' && recorded
              ? `Substituir o pagamento registrado (${formatCurrency(recorded.amount, currency)} em ${fmtDate(recorded.date)}) por um novo de ${amount} em ${when}`
              : `Registrar o pagamento de ${amount} em ${when}`}
          </label>
          {payment.proposal === 'adjust' && (
            <p className={`text-xs ${MUTED_CLS}`}>
              O pagamento atual é desfeito e registrado de novo; se houver mais de um pagamento registrado para essa fatura, eles viram um só.
            </p>
          )}
          {needsSource && choice.apply && (
            <div className="max-w-sm">
              {payment.proposal === 'adjust' && (
                <p className={`mb-1 text-xs ${MUTED_CLS}`}>O pagamento registrado não tem conta de origem: escolha de qual conta ele sai.</p>
              )}
              <label htmlFor="card-ofx-payment-source" className={LABEL_CLS}>Conta de origem</label>
              <select id="card-ofx-payment-source" value={choice.sourceAccountId} disabled={disabled} className={INPUT_CLS}
                aria-describedby={problem ? 'card-ofx-payment-problem' : undefined} onChange={(e) => onChange({ sourceAccountId: e.target.value })}>
                <option value="">Selecione a conta</option>
                {sources.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
              {problem && <p id="card-ofx-payment-problem" className="mt-1 text-xs text-red-600 dark:text-red-400">{problem}</p>}
            </div>
          )}
          {payment.proposal === 'adjust' && !needsSource && (
            <p className={`text-xs ${MUTED_CLS}`}>O novo pagamento sai da mesma conta de origem.</p>
          )}
        </>
      )}
      {!isPaymentActionable(payment) && payment.proposal !== 'ok' && (
        <p className={`text-sm ${MUTED_CLS}`}>Proposta de pagamento desconhecida: nada será feito com ele.</p>
      )}
    </section>
  );
};

/** Payment lines other than the one of the previous invoice: paired with a sheet credit, or information only. */
const AdvancePayments = ({ lines, paired, currency }: { lines: CardOfxLine[]; paired: CardOfxLine[]; currency: CurrencyCode }) => {
  if (lines.length === 0 && paired.length === 0) return null;
  return (
    <section aria-labelledby="card-ofx-advance-title" className={BOX_CLS}>
      <h4 id="card-ofx-advance-title" className={H4_CLS}>Pagamentos antecipados ({lines.length + paired.length})</h4>
      {paired.length > 0 && (
        <p className={`text-xs ${MUTED_CLS}`}>
          {countLabel(paired.length, 'pareado com um crédito da planilha', 'pareados com créditos da planilha')}: em “Pareadas com a planilha”.
        </p>
      )}
      {lines.length > 0 && (
        <>
          <p className={`text-xs ${MUTED_CLS}`}>Sem par na planilha: ficam só como informação, não são importados.</p>
          <div className="text-sm"><LineList lines={lines} currency={currency} /></div>
        </>
      )}
    </section>
  );
};

const OrphanLines = ({ lines, currency }: { lines: CardOfxLine[]; currency: CurrencyCode }) => {
  if (lines.length === 0) return null;
  return (
    <section aria-labelledby="card-ofx-orphans-title" className={BOX_CLS}>
      <h4 id="card-ofx-orphans-title" className={H4_CLS}>Outras linhas do OFX ({lines.length})</h4>
      <p className={`text-xs ${MUTED_CLS}`}>Sem proposta do servidor: não são importadas.</p>
      <div className="text-sm"><LineList lines={lines} currency={currency} /></div>
    </section>
  );
};

interface PreviewFooterProps {
  built: CardOfxBuiltConfirm; blocker: CardOfxBlocker | null; payment: CardOfxPayment | null; busy: boolean; isConfirming: boolean;
  confirmError: string | null; currency: CurrencyCode; accountName: (id: string) => string;
  onBack: () => void; onConfirm: () => void; onRefresh: () => void;
}

/** Numbers come from buildCardOfxConfirm, the same groups the request is built from. */
const PreviewFooter = ({
  built, blocker, payment, busy, isConfirming, confirmError, currency, accountName, onBack, onConfirm, onRefresh,
}: PreviewFooterProps) => {
  const { totals } = built;
  // After a failed confirm the preview is stale: nothing about the payment is promised until it is refreshed.
  const stale = blocker?.code === 'needs-refresh';
  const parts: string[] = [];
  if (totals.enriched.groups > 0) parts.push(`${totals.enriched.groups} a enriquecer`);
  if (totals.consumed.groups > 0) {
    parts.push(`${countLabel(totals.consumed.groups, 'parcela futura', 'parcelas futuras')} a consumir`);
  }
  if (totals.created.groups > 0) parts.push(`${countLabel(totals.created.lines, 'nova', 'novas')} (${money(totals.created.cents, currency)})`);
  if (totals.reversal.groups > 0) parts.push(countLabel(totals.reversal.groups, 'par compra/estorno', 'pares compra/estorno'));
  // Exactly what the request carries: the source account appears only when the payment needs one.
  const sourceId = built.payload.payment?.sourceAccountId ?? '';
  const sourceText = sourceId ? `, da conta ${accountName(sourceId)}` : '';
  const promise = payment && totals.payment.action
    ? totals.payment.action === 'adjust'
      ? `O pagamento registrado da fatura de ${monthKeyLabel(payment.invoiceMonthKey)} será desfeito e registrado de novo: ${formatCurrency(payment.amount, currency)} em ${fmtDate(payment.date)}${sourceText}.`
      : `O pagamento da fatura de ${monthKeyLabel(payment.invoiceMonthKey)} será registrado: ${formatCurrency(payment.amount, currency)} em ${fmtDate(payment.date)}${sourceText}.`
    : null;
  return (
    <div className="pt-3 border-t border-gray-200 dark:border-gray-800 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 text-sm min-w-0">
          <p className="text-gray-900 dark:text-white">
            {countLabel(totals.groups, 'proposta marcada', 'propostas marcadas')}
            {parts.length > 0 && <> · {parts.join(' · ')}</>}
          </p>
          {promise && !stale && <p className={MUTED_CLS}>{promise}</p>}
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={onBack} disabled={busy} className={BTN_SECONDARY}>
            <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
            Voltar
          </button>
          <button type="button" onClick={onConfirm} disabled={busy || blocker !== null} title={blocker?.message}
            aria-describedby={blocker ? BLOCKER_ID : undefined} className={BTN_PRIMARY}>
            {isConfirming ? 'Importando…' : 'Confirmar importação'}
          </button>
        </div>
      </div>
      {blocker && (
        <p id={BLOCKER_ID}
          className={`text-xs ${blocker.code === 'none-selected' || blocker.code === 'nothing-to-do' ? MUTED_CLS : 'text-red-600 dark:text-red-400'}`}>
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
// Step 3: result
// ---------------------------------------------------------------------------

const ResultStep = ({ result, lines, onClose }: { result: CardOfxConfirmResponse; lines: string[]; onClose: () => void }) => {
  const warnings = result.warnings ?? [];
  return (
    <div className="space-y-4 min-w-0">
      <div>
        <h4 className={H4_CLS}>Importação concluída</h4>
        {lines.length > 0 ? (
          <ul className="mt-1 text-sm text-gray-900 dark:text-white list-disc list-inside space-y-1">
            {lines.map((line, index) => <li key={index}>{line}</li>)}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-gray-900 dark:text-white">Nada foi alterado.</p>
        )}
      </div>
      {warnings.length > 0 && (
        <div>
          <h4 className={`${H4_CLS} mb-1`}>{countLabel(warnings.length, 'aviso', 'avisos')}</h4>
          <ul className={`${WARN_BOX_CLS} max-h-64 overflow-y-auto`}>
            {warnings.map((warning, index) => <li key={index}>{warning}</li>)}
          </ul>
        </div>
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

interface ImportCardOfxDialogProps {
  open: boolean;
  onClose: () => void;
  /** Credit card account the invoice belongs to. */
  accountId: string;
  /** Defaults to the household from useDefaultHousehold (same as the sibling dialogs). */
  householdId?: string;
  /** File handed over by the generic import: the preview starts as soon as the dialog opens. */
  initialFile?: File | null;
}

const ImportCardOfxDialog = ({ open, onClose, accountId, householdId: householdIdProp, initialFile = null }: ImportCardOfxDialogProps) => {
  const { householdId: defaultHouseholdId } = useDefaultHousehold();
  const householdId = householdIdProp ?? defaultHouseholdId;
  const { success, error: showError, showToast } = useToastContext();
  const { baseCurrency } = useCurrency();

  const { data: accountsData } = useAccounts({ householdId: householdId ?? '' });
  const accounts = useMemo(() => accountsData?.accounts ?? [], [accountsData]);
  const { data: categoriesData } = useCategories({ householdId });
  const customCategories = useMemo(() => (categoriesData ?? []).filter((c) => !c.isSystem), [categoriesData]);
  const customIdsByType = useMemo<Record<MaxFinTransactionType, ReadonlySet<string>>>(() => ({
    INCOME: new Set(customCategories.filter((c) => c.type === CategoryType.INCOME).map((c) => c.id)),
    EXPENSE: new Set(customCategories.filter((c) => c.type === CategoryType.EXPENSE).map((c) => c.id)),
  }), [customCategories]);

  const previewMutation = useCardOfxPreview();
  const confirmMutation = useCardOfxConfirm();
  const isPreviewing = previewMutation.isPending;
  const isConfirming = confirmMutation.isPending;

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CardOfxPreviewResponse | null>(null);
  // The month applied with "Reprocessar"; monthInput is what the month field shows.
  const [monthOverride, setMonthOverride] = useState<MaxFinMonth | null>(null);
  const [monthInput, setMonthInput] = useState('');
  const [selection, setSelection] = useState<CardOfxSelection>({});
  const [paymentChoice, setPaymentChoice] = useState<CardOfxPaymentChoice>(() => defaultPaymentChoice(null));
  const [categoryChoices, setCategoryChoices] = useState<Record<string, MaxFinCategoryTargetInput>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [result, setResult] = useState<CardOfxConfirmResponse | null>(null);
  // Last applied preview: the next one keeps the choices of the groups that did not change.
  const lastPreviewRef = useRef<CardOfxPreviewResponse | null>(null);
  // Latest-wins guard: a preview run only touches state while it is the newest run of a mounted dialog.
  const seqRef = useRef(0);
  const mountedRef = useRef(true);
  // Synchronous twin of isConfirming: guards closing and a second confirm before React re-renders.
  const confirmingRef = useRef(false);
  // Latest custom categories, read after awaits so a refetch that lands mid-preview is not lost.
  const customIdsRef = useRef(customIdsByType);
  // Latest runPreview, for the preview started by the open effect.
  const runPreviewRef = useRef<RunPreview>(async () => 'error');

  useEffect(() => {
    customIdsRef.current = customIdsByType;
  }, [customIdsByType]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset everything whenever the dialog opens; a file handed over by the generic import starts the preview.
  // Closing invalidates any preview still in flight.
  useEffect(() => {
    if (!open) return;
    const handedOver = initialFile ? validateCardOfxFile(initialFile) : null;
    setFile(initialFile && !handedOver ? initialFile : null);
    setPreview(null);
    setMonthOverride(null);
    setMonthInput('');
    setSelection({});
    setPaymentChoice(defaultPaymentChoice(null));
    setCategoryChoices({});
    setFormError(handedOver);
    setConfirmError(null);
    setResult(null);
    lastPreviewRef.current = null;
    if (initialFile && !handedOver) void runPreviewRef.current(initialFile);
    return () => {
      seqRef.current += 1;
    };
  }, [open, initialFile]);

  // Body scroll lock (same pattern as the sibling dialogs).
  useEffect(() => {
    if (!open) return;
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalStyle;
    };
  }, [open]);

  // ESC closes, except while a confirm request is in flight.
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmingRef.current) onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [open, onClose]);

  // What each category select shows and the request sends: the choice while it is valid, else the suggestion.
  const effectiveChoices = useMemo(
    () => (preview ? resolveCategoryChoices(preview.categoryMap ?? [], categoryChoices, {}, customIdsByType) : {}),
    [preview, categoryChoices, customIdsByType],
  );
  // One source for the numbers on screen and the request.
  const built = useMemo(
    () => (preview ? buildCardOfxConfirm(preview, selection, effectiveChoices, paymentChoice, { accounts, customIdsByType }) : null),
    [preview, selection, effectiveChoices, paymentChoice, accounts, customIdsByType],
  );

  if (!open) return null;

  const isRefreshing = isPreviewing && preview !== null;
  const busy = isRefreshing || isConfirming;
  // A failed confirm may have applied part of the proposals: the preview on screen is stale until it runs again.
  const blocker = preview ? cardOfxConfirmBlocker(built, confirmError !== null) : null;
  const accountName = (id: string): string => accounts.find((a) => a.id === id)?.name ?? '—';
  const cardName = accountName(preview?.accountId ?? accountId);
  const sections = built?.sections ?? null;
  const notice = sections ? newLinesNotice(sections) : null;
  // Closing is blocked while the confirm request is in flight: the import must not be abandoned halfway.
  const requestClose = () => {
    if (!confirmingRef.current && !isConfirming) onClose();
  };

  /** Runs the preview and merges the result into the state, unless a newer run or a close got ahead of it. */
  const runPreview: RunPreview = async (target, opts) => {
    seqRef.current += 1;
    const run = seqRef.current;
    const isCurrent = () => mountedRef.current && run === seqRef.current;
    try {
      const data = await previewMutation.mutateAsync({ accountId, options: opts, file: target });
      if (!isCurrent()) return 'stale';
      const prev = lastPreviewRef.current;
      lastPreviewRef.current = data;
      const groups = buildCardOfxSections(data).groups;
      setPreview(data);
      setConfirmError(null);
      setSelection((current) => reconcileGroupSelection(prev?.proposals ?? [], current, groups));
      setPaymentChoice((current) => reconcilePaymentChoice(prev?.payment ?? null, current, data.payment));
      setCategoryChoices((current) =>
        resolveCategoryChoices(data.categoryMap ?? [], current, loadSavedCategoryChoices(data.householdId || householdId), customIdsRef.current));
      setMonthInput(monthToInputValue(data.month));
      return 'ok';
    } catch (err: unknown) {
      if (!isCurrent()) return 'stale';
      showError(getErrorMessage(err, 'Não foi possível pré-visualizar a fatura.'));
      return 'error';
    }
  };
  runPreviewRef.current = runPreview;

  /** Resolves to whether the file was accepted; a rejected file is also cleared from the input. */
  const handleFileChange = (selectedFile: File | null): boolean => {
    const problem = selectedFile ? validateCardOfxFile(selectedFile) : null;
    setFormError(problem);
    // A different file means different lines: forget the old preview and choices.
    seqRef.current += 1;
    setFile(problem ? null : selectedFile);
    setPreview(null);
    setSelection({});
    setPaymentChoice(defaultPaymentChoice(null));
    setMonthOverride(null);
    setMonthInput('');
    setConfirmError(null);
    lastPreviewRef.current = null;
    return problem === null;
  };

  const handlePreview = () => {
    setFormError(null);
    if (!householdId) return setFormError('Nenhuma household selecionada.');
    if (!file) return setFormError('Selecione o arquivo .ofx da fatura.');
    void runPreview(file, monthOverride ? { monthOverride } : undefined);
  };

  // A different invoice month re-runs the preview (latest wins: the field stays usable while it runs).
  const handleApplyMonth = async () => {
    const month = parseMonthInput(monthInput);
    if (!month || !file) return;
    if ((await runPreview(file, { monthOverride: month })) === 'ok') setMonthOverride(month);
  };

  // After a failed confirm: run the preview again; whatever was applied comes back as reconciled.
  const handleRefresh = async () => {
    if (!file) return;
    await runPreview(file, monthOverride ? { monthOverride } : undefined);
  };

  const handleToggleGroup = (group: CardOfxGroupView, checked: boolean) => setSelection((prev) => setGroupSelected(prev, group, checked));
  const handleSelectAll = (groups: CardOfxGroupView[]) => setSelection((prev) => selectAllGroups(prev, groups));
  const handleClear = (groups: CardOfxGroupView[]) => setSelection((prev) => clearGroups(prev, groups));
  const handlePaymentChange = (patch: Partial<CardOfxPaymentChoice>) => setPaymentChoice((prev) => ({ ...prev, ...patch }));

  const handleCategoryChange = (entry: MaxFinCategoryMapEntry, value: string) => {
    const key = categoryChoiceKey(entry.type, entry.key);
    const target = selectValueToTarget(value, entry.key);
    setCategoryChoices((prev) => ({ ...prev, [key]: target }));
    saveCategoryChoices(preview?.householdId || householdId, { [key]: target });
  };

  const handleBack = () => {
    setPreview(null);
    setFormError(null);
    setConfirmError(null);
  };

  const handleConfirm = async () => {
    if (!built || blocker || isConfirming || confirmingRef.current) return;
    confirmingRef.current = true;
    try {
      const data = await confirmMutation.mutateAsync(built.payload);
      success(buildCardOfxSummary(data, (value) => formatCurrency(value, baseCurrency)));
      if (mountedRef.current) setResult(data);
    } catch (err: unknown) {
      const message = cardOfxFailureMessage(getErrorMessage(err, 'Não foi possível confirmar a importação.'));
      showToast(message, 'error', ERROR_TOAST_MS);
      if (mountedRef.current) setConfirmError(message);
    } finally {
      confirmingRef.current = false;
    }
  };

  const groupSectionProps = {
    selection, disabled: busy, currency: baseCurrency, onToggle: handleToggleGroup, onSelectAll: handleSelectAll, onClear: handleClear,
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black/40 animate-fade-in transition-opacity duration-300 ease-out" onClick={requestClose} aria-hidden="true" />
      <div className="flex min-h-full items-center justify-center p-4">
        <div role="dialog" aria-modal="true" aria-labelledby="card-ofx-dialog-title"
          className={`relative w-full ${preview && !result ? 'max-w-5xl' : 'max-w-2xl'} p-6 border rounded-lg bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800 max-h-[90vh] overflow-y-auto min-w-0 animate-slide-in-bottom`}>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center min-w-0">
              <Upload className="h-5 w-5 text-gray-500 dark:text-gray-400 mr-3 flex-shrink-0" aria-hidden="true" />
              <h3 id="card-ofx-dialog-title" className="text-lg font-light tracking-tight text-gray-900 dark:text-white truncate">
                Importar fatura do cartão (OFX)
              </h3>
            </div>
            <button type="button" onClick={requestClose} disabled={isConfirming} aria-label="Fechar modal"
              className="text-gray-400 dark:text-gray-500 hover:opacity-70 transition-opacity p-1 disabled:opacity-40 disabled:cursor-not-allowed">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {formError && <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">{formError}</p>}

          {result ? (
            <ResultStep result={result} lines={cardOfxResultLines(result, (value) => formatCurrency(value, baseCurrency), fmtDate)}
              onClose={requestClose} />
          ) : preview && built && sections ? (
            <div className="space-y-5 min-w-0">
              <PreviewHeader preview={preview} cardName={cardName} totals={built.totals} monthInput={monthInput} isRefreshing={isRefreshing}
                monthDisabled={isConfirming} currency={baseCurrency} onMonthInputChange={setMonthInput}
                onApplyMonth={() => void handleApplyMonth()} />

              {preview.warnings.length > 0 && (
                <ul className={WARN_BOX_CLS}>
                  {preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                </ul>
              )}

              {/* Kept visible (dimmed) while the preview is being recomputed. */}
              <div className={`space-y-6 min-w-0 transition-opacity ${isRefreshing ? 'opacity-60' : ''}`} aria-busy={isRefreshing}>
                {sections.groups.length === 0 && (
                  <p className={`text-sm ${MUTED_CLS}`}>Nenhuma proposta: as linhas do OFX já estão conciliadas.</p>
                )}
                <ReconciledSection lines={sections.reconciled} currency={baseCurrency} />
                <GroupSection id="card-ofx-matched" title="Pareadas com a planilha" groups={sections.matched} {...groupSectionProps}
                  hint="A linha da planilha fica, com categoria, notas e marcações; “Como fica” mostra a data e a descrição que ela recebe."
                  bulk={{ selectAll: 'Marcar todas as pareadas', clear: 'Desmarcar todas as pareadas' }} />
                <GroupSection id="card-ofx-futures" title="Parcelas futuras consumidas" groups={sections.futures} {...groupSectionProps}
                  hint="A parcela futura já registrada passa a ser a compra real (data, descrição e pagamento do banco)."
                  bulk={{ selectAll: 'Marcar todas as futuras', clear: 'Desmarcar todas as futuras' }} />
                <GroupSection id="card-ofx-new" title="Novas" groups={sections.created} {...groupSectionProps}
                  hint="Compras do OFX sem par: viram transações no cartão, com as parcelas futuras quando houver."
                  bulk={{ selectAll: 'Marcar todas as novas', clear: 'Desmarcar todas as novas' }}>
                  {notice && <NewLinesNoticeBox notice={notice} currency={baseCurrency} />}
                  <CategoryTable entries={preview.categoryMap ?? []} choices={effectiveChoices} customCategories={customCategories} disabled={busy}
                    onChange={handleCategoryChange} />
                </GroupSection>
                <GroupSection id="card-ofx-reversal" title="Compra e estorno" groups={sections.reversal} {...groupSectionProps}
                  hint="Compra estornada na mesma fatura (soma zero). A marcação inicial é a sugestão do servidor; marque para registrar as duas."
                  bulk={{ selectAll: 'Marcar todos os pares', clear: 'Desmarcar todos os pares' }} />
                <GroupSection id="card-ofx-other" title="Propostas desconhecidas" groups={sections.other} {...groupSectionProps}
                  hint="Tipo de proposta que esta versão não conhece: não é enviada." />
                <SheetOnlySection rows={sections.sheetOnly} currency={baseCurrency} />
                {preview.payment && (
                  <PaymentBlock payment={preview.payment} choice={paymentChoice} accounts={accounts} problem={built.paymentProblem} disabled={busy}
                    currency={baseCurrency} accountName={accountName} onChange={handlePaymentChange} />
                )}
                <AdvancePayments lines={sections.advancePayments} paired={sections.pairedAdvancePayments} currency={baseCurrency} />
                <OrphanLines lines={sections.orphans} currency={baseCurrency} />
              </div>

              <PreviewFooter built={built} blocker={blocker} payment={preview.payment} busy={busy} isConfirming={isConfirming}
                confirmError={confirmError} currency={baseCurrency} accountName={accountName}
                onBack={handleBack} onConfirm={() => void handleConfirm()} onRefresh={() => void handleRefresh()} />
            </div>
          ) : (
            <FileStep cardName={cardName} file={file} isPreviewing={isPreviewing} canPreview={!isPreviewing && !!file && !!householdId}
              onFileChange={handleFileChange} onPreview={handlePreview} onCancel={requestClose} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ImportCardOfxDialog;

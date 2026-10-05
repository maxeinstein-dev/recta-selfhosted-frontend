import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, Repeat } from 'lucide-react';
import { useApplyDetectedRecurring, useDetectRecurring } from '../hooks/api/useDetectRecurring';
import type { RecurringApplyResult, RecurringCandidate, RecurringDetectSkipped } from '../hooks/api/useDetectRecurring';
import { useToastContext } from '../context/ToastContext';
import { useCurrency } from '../context/CurrencyContext';
import { formatCurrency } from '../utils/format';
import {
  EMPTY_DETECT_MESSAGE, KIND_LABEL, allFollowLast, amountRangeText, applyFailureMessage, applyResultLines, applySummary, buildDetectApply, confidenceText,
  defaultDraft, detectBlocker, groupCandidates, kindFullySelected, monthsSeenText, reconcileDraft, resolveCandidate, setAllFollowLast, setAmountText,
  setDayText, setDescriptionText, setFollowLast, setKindSelected, setSelected, skippedLines,
} from '../utils/recurringDetect';
import type { DetectDraft } from '../utils/recurringDetect';
import { FOLLOW_LAST_HELP, FOLLOW_LAST_LABEL } from '../utils/recurringFollow';
import {
  BTN_PRIMARY, BTN_SECONDARY, BTN_SECONDARY_SM, CHECKBOX_CLS, Chip, DialogShell, ERROR_CLS, ERROR_TOAST_MS, H4_CLS, INPUT_SM_CLS, LINK_CLS, MUTED_CLS,
  TABLE_WRAP_CLS, TBODY_CLS, TD_CLS, TH_CLS, THEAD_ROW_CLS, WARN_BOX_CLS, fmtDate, getErrorMessage,
} from './people/ui';

const BLOCKER_ID = 'detect-recurring-blocker';
const EMPTY_DRAFT: DetectDraft = { selected: {}, edits: {} };
/** The server defaults (3 months in a 12 month window): nothing is asked of the user before detecting. */
const DETECT_PARAMS: { minMonths?: number; months?: number } = {};

interface DetectRecurringDialogProps {
  open: boolean;
  onClose: () => void;
  householdId: string | undefined;
  /** EDITOR or more. A viewer can read the candidates, but sees no way to choose, adjust or create. */
  canWrite: boolean;
}

/** "Detectar recorrentes": proposes the recurring expenses found in the history; one apply creates the ones chosen. */
const DetectRecurringDialog = ({ open, onClose, householdId, canWrite }: DetectRecurringDialogProps) => {
  const { success, showToast } = useToastContext();
  const { baseCurrency } = useCurrency();
  const money = (cents: number): string => formatCurrency(cents / 100, baseCurrency);
  const reais = (value: number): string => formatCurrency(value, baseCurrency);

  const detectMutation = useDetectRecurring();
  const applyMutation = useApplyDetectedRecurring();
  const applying = applyMutation.isPending;

  const [candidates, setCandidates] = useState<RecurringCandidate[] | null>(null);
  const [skipped, setSkipped] = useState<RecurringDetectSkipped | null>(null);
  const [draft, setDraft] = useState<DetectDraft>(EMPTY_DRAFT);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [result, setResult] = useState<RecurringApplyResult | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const candidatesRef = useRef<RecurringCandidate[] | null>(null);
  // Latest-wins: a detection only touches state while it is the newest run of a mounted, open dialog.
  const seqRef = useRef(0);
  const mountedRef = useRef(true);
  // Synchronous twin of `applying`: a second click before React re-renders must not send a second request.
  const applyingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runDetect = async () => {
    if (!householdId) return;
    seqRef.current += 1;
    const run = seqRef.current;
    const isCurrent = () => mountedRef.current && run === seqRef.current;
    setDetecting(true);
    try {
      const data = await detectMutation.mutateAsync({ householdId, ...DETECT_PARAMS });
      if (!isCurrent()) return;
      const next = data.candidates ?? [];
      const prev = candidatesRef.current;
      candidatesRef.current = next;
      setCandidates(next);
      setSkipped(data.skipped ?? null);
      setDraft((current) => (prev ? reconcileDraft(current, prev, next) : defaultDraft(next)));
      setDetectError(null);
      // A new list is a fresh start for the failed apply: the stale list is gone.
      setApplyError(null);
    } catch (err: unknown) {
      if (!isCurrent()) return;
      const message = getErrorMessage(err, 'Não foi possível detectar as recorrentes.');
      setDetectError(message);
      showToast(message, 'error', ERROR_TOAST_MS);
    } finally {
      if (isCurrent()) setDetecting(false);
    }
  };

  // Every opening starts over and detects at once.
  useEffect(() => {
    if (!open) return;
    candidatesRef.current = null;
    setCandidates(null);
    setSkipped(null);
    setDraft(EMPTY_DRAFT);
    setDetectError(null);
    setApplyError(null);
    setResult(null);
    setExpanded({});
    void runDetect();
    return () => {
      seqRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, householdId]);

  const list = useMemo(() => candidates ?? [], [candidates]);
  const groups = useMemo(() => groupCandidates(list), [list]);
  const built = useMemo(
    () => (candidates && householdId ? buildDetectApply(householdId, candidates, draft, DETECT_PARAMS) : null),
    [candidates, householdId, draft],
  );
  const blocker = canWrite ? detectBlocker(built, { needsRefresh: applyError !== null, applying }) : null;

  const handleApply = async () => {
    if (!canWrite || !built || blocker || applying || applyingRef.current) return;
    applyingRef.current = true;
    try {
      const data = await applyMutation.mutateAsync(built.payload);
      success(applySummary(data));
      if (mountedRef.current) setResult(data);
    } catch (err: unknown) {
      const message = applyFailureMessage(getErrorMessage(err, 'Não foi possível criar as recorrências.'), (err as { status?: number } | null)?.status);
      showToast(message, 'error', ERROR_TOAST_MS);
      if (mountedRef.current) setApplyError(message);
    } finally {
      applyingRef.current = false;
    }
  };

  const update = (fn: (d: DetectDraft) => DetectDraft) => setDraft(fn);
  const loading = candidates === null && detecting;
  const reasons = skippedLines(skipped);
  const busy = applying;

  const renderRow = (c: RecurringCandidate) => {
    const r = resolveCandidate(c, draft);
    const range = amountRangeText(c);
    const open = expanded[c.id] === true;
    const rowId = `detect-${c.id}`;
    return (
      <Fragment key={c.id}>
        <tr className={r.selected ? '' : 'bg-gray-50/60 dark:bg-gray-800/20'} data-candidate={c.id}>
          {canWrite && (
            <td className="px-3 py-2 align-top">
              <input type="checkbox" checked={r.selected} disabled={busy} className={CHECKBOX_CLS} aria-label={`Criar recorrência: ${c.description}`}
                onChange={(e) => update((d) => setSelected(d, c.id, e.target.checked))} />
            </td>
          )}
          <td className={`${TD_CLS} min-w-[200px]`}>
            {canWrite ? (
              <>
                <input type="text" value={r.description} disabled={busy} maxLength={600} aria-label={`Descrição de ${c.description}`} aria-invalid={r.errors.description ? true : undefined}
                  className={INPUT_SM_CLS} onChange={(e) => update((d) => setDescriptionText(d, c.id, e.target.value))} />
                {r.errors.description && <p role="alert" className={ERROR_CLS}>{r.errors.description}</p>}
              </>
            ) : (
              <p>{c.description}</p>
            )}
            <button type="button" className={`${LINK_CLS} mt-1 inline-flex items-center gap-1`} aria-expanded={open} aria-controls={`${rowId}-examples`}
              aria-label={`Ver exemplos de ${c.description}`} onClick={() => setExpanded((e) => ({ ...e, [c.id]: !open }))}>
              {open ? <ChevronDown className="h-3 w-3" aria-hidden="true" /> : <ChevronRight className="h-3 w-3" aria-hidden="true" />}
              {c.examples.length === 1 ? '1 exemplo' : `${c.examples.length} exemplos`}
            </button>
          </td>
          <td className={`${TD_CLS} whitespace-nowrap`}>{c.accountName}</td>
          <td className={`${TD_CLS} w-36`}>
            {canWrite ? (
              <>
                <input type="text" inputMode="decimal" value={r.amountText} disabled={busy} aria-label={`Valor de ${c.description}`} aria-invalid={r.errors.amount ? true : undefined}
                  className={INPUT_SM_CLS} onChange={(e) => update((d) => setAmountText(d, c.id, e.target.value))} />
                {r.errors.amount && <p role="alert" className={ERROR_CLS}>{r.errors.amount}</p>}
              </>
            ) : (
              <span className="whitespace-nowrap">{reais(c.amount)}</span>
            )}
            {range && <span className={`block text-xs ${MUTED_CLS}`} data-range>{range}</span>}
          </td>
          <td className={`${TD_CLS} w-20`}>
            {canWrite ? (
              <>
                <input type="text" inputMode="numeric" value={r.dayText} disabled={busy} maxLength={2} aria-label={`Dia do mês de ${c.description}`} aria-invalid={r.errors.day ? true : undefined}
                  className={INPUT_SM_CLS} onChange={(e) => update((d) => setDayText(d, c.id, e.target.value))} />
                {r.errors.day && <p role="alert" className={ERROR_CLS}>{r.errors.day}</p>}
              </>
            ) : (
              <span>{c.dayOfMonth}</span>
            )}
          </td>
          <td className={`${TD_CLS} whitespace-nowrap`}>{monthsSeenText(c)}</td>
          <td className={`${TD_CLS} whitespace-nowrap`}><Chip tone={c.kind === 'bill' ? 'blue' : 'green'}>{c.kind === 'bill' ? 'conta' : 'estável'}</Chip></td>
          <td className={`${TD_CLS} whitespace-nowrap`}>{confidenceText(c.confidence)}</td>
          <td className="px-3 py-2 align-top">
            <input type="checkbox" checked={r.followLast} disabled={busy || !canWrite} className={CHECKBOX_CLS} title={FOLLOW_LAST_HELP}
              aria-label={`${FOLLOW_LAST_LABEL}: ${c.description}`} onChange={(e) => update((d) => setFollowLast(d, c.id, e.target.checked))} />
          </td>
        </tr>
        {open && (
          <tr id={`${rowId}-examples`} data-examples={c.id}>
            <td colSpan={canWrite ? 9 : 8} className="px-3 py-2 bg-gray-50/60 dark:bg-gray-800/20">
              {c.examples.length === 0 ? (
                <p className={`text-xs ${MUTED_CLS}`}>Sem exemplos.</p>
              ) : (
                <ul className="text-xs space-y-1">
                  {c.examples.map((ex) => (
                    <li key={ex.transactionId} className="flex flex-wrap gap-x-3">
                      <span className={MUTED_CLS}>{fmtDate(ex.date)}</span>
                      <span className="min-w-0 truncate max-w-[320px]" title={ex.description}>{ex.description}</span>
                      <span className="whitespace-nowrap">{reais(ex.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  const totals = built?.totals;

  return (
    <DialogShell open={open} onClose={onClose} canClose={!applying} titleId="detect-recurring-title" widthClass={result || !candidates || list.length === 0 ? 'max-w-2xl' : 'max-w-6xl'}
      title="Detectar recorrentes" icon={<Repeat className="h-5 w-5 text-gray-500 dark:text-gray-400 mr-3 flex-shrink-0" aria-hidden="true" />}>
      {result ? (
        <div className="space-y-4 min-w-0" data-step="result">
          <div>
            <h4 className={H4_CLS}>Recorrências criadas</h4>
            {applyResultLines(result).length > 0 ? (
              <ul className="mt-1 text-sm text-gray-900 dark:text-white list-disc list-inside space-y-1">
                {applyResultLines(result).map((line) => <li key={line}>{line}</li>)}
              </ul>
            ) : <p className="mt-1 text-sm text-gray-900 dark:text-white">Nada foi criado.</p>}
          </div>
          {result.warnings.length > 0 && (
            <ul className={`${WARN_BOX_CLS} max-h-64 overflow-y-auto`}>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}
          <div className="flex justify-end pt-2">
            <button type="button" onClick={onClose} autoFocus className={BTN_PRIMARY}>Fechar</button>
          </div>
        </div>
      ) : loading ? (
        <p className={`text-sm ${MUTED_CLS}`} role="status">Procurando despesas recorrentes no histórico…</p>
      ) : candidates === null ? (
        <div className="space-y-4 min-w-0">
          <p role="alert" className={ERROR_CLS}>{detectError ?? 'Não foi possível detectar as recorrentes.'}</p>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={onClose} className={BTN_SECONDARY}>Fechar</button>
            <button type="button" onClick={() => void runDetect()} disabled={!householdId} className={BTN_PRIMARY}>Tentar de novo</button>
          </div>
        </div>
      ) : list.length === 0 ? (
        <div className="space-y-4 min-w-0" data-step="empty">
          <p className="text-sm text-gray-900 dark:text-white">{EMPTY_DETECT_MESSAGE}</p>
          {reasons.length > 0 && (
            <div>
              <p className={`text-xs ${MUTED_CLS}`}>Ficaram de fora:</p>
              <ul className={`mt-1 text-sm list-disc list-inside space-y-1 ${MUTED_CLS}`}>{reasons.map((line) => <li key={line}>{line}</li>)}</ul>
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={onClose} className={BTN_SECONDARY}>Fechar</button>
            <button type="button" onClick={() => void runDetect()} disabled={detecting || !householdId} className={BTN_SECONDARY}>
              {detecting ? 'Detectando…' : 'Detectar de novo'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5 min-w-0" data-step="list">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className={`text-sm ${MUTED_CLS}`}>
              {list.length === 1 ? '1 despesa parece se repetir' : `${list.length} despesas parecem se repetir`} todo mês.
              {canWrite ? ' Marque as que viram recorrência; o valor, o dia e a descrição podem ser ajustados antes.' : ''}
            </p>
            {detecting && (
              <span className={`inline-flex items-center gap-1 text-xs ${MUTED_CLS}`} role="status">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Atualizando…
              </span>
            )}
          </div>

          {reasons.length > 0 && <p className={`text-xs ${MUTED_CLS}`}>Ficaram de fora: {reasons.join(', ')}.</p>}

          {canWrite && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {(['stable', 'bill'] as const).filter((kind) => list.some((c) => (c.kind === 'bill') === (kind === 'bill'))).map((kind) => {
                const full = kindFullySelected(draft, list, kind);
                const what = kind === 'bill' ? 'as contas' : 'as estáveis';
                return (
                  <button key={kind} type="button" className={LINK_CLS} disabled={busy}
                    onClick={() => update((d) => setKindSelected(d, list, kind, !full))}>
                    {full ? 'Desmarcar' : 'Marcar'} todas {what}
                  </button>
                );
              })}
              <button type="button" className={LINK_CLS} disabled={busy} title={FOLLOW_LAST_HELP}
                onClick={() => update((d) => setAllFollowLast(d, list, !allFollowLast(d, list)))}>
                {allFollowLast(draft, list) ? 'Desligar' : 'Ligar'} “{FOLLOW_LAST_LABEL.toLowerCase()}” em todas
              </button>
            </div>
          )}

          <div className={`space-y-5 min-w-0 transition-opacity ${detecting ? 'opacity-60' : ''}`} aria-busy={detecting}>
            {groups.map((group) => (
              <section key={group.kind} aria-labelledby={`detect-group-${group.kind}`} className="space-y-2 min-w-0">
                <h4 id={`detect-group-${group.kind}`} className={H4_CLS}>
                  {KIND_LABEL[group.kind]} ({group.candidates.length})
                  {canWrite && (
                    <span className={`ml-2 text-xs font-normal ${MUTED_CLS}`}>{group.candidates.filter((c) => draft.selected[c.id] === true).length} marcadas</span>
                  )}
                </h4>
                <div className={TABLE_WRAP_CLS}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={THEAD_ROW_CLS}>
                        {canWrite && <th className={`${TH_CLS} w-8`} aria-label="Criar" />}
                        <th className={TH_CLS}>Descrição</th>
                        <th className={TH_CLS}>Conta</th>
                        <th className={TH_CLS}>Valor</th>
                        <th className={TH_CLS}>Dia</th>
                        <th className={TH_CLS}>Meses vistos</th>
                        <th className={TH_CLS}>Tipo</th>
                        <th className={TH_CLS}>Confiança</th>
                        <th className={TH_CLS} title={FOLLOW_LAST_HELP}>Acompanha o último valor</th>
                      </tr>
                    </thead>
                    <tbody className={TBODY_CLS}>{group.candidates.map(renderRow)}</tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>

          <div className="pt-3 border-t border-gray-200 dark:border-gray-800 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              {canWrite && totals ? (
                <p className="text-sm text-gray-900 dark:text-white min-w-0" data-summary>
                  {totals.count === 0
                    ? 'Nada marcado.'
                    : `${totals.count === 1 ? '1 recorrência' : `${totals.count} recorrências`} (${totals.stableCount} ${totals.stableCount === 1 ? 'estável' : 'estáveis'}, ${totals.billCount} ${totals.billCount === 1 ? 'conta' : 'contas'}) · ${money(totals.monthlyCents)} por mês · ${totals.followCount} ${totals.followCount === 1 ? 'acompanha' : 'acompanham'} o último valor`}
                </p>
              ) : <span />}
              <div className="flex gap-3">
                <button type="button" onClick={() => void runDetect()} disabled={busy || !householdId} className={BTN_SECONDARY}>
                  <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
                  Detectar de novo
                </button>
                <button type="button" onClick={onClose} disabled={busy} className={BTN_SECONDARY}>Fechar</button>
                {canWrite && (
                  <button type="button" onClick={() => void handleApply()} disabled={busy || blocker !== null} title={blocker?.message}
                    aria-describedby={blocker ? BLOCKER_ID : undefined} className={BTN_PRIMARY}>
                    {applying ? 'Criando…' : totals && totals.count > 0 ? `Criar ${totals.count === 1 ? '1 recorrência' : `${totals.count} recorrências`}` : 'Criar recorrências'}
                  </button>
                )}
              </div>
            </div>
            {blocker && blocker.code !== 'applying' && (
              <p id={BLOCKER_ID} className={`text-xs ${blocker.code === 'none-selected' ? MUTED_CLS : 'text-red-600 dark:text-red-400'}`}>{blocker.message}</p>
            )}
            {detectError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{detectError}</p>}
            {applyError && (
              <div className="flex flex-wrap items-center gap-3">
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">{applyError}</p>
                <button type="button" onClick={() => void runDetect()} disabled={busy} className={BTN_SECONDARY_SM}>Detectar de novo</button>
              </div>
            )}
          </div>
        </div>
      )}
    </DialogShell>
  );
};

export default DetectRecurringDialog;

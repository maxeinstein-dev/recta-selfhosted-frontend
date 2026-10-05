import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardCheck, RefreshCw } from 'lucide-react';
import { useAccounts } from '../hooks/api/useAccounts';
import { useDefaultHousehold } from '../hooks/useDefaultHousehold';
import { useCardOfxReviewActions, useCardOfxReviewQueue } from '../hooks/api/useCardOfxReview';
import type { CardOfxReviewActionsResponse, CardOfxReviewItem, CardOfxReviewQueue, CardOfxReviewView } from '../hooks/api/useCardOfxReview';
import { useToastContext } from '../context/ToastContext';
import { useCurrency } from '../context/CurrencyContext';
import { formatCurrency } from '../utils/format';
import { countLabel } from '../utils/maxfinPayload';
import { signedCents } from '../utils/cardOfx';
import {
  DELETE_WARNING, EMPTY_REVIEW_DRAFT, KEPT_EXPLANATION, REVIEW_ACTION_LABEL, REVIEW_EXPLANATION, REVIEW_LIMIT, REVIEW_STATUS_LABEL,
  allowedActions, buildReviewActions, choiceOf, confirmLines, decidedCount, draftAfterResults, lingeringOutcomes, moveTargetAccounts,
  moveTargetProblem, reconcileReviewDraft, reviewBlocker, reviewFailureMessage, reviewHeadline, reviewReasonText, reviewSections,
  reviewSummaryLine, reviewViewLabel, setBulkChoice, setRowChoice, setRowTarget, summarizeReviewResponse, unkeepRequest,
} from '../utils/cardOfxReview';
import type { ReviewApplySummary, ReviewChoiceAction, ReviewDraft, ReviewOutcome } from '../utils/cardOfxReview';
import {
  BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, BTN_SECONDARY_SM, Chip, DialogShell, ERROR_CLS, ERROR_TOAST_MS, H4_CLS, INPUT_SM_CLS,
  LINK_CLS, MUTED_CLS, NOTICE_BOX_CLS, TABLE_WRAP_CLS, TBODY_CLS, TD_CLS, TH_CLS, THEAD_ROW_CLS, WARN_BOX_CLS, fmtDate,
  getErrorMessage,
} from './people/ui';

const BLOCKER_ID = 'card-review-blocker';
const ACTION_ORDER: ReviewChoiceAction[] = ['none', 'keep', 'move', 'delete'];

interface CardOfxReviewDialogProps {
  open: boolean;
  onClose: () => void;
  /** The credit card whose sheet rows are reviewed. */
  accountId: string;
  /** Defaults to the household from useDefaultHousehold (same as the sibling dialogs). */
  householdId?: string;
  /** Stacking level: opened from the import dialog (z-[60]) it needs the higher one. */
  zClass?: string;
}

/** "Revisar lançamentos sem comprovante": sheet rows of the card that found no line in the bank's OFX. */
const CardOfxReviewDialog = ({ open, onClose, accountId, householdId: householdIdProp, zClass }: CardOfxReviewDialogProps) => {
  const { householdId: defaultHouseholdId } = useDefaultHousehold();
  const householdId = householdIdProp ?? defaultHouseholdId;
  const { success, showToast } = useToastContext();
  const { baseCurrency } = useCurrency();
  const money = (cents: number): string => formatCurrency(cents / 100, baseCurrency);

  const { data: accountsData } = useAccounts({ householdId: householdId ?? '' });
  const accounts = useMemo(() => accountsData?.accounts ?? [], [accountsData]);
  const targets = useMemo(() => moveTargetAccounts(accounts), [accounts]);
  const accountName = (id: string): string => accounts.find((a) => a.id === id)?.name ?? '—';

  const queueMutation = useCardOfxReviewQueue();
  const actionsMutation = useCardOfxReviewActions();

  const [view, setView] = useState<CardOfxReviewView>('queue');
  const [monthFilter, setMonthFilter] = useState('');
  const [queue, setQueue] = useState<CardOfxReviewQueue | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReviewDraft>(EMPTY_REVIEW_DRAFT);
  const [outcomes, setOutcomes] = useState<Record<string, ReviewOutcome>>({});
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  // A request failed, or the list could not be read again after an apply: it is stale until it is read again.
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [summary, setSummary] = useState<ReviewApplySummary | null>(null);
  const [bulkAction, setBulkAction] = useState<ReviewChoiceAction>('keep');
  const [bulkTarget, setBulkTarget] = useState('');
  const [bulkNote, setBulkNote] = useState<string | null>(null);

  // Latest-wins: a read only touches state while it is the newest read of a mounted, open dialog.
  const seqRef = useRef(0);
  const mountedRef = useRef(true);
  // Synchronous twin of `applying`: a second click before React re-renders must not send a second request.
  const applyingRef = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // The months of the unfiltered list, so the month filter keeps its options while one month is shown.
  const monthOptionsRef = useRef<Array<{ monthKey: string; label: string }>>([]);
  const [monthOptions, setMonthOptions] = useState<Array<{ monthKey: string; label: string }>>([]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Reads the list (or the kept ones). Resolves to whether this read is the one that was applied. */
  const load = async (nextView: CardOfxReviewView, nextMonth: string): Promise<boolean> => {
    seqRef.current += 1;
    const run = seqRef.current;
    const isCurrent = () => mountedRef.current && run === seqRef.current;
    setLoading(true);
    try {
      const data = await queueMutation.mutateAsync({
        accountId, view: nextView, limit: REVIEW_LIMIT, ...(nextMonth ? { monthKey: nextMonth } : {}),
      });
      if (!isCurrent()) return false;
      const sections = reviewSections(data);
      setQueue(data);
      setLoadError(null);
      setNeedsRefresh(false);
      setApplyError(null);
      setDraft((current) => reconcileReviewDraft(current, data.items ?? []));
      setOutcomes((current) => {
        const present = new Set((data.items ?? []).map((i) => i.transactionId));
        return Object.fromEntries(Object.entries(current).filter(([id]) => present.has(id)));
      });
      if (!nextMonth) {
        const options = sections.map((s) => ({ monthKey: s.monthKey, label: s.label }));
        monthOptionsRef.current = options;
        setMonthOptions(options);
      }
      return true;
    } catch (err: unknown) {
      if (!isCurrent()) return false;
      const message = getErrorMessage(err, 'Não foi possível carregar a lista.');
      setLoadError(message);
      // A list that could not be read after an apply no longer shows what is there.
      setNeedsRefresh(true);
      showToast(message, 'error', ERROR_TOAST_MS);
      return false;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  // Every opening starts over and reads at once. Closing invalidates the read in flight.
  useEffect(() => {
    if (!open) return;
    setView('queue');
    setMonthFilter('');
    setQueue(null);
    setLoadError(null);
    setDraft(EMPTY_REVIEW_DRAFT);
    setOutcomes({});
    setConfirming(false);
    setApplying(false);
    applyingRef.current = false;
    setApplyError(null);
    setNeedsRefresh(false);
    setSummary(null);
    setBulkAction('keep');
    setBulkTarget('');
    setBulkNote(null);
    monthOptionsRef.current = [];
    setMonthOptions([]);
    void load('queue', '');
    return () => {
      seqRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accountId]);

  const items = useMemo<CardOfxReviewItem[]>(() => queue?.items ?? [], [queue]);
  const sections = useMemo(() => (queue ? reviewSections(queue) : []), [queue]);
  const built = useMemo(() => buildReviewActions(accountId, items, draft, accounts), [accountId, items, draft, accounts]);
  const blocker = view === 'queue' ? reviewBlocker(built, { needsRefresh, busy: applying || loading }) : null;
  const headline = queue ? reviewHeadline(queue, money) : null;
  const decided = built.counts.total + built.problems.length;
  const busy = applying;

  const changeView = (next: CardOfxReviewView) => {
    if (applyingRef.current || next === view) return;
    setView(next);
    setMonthFilter('');
    setConfirming(false);
    setSummary(null);
    setBulkNote(null);
    setQueue(null);
    setDraft(EMPTY_REVIEW_DRAFT);
    setOutcomes({});
    void load(next, '');
  };

  const changeMonth = (value: string) => {
    if (applyingRef.current) return;
    setMonthFilter(value);
    setConfirming(false);
    void load(view, value);
  };

  const handleRefresh = () => {
    if (applyingRef.current) return;
    setConfirming(false);
    void load(view, monthFilter);
  };

  /** Sends the actions, reads the answer row by row, and reads the list again. */
  const send = async (request: ReturnType<typeof buildReviewActions>['payload'], keepDraft: ReviewDraft) => {
    if (applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    setApplyError(null);
    let response: CardOfxReviewActionsResponse | null = null;
    try {
      response = await actionsMutation.mutateAsync(request);
    } catch (err: unknown) {
      const message = reviewFailureMessage(getErrorMessage(err, 'Não foi possível aplicar as decisões.'));
      showToast(message, 'error', ERROR_TOAST_MS);
      if (mountedRef.current) {
        setApplyError(message);
        setNeedsRefresh(true);
        setConfirming(false);
      }
    } finally {
      applyingRef.current = false;
      if (mountedRef.current) setApplying(false);
    }
    if (!response || !mountedRef.current) return;
    const result = summarizeReviewResponse(request.actions, response);
    const line = reviewSummaryLine(result);
    if (result.failed > 0 || result.blocked > 0 || result.missing.length > 0) showToast(`Revisão: ${line}.`, 'error', ERROR_TOAST_MS);
    else success(`Revisão: ${line}.`);
    setSummary(result);
    setConfirming(false);
    setDraft(draftAfterResults(keepDraft, result));
    setOutcomes(lingeringOutcomes(result));
    setBulkNote(null);
    // The list changed under the decisions: read it again (a read that fails leaves the list marked as stale).
    await load(view, monthFilter);
  };

  const handleConfirm = () => {
    if (blocker || confirming === false) return;
    void send(built.payload, draftRef.current);
  };

  const handleUnkeep = (item: CardOfxReviewItem) => {
    if (applyingRef.current || loading) return;
    void send(unkeepRequest(accountId, item.transactionId), EMPTY_REVIEW_DRAFT);
  };

  const handleChoice = (item: CardOfxReviewItem, action: ReviewChoiceAction) => {
    setConfirming(false);
    setBulkNote(null);
    setDraft((prev) => setRowChoice(prev, item, action));
  };

  const handleBulk = () => {
    setConfirming(false);
    const result = setBulkChoice(draftRef.current, items, bulkAction, bulkTarget);
    setDraft(result.draft);
    setBulkNote(
      result.blockedSkipped > 0
        ? `${countLabel(result.blockedSkipped, 'lançamento bloqueado ficou de fora', 'lançamentos bloqueados ficaram de fora')}: só aceitam “Manter sem comprovante”.`
        : null,
    );
  };

  const kept = view === 'kept';
  const bulkProblem = bulkAction === 'move' ? moveTargetProblem(bulkTarget, accounts) : null;
  const outcomeChip = (id: string) => {
    const outcome = outcomes[id];
    if (!outcome) return null;
    const reason = reviewReasonText(outcome.reason);
    return (
      <Chip tone={outcome.status === 'failed' ? 'red' : 'yellow'} title={reason || undefined}>
        {REVIEW_STATUS_LABEL[outcome.status]}{reason ? `: ${reason}` : ''}
      </Chip>
    );
  };

  return (
    <DialogShell open={open} onClose={onClose} canClose={!applying} titleId="card-review-title" title="Revisar lançamentos sem comprovante"
      icon={<ClipboardCheck className="h-5 w-5 text-gray-500 dark:text-gray-400 mr-3 flex-shrink-0" aria-hidden="true" />}
      widthClass="max-w-5xl" zClass={zClass}>
      <div className="space-y-4 min-w-0">
        <p className={`text-sm ${MUTED_CLS}`}>
          <strong className="font-medium text-gray-900 dark:text-white">{accountName(accountId)}</strong>. {kept ? KEPT_EXPLANATION : REVIEW_EXPLANATION}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => changeView(kept ? 'queue' : 'kept')} disabled={busy} className={BTN_SECONDARY_SM}>
            {reviewViewLabel(kept ? 'queue' : 'kept')}
          </button>
          {monthOptions.length > 1 && (
            <label className="inline-flex items-center gap-2 text-sm">
              <span className={MUTED_CLS}>Mês</span>
              <select value={monthFilter} disabled={busy} onChange={(e) => changeMonth(e.target.value)} className={`${INPUT_SM_CLS} w-auto`}>
                <option value="">Todos</option>
                {monthOptions.map((o) => <option key={o.monthKey} value={o.monthKey}>{o.label}</option>)}
              </select>
            </label>
          )}
          <button type="button" onClick={handleRefresh} disabled={busy || loading} className={LINK_CLS}>
            <RefreshCw className={`inline h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Atualizar lista
          </button>
        </div>

        {loadError && (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
            <button type="button" onClick={handleRefresh} disabled={busy || loading} className={BTN_SECONDARY_SM}>Tentar de novo</button>
          </div>
        )}

        {loading && !queue && <p role="status" className={`text-sm ${MUTED_CLS}`}>Carregando…</p>}

        {summary && (
          <section aria-labelledby="card-review-summary-title" className="rounded-md border border-gray-200 dark:border-gray-800 p-4 space-y-2">
            <h4 id="card-review-summary-title" className={H4_CLS}>Resultado: {reviewSummaryLine(summary)}</h4>
            {summary.inconsistent && (
              <p className={`text-xs ${MUTED_CLS}`}>Os totais do servidor não batem com o resultado de cada lançamento; vale o resultado de cada um.</p>
            )}
            {summary.missing.length > 0 && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {countLabel(summary.missing.length, 'decisão não teve resposta do servidor', 'decisões não tiveram resposta do servidor')}: não se sabe se foram aplicadas. A lista abaixo mostra o que existe agora.
              </p>
            )}
            {summary.results.filter((r) => r.status === 'failed' || r.status === 'blocked').length > 0 && (
              <ul className="text-xs space-y-0.5">
                {summary.results.filter((r) => r.status === 'failed' || r.status === 'blocked').map((r) => {
                  const row = items.find((i) => i.transactionId === r.transactionId);
                  return (
                    <li key={`${r.transactionId}-${r.action}`} className={r.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-yellow-800 dark:text-yellow-300'}>
                      {row?.description ?? r.transactionId}: {REVIEW_STATUS_LABEL[r.status]}{r.reason ? ` (${reviewReasonText(r.reason)})` : ''}
                    </li>
                  );
                })}
              </ul>
            )}
            {summary.warnings.length > 0 && (
              <ul className={WARN_BOX_CLS}>
                {summary.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
              </ul>
            )}
          </section>
        )}

        {queue && headline && (
          <div className="space-y-1">
            <p className={H4_CLS} role="status">{headline.text}</p>
            {headline.truncatedNote && <p className={`text-xs ${MUTED_CLS}`}>{headline.truncatedNote}</p>}
          </div>
        )}

        {queue && !kept && items.length > 0 && (
          <div className="rounded-md border border-gray-200 dark:border-gray-800 p-3 space-y-2" aria-label="Decidir para todos os listados" role="group">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">Decidir para todos os listados</p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="card-review-bulk-action" className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Ação</label>
                <select id="card-review-bulk-action" value={bulkAction} disabled={busy} className={`${INPUT_SM_CLS} w-auto`}
                  onChange={(e) => setBulkAction(e.target.value as ReviewChoiceAction)}>
                  {ACTION_ORDER.map((a) => <option key={a} value={a}>{REVIEW_ACTION_LABEL[a]}</option>)}
                </select>
              </div>
              {bulkAction === 'move' && (
                <div>
                  <label htmlFor="card-review-bulk-target" className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Conta de destino</label>
                  <select id="card-review-bulk-target" value={bulkTarget} disabled={busy} className={`${INPUT_SM_CLS} w-auto min-w-[180px]`}
                    onChange={(e) => setBulkTarget(e.target.value)}>
                    <option value="">Selecione a conta</option>
                    {targets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
              <button type="button" onClick={handleBulk} disabled={busy || (bulkAction === 'move' && bulkProblem !== null)} className={BTN_SECONDARY_SM}>
                Marcar todos
              </button>
              <button type="button" onClick={() => { setConfirming(false); setBulkNote(null); setDraft(EMPTY_REVIEW_DRAFT); }}
                disabled={busy || decided === 0} className={LINK_CLS}>
                Limpar decisões
              </button>
            </div>
            {bulkAction === 'move' && bulkProblem && bulkTarget === '' && <p className={`text-xs ${MUTED_CLS}`}>{bulkProblem}</p>}
            {bulkNote && <p role="note" className="text-xs text-yellow-800 dark:text-yellow-300">{bulkNote}</p>}
            <p className={`text-xs ${MUTED_CLS}`}>Isto só preenche as decisões abaixo; nada é aplicado antes de “Aplicar decisões” e da confirmação.</p>
          </div>
        )}

        {queue && sections.map((section) => (
          <section key={section.monthKey} aria-labelledby={`card-review-${section.monthKey}`} className="space-y-2 min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 id={`card-review-${section.monthKey}`} className={H4_CLS}>
                Fatura de {section.label} ({section.count})
              </h4>
              <span className={`text-xs ${MUTED_CLS}`}>
                Total {money(section.netCents)}
                {!kept && decidedCount(section.items, draft) > 0 && <> · {countLabel(decidedCount(section.items, draft), 'decidido', 'decididos')}</>}
              </span>
            </div>
            <div className={TABLE_WRAP_CLS}>
              <table className="w-full text-sm">
                <thead>
                  <tr className={THEAD_ROW_CLS}>
                    <th className={TH_CLS}>Data</th>
                    <th className={TH_CLS}>Descrição</th>
                    <th className={`${TH_CLS} text-right`}>Valor</th>
                    <th className={TH_CLS}>{kept ? 'Situação' : 'O que fazer'}</th>
                  </tr>
                </thead>
                <tbody className={TBODY_CLS}>
                  {section.items.map((item) => {
                    const choice = choiceOf(draft, item.transactionId);
                    const problem = choice.action === 'move' ? moveTargetProblem(choice.targetAccountId, accounts) : null;
                    return (
                      <tr key={item.transactionId} data-review-row={item.transactionId}>
                        <td className={`${TD_CLS} whitespace-nowrap ${MUTED_CLS}`}>{fmtDate(item.date)}</td>
                        <td className={`${TD_CLS} min-w-[220px]`}>
                          <p className="truncate max-w-[320px]" title={item.description}>{item.description}</p>
                          <div className="flex flex-wrap items-center gap-1 mt-0.5 empty:hidden">
                            {item.categoryName && <Chip tone="gray">{item.categoryName}</Chip>}
                            {item.blocked && (
                              <Chip tone="yellow" title="Tem partilha, divisão, acerto, recorrência ou anexo: só pode ser mantido sem comprovante.">
                                bloqueado: só manter
                              </Chip>
                            )}
                            {outcomeChip(item.transactionId)}
                          </div>
                        </td>
                        <td className={`${TD_CLS} whitespace-nowrap text-right`}>
                          {item.type === 'INCOME' ? '+' : ''}{formatCurrency(item.amount, baseCurrency)}
                          <span className="sr-only"> ({signedCents(item.amount, item.type) < 0 ? 'crédito' : 'compra'})</span>
                        </td>
                        <td className={`${TD_CLS} min-w-[220px]`}>
                          {kept ? (
                            <button type="button" onClick={() => handleUnkeep(item)} disabled={busy || loading} className={BTN_SECONDARY_SM}
                              aria-label={`Desfazer: ${item.description}`}>
                              Desfazer
                            </button>
                          ) : (
                            <div className="space-y-1">
                              <select value={choice.action} disabled={busy} className={INPUT_SM_CLS} aria-label={`Ação para ${item.description}`}
                                onChange={(e) => handleChoice(item, e.target.value as ReviewChoiceAction)}>
                                {allowedActions(item).map((a) => <option key={a} value={a}>{REVIEW_ACTION_LABEL[a]}</option>)}
                              </select>
                              {choice.action === 'move' && (
                                <>
                                  <select value={choice.targetAccountId} disabled={busy} className={INPUT_SM_CLS}
                                    aria-label={`Conta de destino para ${item.description}`}
                                    onChange={(e) => { setConfirming(false); setDraft((prev) => setRowTarget(prev, item.transactionId, e.target.value)); }}>
                                    <option value="">Selecione a conta</option>
                                    {targets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                                  </select>
                                  {problem && <p className={ERROR_CLS}>{problem}</p>}
                                </>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        {queue && items.length === 0 && !loading && (
          <p className={`text-sm ${MUTED_CLS}`}>
            {kept ? 'Nada marcado como “sem comprovante”.' : 'Tudo certo: nenhum lançamento da planilha ficou sem linha no OFX.'}
          </p>
        )}

        {!kept && queue && items.length > 0 && (
          <div className="pt-3 border-t border-gray-200 dark:border-gray-800 space-y-3">
            {confirming ? (
              <div role="alertdialog" aria-labelledby="card-review-confirm-title" className={NOTICE_BOX_CLS}>
                <p id="card-review-confirm-title" className="font-medium">Confirmar {countLabel(built.counts.total, 'decisão', 'decisões')}?</p>
                <ul className="list-disc list-inside">
                  {confirmLines(built.counts, accountName, money).map((line, index) => <li key={index}>{line}</li>)}
                </ul>
                {built.counts.delete > 0 && <p role="note">{DELETE_WARNING}</p>}
                <div className="flex flex-wrap gap-3 pt-1">
                  <button type="button" onClick={handleConfirm} disabled={busy || blocker !== null}
                    className={built.counts.delete > 0 ? BTN_DANGER : BTN_PRIMARY}>
                    {applying ? 'Aplicando…' : 'Confirmar'}
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={BTN_SECONDARY}>Voltar</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-gray-900 dark:text-white">{countLabel(decided, 'decisão', 'decisões')}</p>
                <button type="button" onClick={() => setConfirming(true)} disabled={busy || blocker !== null} title={blocker?.message}
                  aria-describedby={blocker ? BLOCKER_ID : undefined} className={BTN_PRIMARY}>
                  Aplicar decisões
                </button>
              </div>
            )}
            {blocker && !confirming && (
              <p id={BLOCKER_ID} className={`text-xs ${blocker.code === 'nothing' || blocker.code === 'busy' ? MUTED_CLS : 'text-red-600 dark:text-red-400'}`}>
                {blocker.message}
              </p>
            )}
            {applyError && (
              <div className="flex flex-wrap items-center gap-3">
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">{applyError}</p>
                <button type="button" onClick={handleRefresh} disabled={busy || loading} className={BTN_SECONDARY_SM}>Atualizar lista</button>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button type="button" onClick={onClose} disabled={applying} className={BTN_SECONDARY}>Fechar</button>
        </div>
      </div>
    </DialogShell>
  );
};

export default CardOfxReviewDialog;

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, FastForward, FileUp, RefreshCw, SkipForward, Upload, X } from 'lucide-react';
import { useAccounts } from '../hooks/api/useAccounts';
import { useDefaultHousehold } from '../hooks/useDefaultHousehold';
import { useToastContext } from '../context/ToastContext';
import { useCurrency } from '../context/CurrencyContext';
import { formatCurrency, formatDate } from '../utils/format';
import { isCardOfxHandoff } from '../utils/cardOfx';
import ImportCardOfxDialog from './ImportCardOfxDialog';
import { QueueHeader, QueueProgressList } from './ImportQueuePanel';
import { planStatementDefaultApply, statementConfirmRows, statementImportNote } from '../utils/statementQueue';
import {
  applyDefaultsToRemaining, completeCurrent, createQueue, failCurrent, followingCount, isQueueFinished, queueSummaryLine, retryCurrent, skipCurrent,
} from '../utils/importQueue';
import type { ApplyOutcome, QueueState } from '../utils/importQueue';

import {
  useImportPreview,
  useImportTransactions,
} from '../hooks/api/useImportTransactions';
import type { ImportPreview } from '../hooks/api/useImportTransactions';

interface ImportTransactionsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Se omitido, usa o household padrão (mesmo padrão de Transactions.tsx). */
  householdId?: string;
  defaultAccountId?: string | null;
  /**
   * Several statements for the account `defaultAccountId`, already in the order to import (oldest first): they go one
   * after the other, each one previewed only after the previous one was confirmed (or skipped). Read when the dialog opens.
   */
  initialFiles?: File[];
}

const ACCEPTED_EXTENSIONS = ['.csv', '.ofx'];
const NO_FILES: File[] = [];
const BTN_SECONDARY_SM =
  'inline-flex items-center px-3 py-1.5 text-xs font-light tracking-tight text-gray-900 dark:text-white bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-md hover:opacity-70 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed';

const getErrorMessage = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

const ImportTransactionsDialog = ({
  open,
  onClose,
  householdId: householdIdProp,
  defaultAccountId,
  initialFiles,
}: ImportTransactionsDialogProps) => {
  const { householdId: defaultHouseholdId } = useDefaultHousehold();
  const householdId = householdIdProp ?? defaultHouseholdId;
  const { success, error: showError } = useToastContext();
  const { baseCurrency } = useCurrency();

  const { data: accountsData, isLoading: isLoadingAccounts } = useAccounts({
    householdId: householdId ?? '',
  });
  const accounts = accountsData?.accounts ?? [];

  // A invalidação das queries após o sucesso fica nos hooks (onSuccess); o dialog só fecha e mostra o aviso.
  const previewMutation = useImportPreview();
  const confirmMutation = useImportTransactions();

  const [accountId, setAccountId] = useState<string>(defaultAccountId ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // Fatura de cartão em .ofx: o fluxo de conciliação (ImportCardOfxDialog) assume a conta e o arquivo.
  const [cardOfx, setCardOfx] = useState<{ accountId: string; file: File } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fila de extratos (prop `initialFiles`): um arquivo por vez, o próximo só depois de confirmar ou pular o anterior.
  const queueFilesRef = useRef<File[]>(initialFiles ?? NO_FILES);
  queueFilesRef.current = initialFiles ?? NO_FILES;
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [queueStop, setQueueStop] = useState<string | null>(null);
  const [queueImported, setQueueImported] = useState(0);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // O loop "aplicar o padrão nas restantes" está rodando: o dialog não fecha.
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);
  // Gêmeo síncrono de isConfirming: bloqueia fechar e um segundo confirmar antes do React renderizar.
  const confirmingRef = useRef(false);
  const mountedRef = useRef(true);
  // Só a última pré-visualização da fila mexe no estado.
  const seqRef = useRef(0);
  const startFileRef = useRef<(index: number) => void>(() => undefined);
  // Preview que o loop obteve do arquivo em que parou: aparece como está, sem pedir de novo ao servidor.
  const loopPreviewRef = useRef<{ index: number; data: ImportPreview } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reseta o estado sempre que o dialog abre/fecha.
  useEffect(() => {
    if (open) {
      setAccountId(defaultAccountId ?? '');
      setFile(null);
      setPreview(null);
      setFormError(null);
      setCardOfx(null);
      setConfirmError(null);
      setQueueStop(null);
      setQueueImported(0);
      setApplying(false);
      applyingRef.current = false;
      const queued = queueFilesRef.current;
      if (queued.length > 0 && defaultAccountId) {
        setQueue(createQueue(queued.map((f) => f.name)));
        startFileRef.current(0);
      } else {
        setQueue(null);
      }
    }
    return () => {
      seqRef.current += 1;
    };
  }, [open, defaultAccountId]);

  // ESC + trava scroll do body (mesmo padrão de ConfirmModal/TransactionModal).
  // No fluxo do cartão quem cuida disso é o ImportCardOfxDialog (que não fecha no meio da confirmação).
  useEffect(() => {
    if (!open || cardOfx) return;
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmingRef.current && !applyingRef.current) onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = originalStyle;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open, onClose, cardOfx]);

  if (!open) return null;

  if (cardOfx) {
    return (
      <ImportCardOfxDialog
        open
        onClose={onClose}
        accountId={cardOfx.accountId}
        householdId={householdId ?? undefined}
        initialFile={cardOfx.file}
      />
    );
  }

  const isPreviewing = previewMutation.isPending;
  const isConfirming = confirmMutation.isPending;
  const queueFinished = queue !== null && isQueueFinished(queue);
  // Um arquivo só: sem o painel da fila, e fecha ao confirmar (como o fluxo avulso).
  const single = queue !== null && queue.items.length === 1;
  const queueBusy = isPreviewing || isConfirming || applying;
  const queueAccountId = defaultAccountId ?? '';
  // Não fecha no meio de uma confirmação nem do loop da fila: a importação não pode ser abandonada pela metade.
  const requestClose = () => {
    if (!confirmingRef.current && !isConfirming && !applyingRef.current) onClose();
  };

  /** Pré-visualiza um arquivo da fila (latest-wins). Resolve para se o preview entrou na tela. */
  const runQueuePreview = async (target: File): Promise<boolean> => {
    seqRef.current += 1;
    const run = seqRef.current;
    if (!householdId || !queueAccountId) {
      setFormError(!householdId ? 'Nenhuma household selecionada.' : 'Selecione a conta de destino.');
      return false;
    }
    try {
      const result = await previewMutation.mutateAsync({ householdId, accountId: queueAccountId, file: target });
      if (!mountedRef.current || run !== seqRef.current) return false;
      setPreview(result);
      setConfirmError(null);
      return true;
    } catch (err: unknown) {
      if (!mountedRef.current || run !== seqRef.current) return false;
      showError(getErrorMessage(err, 'Não foi possível pré-visualizar o arquivo.'));
      return false;
    }
  };

  /** Coloca o arquivo da fila em `index` na tela: estado limpo e pré-visualização. */
  const startFile = (index: number, adopt?: ImportPreview) => {
    const target = queueFilesRef.current[index];
    seqRef.current += 1;
    setFile(target ?? null);
    setPreview(adopt ?? null);
    setFormError(null);
    setConfirmError(null);
    if (target && !adopt) void runQueuePreview(target);
  };
  startFileRef.current = startFile;

  const moveQueueTo = (next: QueueState) => {
    setQueue(next);
    if (isQueueFinished(next)) {
      seqRef.current += 1;
      setFile(null);
      setPreview(null);
      setConfirmError(null);
    } else {
      startFile(next.index);
    }
  };

  const handleSkip = () => {
    if (!queue || queueBusy || confirmingRef.current || applyingRef.current) return;
    setQueueStop(null);
    moveQueueTo(skipCurrent(queue));
  };

  /** Depois de uma confirmação que falhou: pré-visualiza de novo; o que já entrou volta como duplicada. */
  const handleQueueRefresh = async () => {
    if (!file) return;
    if (await runQueuePreview(file)) setQueue((current) => (current ? retryCurrent(current) : current));
  };

  /**
   * Os arquivos depois do que acabou de ser confirmado: pré-visualiza e confirma só as linhas novas, um por vez.
   * Um arquivo sem nada novo fica de fora; o primeiro que não puder seguir para a fila, com o motivo.
   */
  const runDefaultsLoop = async (queue: QueueState) => {
    if (!householdId) {
      applyingRef.current = false;
      return;
    }
    applyingRef.current = true;
    setApplying(true);
    setQueueStop(null);
    seqRef.current += 1;
    loopPreviewRef.current = null;
    let imported = 0;
    const applyOne = async (index: number): Promise<ApplyOutcome> => {
      const target = queueFilesRef.current[index];
      let data: ImportPreview;
      try {
        data = await previewMutation.mutateAsync({ householdId, accountId: queueAccountId, file: target });
      } catch (err: unknown) {
        return { ok: false, written: false, reason: getErrorMessage(err, 'Não foi possível pré-visualizar o arquivo.') };
      }
      loopPreviewRef.current = { index, data };
      const plan = planStatementDefaultApply(data);
      if (!plan.ok) return { ok: true, upToDate: true, note: plan.reason };
      confirmingRef.current = true;
      try {
        const result = await confirmMutation.mutateAsync({ householdId, accountId: queueAccountId, rows: plan.rows });
        const count = result?.imported ?? plan.rows.length;
        imported += count;
        success(statementImportNote(count) + '.');
        return { ok: true, note: statementImportNote(count) };
      } catch (err: unknown) {
        const message = getErrorMessage(err, 'Não foi possível confirmar a importação.');
        showError(message);
        return { ok: false, written: true, reason: message };
      } finally {
        confirmingRef.current = false;
      }
    };
    try {
      const run = await applyDefaultsToRemaining(queue, applyOne, {
        shouldStop: () => !mountedRef.current,
        onProgress: (state) => {
          if (mountedRef.current) setQueue(state);
        },
      });
      if (!mountedRef.current) return;
      setQueueImported((prev) => prev + imported);
      setQueue(run.state);
      if (isQueueFinished(run.state)) {
        seqRef.current += 1;
        setFile(null);
        setPreview(null);
      } else if (run.stop) {
        setQueueStop(`${run.stop.name}: ${run.stop.reason}`);
        // Atribuído dentro de applyOne (o TS não acompanha o closure).
        const got = loopPreviewRef.current as { index: number; data: ImportPreview } | null;
        startFile(run.state.index, got && got.index === run.state.index ? got.data : undefined);
        if (run.state.items[run.state.index]?.status === 'failed') setConfirmError(run.stop.reason);
      }
    } finally {
      applyingRef.current = false;
      if (mountedRef.current) setApplying(false);
    }
  };

  const handleFileChange = (selected: File | null) => {
    setFormError(null);
    if (!selected) {
      setFile(null);
      return;
    }
    const lowerName = selected.name.toLowerCase();
    const isAccepted = ACCEPTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
    if (!isAccepted) {
      setFormError('Formato inválido. Envie um arquivo .csv ou .ofx.');
      setFile(null);
      return;
    }
    setFile(selected);
  };

  const handlePreview = async () => {
    setFormError(null);
    if (!householdId) {
      setFormError('Nenhuma household selecionada.');
      return;
    }
    if (!accountId) {
      setFormError('Selecione a conta de destino.');
      return;
    }
    if (!file) {
      setFormError('Selecione um arquivo .csv ou .ofx.');
      return;
    }
    // Fatura de cartão em .ofx: gravar as linhas cruas duplicaria o que veio da planilha; vai para a conciliação.
    const account = accounts.find((a) => a.id === accountId);
    if (account && isCardOfxHandoff(account.type, file.name)) {
      setCardOfx({ accountId, file });
      return;
    }
    try {
      const result = await previewMutation.mutateAsync({ householdId, accountId, file });
      setPreview(result);
    } catch (err: unknown) {
      showError(getErrorMessage(err, 'Não foi possível pré-visualizar o arquivo.'));
    }
  };

  /** Confirma o arquivo da tela; com `thenApply`, os arquivos seguintes passam pelo loop do padrão. */
  const handleConfirm = async (thenApply = false) => {
    if (!preview || applyingRef.current) return;
    setFormError(null);
    if (!householdId || !accountId) {
      setFormError('Selecione a conta de destino.');
      return;
    }
    // Só vão as linhas que o preview marcou como novas; o servidor confere duplicatas de novo ao gravar.
    const newRows = statementConfirmRows(preview);
    if (newRows.length === 0 || confirmingRef.current) return;
    confirmingRef.current = true;
    // O dialog fica fechado do confirmar até o fim do loop.
    if (thenApply) applyingRef.current = true;
    let loopFrom: QueueState | null = null;
    try {
      const result = await confirmMutation.mutateAsync({ householdId, accountId, rows: newRows });
      const imported = result?.imported ?? newRows.length;
      success(
        imported === 1
          ? '1 transação importada com sucesso.'
          : `${imported} transações importadas com sucesso.`,
      );
      if (queue && !single) {
        if (!mountedRef.current) return;
        setQueueImported((prev) => prev + imported);
        setQueueStop(null);
        const next = completeCurrent(queue, statementImportNote(imported));
        if (thenApply && !isQueueFinished(next)) {
          setQueue(next);
          loopFrom = next;
        } else {
          moveQueueTo(next);
        }
      } else {
        onClose();
      }
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Não foi possível confirmar a importação.');
      showError(message);
      // Na fila, o arquivo fica bloqueado até a pré-visualização ser atualizada (o que entrou volta como duplicada).
      if (queue && mountedRef.current) {
        setConfirmError(message);
        setQueue(failCurrent(queue, message));
      }
    } finally {
      confirmingRef.current = false;
      // Nada mais roda depois de um confirmar que falhou ou foi interrompido.
      if (!loopFrom) applyingRef.current = false;
    }
    if (loopFrom) await runDefaultsLoop(loopFrom);
  };

  const handleBack = () => {
    setPreview(null);
    setFormError(null);
  };

  const rows = preview?.rows ?? [];
  const newCount = preview?.newCount ?? rows.filter((row) => !row.duplicate).length;
  const duplicateCount = preview?.duplicateCount ?? rows.filter((row) => row.duplicate).length;

  return createPortal(
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 animate-fade-in transition-opacity duration-300 ease-out"
        onClick={requestClose}
        aria-hidden="true"
      />

      {/* Scrollable Container */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full sm:w-[640px] max-w-2xl p-6 border rounded-lg bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800 max-h-[90vh] overflow-y-auto min-w-0 animate-slide-in-bottom">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center min-w-0">
              <Upload
                className="h-5 w-5 text-gray-500 dark:text-gray-400 mr-3 flex-shrink-0"
                aria-hidden="true"
              />
              <h3 className="text-lg font-light tracking-tight text-gray-900 dark:text-white truncate">
                Importar transações
              </h3>
            </div>
            <button
              onClick={requestClose}
              disabled={isConfirming || applying}
              aria-label="Fechar modal"
              className="text-gray-400 dark:text-gray-500 hover:opacity-70 transition-opacity p-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {queue && !single && !queueFinished && (
            <div className="mb-4">
              <QueueHeader state={queue} noun="Arquivo" statusText={{ done: 'Importado', skipped: 'Pulado', uptodate: 'Sem novidades' }}>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={handleSkip} disabled={queueBusy} className={BTN_SECONDARY_SM}>
                    <SkipForward className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                    Pular este arquivo
                  </button>
                  {followingCount(queue) > 0 && (
                    <button type="button" onClick={() => void handleConfirm(true)}
                      disabled={queueBusy || !preview || newCount === 0 || confirmError !== null}
                      title={`Confirma este arquivo e, nos ${followingCount(queue)} seguintes, pré-visualiza e confirma as linhas novas, uma por vez; para no primeiro que não puder seguir.`}
                      className={BTN_SECONDARY_SM}>
                      <FastForward className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                      Confirmar esta e aplicar o padrão nas restantes
                    </button>
                  )}
                </div>
              </QueueHeader>
            </div>
          )}

          {queueStop && !single && !applying && !queueFinished && (
            <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">
              A aplicação do padrão parou: {queueStop}
            </p>
          )}

          {formError && (
            <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">
              {formError}
            </p>
          )}

          {queue && queueFinished ? (
            <div className="space-y-4 min-w-0">
              <div>
                <h4 className="text-sm font-medium text-gray-900 dark:text-white">Importação concluída</h4>
                <p className="mt-1 text-sm text-gray-900 dark:text-white">
                  {queueSummaryLine(queue, { done: ['arquivo importado', 'arquivos importados'], skipped: ['pulado', 'pulados'], uptodate: ['sem novidades', 'sem novidades'], failed: ['com falha', 'com falha'] }) || 'Nenhum arquivo foi importado'}.
                </p>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Total: {statementImportNote(queueImported)}.</p>
              </div>
              <QueueProgressList state={queue} statusText={{ done: 'Importado', skipped: 'Pulado', uptodate: 'Sem novidades' }} />
              <div className="flex justify-end pt-2">
                <button type="button" onClick={requestClose} autoFocus
                  className="px-4 py-2.5 text-sm font-light tracking-tight text-white bg-primary-600 dark:bg-primary-500 border border-primary-600 dark:border-primary-500 rounded-md hover:opacity-80 transition-opacity">
                  Fechar
                </button>
              </div>
            </div>
          ) : applying && queue ? (
            <p role="status" className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              Aplicando o padrão: {queue.items[queue.index]?.name ?? ''}…
            </p>
          ) : preview === null && queue ? (
            /* Fila: o arquivo da vez é pré-visualizado sozinho; aqui só a nova tentativa depois de um erro */
            <div className="space-y-4 min-w-0">
              <p className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <FileUp className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                <span className="truncate">{file?.name ?? ''}</span>
              </p>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={requestClose}
                  className="px-4 py-2.5 text-sm font-light tracking-tight text-gray-900 dark:text-white bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-md hover:opacity-70 transition-opacity">
                  Cancelar
                </button>
                <button type="button" onClick={() => file && void runQueuePreview(file)} disabled={isPreviewing || !file}
                  className="px-4 py-2.5 text-sm font-light tracking-tight text-white bg-primary-600 dark:bg-primary-500 border border-primary-600 dark:border-primary-500 rounded-md hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed">
                  {isPreviewing ? 'Analisando…' : 'Pré-visualizar'}
                </button>
              </div>
            </div>
          ) : preview === null ? (
            /* Passo 1: conta destino + arquivo */
            <div className="space-y-4 min-w-0">
              <div>
                <label
                  htmlFor="import-account"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1"
                >
                  Conta de destino
                </label>
                <select
                  id="import-account"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  disabled={isLoadingAccounts || isPreviewing || !householdId}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-800 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                >
                  <option value="">
                    {isLoadingAccounts ? 'Carregando contas…' : 'Selecione uma conta'}
                  </option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="import-file"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1"
                >
                  Arquivo (.csv, .ofx)
                </label>
                <input
                  ref={fileInputRef}
                  id="import-file"
                  type="file"
                  accept=".csv,.ofx"
                  disabled={isPreviewing}
                  onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-gray-700 dark:text-gray-200 file:mr-4 file:py-2.5 file:px-4 file:rounded-md file:border file:border-gray-200 dark:file:border-gray-800 file:text-sm file:font-light file:bg-gray-50 dark:file:bg-gray-800 file:text-gray-900 dark:file:text-white hover:file:opacity-80 disabled:opacity-50"
                />
                {file && (
                  <p className="mt-2 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <FileUp className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                    <span className="truncate">{file.name}</span>
                  </p>
                )}
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  Extrato do banco ou fatura do cartão. A fatura de um cartão de crédito em .ofx abre a
                  conciliação com a planilha. Para a planilha mensal, use o botão Planilha.
                </p>
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={requestClose}
                  className="px-4 py-2.5 text-sm font-light tracking-tight text-gray-900 dark:text-white bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-md hover:opacity-70 transition-opacity"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={isPreviewing || !accountId || !file || !householdId}
                  className="px-4 py-2.5 text-sm font-light tracking-tight text-white bg-primary-600 dark:bg-primary-500 border border-primary-600 dark:border-primary-500 rounded-md hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPreviewing ? 'Analisando…' : 'Pré-visualizar'}
                </button>
              </div>
            </div>
          ) : (
            /* Passo 2: pré-visualização */
            <div className="space-y-4 min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 font-medium">
                  {newCount} {newCount === 1 ? 'nova' : 'novas'}
                </span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300 font-medium">
                  {duplicateCount} {duplicateCount === 1 ? 'duplicada' : 'duplicadas'}
                </span>
              </div>

              {rows.length === 0 ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Nenhuma transação encontrada no arquivo.
                </p>
              ) : (
                <div className="overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-md">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800/50 text-left">
                        <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">
                          Data
                        </th>
                        <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">
                          Descrição
                        </th>
                        <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200 text-right">
                          Valor
                        </th>
                        <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">
                          Tipo
                        </th>
                        <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">
                          Situação
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                      {rows.map((row) => (
                        <tr
                          key={row.index}
                          className={
                            row.duplicate
                              ? 'bg-yellow-50/50 dark:bg-yellow-900/10'
                              : undefined
                          }
                        >
                          <td className="px-3 py-2 whitespace-nowrap text-gray-900 dark:text-white">
                            {formatDate(row.date)}
                          </td>
                          <td className="px-3 py-2 text-gray-900 dark:text-white max-w-[220px] truncate">
                            {row.description}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-right text-gray-900 dark:text-white">
                            {formatCurrency(row.amount, baseCurrency)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400">
                            {row.type === 'INCOME' ? 'Receita' : 'Despesa'}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {row.duplicate ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300">
                                DUPLICADA
                              </span>
                            ) : (
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                Nova
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {confirmError && (
                <div className="flex flex-wrap items-center gap-3">
                  <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                    {confirmError} Atualize a pré-visualização antes de confirmar de novo.
                  </p>
                  <button type="button" onClick={() => void handleQueueRefresh()} disabled={queueBusy} className={BTN_SECONDARY_SM}>
                    Atualizar pré-visualização
                  </button>
                </div>
              )}

              <div className={`flex gap-3 ${queue ? 'justify-end' : 'justify-between'} pt-2`}>
                {!queue && (
                  <button
                    type="button"
                    onClick={handleBack}
                    disabled={isConfirming}
                    className="inline-flex items-center px-4 py-2.5 text-sm font-light tracking-tight text-gray-900 dark:text-white bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-md hover:opacity-70 transition-opacity disabled:opacity-50"
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
                    Voltar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleConfirm(false)}
                  disabled={isConfirming || newCount === 0 || confirmError !== null}
                  title={newCount === 0 ? 'Não há transações novas para importar' : undefined}
                  className="px-4 py-2.5 text-sm font-light tracking-tight text-white bg-primary-600 dark:bg-primary-500 border border-primary-600 dark:border-primary-500 rounded-md hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isConfirming ? 'Importando…' : queue && followingCount(queue) > 0 ? 'Confirmar e continuar' : 'Confirmar importação'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ImportTransactionsDialog;

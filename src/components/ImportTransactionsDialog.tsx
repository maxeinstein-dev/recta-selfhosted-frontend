import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, FileUp, Upload, X } from 'lucide-react';
import { useAccounts } from '../hooks/api/useAccounts';
import { useDefaultHousehold } from '../hooks/useDefaultHousehold';
import { useToastContext } from '../context/ToastContext';
import { useCurrency } from '../context/CurrencyContext';
import { formatCurrency, formatDate } from '../utils/format';
import { isCardOfxHandoff } from '../utils/cardOfx';
import ImportCardOfxDialog from './ImportCardOfxDialog';

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
}

const ACCEPTED_EXTENSIONS = ['.csv', '.ofx'];

const getErrorMessage = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

const ImportTransactionsDialog = ({
  open,
  onClose,
  householdId: householdIdProp,
  defaultAccountId,
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

  // Reseta o estado sempre que o dialog abre/fecha.
  useEffect(() => {
    if (open) {
      setAccountId(defaultAccountId ?? '');
      setFile(null);
      setPreview(null);
      setFormError(null);
      setCardOfx(null);
    }
  }, [open, defaultAccountId]);

  // ESC + trava scroll do body (mesmo padrão de ConfirmModal/TransactionModal).
  // No fluxo do cartão quem cuida disso é o ImportCardOfxDialog (que não fecha no meio da confirmação).
  useEffect(() => {
    if (!open || cardOfx) return;
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

  const handleConfirm = async () => {
    if (!preview) return;
    setFormError(null);
    if (!householdId || !accountId) {
      setFormError('Selecione a conta de destino.');
      return;
    }
    // Só vão as linhas que o preview marcou como novas; o servidor confere duplicatas de novo ao gravar.
    const newRows = preview.rows
      .filter((row) => !row.duplicate)
      .map(({ date, description, amount, type }) => ({ date, description, amount, type }));
    if (newRows.length === 0) return;
    try {
      const result = await confirmMutation.mutateAsync({ householdId, accountId, rows: newRows });
      const imported = result?.imported ?? newRows.length;
      success(
        imported === 1
          ? '1 transação importada com sucesso.'
          : `${imported} transações importadas com sucesso.`,
      );
      onClose();
    } catch (err: unknown) {
      showError(getErrorMessage(err, 'Não foi possível confirmar a importação.'));
    }
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
        onClick={onClose}
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
              onClick={onClose}
              aria-label="Fechar modal"
              className="text-gray-400 dark:text-gray-500 hover:opacity-70 transition-opacity p-1"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {formError && (
            <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">
              {formError}
            </p>
          )}

          {preview === null ? (
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
                  onClick={onClose}
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

              <div className="flex gap-3 justify-between pt-2">
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={isConfirming}
                  className="inline-flex items-center px-4 py-2.5 text-sm font-light tracking-tight text-gray-900 dark:text-white bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-md hover:opacity-70 transition-opacity disabled:opacity-50"
                >
                  <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={isConfirming || newCount === 0}
                  title={newCount === 0 ? 'Não há transações novas para importar' : undefined}
                  className="px-4 py-2.5 text-sm font-light tracking-tight text-white bg-primary-600 dark:bg-primary-500 border border-primary-600 dark:border-primary-500 rounded-md hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isConfirming ? 'Importando…' : 'Confirmar importação'}
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

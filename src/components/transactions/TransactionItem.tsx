import { Transaction } from '../../types';
import { formatCurrency } from '../../utils/format';
import { TransactionActionsMenu } from '../TransactionActionsMenu';
import { TransactionType, getCategoryDisplayName, getCategoryNameFromDisplay } from '../../lib/enums';
import { CreditCard } from 'lucide-react';
import { referenceChip } from '../../utils/referenceMonth';
import { confirmCopy, isConfirmable } from '../../utils/confirmReceipt';
import type React from 'react';

interface TransactionItemProps {
  transaction: Transaction;
  accounts: Array<{ id?: string; name: string; type?: string }>;
  baseCurrency: string;
  customCategories?: Array<{ id: string; name: string; icon?: string | null }>;
  onEdit: (transaction: Transaction) => void;
  onDelete: (id: string) => void;
  onMarkAsPaid: (id: string, paid: boolean) => Promise<void>;
  onView: (transaction: Transaction) => void;
  /** Opens the "Dividir" dialog; the action only shows for expenses. */
  onSplitShares?: (transaction: Transaction) => void;
  /** Opens "Confirmar recebimento / pagamento"; shown for pending income/expense rows. */
  onConfirm?: (transaction: Transaction) => void;
  formatTransactionDescription: (transaction: Transaction) => string;
  getCategoryIcon: (categoryName: string | undefined, customCategories?: Array<{ id: string; name: string; icon?: string | null }>) => React.ComponentType<any>;
  readOnly?: boolean;
  t: Record<string, string>;
}

export const TransactionItem = ({
  transaction,
  accounts,
  baseCurrency,
  customCategories,
  onEdit,
  onDelete,
  onMarkAsPaid,
  onView,
  onSplitShares,
  onConfirm,
  formatTransactionDescription,
  getCategoryIcon,
  readOnly = false,
  t,
}: TransactionItemProps) => {
  const categoryName = transaction.categoryName || getCategoryNameFromDisplay(transaction.category || '', t as unknown as Record<string, string>, customCategories);
  const IconComponent = getCategoryIcon(categoryName, customCategories);
  const isInvoicePayment = transaction.attachmentUrl?.startsWith('invoice_pay:');
  const categoryDisplay = categoryName 
    ? getCategoryDisplayName(categoryName, t as unknown as Record<string, string>, customCategories)
    : t.category;

  // Verificar se a transação está atrasada (data <= hoje e pendente)
  const isOverdue = (() => {
    if (transaction.paid !== false) return false; // Só verifica se estiver pendente
    const transactionDate = transaction.date instanceof Date ? transaction.date : new Date(transaction.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const transDate = new Date(transactionDate);
    transDate.setHours(0, 0, 0, 0);
    return transDate.getTime() <= today.getTime();
  })();

  return (
    <li 
      key={transaction.id} 
      className="px-4 sm:px-6 py-4 hover:bg-gray-50/50 dark:hover:bg-gray-900/50 transition-colors"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <p className="text-base font-light text-gray-900 dark:text-white">
                  {formatTransactionDescription(transaction)}
                </p>
                {transaction.paid === false && (
                  <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-light text-yellow-600 dark:text-yellow-400 border border-yellow-300 dark:border-yellow-700 rounded-full">
                    {t.pending}
                  </span>
                )}
                {referenceChip(transaction) && (
                  <span
                    data-testid="reference-chip"
                    title={t.referenceMonthChipTitle || 'Conta para outro mês: o saldo muda na data, os relatórios do mês usam este mês.'}
                    className="inline-flex items-center px-2.5 py-0.5 text-xs font-light text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-700 rounded-full"
                  >
                    {referenceChip(transaction)}
                  </span>
                )}
                {isOverdue && (
                  <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-light text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 rounded-full">
                    {t.overdue || 'Atrasado'}
                  </span>
                )}
                {onConfirm && !readOnly && isOverdue && isConfirmable({ id: transaction.id, type: transaction.type, paid: transaction.paid }) && (
                  <button
                    type="button"
                    data-testid="row-confirm"
                    onClick={() => onConfirm(transaction)}
                    aria-label={confirmCopy(transaction.type).action}
                    className="inline-flex items-center px-2.5 py-0.5 text-xs font-light text-primary-600 dark:text-primary-400 border border-primary-300 dark:border-primary-700 rounded-full hover:opacity-70 transition-opacity"
                  >
                    {t.confirmShort || 'Confirmar'}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <div className="flex items-center">
                  <IconComponent className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500 mr-1.5" />
                  <span className="text-sm font-light text-gray-500 dark:text-gray-400">
                    {categoryDisplay}
                  </span>
                </div>
                {(() => {
                  const account = accounts.find((acc) => acc.id === transaction.accountId);
                  if (account) {
                    return (
                      <span className="text-xs font-light text-gray-400 dark:text-gray-500">
                        {account.name}
                      </span>
                    );
                  }
                  return null;
                })()}
                {isInvoicePayment && (
                  <div className="flex items-center gap-1.5" title="Pagamento de fatura de cartão de crédito">
                    <CreditCard className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" />
                    <span className="text-xs font-light text-primary-600 dark:text-primary-400">Fatura</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between sm:justify-end gap-3 sm:ml-4">
            <span className={`text-lg font-light ${
              transaction.type === TransactionType.INCOME 
                ? 'text-green-500' 
                : transaction.type === TransactionType.TRANSFER || transaction.type === TransactionType.ALLOCATION
                ? 'text-blue-500'
                : 'text-red-500'
            }`}>
              {transaction.type === TransactionType.INCOME 
                ? '+' 
                : transaction.type === TransactionType.TRANSFER || transaction.type === TransactionType.ALLOCATION
                ? ''
                : '-'}
              {formatCurrency(Math.abs(transaction.amount || 0), baseCurrency)}
            </span>
            <TransactionActionsMenu
              transaction={transaction}
              onEdit={onEdit}
              onDelete={onDelete}
              onMarkAsPaid={onMarkAsPaid}
              onView={onView}
              onConfirm={!readOnly && onConfirm && isConfirmable({ id: transaction.id, type: transaction.type, paid: transaction.paid }) ? onConfirm : undefined}
              onSplitShares={onSplitShares && transaction.type === TransactionType.EXPENSE && !isInvoicePayment ? onSplitShares : undefined}
              readOnly={readOnly}
            />
          </div>
        </div>
    </li>
  );
};

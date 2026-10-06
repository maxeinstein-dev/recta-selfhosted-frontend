import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { useTransactions } from '../context/TransactionsContext';
import { useToastContext } from '../context/ToastContext';
import { useCurrency } from '../context/CurrencyContext';
import { useI18n } from '../context/I18nContext';
import ConfirmReceiptDialog from '../components/ConfirmReceiptDialog';
import { formatCurrency } from '../utils/format';
import { confirmCopy, dayText, followsLastAmount as followsLast } from '../utils/confirmReceipt';
import { confirmExplanation } from '../utils/forecastStrategy';
import { monthKeyOf } from '../utils/referenceMonth';
import type { ConfirmPatch, ConfirmableTx } from '../utils/confirmReceipt';
import { recurrenceUpdatedMessage } from '../utils/recurringFollow';
import { reaisToCents } from '../utils/people';

type PendingTx = ConfirmableTx & { description?: string; competenceMonth?: string | null; id?: string };

/**
 * "Confirmar recebimento / pagamento" wired to the app: `request(tx)` opens the dialog for a pending transaction; the
 * returned `dialog` element goes anywhere in the page. Confirming sends the existing update (balance logic stays in the
 * server's updateTransaction), shows the success toast and, when the server moved the amount of a recurrence that
 * follows the last amount, the "Recorrência atualizada" toast.
 */
export function useConfirmReceipt(): { request: (tx: PendingTx) => void; dialog: ReactNode } {
  const { updateTransaction, recurringTransactions, transactions } = useTransactions();
  const { success } = useToastContext();
  const { baseCurrency } = useCurrency();
  const { t } = useI18n();
  const [pending, setPending] = useState<PendingTx | null>(null);

  const request = useCallback((tx: PendingTx) => setPending(tx), []);

  const onConfirm = useCallback(
    async (patch: ConfirmPatch) => {
      if (!pending?.id) throw new Error('Transação não encontrada.');
      return updateTransaction(pending.id, patch);
    },
    [pending, updateTransaction],
  );

  const onConfirmed = useCallback(
    ({ patch, result }: { patch: ConfirmPatch; result: unknown }) => {
      if (!pending) return;
      const amountCents = patch.amount !== undefined ? reaisToCents(patch.amount) : Math.abs(reaisToCents(pending.amount));
      const day = `${patch.date.getFullYear()}-${String(patch.date.getMonth() + 1).padStart(2, '0')}-${String(patch.date.getDate()).padStart(2, '0')}`;
      success(confirmCopy(pending.type).success(formatCurrency(amountCents / 100, baseCurrency), dayText(day)));
      const notice = (result as { recurringUpdated?: { id: string; amount: number } } | undefined)?.recurringUpdated;
      const message = recurrenceUpdatedMessage(notice, (value) => formatCurrency(value, baseCurrency));
      if (message) success(message);
    },
    [pending, success, baseCurrency],
  );

  const follows = pending
    ? followsLast(
        { ...pending, date: pending.date, recurringTransactionId: pending.recurringTransactionId },
        recurringTransactions,
        transactions,
        new Date(),
      )
    : false;

  // How the expected amount was reached, when the recurrence has a forecast strategy (the reference month decides the days)
  const recurrence = pending?.recurringTransactionId ? recurringTransactions.find((r) => r.id === pending.recurringTransactionId) : undefined;
  const explanation = pending && recurrence
    ? confirmExplanation(recurrence, pending.type === 'INCOME' ? 'INCOME' : 'EXPENSE', pending.competenceMonth || monthKeyOf(pending.date), (cents) => formatCurrency(cents / 100, baseCurrency))
    : null;

  const dialog = (
    <ConfirmReceiptDialog
      transaction={pending}
      baseCurrency={baseCurrency}
      followsLastAmount={follows}
      explanation={explanation}
      onConfirm={onConfirm}
      onConfirmed={onConfirmed}
      onClose={() => setPending(null)}
      t={t as unknown as Record<string, string | undefined>}
    />
  );

  return { request, dialog };
}

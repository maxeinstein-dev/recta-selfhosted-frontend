import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { formatCurrency } from '../utils/format';
import { reaisToCents } from '../utils/people';
import {
  buildPatch, confirmCopy, confirmErrorMessage, dayText, differenceHint, initialDraft, keptReferenceMonth, maskCents, validateConfirm,
} from '../utils/confirmReceipt';
import type { ConfirmDraft, ConfirmPatch, ConfirmableTx } from '../utils/confirmReceipt';
import { monthLabel, referenceChip } from '../utils/referenceMonth';
import { impliedDaysNote } from '../utils/forecastStrategy';
import type { ConfirmExplanation } from '../utils/forecastStrategy';
import { BTN_PRIMARY, BTN_SECONDARY, DialogShell, ERROR_CLS, INPUT_CLS, LABEL_CLS, MUTED_CLS, NOTICE_BOX_CLS } from './people/ui';

export interface ConfirmReceiptDialogProps {
  /** The pending transaction to confirm; null keeps the dialog closed. */
  transaction: (ConfirmableTx & { description?: string; competenceMonth?: string | null }) | null;
  baseCurrency: string;
  /** True when confirming a new amount also makes the recurrence follow it ("as próximas ocorrências passam a usar ..."). */
  followsLastAmount?: boolean;
  /**
   * How the expected amount is reached when the recurrence has a forecast strategy (fixed, conservative, per business day):
   * shown under the title, and, for the per-day mode, the days the received amount stands for. Null/absent = the last value.
   */
  explanation?: ConfirmExplanation | null;
  /** Reads the clock, so a scenario can pin "today". */
  today?: () => Date;
  /** Sends the update (PATCH {amount?, date, paid:true, notes?}); rejects with the server error (409 carries `status`). */
  onConfirm: (patch: ConfirmPatch) => Promise<unknown>;
  /** Called once the confirmation was applied (the caller shows the toast); the dialog then closes itself through onClose. */
  onConfirmed?: (info: { patch: ConfirmPatch; result: unknown }) => void;
  onClose: () => void;
  /** Optional translations (keys of the i18n files); the Portuguese defaults are used for the missing ones. */
  t?: Record<string, string | undefined>;
}

/**
 * "Confirmar recebimento" (income) / "Confirmar pagamento" (expense): confirms a pending transaction with the amount and
 * the date it really had. The balance moves once, through the existing update, with the actual amount and date; the
 * reference month stays as it is. Opening shows the expected amount and date; confirming again (a double click, another
 * tab) never moves the balance twice.
 */
const ConfirmReceiptDialog = ({ transaction, baseCurrency, followsLastAmount = false, explanation = null, today = () => new Date(), onConfirm, onConfirmed, onClose, t = {} }: ConfirmReceiptDialogProps) => {
  const copy = confirmCopy(transaction?.type);
  const format = (cents: number): string => formatCurrency(cents / 100, baseCurrency);
  const [draft, setDraft] = useState<ConfirmDraft>({ amountText: '', dateKey: '', note: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  // Latest wins: an answer that arrives after the dialog was reopened for another transaction changes nothing.
  const openingRef = useRef(0);
  const id = transaction?.id;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Every opening starts from the expected amount and date of the transaction.
  useEffect(() => {
    if (!transaction) return;
    openingRef.current += 1;
    setDraft(initialDraft(transaction, today(), format));
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const expectedCents = transaction ? Math.abs(reaisToCents(transaction.amount)) : 0;
  const check = useMemo(() => validateConfirm(draft, format), [draft, baseCurrency]); // eslint-disable-line react-hooks/exhaustive-deps
  const hint = transaction ? differenceHint(expectedCents, check.amountCents, transaction.type, followsLastAmount, format, explanation?.strategy) : null;
  // Per business day: the days the received amount stands for, and a suggestion when they differ from the calculated ones
  const daysNote = explanation?.perDay
    ? impliedDaysNote(check.amountCents, explanation.perDay.rateCents, explanation.perDay.countedDays, explanation.perDay.businessDays, explanation.perDay.referenceMonth, format)
    : null;
  const chip = transaction ? referenceChip({ date: transaction.date, competenceMonth: transaction.competenceMonth, type: transaction.type }) : null;

  const kept = transaction ? keptReferenceMonth(transaction, draft.dateKey) : null;

  const edit = (apply: (d: ConfirmDraft) => ConfirmDraft) => {
    setDraft(apply);
    setFormError(null);
  };

  const handleSave = async () => {
    if (!transaction || savingRef.current) return;
    const patch = buildPatch(transaction, draft, format);
    if (!patch) {
      setFormError('Revise o valor e a data.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setFormError(null);
    const opening = openingRef.current;
    try {
      const result = await onConfirm(patch);
      if (opening === openingRef.current && mountedRef.current) {
        onConfirmed?.({ patch, result });
        onClose();
      }
    } catch (err: unknown) {
      if (opening === openingRef.current && mountedRef.current) setFormError(confirmErrorMessage(err));
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const expense = transaction?.type === 'EXPENSE';
  const tr = (key: string, fallback: string): string => t[key] || fallback;
  const title = expense ? tr('confirmPaymentTitle', copy.title) : tr('confirmReceiptTitle', copy.title);
  const amountLabel = expense ? tr('paidAmountLabel', copy.amountLabel) : tr('receivedAmountLabel', copy.amountLabel);
  const dateLabel = expense ? tr('paymentDateLabel', copy.dateLabel) : tr('receivedDateLabel', copy.dateLabel);
  const actionLabel = expense ? tr('confirmPaymentAction', copy.action) : tr('confirmReceiptAction', copy.action);

  return (
    <DialogShell open={!!transaction} onClose={onClose} canClose={!saving} titleId="confirm-receipt-title" widthClass="max-w-md" title={title}
      icon={<CheckCircle className="h-5 w-5 text-gray-500 dark:text-gray-400 mr-3 flex-shrink-0" aria-hidden="true" />}>
      {transaction && (
        <div className="space-y-4 min-w-0">
          <p className={`text-sm ${MUTED_CLS}`}>
            <strong className="font-medium text-gray-900 dark:text-white">{transaction.description || '-'}</strong>
            {' '}· esperado {format(expectedCents)} em {dayText(initialExpectedKey(transaction))}
            {chip ? <> · <span>{chip}</span></> : null}
          </p>

          {explanation && (
            <p className={`text-xs ${MUTED_CLS}`} data-testid="confirm-how">
              Como foi calculado: {explanation.how}.
              {explanation.todayCents !== null && explanation.todayCents !== expectedCents ? ` Com a configuração de hoje o cálculo daria ${format(explanation.todayCents)}.` : ''}
            </p>
          )}

          <div>
            <label htmlFor="confirm-amount" className={LABEL_CLS}>{amountLabel}</label>
            <input id="confirm-amount" type="text" inputMode="numeric" autoComplete="off" value={maskCents(draft.amountText, format).display} disabled={saving}
              className={INPUT_CLS} placeholder="R$ 0,00" aria-invalid={check.errors.amount ? true : undefined}
              onChange={(e) => edit((d) => ({ ...d, amountText: maskCents(e.target.value, format).display }))} />
            {check.errors.amount && <p role="alert" className={`mt-1 ${ERROR_CLS}`}>{check.errors.amount}</p>}
            {daysNote && (
              <p className={`mt-1 text-xs ${MUTED_CLS}`} data-testid="confirm-implied">Equivale a {daysNote.implied}.</p>
            )}
          </div>

          <div>
            <label htmlFor="confirm-date" className={LABEL_CLS}>{dateLabel}</label>
            <input id="confirm-date" type="date" value={draft.dateKey} disabled={saving} className={INPUT_CLS}
              aria-invalid={check.errors.date ? true : undefined} onChange={(e) => edit((d) => ({ ...d, dateKey: e.target.value }))} />
            {check.errors.date && <p role="alert" className={`mt-1 ${ERROR_CLS}`}>{check.errors.date}</p>}
            <p className={`mt-1 text-xs ${MUTED_CLS}`}>O saldo da conta muda nesta data, com o valor acima.</p>
          </div>

          <div>
            <label htmlFor="confirm-note" className={LABEL_CLS}>{tr('confirmNoteLabel', 'Observação (opcional)')}</label>
            <input id="confirm-note" type="text" maxLength={500} value={draft.note} disabled={saving} className={INPUT_CLS}
              onChange={(e) => edit((d) => ({ ...d, note: e.target.value }))} />
          </div>

          {kept && (
            <div className={NOTICE_BOX_CLS} aria-live="polite">
              <p data-testid="confirm-kept-month">Continua contando para {monthLabel(kept)}, o mês em que era esperado.</p>
            </div>
          )}

          {hint && <div className={NOTICE_BOX_CLS} aria-live="polite"><p data-testid="confirm-hint">{hint}</p></div>}

          {daysNote?.suggestion && (
            <div className={NOTICE_BOX_CLS} aria-live="polite"><p data-testid="confirm-implied-suggestion">{daysNote.suggestion}</p></div>
          )}

          {formError && <p role="alert" className={ERROR_CLS}>{formError}</p>}

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} disabled={saving} className={BTN_SECONDARY}>{tr('cancel', 'Cancelar')}</button>
            <button type="button" onClick={() => void handleSave()} disabled={saving || !check.ok} className={BTN_PRIMARY}>
              {saving ? tr('confirming', 'Confirmando…') : actionLabel}
            </button>
          </div>
        </div>
      )}
    </DialogShell>
  );
};

/** YYYY-MM-DD of the expected date (a Date is read by its local day). */
function initialExpectedKey(tx: ConfirmableTx): string {
  const d = tx.date;
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return String(d).slice(0, 10);
}

export default ConfirmReceiptDialog;

import { useEffect, useMemo, useRef, useState } from 'react';
import { Scale } from 'lucide-react';
import { useAdjustAccountBalance } from '../../hooks/api/useAccounts';
import { useToastContext } from '../../context/ToastContext';
import { useCurrency } from '../../context/CurrencyContext';
import { formatCurrency } from '../../utils/format';
import {
  buildAdjustBody, defaultAdjustReason, describeAdjustment, formatIsoDate, lastDayOfPreviousYear, maskMoneyInput, reaisToCents,
  todayIsoDate, validateAdjust, MAX_REASON_LENGTH,
} from '../../utils/adjustBalance';
import {
  BTN_PRIMARY, BTN_SECONDARY, CHECKBOX_CLS, DialogShell, ERROR_CLS, INPUT_CLS, LABEL_CLS, LINK_CLS, MUTED_CLS, NOTICE_BOX_CLS, getErrorMessage,
} from '../people/ui';

interface AdjustBalanceDialogProps {
  open: boolean;
  onClose: () => void;
  accountId: string | null;
  accountName: string;
  /** Current total balance in reais, as the account page shows it. */
  currentBalance: number;
}

/**
 * "Ajustar saldo": makes the account balance match the bank with ONE adjustment entry (an income when the account is
 * short, an expense when it is over). No payment or transaction that exists is touched. The entry is dated by the user:
 * an opening balance goes at the end of the previous year so it stays out of this year's reports.
 */
const AdjustBalanceDialog = ({ open, onClose, accountId, accountName, currentBalance }: AdjustBalanceDialogProps) => {
  const { success, error: showError } = useToastContext();
  const { baseCurrency } = useCurrency();
  const money = (cents: number): string => formatCurrency(cents / 100, baseCurrency);
  const mutation = useAdjustAccountBalance();

  const [targetText, setTargetText] = useState('');
  const [date, setDate] = useState(todayIsoDate());
  const [reason, setReason] = useState(defaultAdjustReason(todayIsoDate()));
  const [confirmed, setConfirmed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  // The reason follows the date until the user types their own.
  const reasonEditedRef = useRef(false);
  // Latest wins: an answer that arrives after the dialog was reopened (another account, a fresh form) changes nothing.
  const openingRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Every opening starts from a blank form: the balance is typed on purpose, never preset.
  useEffect(() => {
    if (!open) return;
    openingRef.current += 1;
    reasonEditedRef.current = false;
    const today = todayIsoDate();
    setTargetText('');
    setDate(today);
    setReason(defaultAdjustReason(today));
    setConfirmed(false);
    setFormError(null);
  }, [open, accountId]);

  const currentCents = reaisToCents(currentBalance);
  const target = useMemo(() => maskMoneyInput(targetText), [targetText]);
  const input = { currentCents, targetCents: target.cents, date, reason };
  const check = validateAdjust(input);
  const diff = check.differenceCents;

  // Anything the user is shown the confirmation for must be what is sent: editing a field takes the confirmation back.
  const edit = (apply: () => void) => {
    apply();
    setConfirmed(false);
    setFormError(null);
  };

  const handleDate = (value: string) => edit(() => {
    setDate(value);
    if (!reasonEditedRef.current) setReason(defaultAdjustReason(value));
  });

  const handleSave = async () => {
    if (!accountId || savingRef.current || !confirmed) return;
    const body = buildAdjustBody(input);
    if (!body) {
      setFormError('Revise os dados do ajuste.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setFormError(null);
    const opening = openingRef.current;
    const sentDiff = diff;
    try {
      const result = await mutation.mutateAsync({ accountId, ...body });
      success(result.adjustment && sentDiff !== null
        ? `Saldo ajustado: ${describeAdjustment(sentDiff, money)} em ${formatIsoDate(body.date)}.`
        : 'A conta já estava com esse saldo; nada foi lançado.');
      if (opening === openingRef.current && mountedRef.current) {
        // Applied: another submit needs a new confirmation, even if the parent keeps the dialog open.
        setConfirmed(false);
        onClose();
      }
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Não foi possível ajustar o saldo.');
      if (opening === openingRef.current && mountedRef.current) setFormError(message);
      showError(message);
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const ready = check.ok && confirmed && diff !== null;

  return (
    <DialogShell open={open && !!accountId} onClose={onClose} canClose={!saving} titleId="adjust-balance-title" widthClass="max-w-lg"
      title={`Ajustar saldo de ${accountName}`}
      icon={<Scale className="h-5 w-5 text-gray-500 dark:text-gray-400 mr-3 flex-shrink-0" aria-hidden="true" />}>
      <div className="space-y-4 min-w-0">
        <p className={`text-sm ${MUTED_CLS}`}>
          Saldo atual no Recta: <strong className="font-medium text-gray-900 dark:text-white">{money(currentCents)}</strong>
        </p>

        <div>
          <label htmlFor="adjust-target" className={LABEL_CLS}>Saldo correto (o do banco)</label>
          <input id="adjust-target" type="text" inputMode="numeric" autoComplete="off" value={target.display} disabled={saving} className={INPUT_CLS}
            placeholder="R$ 0,00" aria-invalid={targetText && check.errors.target ? true : undefined}
            onChange={(e) => edit(() => setTargetText(e.target.value))} />
          {targetText && check.errors.target && <p role="alert" className={`mt-1 ${ERROR_CLS}`}>{check.errors.target}</p>}
        </div>

        <div>
          <label htmlFor="adjust-date" className={LABEL_CLS}>Data do ajuste</label>
          <input id="adjust-date" type="date" value={date} max={todayIsoDate()} disabled={saving} className={INPUT_CLS}
            aria-invalid={check.errors.date ? true : undefined} onChange={(e) => handleDate(e.target.value)} />
          {check.errors.date && <p role="alert" className={`mt-1 ${ERROR_CLS}`}>{check.errors.date}</p>}
          <p className={`mt-1 text-xs ${MUTED_CLS}`}>
            Para o saldo inicial, use {formatIsoDate(lastDayOfPreviousYear())}: o lançamento fica fora dos relatórios do ano atual.{' '}
            <button type="button" className={LINK_CLS} disabled={saving} onClick={() => handleDate(lastDayOfPreviousYear())}>
              Usar {formatIsoDate(lastDayOfPreviousYear())}
            </button>
          </p>
        </div>

        <div>
          <label htmlFor="adjust-reason" className={LABEL_CLS}>Motivo</label>
          <input id="adjust-reason" type="text" maxLength={MAX_REASON_LENGTH} value={reason} disabled={saving} className={INPUT_CLS}
            onChange={(e) => edit(() => { reasonEditedRef.current = true; setReason(e.target.value); })} />
          {check.errors.reason && <p role="alert" className={`mt-1 ${ERROR_CLS}`}>{check.errors.reason}</p>}
        </div>

        {diff !== null && diff !== 0 && (
          <div className={NOTICE_BOX_CLS} aria-live="polite">
            <p>
              Diferença: <strong>{diff > 0 ? '+' : '-'}{money(Math.abs(diff))}</strong>. Será criada {describeAdjustment(diff, money)} em{' '}
              {formatIsoDate(date) || 'data a definir'}, e o saldo passa a ser {money(target.cents ?? 0)}.
            </p>
            <p className="text-xs">Nenhuma transação ou pagamento que já existe é alterado.</p>
          </div>
        )}

        <label className="flex items-start gap-2 text-sm text-gray-900 dark:text-gray-100 cursor-pointer">
          <input type="checkbox" className={`${CHECKBOX_CLS} mt-0.5`} checked={confirmed} disabled={saving || !check.ok}
            onChange={(e) => setConfirmed(e.target.checked)} />
          <span>Confirmo o saldo e a data acima.</span>
        </label>

        {formError && <p role="alert" className={ERROR_CLS}>{formError}</p>}

        <div className="flex gap-3 justify-end pt-2">
          <button type="button" onClick={onClose} disabled={saving} className={BTN_SECONDARY}>Cancelar</button>
          <button type="button" onClick={() => void handleSave()} disabled={saving || !ready} className={BTN_PRIMARY}>
            {saving ? 'Ajustando…' : 'Ajustar saldo'}
          </button>
        </div>
      </div>
    </DialogShell>
  );
};

export default AdjustBalanceDialog;

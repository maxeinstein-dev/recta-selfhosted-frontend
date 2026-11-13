import { useState, type FormEvent } from 'react';
import { useI18n } from '../../context/I18nContext';
import { useToastContext } from '../../context/ToastContext';
import { useCurrencyMask } from '../../hooks/useCurrencyMask';
import { useAvailableAccounts } from '../../hooks/api/useAccounts';
import { useConfirmCapture } from '../../hooks/api/useCaptures';
import { TransactionType, getCategoriesByType, CategoryType } from '../../lib/enums';
import { formatDateForAPI } from '../../utils/format';
import {
  appLabel,
  buildConfirmBody,
  captureAccountOptions,
  dateFromDayKey,
  draftFromSuggestion,
  localDayKey,
  DESCRIPTION_MAX,
  type CaptureDraft,
  type CaptureDraftField,
  type CaptureItem,
} from '../../utils/captureInbox';
import { captureText, type CaptureTextKey } from '../../utils/captureTexts';
import { readingOf, warningText } from '../../utils/captureReading';
import SelectCombobox from '../SelectCombobox';
import CategoryCombobox from '../CategoryCombobox';
import { DatePicker } from '../DatePicker';
import { DialogShell, INPUT_CLS, LABEL_CLS, BTN_PRIMARY, BTN_SECONDARY, ERROR_CLS, MUTED_CLS } from '../people/ui';

/** The touch target the phone needs (WCAG 2.5.5 and the Android guideline). */
const TOUCH = 'min-h-[44px]';

const MISSING_TEXT: Record<CaptureDraftField, CaptureTextKey> = {
  type: 'captureFormType',
  accountId: 'captureFormAccount',
  categoryName: 'captureFormCategory',
  amount: 'captureFormAmount',
  date: 'captureFormDate',
};

interface CaptureConfirmModalProps {
  item: CaptureItem;
  householdId: string;
  /** Called after the transaction exists, or when the capture stopped being pending (409): the list then refreshes. */
  onDone: () => void;
  onClose: () => void;
}

/**
 * The transaction form of one capture. It opens with what the suggestion gave and the user corrects any field; the
 * submit posts POST /captures/:id/confirm, never POST /transactions (the server sets the source reference).
 */
const CaptureConfirmModal = ({ item, householdId, onDone, onClose }: CaptureConfirmModalProps) => {
  const { t } = useI18n();
  const tx = (key: CaptureTextKey) => captureText(t, key);
  const { error: showError, success } = useToastContext();
  const confirm = useConfirmCapture();
  const { data: availableAccounts } = useAvailableAccounts(householdId, false);
  const accountOptions = captureAccountOptions(availableAccounts?.accounts ?? []);

  const [draft, setDraft] = useState<CaptureDraft>(() =>
    draftFromSuggestion(item.suggestion, localDayKey(new Date().toISOString()) ?? ''),
  );
  const currency = useCurrencyMask(item.suggestion.amount ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const saving = confirm.isPending;

  const set = <K extends keyof CaptureDraft>(field: K, value: CaptureDraft[K]) =>
    setDraft((current) => ({ ...current, [field]: value }));

  // Changing the type drops a system category that does not belong to it; a custom one stays (its type is not known here).
  const chooseType = (type: CaptureDraft['type']) => {
    setDraft((current) => {
      if (current.type === type || !current.categoryName || current.categoryName.startsWith('CUSTOM:')) {
        return { ...current, type };
      }
      const allowed = getCategoriesByType(type === 'INCOME' ? CategoryType.INCOME : CategoryType.EXPENSE);
      return { ...current, type, categoryName: allowed.includes(current.categoryName as never) ? current.categoryName : '' };
    });
  };

  const typeEnum = draft.type === 'INCOME' ? TransactionType.INCOME : draft.type === 'EXPENSE' ? TransactionType.EXPENSE : undefined;
  const dayDate = dateFromDayKey(draft.date);
  const amountValue = currency.numericValue > 0 ? currency.numericValue : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const result = buildConfirmBody({ ...draft, amount: amountValue, description: draft.description.slice(0, DESCRIPTION_MAX) });
    if (!result.ok) {
      const labels = result.missing.map((field) => tx(MISSING_TEXT[field]));
      if (result.missing.includes('amount') && result.missing.length === 1) setProblem(tx('captureFormAmountInvalid'));
      else setProblem(`${tx('captureFormMissing')}: ${labels.join(', ')}.`);
      return;
    }
    setProblem(null);
    try {
      await confirm.mutateAsync({ id: item.id, householdId, body: result.body });
      success(tx('captureConfirmedToast'));
      onDone();
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 409) {
        showError(tx('captureChangedElsewhere'));
        onDone();
        return;
      }
      setProblem(tx('captureActionFailed'));
    }
  };

  const noAccounts = accountOptions.length === 0;
  const reading = readingOf(item);
  const warning = warningText(reading.warning);
  // What the reader understood that the form has no field for: the merchant and the card ending.
  const readNote = [reading.merchant, reading.cardLast4 ? `cartão final ${reading.cardLast4}` : null].filter(Boolean).join(' · ');
  const typeButton = (type: 'INCOME' | 'EXPENSE', label: string) => {
    const active = draft.type === type;
    return (
      <button
        type="button"
        aria-pressed={active}
        disabled={saving}
        onClick={() => chooseType(type)}
        className={`${TOUCH} flex-1 px-3 py-2 text-sm font-light rounded-md border transition-opacity disabled:opacity-50 ${
          active
            ? 'border-primary-600 dark:border-primary-500 bg-primary-600 dark:bg-primary-500 text-white'
            : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white'
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <DialogShell
      open
      onClose={onClose}
      canClose={!saving}
      titleId="capture-confirm-title"
      title={tx('captureFormTitle')}
      widthClass="max-w-md"
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className={`text-xs font-light ${MUTED_CLS}`}>
          {appLabel(item.package)} · {tx('captureFormIntro')}
        </p>
        {readNote && (
          <p className="text-sm font-light text-gray-800 dark:text-gray-200 break-words">
            <span className={MUTED_CLS}>Lido: </span>{readNote}
          </p>
        )}
        {warning && (
          <p role="note" className="rounded-md bg-amber-50 dark:bg-amber-900/30 px-3 py-2 text-xs font-light text-amber-800 dark:text-amber-200">
            {warning}. Se for, descarte esta captura e lance a transferência pelo Extrato.
          </p>
        )}

        <div>
          <span className={LABEL_CLS}>{tx('captureFormType')}</span>
          <div className="flex gap-2">
            {typeButton('INCOME', tx('captureFormIncome'))}
            {typeButton('EXPENSE', tx('captureFormExpense'))}
          </div>
        </div>

        <div>
          <label htmlFor="capture-amount" className={LABEL_CLS}>{tx('captureFormAmount')}</label>
          <input
            id="capture-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            disabled={saving}
            value={currency.value}
            onChange={currency.onChange}
            className={`${INPUT_CLS} ${TOUCH} text-right text-lg`}
          />
        </div>

        <div>
          <span className={LABEL_CLS}>{tx('captureFormDate')}</span>
          <DatePicker
            value={dayDate}
            onChange={(date) => set('date', date ? formatDateForAPI(date) : '')}
            placeholder={tx('captureFormDate')}
            disabled={saving}
            useModal
          />
        </div>

        <div>
          <span className={LABEL_CLS}>{tx('captureFormAccount')}</span>
          <SelectCombobox
            value={draft.accountId}
            onValueChange={(value) => set('accountId', value)}
            options={accountOptions}
            placeholder={tx('captureFormAccount')}
            disabled={saving || noAccounts}
          />
          {noAccounts && <p className={`mt-1 ${ERROR_CLS}`}>{tx('captureFormNoAccounts')}</p>}
        </div>

        <div>
          <span className={LABEL_CLS}>{tx('captureFormCategory')}</span>
          <CategoryCombobox
            value={draft.categoryName}
            onValueChange={(value) => set('categoryName', value)}
            placeholder={tx('captureFormCategory')}
            type={typeEnum}
            householdId={householdId}
            disabled={saving}
            allowCreate={false}
          />
        </div>

        <div>
          <label htmlFor="capture-description" className={LABEL_CLS}>{tx('captureFormDescription')}</label>
          <input
            id="capture-description"
            type="text"
            maxLength={DESCRIPTION_MAX}
            disabled={saving}
            value={draft.description}
            onChange={(e) => set('description', e.target.value)}
            className={`${INPUT_CLS} ${TOUCH}`}
          />
        </div>

        {problem && (
          <p role="alert" className={ERROR_CLS}>
            {problem}
          </p>
        )}

        <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={saving} className={`${BTN_SECONDARY} ${TOUCH} w-full sm:w-auto`}>
            {tx('captureFormCancel')}
          </button>
          <button type="submit" disabled={saving || noAccounts} className={`${BTN_PRIMARY} ${TOUCH} w-full sm:w-auto`}>
            {saving ? tx('captureFormSaving') : tx('captureFormSave')}
          </button>
        </div>
      </form>
    </DialogShell>
  );
};

export default CaptureConfirmModal;

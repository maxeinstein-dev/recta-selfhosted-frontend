import { useState } from 'react';
import { useI18n } from '../../context/I18nContext';
import { formatCurrency } from '../../utils/format';
import { AlertTriangle } from 'lucide-react';
import { appLabel, formatCaptureDateTime, type CaptureItem } from '../../utils/captureInbox';
import { METHOD_TEXT, canConfirmInOneTap, fallbackCategory, readingOf, warningText } from '../../utils/captureReading';
import { captureText, type CaptureTextKey } from '../../utils/captureTexts';
import { BTN_PRIMARY, BTN_SECONDARY, MUTED_CLS } from '../people/ui';

/** Long texts start folded: three lines, with a button that opens the rest. */
const FOLD_AFTER_CHARS = 140;
/** The touch target of every action (the phone needs 44 px). */
const TOUCH = 'min-h-[44px]';

export type CaptureBusy = 'confirm' | 'dismiss' | 'restore' | null;

interface CaptureCardProps {
  item: CaptureItem;
  /** The name of the suggested account and category, from the household's lists. */
  accountName: (id: string) => string | null;
  categoryLabel: (value: string) => string;
  canEdit: boolean;
  busy: CaptureBusy;
  onConfirm: () => void;
  onEdit: () => void;
  onDismiss: () => void;
  onRestore: () => void;
}

/**
 * One capture in the inbox. The primary action sits full width at the top of the actions, so it is in thumb reach on a
 * phone: one tap when the suggestion is complete, otherwise it opens the form filled with what there is.
 */
const CaptureCard = ({ item, accountName, categoryLabel, canEdit, busy, onConfirm, onEdit, onDismiss, onRestore }: CaptureCardProps) => {
  const { t } = useI18n();
  const tx = (key: CaptureTextKey) => captureText(t, key);
  const [expanded, setExpanded] = useState(false);
  const { suggestion } = item;
  const reading = readingOf(item);
  const hasAnySuggestion = reading.type !== null || reading.accountId !== null || reading.amount !== null || reading.title !== null;
  const complete = canConfirmInOneTap(suggestion);
  const dismissed = item.status === 'DISMISSED';
  const folded = item.text.length > FOLD_AFTER_CHARS;
  // The amount is the server's, in reais; the screen only formats it.
  const amount = reading.amount === null ? null : formatCurrency(reading.amount);
  const account = reading.accountId ? accountName(reading.accountId) : null;
  // The category a one-tap confirm will use: the suggested one, else "Outras despesas/receitas".
  const categoryValue = suggestion.categoryName ?? (complete && reading.type ? fallbackCategory(reading.type) : null);
  const category = categoryValue ? categoryLabel(categoryValue) : null;
  const method = reading.method ? METHOD_TEXT[reading.method] ?? null : null;
  const warning = warningText(reading.warning);

  return (
    <li className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white break-words">{appLabel(item.package)}</p>
        <p className={`text-xs font-light ${MUTED_CLS}`}>{formatCaptureDateTime(item.postedAt)}</p>
      </div>

      <div className="min-w-0">
        <p className={`text-xs font-light mb-1 ${MUTED_CLS}`}>{tx('captureRawText')}</p>
        <p
          className={`text-sm font-light whitespace-pre-line break-words text-gray-800 dark:text-gray-200 ${
            folded && !expanded ? 'line-clamp-3' : ''
          }`}
        >
          {item.text}
        </p>
        {folded && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className={`${TOUCH} mt-1 text-sm font-light text-primary-600 dark:text-primary-400 hover:underline`}
          >
            {expanded ? tx('captureHideText') : tx('captureShowFullText')}
          </button>
        )}
      </div>

      <div className="rounded-md bg-gray-50 dark:bg-gray-800/50 p-3 min-w-0">
        <p className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-200">{tx('captureSuggestionTitle')}</p>
        {hasAnySuggestion ? (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm font-light">
            {amount && (
              <>
                <dt className={MUTED_CLS}>{tx('captureFormAmount')}</dt>
                <dd className="text-base font-medium tabular-nums text-gray-900 dark:text-white break-words">{amount}</dd>
              </>
            )}
            {reading.type && (
              <>
                <dt className={MUTED_CLS}>{tx('captureFormType')}</dt>
                <dd className="text-gray-900 dark:text-white break-words">
                  {reading.type === 'INCOME' ? tx('captureFormIncome') : tx('captureFormExpense')}
                  {method && <span className={MUTED_CLS}> · {method}{reading.installments ? ` em ${reading.installments}x` : ''}</span>}
                </dd>
              </>
            )}
            {reading.title && (
              <>
                <dt className={MUTED_CLS}>{reading.merchant ? 'Estabelecimento' : tx('captureFormDescription')}</dt>
                <dd className="text-gray-900 dark:text-white break-words">{reading.title}</dd>
              </>
            )}
            {(account || reading.cardLast4) && (
              <>
                <dt className={MUTED_CLS}>{tx('captureFormAccount')}</dt>
                <dd className="text-gray-900 dark:text-white break-words">
                  {account ?? <span className={MUTED_CLS}>sem conta</span>}
                  {reading.cardLast4 && <span className={MUTED_CLS}> · cartão final {reading.cardLast4}</span>}
                </dd>
              </>
            )}
            {category && (
              <>
                <dt className={MUTED_CLS}>{tx('captureFormCategory')}</dt>
                <dd className="text-gray-900 dark:text-white break-words">{category}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className={`text-sm font-light ${MUTED_CLS}`}>
            {!reading.notice
              ? tx('captureNoSuggestion')
              : dismissed
                ? 'Aviso ou promoção, sem lançamento: foi descartado sozinho. Restaure se for uma transação.'
                : 'Aviso ou promoção, sem valor de transação. Preencha o lançamento se for uma.'}
          </p>
        )}
        {warning && (
          <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 dark:bg-amber-900/30 px-2 py-1.5 text-xs font-light text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{warning}. Confira antes de confirmar.</span>
          </p>
        )}
        {!dismissed && hasAnySuggestion && !complete && (
          <p className={`mt-2 text-xs font-light ${MUTED_CLS}`}>{tx('captureIncompleteSuggestion')}</p>
        )}
      </div>

      {canEdit && !dismissed && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy !== null}
            className={`${BTN_PRIMARY} ${TOUCH} w-full`}
          >
            {busy === 'confirm' ? tx('captureConfirming') : complete ? tx('captureConfirm') : tx('captureFillAndConfirm')}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onEdit} disabled={busy !== null} className={`${BTN_SECONDARY} ${TOUCH}`}>
              {tx('captureEdit')}
            </button>
            <button type="button" onClick={onDismiss} disabled={busy !== null} className={`${BTN_SECONDARY} ${TOUCH}`}>
              {busy === 'dismiss' ? tx('captureDismissing') : tx('captureDismiss')}
            </button>
          </div>
        </div>
      )}

      {canEdit && dismissed && (
        <button type="button" onClick={onRestore} disabled={busy !== null} className={`${BTN_SECONDARY} ${TOUCH} w-full`}>
          {busy === 'restore' ? tx('captureRestoring') : tx('captureRestore')}
        </button>
      )}
    </li>
  );
};

export default CaptureCard;

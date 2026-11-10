import { useState } from 'react';
import { useI18n } from '../../context/I18nContext';
import { formatCurrency } from '../../utils/format';
import {
  appLabel,
  formatCaptureDateTime,
  isSuggestionComplete,
  type CaptureItem,
  type CaptureSuggestion,
} from '../../utils/captureInbox';
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

const formatSuggestionAmount = (suggestion: CaptureSuggestion): string | null =>
  suggestion.amount === null ? null : formatCurrency(suggestion.amount);

/**
 * One capture in the inbox. The primary action sits full width at the top of the actions, so it is in thumb reach on a
 * phone: one tap when the suggestion is complete, otherwise it opens the form filled with what there is.
 */
const CaptureCard = ({ item, accountName, categoryLabel, canEdit, busy, onConfirm, onEdit, onDismiss, onRestore }: CaptureCardProps) => {
  const { t } = useI18n();
  const tx = (key: CaptureTextKey) => captureText(t, key);
  const [expanded, setExpanded] = useState(false);
  const { suggestion } = item;
  const hasAnySuggestion = suggestion.type !== null || suggestion.accountId !== null || suggestion.categoryName !== null || suggestion.amount !== null;
  const complete = isSuggestionComplete(suggestion);
  const dismissed = item.status === 'DISMISSED';
  const folded = item.text.length > FOLD_AFTER_CHARS;
  const amount = formatSuggestionAmount(suggestion);
  const account = suggestion.accountId ? accountName(suggestion.accountId) : null;
  const category = suggestion.categoryName ? categoryLabel(suggestion.categoryName) : null;

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
            {suggestion.type && (
              <>
                <dt className={MUTED_CLS}>{tx('captureFormType')}</dt>
                <dd className="text-gray-900 dark:text-white break-words">
                  {suggestion.type === 'INCOME' ? tx('captureFormIncome') : tx('captureFormExpense')}
                </dd>
              </>
            )}
            {amount && (
              <>
                <dt className={MUTED_CLS}>{tx('captureFormAmount')}</dt>
                <dd className="text-gray-900 dark:text-white break-words">{amount}</dd>
              </>
            )}
            {account && (
              <>
                <dt className={MUTED_CLS}>{tx('captureFormAccount')}</dt>
                <dd className="text-gray-900 dark:text-white break-words">{account}</dd>
              </>
            )}
            {category && (
              <>
                <dt className={MUTED_CLS}>{tx('captureFormCategory')}</dt>
                <dd className="text-gray-900 dark:text-white break-words">{category}</dd>
              </>
            )}
            {suggestion.description && (
              <>
                <dt className={MUTED_CLS}>{tx('captureFormDescription')}</dt>
                <dd className="text-gray-900 dark:text-white break-words">{suggestion.description}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className={`text-sm font-light ${MUTED_CLS}`}>{tx('captureNoSuggestion')}</p>
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

import { useI18n } from '../../context/I18nContext';

interface TransactionModalFooterProps {
  readOnly?: boolean;
  onClose: () => void;
  isSubmitting: boolean;
  hasErrors: boolean;
  isUpdate?: boolean;
  onSaveAndCreateNew?: () => void;
}

// On a phone the buttons stack, the primary one last at the bottom (thumb reach), each 44 px tall; from sm they sit in a row.
const FOOTER_CLS = 'flex flex-col gap-2 pt-6 border-t border-gray-100 dark:border-gray-800 sm:flex-row sm:justify-end sm:gap-3';
const BUTTON_BASE = 'min-h-[44px] w-full sm:w-auto px-4 py-2.5 border rounded-md text-sm font-light tracking-tight transition-opacity focus:outline-none';
const SECONDARY_CLS = `${BUTTON_BASE} border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white bg-white dark:bg-gray-900 hover:opacity-70`;
const ACCENT_CLS = `${BUTTON_BASE} border-primary-600 dark:border-primary-500 text-primary-600 dark:text-primary-400 bg-white dark:bg-gray-900 hover:opacity-70 disabled:opacity-50`;
const PRIMARY_CLS = `${BUTTON_BASE} border-primary-600 dark:border-primary-500 text-white bg-primary-600 dark:bg-primary-500 hover:opacity-80 disabled:opacity-50`;

export const TransactionModalFooter = ({
  readOnly,
  onClose,
  isSubmitting,
  hasErrors,
  isUpdate = false,
  onSaveAndCreateNew
}: TransactionModalFooterProps) => {
  const { t } = useI18n();

  return (
    <div className={FOOTER_CLS}>
      {readOnly ? (
        <button
          type="button"
          onClick={onClose}
          className={SECONDARY_CLS}
        >
          {t.close}
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={onClose}
            className={SECONDARY_CLS}
          >
            {t.cancel}
          </button>
          {!isUpdate && onSaveAndCreateNew && (
            <button
              type="button"
              onClick={onSaveAndCreateNew}
              disabled={isSubmitting || hasErrors}
              className={ACCENT_CLS}
            >
              {isSubmitting ? t.loading : t.saveAndCreateNew}
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting || hasErrors}
            className={PRIMARY_CLS}
          >
            {isSubmitting ? t.loading : isUpdate ? t.update : t.create}
          </button>
        </>
      )}
    </div>
  );
};

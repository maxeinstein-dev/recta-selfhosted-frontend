import { Controller, Control, FieldErrors, UseFormWatch } from 'react-hook-form';
import { AlertCircle } from 'lucide-react';
import { useI18n } from '../../context/I18nContext';
import { TransactionFormData } from '../../schemas';
import SelectCombobox from '../SelectCombobox';
import { accountOptionLabel } from '../../utils/accountOptionLabel';
import type { Account as AccountWithPersonal } from '../../hooks/api/useAccounts';

interface AccountFieldProps {
  control: Control<TransactionFormData>;
  watch: UseFormWatch<TransactionFormData>;
  errors: FieldErrors<TransactionFormData>;
  availableAccounts: AccountWithPersonal[];
  isCreditCardContext: boolean;
  hasNoAccountsAvailable: boolean;
  authUser?: { id: string } | null;
  disabled?: boolean;
}

export const AccountField = ({
  control,
  watch: _watch,
  errors,
  availableAccounts,
  isCreditCardContext,
  hasNoAccountsAvailable,
  authUser,
  disabled = false,
}: AccountFieldProps) => {
  const { t } = useI18n();

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {isCreditCardContext ? t.creditCard : t.account}
      </label>
      
      {hasNoAccountsAvailable && (
        <div className="mb-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <div className="flex items-start space-x-2">
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-900 dark:text-yellow-200">
                {t.noAccountsAvailable}
              </p>
              <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                {t.noAccountsAvailableMessage}
              </p>
            </div>
          </div>
        </div>
      )}
      
      <Controller
        name="accountId"
        control={control}
        render={({ field }) => (
          <SelectCombobox
            value={field.value || ''}
            onValueChange={field.onChange}
            options={[
              { value: '', label: t.selectAccount },
              ...availableAccounts.map((account: AccountWithPersonal) => {
                return {
                  value: account.id || '',
                  label: accountOptionLabel(account, { creditCard: t.creditCard, cash: t.cash, myPersonalAccount: t.myPersonalAccount, otherMemberPersonalAccount: t.otherMemberPersonalAccount }, authUser?.id),
                };
              })
            ]}
            placeholder={hasNoAccountsAvailable ? t.noAccountsAvailable : t.selectAccount}
            disabled={disabled || hasNoAccountsAvailable}
          />
        )}
      />
      {errors.accountId && (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.accountId.message}</p>
      )}
    </div>
  );
};

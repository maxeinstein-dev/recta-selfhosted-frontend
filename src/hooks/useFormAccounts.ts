import { useMemo } from 'react';
import { useTransactions } from '../context/TransactionsContext';
import { useDefaultHousehold } from './useDefaultHousehold';
import { useAvailableAccounts, useAccounts } from './api/useAccounts';
import { useHouseholds } from './api/useHouseholds';

/**
 * The accounts a lançamento form offers, shared by the full form and the mobile add sheet.
 * In a shared household the available-accounts endpoint is used; otherwise the household's accounts.
 */
export function useFormAccounts() {
  const { accounts: contextAccounts } = useTransactions();
  const { householdId, household: currentHousehold } = useDefaultHousehold();

  // Check if we're in a shared household (not personal)
  // A shared household is any household that is not the oldest one (personal is oldest)
  const { data: allHouseholds } = useHouseholds();
  const isSharedHousehold = useMemo(() => {
    if (!allHouseholds || allHouseholds.length === 0 || !currentHousehold) return false;
    // Personal household is the oldest (first by createdAt)
    const sortedHouseholds = [...allHouseholds].sort((a, b) =>
      new Date(a.createdAt || a.joinedAt || 0).getTime() - new Date(b.createdAt || b.joinedAt || 0).getTime()
    );
    const personalHousehold = sortedHouseholds[0];
    return personalHousehold?.id !== currentHousehold.id;
  }, [allHouseholds, currentHousehold]);

  // Use available accounts endpoint when in shared household, regular accounts otherwise
  const { data: availableAccountsData } = useAvailableAccounts(
    householdId || '',
    false
  );
  const { data: regularAccountsData } = useAccounts(
    { householdId: householdId || '' }
  );

  // In shared household, use available accounts (includes personal if allowed)
  // In personal household, use regular accounts
  const accounts = useMemo(() => {
    if (isSharedHousehold && availableAccountsData?.accounts) {
      return availableAccountsData.accounts;
    }
    if (!isSharedHousehold && regularAccountsData?.accounts) {
      return regularAccountsData.accounts;
    }
    // Fallback to context accounts
    return contextAccounts || [];
  }, [isSharedHousehold, availableAccountsData, regularAccountsData, contextAccounts]);

  return { householdId, household: currentHousehold, isSharedHousehold, accounts };
}

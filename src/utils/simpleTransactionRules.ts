import { getAvailableBalance } from './accountBalance';

/**
 * The checks the full form runs before creating a simple (not split, not transfer) income or expense.
 * Shared by the form and the mobile add sheet. Returns the reason to refuse, or null when it may be created.
 */
export type SimpleTransactionError = 'accountRequired' | 'insufficientBalance' | null;

export interface SimpleTransactionCheck {
  type: string;
  amount: number;
  paid: boolean;
  accountId: string;
}

export function simpleTransactionError(
  data: SimpleTransactionCheck,
  accounts: ReadonlyArray<{ id?: string | null; type: string; availableBalance?: number; totalBalance?: number; allocatedBalance?: number }>,
): SimpleTransactionError {
  if (data.type !== 'INCOME' && data.type !== 'EXPENSE') return null;
  if (!data.accountId) return 'accountRequired';
  if (data.type !== 'EXPENSE' || !data.paid) return null;
  const account = accounts.find((a) => a.id === data.accountId);
  // A card has a limit, not a balance: only the other accounts are checked.
  if (!account || account.type === 'CREDIT') return null;
  return data.amount > getAvailableBalance(account as Parameters<typeof getAvailableBalance>[0]) ? 'insufficientBalance' : null;
}

/**
 * The name an account shows in a choice list (the form's account field and the mobile add sheet).
 * Cards and cash get their type first; a personal account says whose it is.
 */
export interface AccountOptionLabels {
  creditCard: string;
  cash: string;
  myPersonalAccount: string;
  otherMemberPersonalAccount: string;
}

export interface AccountOptionSource {
  name: string;
  type: string;
  isPersonal?: boolean | null;
  accountOwnerId?: string | null;
}

export function accountOptionLabel(
  account: AccountOptionSource,
  labels: AccountOptionLabels,
  authUserId: string | null | undefined,
): string {
  let label = account.type === 'CREDIT'
    ? `${labels.creditCard} - ${account.name}`
    : account.type === 'CASH'
      ? `${labels.cash} - ${account.name}`
      : account.name;

  if (account.isPersonal === true) {
    const isOtherMember = Boolean(account.accountOwnerId) && account.accountOwnerId !== authUserId;
    label = `${label} ${isOtherMember ? labels.otherMemberPersonalAccount : labels.myPersonalAccount}`;
  }
  return label;
}

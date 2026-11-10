import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { useI18n } from '../../context/I18nContext';
import { useToastContext } from '../../context/ToastContext';
import { useAccounts } from '../../hooks/api/useAccounts';
import { useCaptureAccountRules, useSaveCaptureAccountRules } from '../../hooks/api/useCaptures';
import { CAPTURE_APPS, CAPTURE_KINDS, captureAccountOptions, type CaptureKind } from '../../utils/captureInbox';
import {
  draftFromRules,
  isRulesDraftChanged,
  ruleKey,
  shownRulePairs,
  type RulesDraft,
} from '../../utils/captureRules';
import { captureText, type CaptureTextKey } from '../../utils/captureTexts';
import SelectCombobox from '../SelectCombobox';
import { BTN_PRIMARY, BTN_SECONDARY, ERROR_CLS, MUTED_CLS } from '../people/ui';

const KIND_TEXT: Record<CaptureKind, CaptureTextKey> = {
  CARD_PURCHASE: 'captureKindCardPurchase',
  PIX_OUT: 'captureKindPixOut',
  PIX_IN: 'captureKindPixIn',
  REFUND: 'captureKindRefund',
  SAVINGS_MOVE: 'captureKindSavingsMove',
};

const TOUCH = 'min-h-[44px]';

interface CaptureRulesCardProps {
  householdId?: string;
  /** EDITOR or more; a viewer sees the accounts and cannot change them. */
  canEdit: boolean;
}

/**
 * Settings > Capturas, accounts part: which account each (app, kind) of notification posts to. The screen edits a draft
 * that starts from the server's rules; saving sends them with PUT /captures/account-rules (see buildRulesBody).
 */
const CaptureRulesCard = ({ householdId, canEdit }: CaptureRulesCardProps) => {
  const { t } = useI18n();
  const tx = (key: CaptureTextKey) => captureText(t, key);
  const { success, error: showError } = useToastContext();
  const rules = useCaptureAccountRules(householdId);
  const accounts = useAccounts({ householdId: householdId ?? '' });
  const save = useSaveCaptureAccountRules(householdId);

  // null: nothing edited yet, the screen shows the server's rules.
  const [draft, setDraft] = useState<RulesDraft | null>(null);
  const serverRules = rules.data ?? [];
  const current = draft ?? draftFromRules(serverRules);
  const dirty = draft !== null && isRulesDraftChanged(draft, serverRules);
  const options = captureAccountOptions(accounts.data?.accounts ?? []);

  const choose = (key: string, accountId: string) => {
    setDraft({ ...current, [key]: accountId });
  };

  const handleSave = async () => {
    if (!draft || !dirty || save.isPending) return;
    try {
      await save.mutateAsync({ draft, current: serverRules });
      setDraft(null);
      success(tx('captureRulesSaved'));
    } catch {
      showError(tx('captureRulesFailed'));
    }
  };

  const appPairs = CAPTURE_APPS.map((app) => ({
    app,
    pairs: shownRulePairs().filter((pair) => pair.package === app.package),
  }));

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg p-4 sm:p-6">
      <h2 className="text-lg sm:text-xl font-light tracking-tight text-gray-900 dark:text-white mb-2 flex items-center">
        <Wallet className="h-5 w-5 mr-2" aria-hidden="true" />
        {tx('captureRulesTitle')}
      </h2>
      <p className={`text-sm font-light mb-4 ${MUTED_CLS}`}>{tx('captureRulesIntro')}</p>

      {rules.isError && <p role="alert" className={`${ERROR_CLS} mb-3`}>{tx('captureRulesLoadError')}</p>}
      {!canEdit && <p className={`text-xs font-light mb-3 ${MUTED_CLS}`}>{tx('captureRulesReadOnly')}</p>}
      {canEdit && options.length === 0 && !accounts.isPending && (
        <p className={`text-xs font-light mb-3 ${MUTED_CLS}`}>{tx('captureRulesNoAccounts')}</p>
      )}

      <div className="space-y-6">
        {appPairs.map(({ app, pairs }) => (
          <section key={app.package} aria-label={app.label}>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">{app.label}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {pairs.map((pair) => {
                const key = ruleKey(pair.package, pair.kind);
                const kind = CAPTURE_KINDS.find((k) => k === pair.kind);
                return (
                  <div key={key} className="min-w-0">
                    <span className="block text-sm font-light text-gray-700 dark:text-gray-300 mb-1">
                      {kind ? tx(KIND_TEXT[kind]) : pair.kind}
                    </span>
                    <SelectCombobox
                      value={current[key] ?? ''}
                      onValueChange={(value) => choose(key, value)}
                      options={options}
                      placeholder={tx('captureRulesNoAccount')}
                      disabled={!canEdit || save.isPending || rules.isPending}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {canEdit && (
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          {dirty && (
            <button type="button" onClick={() => setDraft(null)} disabled={save.isPending} className={`${BTN_SECONDARY} ${TOUCH} w-full sm:w-auto`}>
              {tx('captureRulesUndo')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!dirty || save.isPending}
            className={`${BTN_PRIMARY} ${TOUCH} w-full sm:w-auto`}
          >
            {save.isPending ? tx('captureRulesSaving') : tx('captureRulesSave')}
          </button>
        </div>
      )}
    </div>
  );
};

export default CaptureRulesCard;

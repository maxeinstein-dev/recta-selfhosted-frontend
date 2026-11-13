import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import CaptureCard, { type CaptureBusy } from '../components/captures/CaptureCard';
import CaptureConfirmModal from '../components/captures/CaptureConfirmModal';
import { useI18n } from '../context/I18nContext';
import { useToastContext } from '../context/ToastContext';
import { useDefaultHousehold } from '../hooks/useDefaultHousehold';
import { useAvailableAccounts } from '../hooks/api/useAccounts';
import { useCategories } from '../hooks/api/useCategories';
import {
  useCaptures,
  useCapturesCount,
  useConfirmCapture,
  useDismissCapture,
  useRestoreCapture,
} from '../hooks/api/useCaptures';
import { getCategoryDisplayName } from '../lib/enums';
import { canWritePeople } from '../utils/people';
import { oneTapConfirmBody } from '../utils/captureReading';
import {
  captureBadgeText,
  localDayKey,
  type CaptureItem,
  type CaptureStatus,
} from '../utils/captureInbox';
import { captureText, type CaptureTextKey } from '../utils/captureTexts';
import { BTN_SECONDARY } from '../components/people/ui';

const TAB_CLS = 'min-h-[44px] flex-1 px-3 py-2 text-sm font-light rounded-md transition-colors';

/** The caller asked for an item that changed or is gone (409), or the request failed for another reason. */
const isConflict = (error: unknown): boolean => (error as { status?: number } | null)?.status === 409;

/**
 * The capture inbox: the notifications the phone read, waiting for a decision. A tap confirms a complete suggestion;
 * anything else opens the transaction form with what the suggestion has. Dismissed ones can be restored.
 */
const Captures = () => {
  const { t } = useI18n();
  const tx = (key: CaptureTextKey) => captureText(t, key);
  const { householdId, household } = useDefaultHousehold();
  const canEdit = canWritePeople(household);
  const { success, error: showError } = useToastContext();

  // ?status=DISMISSED opens the dismissed tab (the link of Settings > Leitura das notificações).
  const [searchParams, setSearchParams] = useSearchParams();
  const status: CaptureStatus = searchParams.get('status') === 'DISMISSED' ? 'DISMISSED' : 'PENDING';
  const setStatus = (next: CaptureStatus) =>
    setSearchParams((params) => {
      const copy = new URLSearchParams(params);
      if (next === 'DISMISSED') copy.set('status', 'DISMISSED');
      else copy.delete('status');
      return copy;
    }, { replace: true });
  const [editing, setEditing] = useState<CaptureItem | null>(null);

  const list = useCaptures({ householdId, status });
  const pendingCount = useCapturesCount(householdId, 'PENDING');
  const confirm = useConfirmCapture();
  const dismiss = useDismissCapture();
  const restore = useRestoreCapture();
  const { data: availableAccounts } = useAvailableAccounts(householdId ?? '', false);
  const { data: categories } = useCategories({ householdId });

  const items = useMemo(() => {
    const seen = new Map<string, CaptureItem>();
    for (const page of list.data?.pages ?? []) {
      for (const item of page.data) seen.set(item.id, item);
    }
    return [...seen.values()];
  }, [list.data]);

  const accountName = useCallback(
    (id: string) => availableAccounts?.accounts.find((account) => account.id === id)?.name ?? null,
    [availableAccounts],
  );

  const categoryLabel = useCallback(
    (value: string): string => {
      if (value.startsWith('CUSTOM:')) {
        const id = value.slice('CUSTOM:'.length);
        return categories?.find((category) => category.id === id)?.name ?? '';
      }
      return getCategoryDisplayName(value, t as unknown as Record<string, string>);
    },
    [categories, t],
  );

  const busyFor = (id: string): CaptureBusy => {
    if (confirm.isPending && confirm.variables?.id === id) return 'confirm';
    if (dismiss.isPending && dismiss.variables?.id === id) return 'dismiss';
    if (restore.isPending && restore.variables?.id === id) return 'restore';
    return null;
  };

  const reportFailure = (error: unknown) => {
    showError(isConflict(error) ? tx('captureChangedElsewhere') : tx('captureActionFailed'));
  };

  const handleConfirm = async (item: CaptureItem) => {
    if (!householdId) return;
    const result = oneTapConfirmBody(item.suggestion, localDayKey(new Date().toISOString()) ?? '');
    if (!result.ok) {
      // Not enough to post in one tap: open the form with what there is.
      setEditing(item);
      return;
    }
    try {
      await confirm.mutateAsync({ id: item.id, householdId, body: result.body });
      success(tx('captureConfirmedToast'));
    } catch (error) {
      reportFailure(error);
    }
  };

  const handleDismiss = async (item: CaptureItem) => {
    if (!householdId) return;
    try {
      await dismiss.mutateAsync({ id: item.id, householdId });
      success(tx('captureDismissedToast'));
    } catch (error) {
      reportFailure(error);
    }
  };

  const handleRestore = async (item: CaptureItem) => {
    if (!householdId) return;
    try {
      await restore.mutateAsync({ id: item.id, householdId });
      success(tx('captureRestoredToast'));
    } catch (error) {
      reportFailure(error);
    }
  };

  const pendingBadge = captureBadgeText(pendingCount.data ?? 0);
  const tabs: Array<{ key: CaptureStatus; label: string; count?: string }> = [
    { key: 'PENDING', label: tx('captureTabPending'), count: pendingBadge || undefined },
    { key: 'DISMISSED', label: tx('captureTabDismissed') },
  ];

  let body: ReactNode;
  if (!householdId || list.isPending) {
    body = <p className="text-sm font-light text-gray-500 dark:text-gray-400" role="status">{tx('captureLoading')}</p>;
  } else if (list.isError) {
    body = (
      <div className="space-y-3">
        <p role="alert" className="text-sm font-light text-red-600 dark:text-red-400">{tx('captureLoadError')}</p>
        <button type="button" onClick={() => void list.refetch()} className={`${BTN_SECONDARY} min-h-[44px]`}>
          {tx('captureRetry')}
        </button>
      </div>
    );
  } else if (items.length === 0) {
    body = status === 'PENDING' ? (
      <EmptyState icon={Inbox} title={tx('captureEmptyPending')} description={tx('captureEmptyPendingHint')} />
    ) : (
      <EmptyState icon={Inbox} title={tx('captureEmptyDismissed')} />
    );
  } else {
    body = (
      <>
        <ul className="space-y-3">
          {items.map((item) => (
            <CaptureCard
              key={item.id}
              item={item}
              accountName={accountName}
              categoryLabel={categoryLabel}
              canEdit={canEdit}
              busy={busyFor(item.id)}
              onConfirm={() => void handleConfirm(item)}
              onEdit={() => setEditing(item)}
              onDismiss={() => void handleDismiss(item)}
              onRestore={() => void handleRestore(item)}
            />
          ))}
        </ul>
        {list.hasNextPage && (
          <div className="pt-4">
            <button
              type="button"
              onClick={() => void list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
              className={`${BTN_SECONDARY} min-h-[44px] w-full sm:w-auto`}
            >
              {list.isFetchingNextPage ? tx('captureLoadingMore') : tx('captureLoadMore')}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <div>
      <PageHeader title={tx('captureInboxTitle')} description={tx('captureInboxDescription')} />

      <div role="tablist" className="mb-4 flex gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1 max-w-2xl">
        {tabs.map((tab) => {
          const active = status === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setStatus(tab.key)}
              className={`${TAB_CLS} ${
                active
                  ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              {tab.label}
              {tab.count && <span className="ml-2 text-xs text-primary-600 dark:text-primary-400">{tab.count}</span>}
            </button>
          );
        })}
      </div>

      <div className="max-w-2xl">{body}</div>

      {editing && householdId && (
        <CaptureConfirmModal
          item={editing}
          householdId={householdId}
          onDone={() => setEditing(null)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
};

export default Captures;

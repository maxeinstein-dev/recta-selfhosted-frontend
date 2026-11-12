import { useState } from 'react';
import CaptureConfirmModal from '../captures/CaptureConfirmModal';
import { useI18n } from '../../context/I18nContext';
import { useToastContext } from '../../context/ToastContext';
import { useCaptures, useCapturesCount, useConfirmCapture, useDismissCapture } from '../../hooks/api/useCaptures';
import { appLabel, buildConfirmBody, draftFromSuggestion, formatCaptureDateTime, localDayKey, type CaptureItem } from '../../utils/captureInbox';
import { captureText } from '../../utils/captureTexts';
import { captureLineMeta, captureVisibleCount } from '../../utils/extratoMobile';
import { formatCurrency } from '../../utils/format';

const TOUCH = 'min-h-[44px]';

interface MobileCaptureBoxProps {
  householdId?: string;
  /** The household's accounts, to name the suggested one as /app/captures does. */
  accounts: Array<{ id?: string; name: string }>;
  /** Same rule as the captures page: only people who may write see the actions enabled. */
  canEdit: boolean;
}

/**
 * The capture box on top of the mobile Extrato. It uses the same hooks and the same confirm rule as /app/captures: a
 * complete suggestion posts in one tap, an incomplete one opens CaptureConfirmModal. Hidden when nothing waits.
 */
const MobileCaptureBox = ({ householdId, accounts, canEdit }: MobileCaptureBoxProps) => {
  const { t } = useI18n();
  const tx = (key: Parameters<typeof captureText>[1]) => captureText(t, key);
  const { success, error: showError } = useToastContext();
  const list = useCaptures({ householdId, status: 'PENDING' });
  const count = useCapturesCount(householdId, 'PENDING');
  const confirm = useConfirmCapture();
  const dismiss = useDismissCapture();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CaptureItem | null>(null);

  const total = count.data ?? 0;
  if (!householdId || total <= 0) {
    return editing && householdId ? (
      <CaptureConfirmModal item={editing} householdId={householdId} onDone={() => setEditing(null)} onClose={() => setEditing(null)} />
    ) : null;
  }

  const items: CaptureItem[] = [];
  const seen = new Set<string>();
  for (const page of list.data?.pages ?? []) {
    for (const item of page.data) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    }
  }
  const { visible, rest } = captureVisibleCount(total, open);
  const shown = items.slice(0, visible);
  const hiddenCount = Math.max(0, total - shown.length);

  const footerButton = `${TOUCH} flex w-full items-center text-left text-sm font-semibold text-rc-accentInk`;
  // At most one of these applies: more to show, less to hide, or the next page of the list.
  const footer =
    rest > 0 ? (
      <button type="button" onClick={() => setOpen(true)} className={footerButton}>
        Ver mais {rest}
      </button>
    ) : open && hiddenCount === 0 && total > 1 ? (
      <button type="button" onClick={() => setOpen(false)} className={footerButton}>
        Ver menos
      </button>
    ) : open && hiddenCount > 0 && list.hasNextPage ? (
      <button
        type="button"
        onClick={() => void list.fetchNextPage()}
        disabled={list.isFetchingNextPage}
        className={`${footerButton} disabled:opacity-50`}
      >
        Carregar mais capturas
      </button>
    ) : null;

  const reportFailure = (error: unknown) => {
    const conflict = (error as { status?: number } | null)?.status === 409;
    showError(conflict ? tx('captureChangedElsewhere') : tx('captureActionFailed'));
  };

  const handleConfirm = async (item: CaptureItem) => {
    if (!householdId) return;
    const result = buildConfirmBody(draftFromSuggestion(item.suggestion, localDayKey(new Date().toISOString()) ?? ''));
    if (!result.ok) {
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

  return (
    <section aria-labelledby="mobile-capture-title" className="mt-3 rounded-[22px] border-[1.5px] border-rc-accentInk bg-rc-card p-4">
      <div className="flex items-center gap-2">
        <h2 id="mobile-capture-title" className="flex-1 text-base font-semibold">Caixa de capturas</h2>
        <span
          className="inline-grid h-6 min-w-[24px] place-items-center rounded-full bg-rc-accentSoft px-2 text-xs font-bold tabular-nums text-rc-accentInk"
          aria-label={`${total} ${total === 1 ? 'captura pendente' : 'capturas pendentes'}`}
        >
          {total}
        </span>
      </div>
      <p className="mt-0.5 text-[13px] text-rc-ink2">Só o que você confirmar vira lançamento.</p>

      <ul className="mt-1">
        {shown.map((item) => {
          const desc = item.suggestion.description || item.title || appLabel(item.package);
          const amount = item.suggestion.amount;
          const isIncome = item.suggestion.type === 'INCOME';
          const typeLabel = item.suggestion.type === 'INCOME'
            ? tx('captureFormIncome')
            : item.suggestion.type === 'EXPENSE'
              ? tx('captureFormExpense')
              : '';
          const accountName = accounts.find((a) => a.id === item.suggestion.accountId)?.name ?? null;
          const busy = (confirm.isPending && confirm.variables?.id === item.id) || (dismiss.isPending && dismiss.variables?.id === item.id);
          return (
            <li key={item.id} className="border-t border-rc-line py-2.5 first:border-t-0 last:pb-0">
              <div className="flex min-w-0 items-baseline gap-2">
                <p className="min-w-0 flex-1 truncate font-medium">{desc}</p>
                <p className={`whitespace-nowrap font-semibold tabular-nums ${isIncome && amount !== null ? 'text-rc-green' : ''}`}>
                  {amount === null ? '—' : `${isIncome ? '+' : '−'}${formatCurrency(amount)}`}
                </p>
              </div>
              <p className="truncate text-[12.5px] text-rc-ink3">
                {captureLineMeta(typeLabel, accountName, formatCaptureDateTime(item.postedAt))}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={!canEdit || busy}
                  onClick={() => void handleDismiss(item)}
                  aria-label={`Descartar captura: ${desc}`}
                  className={`${TOUCH} flex-1 rounded-xl border border-rc-line px-3 text-sm font-medium text-rc-ink2 disabled:opacity-50`}
                >
                  Descartar
                </button>
                <button
                  type="button"
                  disabled={!canEdit || busy}
                  onClick={() => void handleConfirm(item)}
                  aria-label={`Lançar captura: ${desc}`}
                  className={`${TOUCH} flex-1 rounded-xl bg-rc-accent px-3 text-sm font-semibold text-rc-onAccent disabled:opacity-50`}
                >
                  Lançar
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {footer && (
        // The text sits centred in its 44 px target; the -mb-3 takes the target's empty half-line off the bottom,
        // so the space under the text equals the box's side padding (16 px), as it does without this line.
        <div className="-mb-3.5 mt-1">{footer}</div>
      )}

      {editing && householdId && (
        <CaptureConfirmModal item={editing} householdId={householdId} onDone={() => setEditing(null)} onClose={() => setEditing(null)} />
      )}
    </section>
  );
};

export default MobileCaptureBox;

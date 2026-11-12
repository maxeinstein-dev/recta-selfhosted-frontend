import { useEffect, useRef } from 'react';
import { CheckCircle, Clock, Edit, Eye, Trash2, Users, X } from 'lucide-react';
import type { RowAction } from '../../utils/extratoMobile';
import { useBackLayer } from '../../hooks/useBackLayer';

const TOUCH = 'min-h-[44px]';

const LABELS: Record<RowAction, string> = {
  view: 'Ver detalhes',
  confirm: 'Confirmar pagamento',
  markAsPaid: 'Marcar como pago',
  markAsPending: 'Marcar como pendente',
  edit: 'Editar',
  split: 'Dividir',
  delete: 'Excluir',
};

const ICONS: Record<RowAction, typeof Eye> = {
  view: Eye,
  confirm: CheckCircle,
  markAsPaid: CheckCircle,
  markAsPending: Clock,
  edit: Edit,
  split: Users,
  delete: Trash2,
};

interface MobileRowActionsProps {
  /** The row's name, for the sheet title. */
  title: string;
  /** The actions the row offers (rowActions in utils/extratoMobile). */
  actions: RowAction[];
  /** "Confirmar pagamento" or "Confirmar recebimento", the same words as the desktop menu. */
  confirmLabel: string;
  /** Runs the action. The sheet closes first, so the page's own dialogs (confirm delete, dividing) open on top. */
  onAction: (action: RowAction) => void;
  onClose: () => void;
}

/**
 * The "more options" of a row on the phone: a sheet that rises from the bottom. Closes on the button, on the backdrop
 * and with Esc. Each button is 44 px tall.
 */
const MobileRowActions = ({ title, actions, confirmLabel, onAction, onClose }: MobileRowActionsProps) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  // The page passes a new onClose on every render: keep the latest one, and let the listener and the focus happen once.
  const closeLatest = useRef(onClose);
  closeLatest.current = onClose;
  useBackLayer(true, onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLatest.current();
    };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="row-actions-title"
        className="relative max-h-[92%] w-full overflow-y-auto overflow-x-hidden rounded-t-[26px] bg-rc-card px-4 pt-2"
        style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-rc-line" aria-hidden="true" />
        <div className="flex items-center gap-2">
          <h2 id="row-actions-title" className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Fechar ações"
            className={`${TOUCH} flex w-11 items-center justify-center rounded-xl text-rc-ink2`}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <ul className="mt-2 space-y-1">
          {actions.map((action) => {
            const Icon = ICONS[action];
            const danger = action === 'delete';
            return (
              <li key={action}>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onAction(action);
                  }}
                  className={`${TOUCH} flex w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] ${
                    danger ? 'text-rc-red' : 'text-rc-ink'
                  }`}
                >
                  <Icon className="h-5 w-5 flex-none" aria-hidden="true" />
                  {action === 'confirm' ? confirmLabel : LABELS[action]}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

export default MobileRowActions;

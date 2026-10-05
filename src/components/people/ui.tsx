import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// Shared styles of the people dialogs (the same tokens as ImportCardOfxDialog / ImportMaxFinDialog).

export const FIELD_CLS =
  'border border-gray-200 dark:border-gray-800 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50';
export const INPUT_CLS = `w-full px-3 py-2.5 text-sm ${FIELD_CLS}`;
export const INPUT_SM_CLS = `w-full px-2 py-1.5 text-sm ${FIELD_CLS}`;
export const BTN_BASE = 'inline-flex items-center justify-center font-light tracking-tight rounded-md transition-opacity disabled:opacity-50 disabled:cursor-not-allowed';
export const BTN_SECONDARY = `${BTN_BASE} px-4 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:opacity-70`;
export const BTN_SECONDARY_SM = `${BTN_BASE} px-3 py-1.5 text-xs text-gray-900 dark:text-white bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:opacity-70`;
export const BTN_PRIMARY = `${BTN_BASE} px-4 py-2.5 text-sm text-white bg-primary-600 dark:bg-primary-500 border border-primary-600 dark:border-primary-500 hover:opacity-80`;
export const BTN_DANGER = `${BTN_BASE} px-4 py-2.5 text-sm text-white bg-red-500 border border-red-500 hover:opacity-80`;
export const LINK_CLS = 'text-xs text-primary-600 dark:text-primary-400 hover:underline disabled:opacity-50';
export const LABEL_CLS = 'block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1';
export const CHECKBOX_CLS = 'h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60';
export const TABLE_WRAP_CLS = 'overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-md';
export const THEAD_ROW_CLS = 'bg-gray-50 dark:bg-gray-800/50';
export const TBODY_CLS = 'divide-y divide-gray-200 dark:divide-gray-800';
export const TH_CLS = 'px-3 py-2 font-medium text-gray-700 dark:text-gray-200 text-left whitespace-nowrap';
export const TD_CLS = 'px-3 py-2 text-gray-900 dark:text-white align-top';
export const MUTED_CLS = 'text-gray-600 dark:text-gray-400';
export const H4_CLS = 'text-sm font-medium text-gray-900 dark:text-white';
export const BOX_CLS = 'rounded-md border border-gray-200 dark:border-gray-800 p-4 space-y-2';
export const ERROR_CLS = 'text-xs text-red-600 dark:text-red-400';
export const WARN_BOX_CLS =
  'rounded-md border border-yellow-200 dark:border-yellow-900/60 bg-yellow-50 dark:bg-yellow-900/20 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300 list-disc list-inside space-y-1';
export const NOTICE_BOX_CLS =
  'rounded-md border border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 px-4 py-3 text-sm text-orange-900 dark:text-orange-200 space-y-1';

export const ERROR_TOAST_MS = 10000;

export const getErrorMessage = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

/** YYYY-MM-DD -> dd/mm/yyyy without the UTC-midnight day shift. */
export const fmtDate = (value: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
};

/** Today as YYYY-MM-DD in local time (the default date of a settlement). */
export const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface DialogShellProps {
  open: boolean;
  onClose: () => void;
  /** False while a request that must not be abandoned is in flight: ESC, the backdrop and the X do nothing. */
  canClose: boolean;
  titleId: string;
  title: string;
  icon?: ReactNode;
  /** Tailwind max-width class of the panel. */
  widthClass?: string;
  /** Stacking level: a dialog opened from another one needs the higher one. */
  zClass?: string;
  children: ReactNode;
}

// Open shells, oldest first. Only the topmost one answers ESC (the nested person form must not take the dialog under
// it along), and the page scroll stays locked until the last one is gone, whatever order they unmount in.
const openShells: symbol[] = [];
let savedOverflow = '';

function lockScroll(): void {
  if (openShells.length === 1) {
    savedOverflow = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';
  }
}

function unlockScroll(): void {
  if (openShells.length === 0) document.body.style.overflow = savedOverflow;
}

const FOCUSABLE = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not([data-shell-close])';

/** Portal, backdrop, scroll lock, ESC for the topmost shell only, focus in and back, and the close guard. */
export const DialogShell = ({ open, onClose, canClose, titleId, title, icon, widthClass = 'max-w-2xl', zClass = 'z-[60]', children }: DialogShellProps) => {
  const canCloseRef = useRef(canClose);
  canCloseRef.current = canClose;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = Symbol('shell');
    const active = document.activeElement as HTMLElement | null;
    const before = active && active !== document.body ? active : null;
    openShells.push(id);
    lockScroll();
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || openShells[openShells.length - 1] !== id) return;
      if (canCloseRef.current) onCloseRef.current();
    };
    window.addEventListener('keydown', handleEscape);
    // The first control, else the panel itself, so the keyboard starts inside the dialog.
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) (panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel).focus();
    return () => {
      window.removeEventListener('keydown', handleEscape);
      openShells.splice(openShells.indexOf(id), 1);
      unlockScroll();
      if (before && before.isConnected) before.focus();
    };
  }, [open]);

  if (!open) return null;
  const requestClose = () => {
    if (canCloseRef.current) onClose();
  };
  return createPortal(
    <div className={`fixed inset-0 ${zClass} overflow-y-auto`}>
      <div className="fixed inset-0 bg-black/40 animate-fade-in transition-opacity duration-300 ease-out" onClick={requestClose} aria-hidden="true" />
      <div className="flex min-h-full items-center justify-center p-4">
        <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
          className={`relative w-full ${widthClass} p-6 border rounded-lg bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800 max-h-[90vh] overflow-y-auto min-w-0 animate-slide-in-bottom focus:outline-none`}>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center min-w-0">
              {icon}
              <h3 id={titleId} className="text-lg font-light tracking-tight text-gray-900 dark:text-white truncate">{title}</h3>
            </div>
            <button type="button" data-shell-close onClick={requestClose} disabled={!canClose} aria-label="Fechar modal"
              className="text-gray-400 dark:text-gray-500 hover:opacity-70 transition-opacity p-1 disabled:opacity-40 disabled:cursor-not-allowed">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
};

const CHIP_TONES = {
  green: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300',
  red: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300',
  yellow: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300',
  blue: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300',
  gray: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
} as const;
export type ChipTone = keyof typeof CHIP_TONES;

export const Chip = ({ tone, title, children }: { tone: ChipTone; title?: string; children: ReactNode }) => (
  <span title={title} className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${CHIP_TONES[tone]}`}>
    {children}
  </span>
);

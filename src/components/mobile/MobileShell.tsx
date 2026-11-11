import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BarChart3, CreditCard, List, LogOut, LucideIcon, MessageCircle, MessageSquare, Plus, TrendingUp, User, Users, X } from 'lucide-react';
import { useI18n } from '../../context/I18nContext';
import { cashFlowText } from '../../utils/cashFlowTexts';
import { incomeText } from '../../utils/incomeTexts';
import { captureText } from '../../utils/captureTexts';
import TransactionModal from '../TransactionModal';
import MonthSelector from './MonthSelector';
import {
  MORE_ITEMS,
  SHELL_TABS,
  ScreenId,
  TabId,
  extratoBadgeText,
  extratoTabName,
  headerTitleFor,
  moreItemForPath,
  screenForPath,
  tabForPath,
  usesMonthSelector,
} from '../../utils/mobileShell';

export const COMMUNITY_URL = 'https://www.reddit.com/r/RectaApp/';

const TAB_ICONS: Record<TabId, LucideIcon> = {
  home: BarChart3,
  cashFlow: TrendingUp,
  creditCards: CreditCard,
  transactions: List,
  house: Users,
};

interface MobileShellProps {
  children: ReactNode;
  /** Captures waiting for a decision: the Extrato tab's badge and accessible name. */
  pendingCaptures: number;
  /** The household selector, shown in the "Mais" sheet. */
  householdSelector: ReactNode;
  /** The invites bell, in the header's right corner. */
  invitesNotification: ReactNode;
  onOpenFeedback: () => void;
  onLogout: () => void;
}

type Dict = Record<string, string | undefined>;

/** The label of a screen, in the same words the desktop menu uses. */
function screenLabel(t: unknown, screen: ScreenId): string {
  const dict = t as unknown as Dict;
  switch (screen) {
    case 'home':
      return 'Início';
    case 'transactions':
      return dict.transactions ?? 'Extrato';
    case 'captures':
      return captureText(t, 'captureNavLabel');
    case 'accounts':
      return dict.accounts ?? 'Contas';
    case 'cashFlow':
      return cashFlowText(t, 'cashFlowNavLabel');
    case 'income':
      return incomeText(t, 'incomeNavLabel');
    case 'creditCards':
      return dict.creditCards ?? 'Cartões';
    case 'people':
      return dict.peoplePage || 'Pessoas';
    case 'recurring':
      return dict.recurring ?? 'Recorrências';
    case 'goals':
      return dict.goals ?? 'Metas';
    case 'budgets':
      return dict.budgets ?? 'Orçamentos';
    case 'reports':
      return dict.reports ?? 'Relatórios';
    case 'settings':
      return dict.settings ?? 'Ajustes';
  }
}

const MobileShell = ({
  children,
  pendingCaptures,
  householdSelector,
  invitesNotification,
  onOpenFeedback,
  onLogout,
}: MobileShellProps) => {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const moreCloseRef = useRef<HTMLButtonElement>(null);

  const screen = screenForPath(pathname);
  const activeTab = tabForPath(pathname);
  const activeMore = moreItemForPath(pathname);
  const showMonth = usesMonthSelector(screen);
  const title = headerTitleFor(pathname) ?? (screen ? screenLabel(t, screen) : 'Recta');
  const dict = t as unknown as Dict;

  // Esc closes the "Mais" sheet; its close button takes the focus when the sheet opens.
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('keydown', onKey);
    moreCloseRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  const closeMore = () => setMoreOpen(false);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-rc-bg text-rc-ink">
      <header
        className="flex flex-none items-center gap-1 bg-rc-card px-2 pb-1"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
      >
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label="Abrir menu Mais"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-rc-accent text-rc-onAccent"
        >
          <User className="h-5 w-5" aria-hidden="true" />
        </button>
        {showMonth ? (
          <MonthSelector />
        ) : (
          <p className="min-w-0 flex-1 truncate text-center text-base font-semibold">{title}</p>
        )}
        <div className="flex h-11 w-11 flex-none items-center justify-center [&_button]:flex [&_button]:h-11 [&_button]:w-11 [&_button]:items-center [&_button]:justify-center [&_button]:p-0">{invitesNotification}</div>
      </header>

      <main id="main-content" role="main" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="px-4 pb-32 pt-4">{children}</div>
      </main>

      <nav
        aria-label="Navegação principal"
        className="grid flex-none grid-cols-5 border-t border-rc-line bg-rc-card"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {SHELL_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab.id];
          const active = activeTab === tab.id;
          const isExtrato = tab.id === 'transactions';
          const badge = isExtrato ? extratoBadgeText(pendingCaptures) : '';
          const name = isExtrato ? extratoTabName(pendingCaptures) : tab.label;
          return (
            <Link
              key={tab.id}
              to={tab.path}
              aria-label={name}
              aria-current={active ? 'page' : undefined}
              onClick={closeMore}
              className={`relative flex min-h-[58px] min-w-0 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                active ? 'font-semibold text-rc-accentInk' : 'text-rc-ink3'
              }`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span aria-hidden="true" className="truncate">{tab.label}</span>
              {badge && (
                <span
                  aria-hidden="true"
                  className="absolute left-[calc(50%+6px)] top-1.5 inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rc-red px-1 text-[11px] font-bold leading-none text-rc-onRed"
                >
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={() => setAddOpen(true)}
        aria-label="Adicionar lançamento"
        className="fixed right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-rc-accent text-rc-onAccent shadow-lg"
        style={{ bottom: 'calc(58px + env(safe-area-inset-bottom, 0px) + 12px)' }}
      >
        <Plus className="h-6 w-6" strokeWidth={2.2} aria-hidden="true" />
      </button>

      {addOpen && (
        <TransactionModal transaction={null} onClose={() => setAddOpen(false)} defaultAccountId={null} />
      )}

      {moreOpen && (
        <div className="fixed inset-0 z-40 flex items-end">
          <div className="absolute inset-0 bg-black/50" onClick={closeMore} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-more-title"
            className="relative max-h-[92%] w-full overflow-y-auto overflow-x-hidden rounded-t-[26px] bg-rc-card px-4 pt-2"
            style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))' }}
          >
            <div className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-rc-line" aria-hidden="true" />
            <div className="flex items-center gap-2">
              <h2 id="mobile-more-title" className="flex-1 text-lg font-semibold">Mais</h2>
              <button
                ref={moreCloseRef}
                type="button"
                onClick={closeMore}
                aria-label="Fechar menu"
                className="flex h-11 w-11 items-center justify-center rounded-xl text-rc-ink2"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <ul className="mt-2 space-y-1">
              {MORE_ITEMS.map((item) => {
                const current = activeMore?.screen === item.screen;
                return (
                  <li key={item.screen}>
                    <Link
                      to={item.path}
                      onClick={closeMore}
                      aria-current={current ? 'page' : undefined}
                      className={`flex min-h-[52px] items-center rounded-xl px-3 text-[15px] ${
                        current ? 'bg-rc-accentSoft font-semibold text-rc-accentInk' : 'text-rc-ink'
                      }`}
                    >
                      {screenLabel(t, item.screen)}
                    </Link>
                  </li>
                );
              })}
              <li>
                <a
                  href={COMMUNITY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={closeMore}
                  className="flex min-h-[52px] items-center gap-3 rounded-xl px-3 text-[15px] text-rc-ink"
                >
                  <MessageSquare className="h-5 w-5 text-rc-ink3" aria-hidden="true" />
                  {dict.community ?? 'Comunidade'}
                </a>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    closeMore();
                    onOpenFeedback();
                  }}
                  className="flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium text-purple-700 dark:text-purple-300"
                >
                  <MessageCircle className="h-5 w-5" aria-hidden="true" />
                  {dict.giveFeedback ?? 'Dê seu feedback'}
                </button>
              </li>
            </ul>

            <div className="mt-3 border-t border-rc-line pt-3">{householdSelector}</div>

            <button
              type="button"
              onClick={() => {
                closeMore();
                onLogout();
              }}
              className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-rc-accent text-[15px] font-semibold text-rc-onAccent"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {dict.logout ?? 'Sair'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileShell;

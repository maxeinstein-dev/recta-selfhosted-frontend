/**
 * Pure logic of the mobile shell (below 768 px): which tab and which "Mais" item a route belongs to, the screen
 * id of the header title, and the month arithmetic of the header's month selector. No React and no imports, so
 * tools/fe-tests/t33_mobile_shell.mts runs it under tsx (MOBILE_SHELL_MODULE points it at a mutated copy).
 */

/** Every screen the shell can show. The React side turns an id into a label. */
export type ScreenId =
  | 'home'
  | 'transactions'
  | 'captures'
  | 'accounts'
  | 'cashFlow'
  | 'income'
  | 'creditCards'
  | 'people'
  | 'recurring'
  | 'goals'
  | 'budgets'
  | 'reports'
  | 'settings';

export type TabId = 'home' | 'cashFlow' | 'creditCards' | 'transactions' | 'house';

export interface ShellTab {
  id: TabId;
  path: string;
  label: string;
}

/** The five tabs, in order. "Casa" points at the people page until the Casa screen exists (lote R7). */
export const SHELL_TABS: readonly ShellTab[] = [
  { id: 'home', path: '/app', label: 'Início' },
  { id: 'cashFlow', path: '/app/cash-flow', label: 'Fluxo' },
  { id: 'creditCards', path: '/app/credit-cards', label: 'Cartões' },
  { id: 'transactions', path: '/app/transactions', label: 'Extrato' },
  { id: 'house', path: '/app/people', label: 'Casa' },
];

export interface MoreItem {
  /** The screen the item opens. */
  screen: ScreenId;
  path: string;
}

/** The "Mais" sheet: the routes that are not tabs, in the order of the sheet. */
export const MORE_ITEMS: readonly MoreItem[] = [
  { screen: 'accounts', path: '/app/accounts' },
  { screen: 'recurring', path: '/app/recurring' },
  { screen: 'budgets', path: '/app/budgets' },
  { screen: 'goals', path: '/app/goals' },
  { screen: 'people', path: '/app/people' },
  { screen: 'income', path: '/app/income' },
  { screen: 'reports', path: '/app/reports' },
  { screen: 'captures', path: '/app/captures' },
  { screen: 'settings', path: '/app/settings' },
];

/** Routes and the screen they show. Prefixes are matched longest first, so /app/income/... is the income screen. */
const ROUTE_SCREENS: readonly { prefix: string; screen: ScreenId }[] = [
  { prefix: '/app/transactions', screen: 'transactions' },
  { prefix: '/app/captures', screen: 'captures' },
  { prefix: '/app/budgets', screen: 'budgets' },
  { prefix: '/app/recurring', screen: 'recurring' },
  { prefix: '/app/accounts', screen: 'accounts' },
  { prefix: '/app/cash-flow', screen: 'cashFlow' },
  { prefix: '/app/income', screen: 'income' },
  { prefix: '/app/credit-cards', screen: 'creditCards' },
  { prefix: '/app/people', screen: 'people' },
  { prefix: '/app/goals', screen: 'goals' },
  { prefix: '/app/reports', screen: 'reports' },
  { prefix: '/app/settings', screen: 'settings' },
];

function startsWithPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

/** The screen of a route, or null when the route is not one of the app's screens. `/app` itself is home. */
export function screenForPath(pathname: string): ScreenId | null {
  if (pathname === '/app' || pathname === '/app/') return 'home';
  const hit = ROUTE_SCREENS.find((r) => startsWithPath(pathname, r.prefix));
  return hit ? hit.screen : null;
}

/** The tab that is active for a route, or null when no tab is (the "Mais" routes). */
export function tabForPath(pathname: string): TabId | null {
  const screen = screenForPath(pathname);
  if (screen === 'home') return 'home';
  if (screen === 'cashFlow') return 'cashFlow';
  if (screen === 'creditCards') return 'creditCards';
  if (screen === 'transactions') return 'transactions';
  if (screen === 'people') return 'house';
  return null;
}

/** The "Mais" item that is open for a route, or null. */
export function moreItemForPath(pathname: string): MoreItem | null {
  const screen = screenForPath(pathname);
  return MORE_ITEMS.find((item) => item.screen === screen) ?? null;
}

/**
 * Screens whose header shows the month selector. Empty in lote R0: the selector is built but no screen declares it
 * yet. R1 adds the Extrato; the other lotes add theirs.
 */
export const MONTH_SELECTOR_SCREENS: ReadonlySet<ScreenId> = new Set<ScreenId>([]);

export function usesMonthSelector(screen: ScreenId | null): boolean {
  return screen !== null && MONTH_SELECTOR_SCREENS.has(screen);
}

/** The accessible name of the Extrato tab: says how many captures wait for a decision. */
export function extratoTabName(pendingCaptures: number): string {
  if (!Number.isFinite(pendingCaptures) || pendingCaptures <= 0) return 'Extrato';
  const n = Math.floor(pendingCaptures);
  return n === 1
    ? 'Extrato, 1 captura esperando confirmação'
    : `Extrato, ${n} capturas esperando confirmação`;
}

/** Text of the badge on the Extrato tab: "99+" above 99, nothing at zero. */
export function extratoBadgeText(pendingCaptures: number): string {
  if (!Number.isFinite(pendingCaptures) || pendingCaptures <= 0) return '';
  return pendingCaptures > 99 ? '99+' : String(Math.floor(pendingCaptures));
}

/* ---------- month arithmetic (YYYY-MM keys) ---------- */

export const MONTH_NAMES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
] as const;

/** The month key ('YYYY-MM') of a date in local time. */
export function monthKeyOf(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Moves a month key by `delta` months (negative goes back), across year boundaries. */
export function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/** The label of a month key for the header: 'novembro de 2026'. */
export function monthLabelPt(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES_PT[m - 1]} de ${y}`;
}

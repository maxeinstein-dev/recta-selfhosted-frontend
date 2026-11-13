/**
 * Presentation logic of the income bar, the housing card and the spending groups screen (P05, lote L3). Pure: no React,
 * so tools/fe-tests/t51_income_split.mts runs it under tsx (INCOME_SPLIT_MODULE points it at a mutated copy).
 *
 * Every number comes from the server (GET /dashboard/income-split, GET /category-groups); nothing here recalculates the
 * split. The bar is drawn from the values in whole cents, not from the rounded shares, which may not add up to 100%.
 */

/* ---------- contract (see specs/planos/P05-grupos-de-gasto.md) ---------- */

export interface IncomeSplitGroup {
  id: string | null;
  key: string;
  name: string;
  color: string | null;
  isHousing: boolean;
  sortOrder: number;
  realized: number;
  committed: number;
  amount: number;
  percentOfIncome: number | null;
}

export interface IncomeSplit {
  month: string;
  income: { amount: number; basis: 'expected' };
  groups: IncomeSplitGroup[];
  totalSpent: number;
  leftover: { amount: number; percentOfIncome: number | null };
  housing: { amount: number; percentOfIncome: number | null; reference: number; housingGroups: number };
}

export interface GroupCategory {
  categoryName: string;
  name: string;
  isSystem: boolean;
}

export interface CategoryGroup {
  id: string;
  name: string;
  sortOrder: number;
  color: string | null;
  isHousing: boolean;
  categories: GroupCategory[];
}

export interface CategoryGroupList {
  groups: CategoryGroup[];
  ungrouped: GroupCategory[];
}

export type CentsFormatter = (cents: number) => string;

const OTHER_KEY = 'OTHER';
export const OTHER_NAME = 'Outros';
export const LEFTOVER_KEY = 'leftover';
/**
 * Name of the last part of the bar. Never "Sobra": that is the big number of the Início (R5), a cash figure where the
 * card invoice counts on its due date; this bar is by purchase date and category, so the two differ (decided 13/11/2026).
 */
export const LEFTOVER_LABEL = 'Livre da renda';
/** Colours of the bar: the leftover is green (the only green of the screen), "Outros" neutral. */
export const LEFTOVER_COLOR = 'var(--rc-green)';
export const OTHER_COLOR = '#94A3B8';
/** For groups without a colour of their own, by position. */
const PALETTE = ['#2457E6', '#8B5CF6', '#F59E0B', '#0EA5E9', '#EC4899', '#14B8A6', '#F97316', '#6366F1'];

const toCents = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : 0);

const colorOf = (g: IncomeSplitGroup, index: number): string => {
  if (g.key === OTHER_KEY) return OTHER_COLOR;
  if (g.color && /^#[0-9a-f]{6}$/i.test(g.color)) return g.color;
  return PALETTE[index % PALETTE.length]!;
};

/* ---------- barra ---------- */

export interface BarSegment {
  key: string;
  label: string;
  color: string;
  cents: number;
  /** Share of the bar, 0..100 (the widths add up to 100 when the bar is not empty). */
  width: number;
}

export interface IncomeBar {
  segments: BarSegment[];
  /** How much the spending passes the income (0 when it does not). */
  overCents: number;
  /** Nothing to draw: no income and no spending. */
  empty: boolean;
}

/**
 * The bar: one segment per group with money, in the order of the server, then the leftover. Its length is the income;
 * when the spending passes the income there is no leftover and the bar is the spending (the excess is reported apart).
 */
export function incomeBar(split: IncomeSplit): IncomeBar {
  const incomeCents = Math.max(0, toCents(split.income?.amount));
  const parts = (split.groups ?? [])
    .map((g, index) => ({ key: g.key, label: g.name, color: colorOf(g, index), cents: Math.max(0, toCents(g.amount)) }))
    .filter((p) => p.cents > 0);
  const spentCents = parts.reduce((t, p) => t + p.cents, 0);
  const leftoverCents = incomeCents - spentCents;
  if (leftoverCents > 0) parts.push({ key: LEFTOVER_KEY, label: LEFTOVER_LABEL, color: LEFTOVER_COLOR, cents: leftoverCents });
  const base = Math.max(incomeCents, spentCents);
  if (base === 0) return { segments: [], overCents: 0, empty: true };
  return {
    segments: parts.map((p) => ({ ...p, width: (p.cents / base) * 100 })),
    overCents: Math.max(0, -leftoverCents),
    empty: false,
  };
}

/* ---------- legenda ---------- */

/** A server share (fraction) as a whole percent; "<1%" below one percent but above zero; a dash when there is no income. */
export function shareLabel(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '—';
  if (fraction > 0 && fraction < 0.01) return '<1%';
  return `${Math.round(fraction * 100)}%`;
}

export interface LegendItem {
  key: string;
  label: string;
  color: string;
  amount: string;
  share: string;
  /** "R$ X a vencer" when part of the amount is still to come. */
  committed: string | null;
}

/** Every group of the household (an empty one too, at 0%), "Outros" only when it has money, then the leftover. */
export function incomeLegend(split: IncomeSplit, format: CentsFormatter): LegendItem[] {
  const items: LegendItem[] = (split.groups ?? [])
    .map((g, index) => ({ g, index }))
    .filter(({ g }) => g.key !== OTHER_KEY || toCents(g.amount) > 0)
    .map(({ g, index }) => {
      const committed = toCents(g.committed);
      return {
        key: g.key,
        label: g.name,
        color: colorOf(g, index),
        amount: format(toCents(g.amount)),
        share: shareLabel(g.percentOfIncome),
        committed: committed > 0 ? `${format(committed)} a vencer` : null,
      };
    });
  const leftover = toCents(split.leftover?.amount);
  items.push({
    key: LEFTOVER_KEY,
    label: leftover < 0 ? 'Falta' : LEFTOVER_LABEL,
    color: leftover < 0 ? 'var(--rc-red)' : LEFTOVER_COLOR,
    amount: format(Math.abs(leftover)),
    share: shareLabel(split.leftover?.percentOfIncome),
    committed: null,
  });
  return items;
}

/** Which income the bar measures: always the expected one. */
export function incomeBasisText(split: IncomeSplit, format: CentsFormatter): string {
  const income = toCents(split.income?.amount);
  if (income <= 0) return 'Sem renda esperada para o mês: cadastre o salário ou outra receita mensal em Renda.';
  return `Sobre a renda esperada do mês (${format(income)}); compras no cartão contam na data da compra.`;
}

/* ---------- moradia ---------- */

export type HousingCard =
  | { kind: 'invite' }
  | { kind: 'noIncome'; amount: string }
  | { kind: 'share'; amount: string; share: string; reference: string; over: boolean; fill: number; referenceAt: number };

/**
 * The housing card: an invitation to mark a group as housing when none is; the value alone when there is no income;
 * otherwise the share of the income against the reference (30%). `fill` is the share on a 0..100 track, capped.
 */
export function housingCard(split: IncomeSplit, format: CentsFormatter): HousingCard {
  const h = split.housing;
  if (!h || h.housingGroups === 0) return { kind: 'invite' };
  const amount = format(toCents(h.amount));
  if (h.percentOfIncome === null || !Number.isFinite(h.percentOfIncome)) return { kind: 'noIncome', amount };
  const reference = Number.isFinite(h.reference) ? h.reference : 0.3;
  return {
    kind: 'share',
    amount,
    share: shareLabel(h.percentOfIncome),
    reference: shareLabel(reference),
    over: h.percentOfIncome > reference,
    fill: Math.min(100, Math.max(0, h.percentOfIncome * 100)),
    referenceAt: Math.min(100, reference * 100),
  };
}

/* ---------- tela de grupos ---------- */

export interface CategoryRow extends GroupCategory {
  /** Group id, or '' for "Outros". */
  groupId: string;
}

/** Every expense category with its group ('' = Outros), by name. */
export function categoryRows(list: CategoryGroupList): CategoryRow[] {
  const rows: CategoryRow[] = [
    ...list.groups.flatMap((g) => g.categories.map((c) => ({ ...c, groupId: g.id }))),
    ...list.ungrouped.map((c) => ({ ...c, groupId: '' })),
  ];
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
}

/** Options of the group selector of a category: the groups in order, then "Outros" (empty value). */
export function groupOptions(list: CategoryGroupList): Array<{ value: string; label: string }> {
  return [...list.groups.map((g) => ({ value: g.id, label: g.name })), { value: '', label: OTHER_NAME }];
}

/** The list with one category moved to a group (null = Outros), for the optimistic update. Unknown category: same list. */
export function moveCategory(list: CategoryGroupList, categoryName: string, groupId: string | null): CategoryGroupList {
  const all = [...list.groups.flatMap((g) => g.categories), ...list.ungrouped];
  const moving = all.find((c) => c.categoryName === categoryName);
  if (!moving) return list;
  const without = (cs: GroupCategory[]) => cs.filter((c) => c.categoryName !== categoryName);
  const target = groupId && list.groups.some((g) => g.id === groupId) ? groupId : null;
  return {
    groups: list.groups.map((g) => ({ ...g, categories: g.id === target ? [...without(g.categories), moving] : without(g.categories) })),
    ungrouped: target ? without(list.ungrouped) : [...without(list.ungrouped), moving],
  };
}

const normalize = (name: string): string => name.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The same rules the server applies to a group name, said before the request. Null = fine. */
export function groupNameError(name: string, groups: ReadonlyArray<{ id: string; name: string }>, ignoreId?: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Dê um nome ao grupo.';
  if (trimmed.length > 60) return 'Use até 60 caracteres.';
  if (normalize(trimmed) === normalize(OTHER_NAME)) return '"Outros" é o grupo das categorias sem grupo.';
  if (groups.some((g) => g.id !== ignoreId && normalize(g.name) === normalize(trimmed))) return 'Já existe um grupo com esse nome.';
  return null;
}

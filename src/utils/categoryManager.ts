// Pure rules of the category manager (Settings), the merge dialog and the inline "Criar" option of the category
// combobox. No React here: the logic is tested on its own (Recta/tools/fe-tests/t20_categories.mts).

export type CategoryKind = 'INCOME' | 'EXPENSE';

export const MAX_CATEGORY_NAME = 100;
export const DEFAULT_CATEGORY_COLOR = '#64748B';
export const CUSTOM_PREFIX = 'CUSTOM:';

export interface CategoryUsage {
  transactions: number;
  recurringTransactions: number;
  budgets: number;
}

/** One row of GET /categories?includeUsage=true. */
export interface ManagedCategory {
  id: string;
  name: string;
  type: CategoryKind;
  color?: string | null;
  icon?: string | null;
  isSystem: boolean;
  usage?: CategoryUsage | null;
}

const NO_USAGE: CategoryUsage = { transactions: 0, recurringTransactions: 0, budgets: 0 };

/** Case, accent and extra-space insensitive form of a name (the server compares names the same way). */
export function normalizeCategoryName(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function usageOf(category: ManagedCategory): CategoryUsage {
  return category.usage ?? NO_USAGE;
}

export function usageTotal(usage: CategoryUsage | null | undefined): number {
  return usage ? usage.transactions + usage.recurringTransactions + usage.budgets : 0;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "12 transações, 2 recorrências e 1 orçamento" (zero parts left out); "nenhum lançamento" when all are zero. */
export function usageLabel(usage: CategoryUsage | null | undefined): string {
  const parts: string[] = [];
  if (usage?.transactions) parts.push(plural(usage.transactions, 'transação', 'transações'));
  if (usage?.recurringTransactions) parts.push(plural(usage.recurringTransactions, 'recorrência', 'recorrências'));
  if (usage?.budgets) parts.push(plural(usage.budgets, 'orçamento', 'orçamentos'));
  if (parts.length === 0) return 'Sem uso';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}

export interface CategoryGroup {
  type: CategoryKind;
  title: string;
  system: ManagedCategory[];
  custom: ManagedCategory[];
}

/** Receitas first, then Despesas; each with system (by label) and custom (by name) lists. Movement markers are not listed. */
export function groupCategories(
  categories: ManagedCategory[],
  systemLabel: (category: ManagedCategory) => string,
): CategoryGroup[] {
  const byLabel = (a: ManagedCategory, b: ManagedCategory, label: (c: ManagedCategory) => string) =>
    label(a).localeCompare(label(b), 'pt-BR', { sensitivity: 'base' });
  return (['INCOME', 'EXPENSE'] as const).map((type) => ({
    type,
    title: type === 'INCOME' ? 'Receitas' : 'Despesas',
    system: categories.filter((c) => c.isSystem && c.type === type && c.id !== 'TRANSFER' && c.id !== 'ALLOCATION').sort((a, b) => byLabel(a, b, systemLabel)),
    custom: categories.filter((c) => !c.isSystem && c.type === type).sort((a, b) => byLabel(a, b, (c) => c.name)),
  }));
}

export interface MergeTargetOption {
  /** Request field: targetCategoryId (custom) or targetSystemName (system). */
  kind: 'custom' | 'system';
  id: string;
  label: string;
}

/** Where a category can be merged into: same type, never itself; custom ones first, then the system ones. */
export function mergeTargets(
  source: ManagedCategory,
  categories: ManagedCategory[],
  systemLabel: (category: ManagedCategory) => string,
): MergeTargetOption[] {
  if (source.isSystem) return [];
  const sameType = categories.filter((c) => c.type === source.type && c.id !== source.id && c.id !== 'TRANSFER' && c.id !== 'ALLOCATION');
  const custom = sameType.filter((c) => !c.isSystem).map((c): MergeTargetOption => ({ kind: 'custom', id: c.id, label: c.name }));
  const system = sameType.filter((c) => c.isSystem).map((c): MergeTargetOption => ({ kind: 'system', id: c.id, label: systemLabel(c) }));
  const sort = (list: MergeTargetOption[]) => list.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' }));
  return [...sort(custom), ...sort(system)];
}

export interface MergeRequest {
  url: string;
  body: { targetCategoryId: string } | { targetSystemName: string };
}

export function buildMergeRequest(sourceId: string, target: MergeTargetOption, preview: boolean): MergeRequest {
  return {
    url: `/categories/${sourceId}/merge${preview ? '?preview=true' : ''}`,
    body: target.kind === 'custom' ? { targetCategoryId: target.id } : { targetSystemName: target.id },
  };
}

export interface MergeCounts {
  transactions: number;
  recurringTransactions: number;
  budgets: number;
  budgetsCombined: number;
}

/** "Vão para Investimentos: 12 transações, 2 recorrências e 1 orçamento." (no verb to agree in number and gender) */
export function mergePreviewSentence(counts: MergeCounts, targetLabel: string): string {
  const budgets = counts.budgets + counts.budgetsCombined;
  const parts: string[] = [];
  if (counts.transactions) parts.push(plural(counts.transactions, 'transação', 'transações'));
  if (counts.recurringTransactions) parts.push(plural(counts.recurringTransactions, 'recorrência', 'recorrências'));
  if (budgets) parts.push(plural(budgets, 'orçamento', 'orçamentos'));
  if (parts.length === 0) return `Nada usa esta categoria: ela só será removida, e nada muda em ${targetLabel}.`;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
  return `Vão para ${targetLabel}: ${list}.`;
}

/** Extra line when two monthly budgets meet in the target: their limits are added. */
export function mergeBudgetNote(counts: MergeCounts): string | null {
  if (!counts.budgetsCombined) return null;
  return counts.budgetsCombined === 1
    ? 'Um orçamento mensal já existia no destino: os limites dos dois serão somados.'
    : `${counts.budgetsCombined} orçamentos mensais já existiam no destino: os limites serão somados.`;
}

export interface ValidatedName {
  ok: boolean;
  name: string;
  message?: string;
}

/**
 * Checks a new or renamed name against the categories already listed (same type): empty, too long, or the same as another
 * category once case, accents and spaces are ignored. `ignoreId` is the category being renamed.
 */
export function validateCategoryName(
  raw: string,
  type: CategoryKind,
  categories: ManagedCategory[],
  systemLabel: (category: ManagedCategory) => string,
  ignoreId?: string | null,
): ValidatedName {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, name, message: 'Informe um nome.' };
  if (name.length > MAX_CATEGORY_NAME) return { ok: false, name, message: `Use no máximo ${MAX_CATEGORY_NAME} caracteres.` };
  const wanted = normalizeCategoryName(name);
  const clash = categories.find(
    (c) => c.type === type && c.id !== ignoreId && normalizeCategoryName(c.isSystem ? systemLabel(c) : c.name) === wanted,
  );
  if (clash) {
    return {
      ok: false,
      name,
      message: clash.isSystem
        ? `Já existe a categoria padrão "${systemLabel(clash)}". Use-a ou escolha outro nome.`
        : `Já existe uma categoria "${clash.name}". Escolha outro nome ou una as duas.`,
    };
  }
  return { ok: true, name };
}

export interface ComboOption {
  value: string;
  display: string;
}

/** The "Criar “texto”" option of the combobox: offered when something was typed and no listed option has that name. */
export function createOptionFor(search: string, options: ComboOption[]): { name: string; label: string } | null {
  const name = search.replace(/\s+/g, ' ').trim();
  if (!name || name.length > MAX_CATEGORY_NAME) return null;
  const wanted = normalizeCategoryName(name);
  if (options.some((o) => o.value !== '' && normalizeCategoryName(o.display) === wanted)) return null;
  return { name, label: `Criar “${name}”` };
}

/** The value stored in transactions/recurrences for a custom category id. */
export function customValue(id: string): string {
  return `${CUSTOM_PREFIX}${id}`;
}

/** Message for a failed create/rename/merge/delete, by the server's error code (the texts are the user's, never raw slugs). */
export function categoryFailureMessage(error: unknown, fallback = 'Não foi possível concluir a operação.'): string {
  const e = error as { code?: string; status?: number; message?: string } | null;
  switch (e?.code) {
    case 'CATEGORY_NAME_TAKEN':
      return 'Já existe uma categoria com esse nome (maiúsculas, acentos e espaços não contam). Escolha outro nome ou una as duas.';
    case 'CATEGORY_IN_USE':
      return 'Esta categoria ainda é usada em transações, recorrências ou orçamentos. Una com outra categoria para movê-los.';
    case 'CATEGORY_MERGE_SELF':
      return 'Escolha outra categoria: não dá para unir uma categoria com ela mesma.';
    case 'CATEGORY_MERGE_TYPE_MISMATCH':
      return 'Só é possível unir categorias do mesmo tipo (receita com receita, despesa com despesa).';
    case 'CATEGORY_MERGE_TARGET_INVALID':
      return 'Esta categoria não pode ser o destino de uma união.';
    default:
      break;
  }
  if (e?.status === 404) return 'Esta categoria não existe mais (talvez já tenha sido unida ou excluída). A lista foi atualizada.';
  if (e?.status === 403) return 'Você não tem permissão para alterar categorias nesta conta.';
  return e?.message && !/^[A-Z_]+$/.test(e.message) ? e.message : fallback;
}

/** Normalizes a color typed or picked to #RRGGBB, or null when it is not one. */
export function normalizeColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : null;
}

export const CATEGORY_COLORS = ['#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6', '#3B82F6', '#6366F1', '#A855F7', '#EC4899', '#64748B'] as const;

export interface CategoryFormValues {
  name: string;
  type: CategoryKind;
  color: string | null;
}

/** What PATCH carries: only the fields that changed. null when nothing changed. */
export function buildUpdatePatch(
  original: { name: string; color?: string | null },
  next: { name: string; color: string | null },
): { name?: string; color?: string | null } | null {
  const patch: { name?: string; color?: string | null } = {};
  if (next.name !== original.name) patch.name = next.name;
  const before = normalizeColor(original.color) ?? null;
  if ((next.color ?? null) !== before) patch.color = next.color;
  return Object.keys(patch).length > 0 ? patch : null;
}

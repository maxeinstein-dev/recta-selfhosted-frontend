/**
 * The label of a category as a row shows it: the translated name of a system category, or the name of a custom
 * category ("CUSTOM:<id>"). A custom category that is not in the list (not loaded yet, or removed) gives an empty
 * label: the raw "CUSTOM:<id>" is an internal id and is never shown.
 *
 * No React: tools/fe-tests/t38_category_label.mts runs it under tsx.
 */
import { getCategoryDisplayName, isCustomCategoryName, type CustomCategoryInfo } from '../lib/enums';

export function invoiceRowCategoryLabel(
  categoryName: string | undefined | null,
  translations: Record<string, string> | undefined,
  customCategories: readonly Pick<CustomCategoryInfo, 'id' | 'name'>[] | undefined,
): string {
  if (!categoryName) return '';
  const label = getCategoryDisplayName(categoryName, translations, customCategories as CustomCategoryInfo[] | undefined);
  return isCustomCategoryName(label) ? '' : label;
}

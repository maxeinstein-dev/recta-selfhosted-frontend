/**
 * Pure rule of the theme by device: until this device has a choice of its own, the theme follows the system; a choice
 * made here wins. The backend's saved theme is not read here (it is a default 'light' for every account, so it says
 * nothing about what the person picked). No React and no imports, so tools/fe-tests/t34_theme_choice.mts runs it
 * under tsx (THEME_CHOICE_MODULE points it at a mutated copy).
 */

export type ThemeName = 'light' | 'dark';

/** localStorage key holding the theme this device was set to ('light' or 'dark'). */
export const THEME_STORAGE_KEY = 'theme';
/** localStorage key set to '1' once the person picks a theme on this device. */
export const THEME_CHOSEN_KEY = 'theme-chosen';

export function followsSystem(chosen: boolean): boolean {
  return !chosen;
}

export function resolveTheme(input: { chosen: boolean; saved: string | null; systemDark: boolean }): ThemeName {
  if (input.chosen && (input.saved === 'light' || input.saved === 'dark')) return input.saved;
  return input.systemDark ? 'dark' : 'light';
}

/**
 * Pure logic of the Android back button in the mobile shell: which layers (sheets, menus, modals) are open, which one
 * the back closes, and how a layer's own history entry is added or removed. No React and no imports, so
 * tools/fe-tests/t40_back_layers.mts runs it under tsx (BACK_LAYERS_MODULE points it at a mutated copy).
 *
 * Each open layer owns one history entry, marked with `history.state.rectaLayer = id`. The back button pops that entry
 * (the WebView goes back), and the popstate closes the layer on top. A layer closed by code pops its own entry with
 * history.back(), so the history does not keep leftovers.
 */

export const LAYER_STATE_KEY = 'rectaLayer';

/** The layers open now, oldest first. Adds `id` on top; an id already open is not added twice. */
export function pushLayer(stack: readonly string[], id: string): string[] {
  return stack.includes(id) ? [...stack] : [...stack, id];
}

/** The layers without `id`. */
export function removeLayer(stack: readonly string[], id: string): string[] {
  return stack.filter((layer) => layer !== id);
}

/** The layer on top, or null when none is open. */
export function topLayer(stack: readonly string[]): string | null {
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

/**
 * The layer a popstate closes: the top one, unless the entry the history landed on (`poppedLayer`) already is that
 * top layer's entry. Null when nothing has to close.
 */
export function layerToClose(stack: readonly string[], poppedLayer: string | null | undefined): string | null {
  const top = topLayer(stack);
  if (top === null) return null;
  return poppedLayer === top ? null : top;
}

/**
 * Whether a layer closed by code should pop its own entry: only when that entry is the current one (`stateLayer`)
 * and no other layer still claims it. Otherwise (the entry is gone, or a navigation already moved on) nothing is popped.
 */
export function historyBackOnClose(
  stack: readonly string[],
  stateLayer: string | null | undefined,
  id: string,
): boolean {
  return stateLayer === id && !stack.includes(id);
}

/**
 * How a layer opening writes its entry: 'keep' when the current entry is already its own (a remount), 'replace' when
 * the current entry is a stale layer entry (a sheet that just closed in the same tick), 'push' otherwise.
 */
export function entryForOpen(
  stack: readonly string[],
  stateLayer: string | null | undefined,
  id: string,
): 'keep' | 'replace' | 'push' {
  if (stateLayer === id) return 'keep';
  if (stateLayer && !stack.includes(stateLayer)) return 'replace';
  return 'push';
}

export type ShellNavigation = 'stay' | 'push' | 'replace';

/**
 * How a tab or "Mais" item navigates. The tab you are on adds nothing. With a sheet open, the navigation replaces the
 * sheet's entry, so voltar goes back to the screen before the sheet. Otherwise it pushes, so voltar returns to the
 * previous screen.
 */
export function shellNavigation(currentPath: string, targetPath: string, sheetOpen: boolean): ShellNavigation {
  if (currentPath === targetPath) return 'stay';
  return sheetOpen ? 'replace' : 'push';
}

export type BackAction = 'closeLayer' | 'historyBack' | 'exit';

/**
 * What the Android back button does, decided by the page: close the layer on top, go back in the history, or leave
 * the app. `historyIndex` is react-router's `history.state.idx` (0 on the first entry of the app). The WebView's own
 * canGoBack() is not used: the page knows its own entries, and the device check could not confirm canGoBack() counts them.
 */
export function backAction(stack: readonly string[], historyIndex: number | null | undefined): BackAction {
  if (stack.length > 0) return 'closeLayer';
  if (typeof historyIndex === 'number' && historyIndex > 0) return 'historyBack';
  return 'exit';
}

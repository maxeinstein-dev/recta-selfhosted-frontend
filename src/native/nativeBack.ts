import { backAction, type BackAction } from '../utils/backLayers';

/**
 * The page's side of the Android back button. MainActivity asks `window.__rectaNativeBack()` (through the bridge's
 * eval) what to do: the page closes its layer or goes back in its own history, and answers 'exit' only when there is
 * nothing to go back to. The WebView's canGoBack() is not consulted.
 */

type NativeBackWindow = Window & {
  __rectaNativeBack?: () => BackAction;
};

/** Installs the function MainActivity calls. `openLayers` returns the layers open now (see hooks/useBackLayer.ts). */
export function installNativeBack(openLayers: () => readonly string[]): void {
  if (typeof window === 'undefined') return;
  (window as NativeBackWindow).__rectaNativeBack = () => {
    const index = (window.history.state as { idx?: unknown } | null)?.idx;
    const action = backAction(openLayers(), typeof index === 'number' ? index : null);
    if (action !== 'exit') window.history.back();
    return action;
  };
}

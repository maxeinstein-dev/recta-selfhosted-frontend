import { useEffect, useId, useRef } from 'react';
import {
  LAYER_STATE_KEY,
  entryForOpen,
  historyBackOnClose,
  layerToClose,
  pushLayer,
  removeLayer,
} from '../utils/backLayers';

/**
 * Makes an open layer (a sheet, a menu, a modal) close with the Android back button, below 768 px only.
 *
 * While the layer is open it owns one history entry (`history.state.rectaLayer`). The back button pops that entry, the
 * popstate closes the layer on top, and the layer's own entry is gone. A layer closed by code (X, backdrop, Esc, a
 * button) pops its entry with history.back(), so the history keeps no leftover. Above 768 px nothing is pushed, so the
 * desktop keeps the browser's behavior.
 *
 * The rules are in utils/backLayers.ts (pure, tested by tools/fe-tests/t40_back_layers.mts). This file only wires them to
 * the window: one module-level popstate listener and the stack of open layers.
 */

let openLayers: string[] = [];
const closers = new Map<string, () => void>();
let listening = false;

const isShellViewport = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches;

const layerOf = (state: unknown): string | null => {
  if (!state || typeof state !== 'object') return null;
  const value = (state as Record<string, unknown>)[LAYER_STATE_KEY];
  return typeof value === 'string' ? value : null;
};

function onPopState(event: PopStateEvent): void {
  const id = layerToClose(openLayers, layerOf(event.state));
  if (id === null) return;
  openLayers = removeLayer(openLayers, id);
  closers.get(id)?.();
}

function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('popstate', onPopState);
}

export function useBackLayer(isOpen: boolean, onClose: () => void): void {
  const id = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen || !isShellViewport()) return undefined;
    listen();

    const how = entryForOpen(openLayers, layerOf(window.history.state), id);
    openLayers = pushLayer(openLayers, id);
    closers.set(id, () => onCloseRef.current());
    if (how !== 'keep') {
      const state = { ...(window.history.state ?? {}), [LAYER_STATE_KEY]: id };
      if (how === 'push') window.history.pushState(state, '', window.location.href);
      else window.history.replaceState(state, '', window.location.href);
    }

    return () => {
      openLayers = removeLayer(openLayers, id);
      closers.delete(id);
      // Deferred: under React StrictMode the effect runs again at once and the layer is open again by then.
      queueMicrotask(() => {
        if (historyBackOnClose(openLayers, layerOf(window.history.state), id)) window.history.back();
      });
    };
  }, [isOpen, id]);
}

/** The layers open now, oldest first (read by the native back button, see native/nativeBack.ts). */
export function getOpenLayers(): readonly string[] {
  return openLayers;
}

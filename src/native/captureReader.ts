import { Capacitor, registerPlugin } from '@capacitor/core';
import type { CaptureReaderPlugin } from '../utils/captureDevice';

/** True only inside the Android app (the Capacitor shell); false in the browser and the PWA. */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * The native notification reader (android/.../capture/CaptureReaderPlugin.kt). In a browser every call rejects, so
 * callers check [isNativeApp] first and render nothing otherwise.
 */
export const CaptureReader = registerPlugin<CaptureReaderPlugin>('CaptureReader');

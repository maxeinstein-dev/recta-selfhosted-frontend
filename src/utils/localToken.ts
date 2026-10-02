/**
 * Local JWT storage helpers (AUTH_MODE=local).
 *
 * Backend contract: POST /auth/login returns { data: { token } }.
 * That JWT is persisted under TOKEN_KEY and sent as
 * `Authorization: Bearer <token>` by the api.ts interceptor.
 */

export const TOKEN_KEY = 'recta_token';

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Read the locally stored JWT, or null when absent/unreadable. No expiry validation here. */
export function getLocalToken(): string | null {
  try {
    return storage()?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Persist the local JWT (e.g. right after POST /auth/login). */
export function setLocalToken(token: string): void {
  try {
    storage()?.setItem(TOKEN_KEY, token);
  } catch {
    // Ignore quota / SSR / private-mode write failures; caller decides UX.
  }
}

/** Drop the local JWT (e.g. on logout or 401). */
export function clearLocalToken(): void {
  try {
    storage()?.removeItem(TOKEN_KEY);
  } catch {
    // Ignore — absence of the key is the desired end state anyway.
  }
}

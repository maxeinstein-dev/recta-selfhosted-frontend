import { clearLocalToken } from './localToken';

/**
 * Local-mode (AUTH_MODE=local) session rules that do not depend on the browser build or on axios, so they can be
 * tested on their own (tools/fe-tests/t24_local_auth.mts). This module must not read import.meta.env.
 */

export type AuthMode = 'local' | 'firebase';

export const LOCAL_USER_KEY = 'recta_user';

/** Why a local sign-in or sign-up failed, in terms the login page can translate. */
export type LocalAuthErrorCode =
  | 'invalid-credentials'
  | 'email-taken'
  | 'invalid-input'
  | 'rate-limited'
  | 'registration-closed'
  | 'unknown';

export class LocalAuthError extends Error {
  constructor(public readonly code: LocalAuthErrorCode, message: string) {
    super(message);
    this.name = 'LocalAuthError';
  }
}

/** The error code for the HTTP status the backend answered on /auth/login or /auth/register. */
export function localAuthErrorCode(status: number): LocalAuthErrorCode {
  if (status === 401) return 'invalid-credentials';
  if (status === 429) return 'rate-limited';
  if (status === 403) return 'registration-closed';
  if (status === 409) return 'email-taken';
  if (status === 400) return 'invalid-input';
  return 'unknown';
}

/** The i18n key (Translations) of the message the login page shows for each failure. */
export const LOCAL_AUTH_MESSAGE_KEY = {
  'invalid-credentials': 'localAuthInvalidCredentials',
  'email-taken': 'localAuthEmailTaken',
  'invalid-input': 'localAuthInvalidInput',
  'rate-limited': 'localAuthRateLimited',
  'registration-closed': 'localAuthRegistrationClosed',
  unknown: 'loginError',
} as const satisfies Record<LocalAuthErrorCode, string>;

/**
 * Whether the login page offers "create account". Only a local backend can close sign-ups
 * (AUTH_ALLOW_REGISTRATION=false); Firebase mode always allows them, and an unknown flag counts as open.
 */
export function isRegistrationOpen(mode: AuthMode | undefined, registrationEnabled: boolean | undefined): boolean {
  return mode !== 'local' || registrationEnabled !== false;
}

/**
 * Which form the login page opens for `?action=...`: sign-up only when it was asked for and sign-ups are open
 * (with them closed the form could only end in a 403).
 */
export function wantsSignupForm(action: string | null, registrationOpen: boolean): boolean {
  return action === 'signup' && registrationOpen;
}

/**
 * Which credential the API client sends: chosen by the backend mode, not by what happens to be stored. A leftover
 * local token must not shadow a Firebase session (and a Firebase user must not be sent as a local one).
 */
export function tokenSourceFor(mode: AuthMode | null): 'local' | 'firebase' {
  return mode === 'local' ? 'local' : 'firebase';
}

/**
 * Whether an answer ends the local session: a 401 for a request that carried the stored local JWT. Nothing refreshes
 * a local token, so an expired one (or one of a deleted user) only gets the user back to the login page.
 */
export function shouldEndLocalSession(status: number | undefined, mode: AuthMode | null, storedToken: string | null): boolean {
  return status === 401 && mode === 'local' && !!storedToken;
}

/** Forget the local JWT and user, and go to the login page (unless the user is already there). */
export function endExpiredLocalSession(): void {
  clearLocalToken();
  try {
    localStorage.removeItem(LOCAL_USER_KEY);
  } catch {
    // Storage unavailable: nothing was kept.
  }
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

/** What GET /auth/config said, read defensively: null when the body is not a usable answer. */
export function parseAuthConfig(body: unknown): { authMode: AuthMode; registrationEnabled: boolean } | null {
  const data = (body as { data?: { authMode?: unknown; registrationEnabled?: unknown } } | null | undefined)?.data;
  const mode = data?.authMode;
  if (mode !== 'local' && mode !== 'firebase') return null;
  // A backend that predates the setting does not send it: sign-up is open there.
  return { authMode: mode, registrationEnabled: data?.registrationEnabled !== false };
}

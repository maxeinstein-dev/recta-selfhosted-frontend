import { parseAuthConfig, type AuthMode } from '../utils/localSession';

export type { AuthMode };

const STORAGE_KEY = 'recta_auth_mode';

let cachedMode: AuthMode | null = null;
// Whether the backend accepts new local sign-ups (AUTH_ALLOW_REGISTRATION). True until a backend says otherwise.
let cachedRegistrationEnabled = true;

function readStoredMode(): AuthMode | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'local' || raw === 'firebase') return raw;
    return null;
  } catch {
    return null;
  }
}

function readEnvMode(): AuthMode | null {
  const raw = import.meta.env.VITE_AUTH_MODE;
  if (raw === 'local' || raw === 'firebase') return raw;
  return null;
}

function baseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
  return raw.replace(/\/$/, '');
}

// Busca o authMode no backend (GET /auth/config, público).
// Sem axios aqui para evitar ciclo de import com utils/api.ts.
// Cache em memória + localStorage; fallback para VITE_AUTH_MODE se inalcançável.
export async function fetchAuthConfig(): Promise<AuthMode> {
  if (cachedMode) return cachedMode;

  try {
    const res = await fetch(`${baseUrl()}/auth/config`);
    if (!res.ok) throw new Error(`GET /auth/config -> HTTP ${res.status}`);
    const config = parseAuthConfig(await res.json());
    if (!config) {
      throw new Error('GET /auth/config -> resposta sem authMode válido');
    }
    const mode = config.authMode;
    cachedMode = mode;
    cachedRegistrationEnabled = config.registrationEnabled;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // storage indisponível (SSR/privado): segue só com cache em memória
    }
    return mode;
  } catch {
    return readEnvMode() ?? readStoredMode() ?? 'local';
  }
}

export function getCachedAuthMode(): AuthMode | null {
  return cachedMode ?? readStoredMode() ?? readEnvMode();
}

/** Whether the backend accepts new local sign-ups (known after fetchAuthConfig; open until then or on an older backend). */
export function getRegistrationEnabled(): boolean {
  return cachedRegistrationEnabled;
}

export function clearAuthModeCache(): void {
  cachedMode = null;
  cachedRegistrationEnabled = true;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}

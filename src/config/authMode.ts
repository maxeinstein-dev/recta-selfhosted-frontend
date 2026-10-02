export type AuthMode = 'local' | 'firebase';

interface AuthConfigResponse {
  success: boolean;
  data: {
    authMode: AuthMode;
    firebaseWebApiKey: string | null;
  };
}

const STORAGE_KEY = 'recta_auth_mode';

let cachedMode: AuthMode | null = null;

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
    const body = (await res.json()) as AuthConfigResponse;
    const mode = body?.data?.authMode;
    if (mode !== 'local' && mode !== 'firebase') {
      throw new Error(`GET /auth/config -> authMode inválido: ${String(mode)}`);
    }
    cachedMode = mode;
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

export function clearAuthModeCache(): void {
  cachedMode = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}

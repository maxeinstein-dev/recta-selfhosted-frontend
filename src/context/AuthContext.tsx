import { createContext, useContext, useEffect, useState, ReactNode, useMemo, useCallback, useRef } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  User,
  sendEmailVerification
} from 'firebase/auth';
import { getFirebaseAuth } from '../config/firebase';
import { AuthContextType } from '../types';
import { analyticsHelpers } from '../utils/analytics';
import { useSyncAuth } from '../hooks/api/useAuth';
import { isNetworkError } from '../utils/api';
import { queryClient } from '../lib/queryClient';
import { clearUserFromLocalStorage } from '../hooks/api/useUsers';
import { clearHouseholdFromLocalStorage } from '../utils/householdStorage';
import { fetchAuthConfig, getCachedAuthMode, type AuthMode } from '../config/authMode';
import { getLocalToken, setLocalToken, clearLocalToken } from '../utils/localToken';

/**
 * Verificar se está em período de manutenção
 * Deve usar a mesma lógica do useMaintenanceMode
 * Controlado pela variável de ambiente VITE_FLAG_MAINTENANCE
 */
const isMaintenanceMode = (): boolean => {
  const maintenanceFlag = import.meta.env.VITE_FLAG_MAINTENANCE;
  return maintenanceFlag === 'true' || maintenanceFlag === true;
};

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = (): AuthContextType => useContext(AuthContext);

/**
 * C3 (AUTH_MODE=local): resolução do modo via módulo canônico do lane C1
 * (`src/config/authMode.ts` — GET /auth/config com fallback de env).
 * Token local via helpers do lane C2 (`src/utils/localToken.ts`, mesma chave
 * `recta_token` lida pelo interceptor de utils/api.ts).
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
const LOCAL_USER_KEY = 'recta_user';

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authMode, setAuthMode] = useState<AuthMode>(() => getCachedAuthMode() ?? 'firebase');
  const authModeRef = useRef<AuthMode>(authMode);
  authModeRef.current = authMode;
  const syncAuth = useSyncAuth();
  const syncAuthRef = useRef(syncAuth);
  syncAuthRef.current = syncAuth;

  // Modo local: login via backend. Usa fetch direto (sem apiClient, que no modo
  // local ainda não tem sessão no momento do login) e persiste o JWT via
  // helpers do lane C2. Retorna pseudo-User no shape { uid, email }.
  const localLoginRequest = useCallback(async (email: string, password: string): Promise<User> => {
    const loginRes = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!loginRes.ok) {
      const errBody = await loginRes.json().catch(() => null);
      const msg =
        (errBody?.error as { message?: string } | undefined)?.message ??
        (typeof errBody?.error === 'string' ? errBody.error : undefined) ??
        `HTTP ${loginRes.status}`;
      throw new Error(msg);
    }
    const json = (await loginRes.json()) as {
      data: { token: string; id: string; email: string };
    };
    const { token, id, email: loggedEmail } = json.data;
    setLocalToken(token);
    try {
      localStorage.setItem(LOCAL_USER_KEY, JSON.stringify({ id, email: loggedEmail }));
    } catch {
      // storage indisponível — segue com sessão em memória
    }
    const pseudo = { uid: id, email: loggedEmail } as unknown as User;
    setCurrentUser(pseudo);
    return pseudo;
  }, []);

  // Modo local: registra via backend e encadeia login para obter o JWT.
  const localSignup = useCallback(async (email: string, password: string) => {
    const registerRes = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!registerRes.ok) {
      const errBody = await registerRes.json().catch(() => null);
      const msg =
        (errBody?.error as { message?: string } | undefined)?.message ??
        (typeof errBody?.error === 'string' ? errBody.error : undefined) ??
        `HTTP ${registerRes.status}`;
      throw new Error(msg);
    }
    analyticsHelpers.logSignup('email');
    const pseudo = await localLoginRequest(email, password);
    return { user: pseudo };
  }, [localLoginRequest]);

  const signup = useCallback(async (email: string, password: string, referralCode?: string) => {
    if (isMaintenanceMode()) {
      throw new Error('O aplicativo está em manutenção. Por favor, tente novamente mais tarde.');
    }
    if (authModeRef.current === 'local') {
      return localSignup(email, password);
    }
    const result = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
    await sendEmailVerification(result.user);
    analyticsHelpers.logSignup('email');
    // Sincronizar com backend após criar usuário e processar referral code se fornecido
    try {
      await syncAuth.mutateAsync(referralCode);
    } catch (error) {
      // Log apenas como warning se for erro de rede (backend pode estar offline)
      if (isNetworkError(error)) {
        // Backend não disponível para sincronização
      } else {
        // Error syncing user with backend
      }
    }
    return result;
  }, [syncAuth, localSignup]);

  const localLogin = useCallback(async (email: string, password: string) => {
    const pseudo = await localLoginRequest(email, password);
    analyticsHelpers.logLogin('email');
    return { user: pseudo };
  }, [localLoginRequest]);

  const login = useCallback(async (email: string, password: string) => {
    if (isMaintenanceMode()) {
      throw new Error('O aplicativo está em manutenção. Por favor, tente novamente mais tarde.');
    }
    if (authModeRef.current === 'local') {
      return localLogin(email, password);
    }
    const result = await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
    analyticsHelpers.logLogin('email');
    // Sincronizar com backend após login
    try {
      await syncAuth.mutateAsync(undefined);
    } catch (error) {
      // Log apenas como warning se for erro de rede (backend pode estar offline)
      if (isNetworkError(error)) {
        // Backend não disponível para sincronização
      } else {
        // Error syncing user with backend
      }
    }
    return result;
  }, [syncAuth, localLogin]);

  const loginWithGoogle = useCallback(async (referralCode?: string) => {
    if (isMaintenanceMode()) {
      throw new Error('O aplicativo está em manutenção. Por favor, tente novamente mais tarde.');
    }
    if (authModeRef.current === 'local') {
      throw new Error('Login com Google não está disponível no modo de autenticação local.');
    }
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(getFirebaseAuth(), provider);
    analyticsHelpers.logLogin('google');
    // Sincronizar com backend após login e processar referral code se fornecido
    try {
      await syncAuth.mutateAsync(referralCode);
    } catch (error) {
      // Log apenas como warning se for erro de rede (backend pode estar offline)
      if (isNetworkError(error)) {
        // Backend não disponível para sincronização
      } else {
        // Error syncing user with backend
      }
    }
    return result;
  }, [syncAuth]);

  const logout = useCallback(async () => {
    analyticsHelpers.logLogout();
    
    // Limpar cache do React Query PRIMEIRO (antes de limpar storage)
    try {
      queryClient.clear();
      queryClient.removeQueries();
      queryClient.resetQueries();
    } catch (error) {
      // Error clearing React Query cache
    }
    
    // Limpar dados específicos do usuário do localStorage
    try {
      clearUserFromLocalStorage();
      clearHouseholdFromLocalStorage();
    } catch (error) {
      // Error clearing user data from localStorage
    }
    
    // Remover token/sessão local explicitamente (localStorage.clear() abaixo já
    // cobre, mas a remoção explícita protege contra mudanças futuras na ordem)
    clearLocalToken();
    try {
      localStorage.removeItem(LOCAL_USER_KEY);
    } catch (error) {
      // Error clearing local user
    }

    // Limpar todo o localStorage (após limpar dados específicos)
    try {
      localStorage.clear();
    } catch (error) {
      // Error clearing localStorage
    }
    
    // Limpar sessionStorage
    try {
      sessionStorage.clear();
    } catch (error) {
      // Error clearing sessionStorage
    }
    
    // Limpar cache do Service Worker (segurança)
    if ('caches' in window) {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames.map(cacheName => caches.delete(cacheName))
        );
      } catch (error) {
        // Error clearing cache
      }
    }
    
    // Fazer logout do Firebase apenas no modo firebase (modo local não tem sessão Firebase)
    if (authModeRef.current !== 'local') {
      await signOut(getFirebaseAuth());
    }
    
    // Forçar limpeza adicional do React Query após logout
    // Isso garante que nenhum dado fique em cache
    try {
      queryClient.clear();
      queryClient.cancelQueries();
    } catch (error) {
      // Error clearing React Query cache after logout
    }
  }, []);

  // C3: resolver o modo via backend (fonte canônica, módulo do lane C1).
  // O env é só fallback inicial até a resposta de GET /auth/config chegar.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mode = await fetchAuthConfig();
      if (!cancelled) {
        setAuthMode(mode);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Modo local: sem sessão Firebase — restaura pseudo-user do storage, se houver.
    if (authMode === 'local') {
      try {
        const stored = localStorage.getItem(LOCAL_USER_KEY);
        const token = getLocalToken();
        if (stored && token) {
          const parsed = JSON.parse(stored) as { id: string; email: string };
          if (parsed?.id && parsed?.email) {
            setCurrentUser({ uid: parsed.id, email: parsed.email } as unknown as User);
          }
        }
      } catch {
        // storage indisponível — segue sem sessão
      }
      setLoading(false);
      return;
    }
    let isMounted = true;
    let syncInProgress = false;
    let lastSyncedUid: string | null = null;
    let syncTimeout: NodeJS.Timeout | null = null;
    let unsubscribe: () => void = () => {};
    try {
      unsubscribe = onAuthStateChanged(getFirebaseAuth(), async (user: User | null) => {
      if (!isMounted) return;
      
      // Limpar timeout anterior se existir
      if (syncTimeout) {
        clearTimeout(syncTimeout);
        syncTimeout = null;
      }
      
      setCurrentUser(user);
      
      if (user) {
        // Só sincronizar se o UID mudou ou se ainda não sincronizamos
        const shouldSync = user.uid !== lastSyncedUid && !syncInProgress;
        
        if (shouldSync) {
          syncInProgress = true;
          lastSyncedUid = user.uid;
          
          // Usar timeout para evitar múltiplas chamadas rápidas
          syncTimeout = setTimeout(async () => {
            if (!isMounted || user.uid !== lastSyncedUid) {
              syncInProgress = false;
              return;
            }
            
            try {
              // Pequeno delay adicional para garantir que o token do Firebase esteja pronto
              await new Promise(resolve => setTimeout(resolve, 200));
              if (isMounted && user.uid === lastSyncedUid) {
                await syncAuthRef.current.mutateAsync(undefined);
              }
            } catch (error) {
              // Log apenas como warning se for erro de rede (backend pode estar offline)
              // Não resetar lastSyncedUid para erros de rede, permitindo retry automático
              if (isNetworkError(error)) {
                // Backend não disponível para sincronização
                // Resetar flag apenas para permitir nova tentativa após delay maior
                if (user.uid === lastSyncedUid) {
                  lastSyncedUid = null;
                }
              } else {
                // Error syncing user with backend
                // Resetar flag em caso de erro para permitir nova tentativa após delay
                if (user.uid === lastSyncedUid) {
                  lastSyncedUid = null;
                }
              }
            } finally {
              if (user.uid === lastSyncedUid) {
                syncInProgress = false;
              }
            }
          }, 500); // Delay de 500ms para evitar múltiplas chamadas
        }
      } else {
        // Resetar quando usuário faz logout
        lastSyncedUid = null;
        syncInProgress = false;
        if (syncTimeout) {
          clearTimeout(syncTimeout);
          syncTimeout = null;
        }
      }
      
      if (isMounted) {
        setLoading(false);
      }
    });
    } catch {
      // Firebase não configurado (ex.: backend em modo firebase sem VITE_FIREBASE_*).
      // Não há sessão a observar; libera a UI sem usuário.
      if (isMounted) {
        setLoading(false);
      }
    }

    return () => {
      isMounted = false;
      if (syncTimeout) {
        clearTimeout(syncTimeout);
      }
      unsubscribe();
    };
  }, [authMode]); // Reavaliar quando o modo resolver via /auth/config

  const value: AuthContextType = useMemo(() => ({
    currentUser,
    signup,
    login,
    loginWithGoogle,
    logout,
  }), [currentUser, signup, login, loginWithGoogle, logout]);

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};


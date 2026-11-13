import React, { createContext, useContext, useState, useEffect, ReactNode, useRef } from 'react';
import { useAuth } from './AuthContext';
import { useUser, useUpdateUserPreferences } from '../hooks/api/useUsers';
import { resolveTheme, followsSystem, THEME_CHOSEN_KEY, THEME_STORAGE_KEY } from '../utils/themeChoice';

export type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const { currentUser } = useAuth();
  
  // Only fetch user data if authenticated - this prevents queries from running before login
  const { data: user, isLoading: userLoading } = useUser();
  const updatePreferences = useUpdateUserPreferences();
  
  // Inicializar tema e aplicar imediatamente no HTML
  // Escolha por aparelho (utils/themeChoice): sem escolha feita neste aparelho, segue o sistema.
  const readDeviceTheme = (): Theme => {
    if (typeof window === 'undefined') return 'light';
    return resolveTheme({
      chosen: localStorage.getItem(THEME_CHOSEN_KEY) === '1',
      saved: localStorage.getItem(THEME_STORAGE_KEY),
      systemDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
    });
  };

  const getInitialTheme = (): Theme => {
    const next = readDeviceTheme();
    // Aplicar imediatamente no HTML antes do React renderizar
    document.documentElement.classList.toggle('dark', next === 'dark');
    return next;
  };

  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const [isInitialized, setIsInitialized] = useState(false);
  const isUpdatingFromBackend = useRef(false);
  const lastSavedTheme = useRef<Theme | null>(null);
  const hasLoadedFromBackend = useRef(false);
  const updatePreferencesRef = useRef(updatePreferences);
  updatePreferencesRef.current = updatePreferences;

  // Aplicar tema no documento sempre que mudar (apenas como fallback de segurança)
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // Sem escolha neste aparelho, o tema acompanha o sistema quando ele muda (utils/themeChoice).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      if (!followsSystem(localStorage.getItem(THEME_CHOSEN_KEY) === '1')) return;
      const next = readDeviceTheme();
      setThemeState(next);
      document.documentElement.classList.toggle('dark', next === 'dark');
    };
    mql.addEventListener('change', onSystemChange);
    return () => mql.removeEventListener('change', onSystemChange);
  }, []);

  // Carregar preferências do backend quando o usuário fizer login (apenas uma vez)
  useEffect(() => {
    if (!currentUser || userLoading) {
      if (!currentUser) {
        // Se não estiver logado, resetar flag e usa o tema deste aparelho como fallback
        hasLoadedFromBackend.current = false;
        const next = readDeviceTheme();
        if (next !== theme) {
          setThemeState(next);
          const root = document.documentElement;
          if (next === 'dark') {
            root.classList.add('dark');
          } else {
            root.classList.remove('dark');
          }
        }
        setIsInitialized(true);
      }
      return;
    }

    // Só carregar do backend uma vez quando o usuário fizer login
    if (!hasLoadedFromBackend.current) {
      // O tema salvo no perfil não é aplicado: ele é um padrão 'light' para todas as contas e não diz o que
      // a pessoa escolheu. A escolha vale por aparelho (utils/themeChoice), então o perfil não muda o tema aqui.
      // Marcar como carregado mesmo se não houver tema no backend
      hasLoadedFromBackend.current = true;
    }
    setIsInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, user, userLoading]); // Remover 'theme' das dependências para evitar loops

  // Salvar no backend quando mudar (mas não durante o carregamento inicial ou quando vier do backend)
  // Este useEffect é apenas um fallback de segurança - o toggleTheme e setTheme já salvam diretamente
  useEffect(() => {
    if (!isInitialized || !currentUser || userLoading || isUpdatingFromBackend.current) return;
    
    // Não salvar se o valor não mudou desde a última vez que salvamos
    if (lastSavedTheme.current === theme) return;
    
    // Não salvar se acabou de carregar do backend
    if (!hasLoadedFromBackend.current) return;

    const timeoutId = setTimeout(() => {
      if (!isUpdatingFromBackend.current && lastSavedTheme.current !== theme && hasLoadedFromBackend.current) {
        lastSavedTheme.current = theme;
        updatePreferencesRef.current.mutate({ theme });
      }
    }, 300); // Reduzir delay para resposta mais rápida

    return () => clearTimeout(timeoutId);
  }, [theme, currentUser, isInitialized, userLoading]);

  const setTheme = (newTheme: Theme) => {
    // Prevenir atualização se estiver carregando do backend
    if (isUpdatingFromBackend.current) return;
    
    // Aplicar imediatamente no documento ANTES de atualizar o estado
    const root = document.documentElement;
    if (newTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
    localStorage.setItem(THEME_CHOSEN_KEY, '1');
    
    // Marcar que não veio do backend para evitar conflitos
    hasLoadedFromBackend.current = true;
    
    // Salvar no backend se o usuário estiver logado (de forma assíncrona)
    if (currentUser && isInitialized) {
      lastSavedTheme.current = newTheme;
      // Usar requestAnimationFrame para garantir que a UI atualize primeiro
      requestAnimationFrame(() => {
        updatePreferencesRef.current.mutate({ theme: newTheme });
      });
    }
  };

  const toggleTheme = () => {
    // Prevenir atualização se estiver carregando do backend
    if (isUpdatingFromBackend.current) return;
    
    setThemeState((currentTheme) => {
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      
      // Aplicar imediatamente no documento ANTES de atualizar o estado
      // Isso garante que a mudança visual seja instantânea
      const root = document.documentElement;
      if (newTheme === 'dark') {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
      
      // Salvar imediatamente no localStorage
      localStorage.setItem('theme', newTheme);
      localStorage.setItem(THEME_CHOSEN_KEY, '1');

      // Marcar que não veio do backend para evitar conflitos
      hasLoadedFromBackend.current = true;
      
      // Track analytics (only if not from backend load)
      if (currentUser && isInitialized && !isUpdatingFromBackend.current) {
        import('../utils/analytics').then(({ analyticsHelpers }) => {
          analyticsHelpers.logThemeChanged(newTheme);
        });
      }
      
      // Salvar no backend se o usuário estiver logado (de forma assíncrona)
      if (currentUser && isInitialized) {
        lastSavedTheme.current = newTheme;
        // Usar requestAnimationFrame para garantir que a UI atualize primeiro
        requestAnimationFrame(() => {
          updatePreferencesRef.current.mutate({ theme: newTheme });
        });
      }
      
      return newTheme;
    });
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};


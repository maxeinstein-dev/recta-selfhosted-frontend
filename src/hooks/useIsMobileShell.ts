import { useEffect, useState } from 'react';

/** Below Tailwind's `md` breakpoint (768 px): the mobile shell. From 768 px up the desktop layout stays as it is. */
export const MOBILE_SHELL_QUERY = '(max-width: 767.98px)';

export function useIsMobileShell(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(MOBILE_SHELL_QUERY).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(MOBILE_SHELL_QUERY);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return isMobile;
}

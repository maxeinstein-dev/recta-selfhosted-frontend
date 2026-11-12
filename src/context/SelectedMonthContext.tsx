import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';
import { monthKeyOf, shiftMonthKey } from '../utils/mobileShell';

/**
 * The month chosen in the mobile header. Starts at the current month each time the app opens (state lives in memory,
 * nothing is stored). Only screens that declare they use the selector read it (utils/mobileShell MONTH_SELECTOR_SCREENS).
 */
interface SelectedMonthValue {
  monthKey: string;
  isCurrentMonth: boolean;
  previousMonth: () => void;
  nextMonth: () => void;
  goToCurrentMonth: () => void;
}

const SelectedMonthContext = createContext<SelectedMonthValue | undefined>(undefined);

export const SelectedMonthProvider = ({ children }: { children: ReactNode }) => {
  const currentKey = monthKeyOf(new Date());
  const [monthKey, setMonthKey] = useState<string>(currentKey);

  const previousMonth = useCallback(() => setMonthKey((k) => shiftMonthKey(k, -1)), []);
  const nextMonth = useCallback(() => setMonthKey((k) => shiftMonthKey(k, 1)), []);
  const goToCurrentMonth = useCallback(() => setMonthKey(monthKeyOf(new Date())), []);

  const value = useMemo<SelectedMonthValue>(
    () => ({
      monthKey,
      isCurrentMonth: monthKey === currentKey,
      previousMonth,
      nextMonth,
      goToCurrentMonth,
    }),
    [monthKey, currentKey, previousMonth, nextMonth, goToCurrentMonth],
  );

  return <SelectedMonthContext.Provider value={value}>{children}</SelectedMonthContext.Provider>;
};

export const useSelectedMonth = (): SelectedMonthValue => {
  const context = useContext(SelectedMonthContext);
  if (context === undefined) {
    throw new Error('useSelectedMonth must be used within a SelectedMonthProvider');
  }
  return context;
};

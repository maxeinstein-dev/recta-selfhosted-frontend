import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSelectedMonth } from '../../context/SelectedMonthContext';
import { monthLabelPt } from '../../utils/mobileShell';

/** The month control of the mobile header. Shown only on the screens that declare they use it (see MobileShell). */
const MonthSelector = () => {
  const { monthKey, previousMonth, nextMonth } = useSelectedMonth();
  const label = monthLabelPt(monthKey);
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
      <button
        type="button"
        onClick={previousMonth}
        aria-label="Mês anterior"
        className="flex h-11 w-11 flex-none items-center justify-center rounded-xl text-rc-ink2"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <span className="min-w-0 truncate text-base font-semibold first-letter:uppercase tabular-nums text-rc-ink" aria-live="polite">
        {label}
      </span>
      <button
        type="button"
        onClick={nextMonth}
        aria-label="Próximo mês"
        className="flex h-11 w-11 flex-none items-center justify-center rounded-xl text-rc-ink2"
      >
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
};

export default MonthSelector;

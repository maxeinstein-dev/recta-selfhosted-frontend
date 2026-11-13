import { useNavigate } from 'react-router-dom';
import { Layers } from 'lucide-react';
import { useCurrency } from '../../context/CurrencyContext';
import { useI18n } from '../../context/I18nContext';
import { useDefaultHousehold } from '../../hooks/useDefaultHousehold';
import { useIncomeSplit } from '../../hooks/api/useCategoryGroups';
import { formatCurrency } from '../../utils/format';
import { HousingShare, IncomeSplitBar } from '../spending-groups/IncomeSplitViews';

interface IncomeSplitWidgetProps {
  selectedMonth: Date;
  blurNumbers?: boolean;
}

const monthKeyOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Dashboard widget (P05): where the month's income goes, by spending group, and housing against 30%. */
export const IncomeSplitWidget = ({ selectedMonth, blurNumbers = false }: IncomeSplitWidgetProps) => {
  const navigate = useNavigate();
  const { householdId } = useDefaultHousehold();
  const { baseCurrency } = useCurrency();
  const { t } = useI18n();
  const title = (t as unknown as Record<string, string | undefined>).incomeSplit || 'Para onde vai a renda';
  const query = useIncomeSplit({ householdId: householdId ?? undefined, month: monthKeyOf(selectedMonth) });
  const money = (cents: number) => formatCurrency(cents / 100, baseCurrency);
  const toGroups = () => navigate('/app/settings#grupos-de-gasto');

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 flex flex-col" data-testid="income-split-widget">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg sm:text-xl font-light tracking-tight text-gray-900 dark:text-gray-100">
          <Layers className="h-5 w-5" aria-hidden="true" />
          {title}
        </h2>
        <button type="button" onClick={toGroups} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Grupos de gasto</button>
      </div>
      {query.isPending && householdId ? (
        <p role="status" className="text-sm text-gray-500 dark:text-gray-400">Carregando…</p>
      ) : query.isError || !query.data ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">Não foi possível carregar a divisão da renda.</p>
      ) : (
        <div className={`grid gap-6 lg:grid-cols-[2fr_1fr] ${blurNumbers ? 'blur-sm select-none' : ''}`}>
          <IncomeSplitBar split={query.data} money={money} />
          <div>
            <h3 className="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">Moradia</h3>
            <HousingShare split={query.data} money={money} onMarkHousing={toGroups} />
          </div>
        </div>
      )}
    </div>
  );
};

import { useMemo } from 'react';
import { useTransactions } from '../../context/TransactionsContext';
import { useCurrency } from '../../context/CurrencyContext';
import { useI18n } from '../../context/I18nContext';
import { formatCurrency } from '../../utils/format';
import { TransactionType, getCategoryDisplayName, CustomCategoryInfo } from '../../lib/enums';
import { Target, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useCategories } from '../../hooks/api/useCategories';
import { useDefaultHousehold } from '../../hooks/useDefaultHousehold';
import { useBudgetSummary } from '../../hooks/api/useBudgets';
import { budgetRealized, summaryMonthOf, summaryRowsByBudget } from '../../utils/budgetOwnShare';
import { budgetsInForce } from '../../utils/budgetPeriod';
import type { BudgetStatusName } from '../../utils/budgetStatus';

interface BudgetVsRealizedWidgetProps {
  selectedMonth: Date;
  blurNumbers?: boolean;
}

export const BudgetVsRealizedWidget = ({ selectedMonth, blurNumbers = false }: BudgetVsRealizedWidgetProps) => {
  const { budgets } = useTransactions();
  const { baseCurrency } = useCurrency();
  const { t } = useI18n();
  const { householdId } = useDefaultHousehold();
  const { data: categoriesData = [] } = useCategories({ householdId: householdId || undefined });

  // Convert to CustomCategoryInfo for getCategoryDisplayName
  const customCategories: CustomCategoryInfo[] = useMemo(() => 
    categoriesData
      .filter(c => !c.isSystem)
      .map(c => ({ id: c.id, name: c.name, type: c.type, color: c.color, icon: c.icon })),
    [categoriesData]
  );

  // Helper to resolve category display name
  const resolveCategoryName = (categoryName: string): string => {
    return getCategoryDisplayName(categoryName, t as unknown as Record<string, string>, customCategories);
  };

  const summary = useBudgetSummary({ householdId: householdId ?? '', month: summaryMonthOf(selectedMonth) });
  // Realized amount and own share: one source, GET /budgets/summary. Nothing is summed here.
  const summaryRows = useMemo(() => summaryRowsByBudget(summary.data?.budgets), [summary.data]);

  const budgetData = useMemo(() => {
    // A budget repeats from its month on: the server says which ones are in force in the month shown
    const monthBudgets = budgetsInForce(budgets, new Set(summaryRows.keys()));

    if (monthBudgets.length === 0) return [];

    return monthBudgets.map((budget) => {
      const realized = budgetRealized(budget.amount, summaryRows.get(budget.id ?? ''), budget.type === TransactionType.EXPENSE);
      const spent = realized?.spent ?? 0;
      const ownSpent = realized?.ownSpent;
      const rawPercentage = realized?.percentage ?? 0;
      // Limitar a porcentagem exibida a 1000% para evitar números extremos
      const percentage = Math.min(rawPercentage, 1000);
      const remaining = realized?.remaining ?? budget.amount;
      const status: BudgetStatusName = realized?.status ?? 'ok';

      return {
        category: budget.category,
        budget: budget.amount,
        spent,
        ownSpent,
        measure: budget.measure,
        pending: realized === null,
        remaining,
        percentage,
        rawPercentage,
        status,
        type: budget.type,
      };
    }).sort((a, b) => {
      // Ordenar: exceeded primeiro, depois warning, depois ok
      const statusOrder = { exceeded: 0, reached: 1, warning: 2, ok: 3 };
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }
      // Se mesmo status, ordenar por porcentagem (maior primeiro)
      return b.percentage - a.percentage;
    });
  }, [budgets, summaryRows]);

  if (budgetData.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-6 flex flex-col">
        <div className="flex items-center gap-2 mb-2">
          <Target className="h-5 w-5 text-primary-600 dark:text-primary-400" />
          <h2 className="text-lg sm:text-xl font-light tracking-tight text-gray-900 dark:text-gray-100">
            {t.budgets}
          </h2>
        </div>
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
          {t.noBudgetForMonth}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <Target className="h-5 w-5 text-primary-600 dark:text-primary-400" />
        <h2 className="text-lg sm:text-xl font-light tracking-tight text-gray-900 dark:text-gray-100">
          {t.budgetsVsRealized}
        </h2>
      </div>
      <div className="space-y-4 flex-1 overflow-auto">
        {budgetData.map((budget) => {
          const StatusIcon = budget.status === 'exceeded' 
            ? AlertCircle 
            : budget.status === 'warning' || budget.status === 'reached'
            ? AlertCircle 
            : CheckCircle2;
          
          const statusColors = {
            exceeded: {
              bg: 'bg-red-50 dark:bg-red-900/20',
              border: 'border-red-200 dark:border-red-800',
              text: 'text-red-700 dark:text-red-300',
              icon: 'text-red-600 dark:text-red-400',
              bar: 'bg-red-600',
            },
            reached: {
              bg: 'bg-orange-50 dark:bg-orange-900/20',
              border: 'border-orange-200 dark:border-orange-800',
              text: 'text-orange-700 dark:text-orange-300',
              icon: 'text-orange-600 dark:text-orange-400',
              bar: 'bg-orange-500',
            },
            warning: {
              bg: 'bg-yellow-50 dark:bg-yellow-900/20',
              border: 'border-yellow-200 dark:border-yellow-800',
              text: 'text-yellow-700 dark:text-yellow-300',
              icon: 'text-yellow-600 dark:text-yellow-400',
              bar: 'bg-yellow-500',
            },
            ok: {
              bg: 'bg-green-50 dark:bg-green-900/20',
              border: 'border-green-200 dark:border-green-800',
              text: 'text-green-700 dark:text-green-300',
              icon: 'text-green-600 dark:text-green-400',
              bar: 'bg-green-500',
            },
          };

          const colors = statusColors[budget.status];

          return (
            <div
              key={`${budget.category}-${budget.type}`}
              className={`p-4 rounded-lg border ${colors.bg} ${colors.border}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <StatusIcon className={`h-4 w-4 ${colors.icon}`} />
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {resolveCategoryName(budget.category)}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded ${colors.bg} ${colors.text}`}>
                    {budget.type === TransactionType.EXPENSE ? t.expense : t.income}
                  </span>
                </div>
                <span className={`text-sm font-light tracking-tight ${colors.text} ${blurNumbers ? 'demo-blur' : ''}`}>
                  {blurNumbers ? '•••' : budget.pending ? '—' : budget.rawPercentage > 1000 ? '1000%+' : `${budget.percentage.toFixed(1)}%`}
                </span>
              </div>
              
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-2">
                <div
                  className={`h-2 rounded-full transition-all ${colors.bar}`}
                  style={{ width: `${Math.min(budget.percentage, 100)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-4">
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">{t.budgeted}: </span>
                    <span className={`font-light tracking-tight text-gray-900 dark:text-gray-100 ${blurNumbers ? 'demo-blur' : ''}`}>
                      {blurNumbers ? '••••' : formatCurrency(budget.budget, baseCurrency)}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">{t.spent}: </span>
                    <span className={`font-light tracking-tight ${budget.status === 'exceeded' ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'} ${blurNumbers ? 'demo-blur' : ''}`}>
                      {blurNumbers ? '••••' : budget.pending ? '—' : formatCurrency(budget.spent, baseCurrency)}
                    </span>
                  </div>
                  {budget.ownSpent !== undefined && (
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">{budget.measure === 'OWN_SHARE' ? t.budgetOwnShareMeasured : t.budgetOwnShare}: </span>
                      <span className={`font-light tracking-tight text-gray-900 dark:text-gray-100 ${blurNumbers ? 'demo-blur' : ''}`}>
                        {blurNumbers ? '••••' : formatCurrency(budget.ownSpent, baseCurrency)}
                      </span>
                    </div>
                  )}
                </div>
                {!budget.pending && budget.remaining !== 0 && (
                  <div>
                    <span className={`font-medium ${budget.remaining > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'} ${blurNumbers ? 'demo-blur' : ''}`}>
                      {budget.remaining > 0 ? '+' : ''}
                      {blurNumbers ? '••••' : formatCurrency(budget.remaining, baseCurrency)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

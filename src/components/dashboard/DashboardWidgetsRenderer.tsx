import { WidgetId } from '../../types';
import {
  CreditCardsWidget,
  TrendsWidget,
  ForecastWidget,
  SavingsGoalsWidget,
  ProjectedBalanceWidget,
  BalanceEvolutionWidget,
  MonthlyComparisonWidget,
  InsightsWidget,
  BudgetVsRealizedWidget,
  FixedVsVariableWidget,
  DailyCashFlowWidget,
  SpendingHeatmapWidget,
  IncomeSplitWidget,
  TrendsForecastSkeleton,
  CreditCardsSkeleton,
  SavingsGoalsSkeleton,
  ChartSkeleton,
  ProjectedBalanceSkeleton,
  WidgetSkeleton,
} from '../widgets';

interface DashboardWidgetsRendererProps {
  widgetId: WidgetId;
  loading: boolean;
  preferencesLoading: boolean;
  isBlurred: boolean;
  selectedMonth?: Date;
  // Widget-specific props
  accountBalances?: any;
  trend?: any;
  forecast?: any;
  totalProjectedBalance?: number;
  totalAvailableBalance?: number;
  balanceEvolution?: any;
  monthlyComparison?: any;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onPreviousMonths?: () => void;
  onNextMonths?: () => void;
  onResetToCurrent?: () => void;
  incomeChange?: number;
  expenseChange?: number;
  balanceChange?: number;
  totalIncome?: number;
  totalExpense?: number;
  categoryData?: any;
  t: Record<string, string>;
}

export const DashboardWidgetsRenderer = ({
  widgetId,
  loading,
  preferencesLoading,
  isBlurred,
  selectedMonth,
  accountBalances,
  trend,
  forecast,
  totalProjectedBalance,
  totalAvailableBalance,
  balanceEvolution,
  monthlyComparison,
  canGoBack,
  canGoForward,
  onPreviousMonths,
  onNextMonths,
  onResetToCurrent,
  incomeChange,
  expenseChange,
  balanceChange,
  totalIncome,
  totalExpense,
  categoryData,
  t: _t,
}: DashboardWidgetsRendererProps) => {
  if (loading || preferencesLoading) {
    switch (widgetId) {
      case 'creditCards':
        return <CreditCardsSkeleton />;
      case 'trends':
      case 'forecast':
        return <TrendsForecastSkeleton />;
      case 'savingsGoals':
        return <SavingsGoalsSkeleton />;
      case 'projectedBalance':
        return <ProjectedBalanceSkeleton />;
      case 'balanceEvolution':
      case 'monthlyComparison':
        return <ChartSkeleton />;
      case 'insights':
        return <WidgetSkeleton />;
      default:
        return <WidgetSkeleton />;
    }
  }

  switch (widgetId) {
    case 'creditCards':
      return (
        <CreditCardsWidget accountBalances={accountBalances} blurNumbers={isBlurred} />
      );
    case 'trends':
      return <TrendsWidget trend={trend} blurNumbers={isBlurred} />;
    case 'forecast':
      return <ForecastWidget forecast={forecast} blurNumbers={isBlurred} />;
    case 'savingsGoals':
      return (
        <SavingsGoalsWidget blurNumbers={isBlurred} />
      );
      case 'projectedBalance':
        return (
          <ProjectedBalanceWidget
            totalProjectedBalance={totalProjectedBalance}
            totalAvailableBalance={totalAvailableBalance}
            blurNumbers={isBlurred}
          />
        );
    case 'balanceEvolution':
      return (
        <BalanceEvolutionWidget
          balanceEvolution={balanceEvolution}
          totalAvailableBalance={totalAvailableBalance}
          blurNumbers={isBlurred}
        />
      );
    case 'monthlyComparison':
      return (
        <MonthlyComparisonWidget
          monthlyComparison={monthlyComparison}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onPreviousMonths={onPreviousMonths}
          onNextMonths={onNextMonths}
          onResetToCurrent={onResetToCurrent}
          blurNumbers={isBlurred}
        />
      );
      case 'insights':
        return (
          <InsightsWidget
            incomeChange={incomeChange}
            expenseChange={expenseChange}
            balanceChange={balanceChange}
            totalIncome={totalIncome}
            totalExpense={totalExpense}
            categoryData={categoryData}
            blurNumbers={isBlurred}
          />
        );
      case 'budgetVsRealized':
        return (
          <BudgetVsRealizedWidget 
            selectedMonth={selectedMonth || new Date()}
            blurNumbers={isBlurred}
          />
        );
      case 'fixedVsVariable':
        return (
          <FixedVsVariableWidget 
            selectedMonth={selectedMonth || new Date()}
            blurNumbers={isBlurred}
          />
        );
      case 'dailyCashFlow':
        return (
          <DailyCashFlowWidget 
            selectedMonth={selectedMonth || new Date()}
            totalAvailableBalance={totalAvailableBalance || 0}
            blurNumbers={isBlurred}
          />
        );
      case 'spendingHeatmap':
        return (
          <SpendingHeatmapWidget 
            selectedMonth={selectedMonth || new Date()}
          />
        );
      case 'incomeSplit':
        return <IncomeSplitWidget selectedMonth={selectedMonth || new Date()} blurNumbers={isBlurred} />;
    default:
      return null;
  }
};

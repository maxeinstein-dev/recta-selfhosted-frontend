import { useMemo } from 'react';
import { useTransactions } from '../context/TransactionsContext';
import { startOfMonth } from 'date-fns';
import { TransactionType } from '../lib/enums';
import { isGeneralBudget } from '../utils/categories';
import { budgetStatusOf, type BudgetStatusName } from '../utils/budgetStatus';

export interface BudgetAlert {
  category: string;
  percentage: number;
  status: BudgetStatusName;
}

export function useBudgetAlerts(selectedMonth: Date, categoryData: any[], totalExpense: number, totalIncome: number): BudgetAlert[] {
  const { budgets } = useTransactions();

  const budgetAlerts = useMemo(() => {
    const monthBudgets = budgets.filter((b) => {
      const budgetMonth = startOfMonth(b.month);
      const selected = startOfMonth(selectedMonth);
      return budgetMonth.getTime() === selected.getTime();
    });

    return monthBudgets
      .map((budget): BudgetAlert => {
        let spent = 0;

        if (isGeneralBudget(budget)) {
          if (budget.type === TransactionType.EXPENSE) {
            spent = totalExpense;
          } else {
            spent = totalIncome;
          }
        } else {
          const categoryTransactions = categoryData.find(
            (c) => c.name === budget.category
          );
          spent =
            budget.type === TransactionType.EXPENSE
              ? categoryTransactions?.despesa || 0
              : categoryTransactions?.receita || 0;
        }

        const percentage =
          budget.amount > 0 ? (spent / budget.amount) * 100 : 0;

        const status = budgetStatusOf(spent, budget.amount);

        return {
          category: budget.category,
          percentage,
          status,
        };
      })
      .filter((b) => b.status !== 'ok');
  }, [budgets, selectedMonth, categoryData, totalExpense, totalIncome]);

  return budgetAlerts;
}



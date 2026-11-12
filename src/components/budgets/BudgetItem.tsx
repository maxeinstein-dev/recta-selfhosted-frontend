import { Budget } from '../../types';
import { formatCurrency } from '../../utils/format';
import { BudgetActionsMenu } from '../BudgetActionsMenu';
import { isGeneralBudget } from '../../utils/categories';
import { ownSharePercentage } from '../../utils/budgetOwnShare';

interface BudgetItemProps {
  budget: Budget & {
    spent: number;
    remaining: number;
    percentage: number;
    status: 'exceeded' | 'warning' | 'ok';
    /** Own share of the spending, only when other people owe part of it. */
    ownSpent?: number;
    /** The API has not answered the realized amount of this budget. */
    pending?: boolean;
  };
  baseCurrency: string;
  onEdit: (budget: Budget) => void;
  onDelete: (id: string) => void;
  t: Record<string, string>;
}

export const BudgetItem = ({
  budget,
  baseCurrency,
  onEdit,
  onDelete,
  t,
}: BudgetItemProps) => {
  return (
    <li key={budget.id} className="px-5 sm:px-6 py-5 hover:bg-gray-50/50 dark:hover:bg-gray-900/50 transition-colors">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-light tracking-tight text-gray-900 dark:text-white mb-4">
            {isGeneralBudget(budget) ? t.general : budget.category}
          </h3>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-medium text-gray-500 dark:text-gray-300 mb-1">
                  {t.budgetAmount}
                </div>
                <div className="text-base font-light text-gray-900 dark:text-white">
                  {formatCurrency(budget.amount, baseCurrency)}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 dark:text-gray-300 mb-1">
                  {t.spent}
                </div>
                <div className="text-base font-light text-gray-900 dark:text-white">
                  {budget.pending ? '—' : formatCurrency(budget.spent, baseCurrency)}
                </div>
              </div>
            </div>
            {budget.ownSpent !== undefined && (
              <p className="text-xs font-light text-gray-500 dark:text-gray-400">
                {t.budgetOwnShare}: <span className="text-gray-900 dark:text-white">{formatCurrency(budget.ownSpent, baseCurrency)}</span>
                {budget.amount > 0 && <> ({ownSharePercentage(budget.ownSpent, budget.amount).toFixed(1)}% {t.budgetOwnShareOfLimit})</>}
              </p>
            )}
            {!budget.pending && (
            <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-300">
                  {budget.remaining >= 0 ? t.remaining : t.exceeded}
                </span>
                <span className={`text-sm font-light ${
                  budget.remaining >= 0 ? 'text-green-500' : 'text-red-500'
                }`}>
                  {formatCurrency(Math.abs(budget.remaining), baseCurrency)}
                </span>
              </div>
              <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1 mb-2">
                <div
                  className={`h-1 rounded-full transition-all ${
                    budget.status === 'exceeded' ? 'bg-red-500' :
                    budget.status === 'warning' ? 'bg-yellow-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(budget.percentage, 100)}%` }}
                />
              </div>
              <div className="text-xs font-light text-gray-400 dark:text-gray-500">
                {budget.percentage.toFixed(1)}% {t.used}
              </div>
            </div>
            )}
          </div>
        </div>
        <BudgetActionsMenu
          budget={budget}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    </li>
  );
};

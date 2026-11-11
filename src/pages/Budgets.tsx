import { useState, useMemo, useEffect } from 'react';
import { useTransactions } from '../context/TransactionsContext';
import { useCurrency } from '../context/CurrencyContext';
import { useI18n } from '../context/I18nContext';
import { useCommandMenu } from '../context/CommandMenuContext';
import { Plus } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import { BudgetModal } from '../components/BudgetModal';
import { Budget } from '../types';
import { startOfMonth } from 'date-fns';
import { getTransactionsByMonth, getTransactionsByCategory, getTotalExpense, getTotalIncome } from '../utils/calculations';
import { PageHeader } from '../components/PageHeader';
import { PageButton } from '../components/PageButton';
import { BudgetsSkeleton } from '../components/PageSkeletons';
import { DatePicker } from '../components/DatePicker';
import { TransactionType } from '../lib/enums';
import { BudgetList } from '../components/budgets';
import { isGeneralBudget } from '../utils/categories';
import { useDefaultHousehold } from '../hooks/useDefaultHousehold';
import { useBudgetSummary } from '../hooks/api/useBudgets';
import { ownShareByBudget, summaryMonthOf } from '../utils/budgetOwnShare';

const Budgets = () => {
  const { budgets, transactions, deleteBudget, loading } = useTransactions();
  const { baseCurrency } = useCurrency();
  const { t } = useI18n();
  const { registerHandler, unregisterHandler } = useCommandMenu();
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<Date>(startOfMonth(new Date()));
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; budgetId: string | null }>({
    isOpen: false,
    budgetId: null,
  });

  useEffect(() => {
    const handleNewBudget = () => {
      setEditingBudget(null);
      setIsModalOpen(true);
    };
    
    registerHandler('newBudget', handleNewBudget);
    
    // Escuta eventos do onboarding
    const handleTriggerCommand = (event: CustomEvent) => {
      if (event.detail?.handlerKey === 'newBudget') {
        handleNewBudget();
      }
    };
    
    window.addEventListener('triggerCommandHandler', handleTriggerCommand as EventListener);
    
    return () => {
      unregisterHandler('newBudget');
      window.removeEventListener('triggerCommandHandler', handleTriggerCommand as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Own share (what is left after what other people owe): from the API, only shown where there is a division.
  const { householdId } = useDefaultHousehold();
  const summary = useBudgetSummary({ householdId: householdId ?? '', month: summaryMonthOf(selectedMonth) });
  const ownShares = useMemo(() => ownShareByBudget(summary.data?.budgets), [summary.data]);

  const monthBudgets = useMemo(() => {
    if (!budgets || budgets.length === 0) {
      return [];
    }
    
    const filtered = budgets.filter(b => {
      if (!b.month) return false;
      const budgetMonth = startOfMonth(b.month);
      const selected = startOfMonth(selectedMonth);
      return budgetMonth.getTime() === selected.getTime();
    });
    
    return filtered;
  }, [budgets, selectedMonth]);

  const monthTransactions = useMemo(
    () => getTransactionsByMonth(transactions, selectedMonth),
    [transactions, selectedMonth]
  );

  const categoryData = useMemo(
    () => getTransactionsByCategory(monthTransactions),
    [monthTransactions]
  );

  const budgetStatus = useMemo(() => {
    return monthBudgets.map(budget => {
      let spent = 0;

      // Treat the "GENERAL" pseudo-category as the "total spending/income of
      // the month" budget. Detection uses categoryName, since `category` holds
      // the localized display name (e.g. "Geral (Todas as categorias)").
      if (isGeneralBudget(budget)) {
        if (budget.type === TransactionType.EXPENSE) {
          spent = getTotalExpense(monthTransactions);
        } else {
          spent = getTotalIncome(monthTransactions);
        }
      } else {
        const categoryTransactions = categoryData.find(c => c.name === budget.category);
        spent = budget.type === TransactionType.EXPENSE
          ? (categoryTransactions?.despesa || 0)
          : (categoryTransactions?.receita || 0);
      }

      const percentage = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
      const remaining = budget.amount - spent;

      const status: 'ok' | 'warning' | 'exceeded' =
        percentage >= 100 ? 'exceeded' : percentage >= 80 ? 'warning' : 'ok';

      return {
        ...budget,
        spent,
        remaining,
        percentage,
        status,
        ownSpent: budget.type === TransactionType.EXPENSE ? ownShares.get(budget.id ?? '')?.ownSpent : undefined,
      };
    });
  }, [monthBudgets, categoryData, monthTransactions, ownShares]);

  const handleDelete = (id: string) => {
    setConfirmModal({ isOpen: true, budgetId: id });
  };

  const handleConfirmDelete = async () => {
    if (confirmModal.budgetId) {
      await deleteBudget(confirmModal.budgetId);
      setConfirmModal({ isOpen: false, budgetId: null });
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingBudget(null);
  };

  if (loading) {
    return <BudgetsSkeleton />;
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 dashboard-fade-in">
      <PageHeader
        title={t.budgets}
        description={t.budgetsDescription}
      >
        <DatePicker
          value={selectedMonth}
          onChange={(date) => {
            if (date) {
              setSelectedMonth(startOfMonth(date));
            }
          }}
          placeholder={t.month}
          className="w-full sm:w-auto"
        />
        <PageButton
          onClick={() => {
            setEditingBudget(null);
            setIsModalOpen(true);
          }}
          variant="primary"
          icon={Plus}
          aria-label={t.newBudget}
          className="h-10"
        >
          {t.newBudget}
        </PageButton>
      </PageHeader>

      <BudgetList
        budgets={budgetStatus}
        baseCurrency={baseCurrency}
        onEdit={(budget) => {
          setEditingBudget(budget);
          setIsModalOpen(true);
        }}
        onDelete={handleDelete}
        t={t}
      />

      <BudgetModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        editingBudget={editingBudget}
        selectedMonth={selectedMonth}
      />

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ isOpen: false, budgetId: null })}
        onConfirm={handleConfirmDelete}
        title={t.delete}
        message={t.confirmDeleteBudget}
        variant="danger"
      />
    </div>
  );
};

export default Budgets;

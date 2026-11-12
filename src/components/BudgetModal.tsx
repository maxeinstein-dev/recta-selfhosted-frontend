import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTransactions } from '../context/TransactionsContext';
import { useCurrencyMask } from '../hooks/useCurrencyMask';
import { useToastContext } from '../context/ToastContext';
import { useI18n } from '../context/I18nContext';
import { parseCurrencyValue } from '../utils/currency';
import { Budget } from '../types';
import { startOfMonth } from 'date-fns';
import { measureForSave } from '../utils/budgetOwnShare';
import { createSchemas, BudgetFormData } from '../schemas';
import SelectCombobox from './SelectCombobox';
import { getMergedCategories } from '../utils/categories';
import { toCategoryName, TransactionType, CustomCategoryInfo as EnumCustomCategoryInfo, CategoryType } from '../lib/enums';
import { DatePicker } from './DatePicker';

interface BudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingBudget: Budget | null;
  selectedMonth: Date;
}

export const BudgetModal = ({
  isOpen,
  onClose,
  editingBudget,
  selectedMonth,
}: BudgetModalProps) => {
  const { addBudget, updateBudget, customCategories } = useTransactions();
  const { success, error: showError } = useToastContext();
  const { t } = useI18n();
  const currencyMask = useCurrencyMask();
  const { budgetSchema } = createSchemas(t);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    control,
    setValue,
  } = useForm<BudgetFormData>({
    resolver: zodResolver(budgetSchema),
    defaultValues: {
      category: '',
      amount: 0,
      type: TransactionType.EXPENSE,
      month: new Date(),
      measure: 'WHOLE',
    },
  });

  const watchedType = useWatch({ control, name: 'type' });
  const watchedCategory = useWatch({ control, name: 'category' });
  const watchedMonth = useWatch({ control, name: 'month' });
  const watchedMeasure = useWatch({ control, name: 'measure' });

  const typeOptions = useMemo(() => [
    { value: TransactionType.INCOME, label: t.income },
    { value: TransactionType.EXPENSE, label: t.expense },
  ], [t]);

  const categoryOptions = useMemo(() => {
    const categoryType: CategoryType | undefined =
      watchedType === TransactionType.INCOME
        ? CategoryType.INCOME
        : watchedType === TransactionType.EXPENSE
          ? CategoryType.EXPENSE
          : undefined;
    const merged = getMergedCategories(
      categoryType,
      (customCategories || []) as EnumCustomCategoryInfo[],
      t as unknown as Record<string, string>
    );
    return [
      // Special pseudo-category. Stored as the literal "GENERAL" so the backend
      // can recognize it without us having to map to OTHER_EXPENSES.
      { value: 'GENERAL', label: t.general },
      ...merged.map((x) => ({ value: x.value, label: x.display })),
    ];
  }, [watchedType, customCategories, t]);

  useEffect(() => {
    if (editingBudget) {
      const budgetAmount = editingBudget.amount || 0;
      const budgetMonth = editingBudget.month instanceof Date 
        ? editingBudget.month 
        : new Date(editingBudget.month);
      const resolvedCategory =
        editingBudget.categoryName ??
        (editingBudget.category && toCategoryName(
          editingBudget.category,
          t as unknown as Record<string, string>,
          (customCategories || []) as EnumCustomCategoryInfo[]
        )) ??
        editingBudget.category;

      reset({
        category: resolvedCategory,
        amount: budgetAmount,
        type: editingBudget.type,
        month: budgetMonth,
        measure: editingBudget.measure ?? 'WHOLE',
      });

      currencyMask.setValue(budgetAmount);
      setValue('amount', budgetAmount, { shouldValidate: false });
    } else {
      reset({
        category: '',
        amount: 0,
        type: TransactionType.EXPENSE,
        month: selectedMonth,
        measure: 'WHOLE',
      });
      currencyMask.setValue('');
      setValue('amount', 0, { shouldValidate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editingBudget?.id, selectedMonth.getTime(), reset, setValue]);

  // Clear category when it's not valid for the selected type (e.g. switched from expense to income)
  useEffect(() => {
    if (!isOpen) return;
    const categoryType: CategoryType | undefined =
      watchedType === TransactionType.INCOME
        ? CategoryType.INCOME
        : watchedType === TransactionType.EXPENSE
          ? CategoryType.EXPENSE
          : undefined;
    const merged = getMergedCategories(
      categoryType,
      (customCategories || []) as EnumCustomCategoryInfo[],
      t as unknown as Record<string, string>
    );
    const validValues = ['GENERAL', ...merged.map((x) => x.value)];
    if (watchedCategory && !validValues.includes(watchedCategory)) {
      setValue('category', '');
    }
  }, [isOpen, watchedType, watchedCategory, customCategories, t, setValue]);

  // Handler para fechar com ESC e prevenir scroll do body
  useEffect(() => {
    if (!isOpen) return;
    
    // Prevenir scroll do body quando modal estiver aberto
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    
    return () => {
      document.body.style.overflow = originalStyle;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  const onSubmit = async (data: BudgetFormData) => {
    try {
      const budgetData: Omit<Budget, 'id' | 'userId'> = {
        category: data.category.trim(),
        amount: data.amount,
        type: data.type,
        month: data.month,
        measure: measureForSave(data.measure, data.type === TransactionType.EXPENSE),
      };

      if (editingBudget?.id) {
        await updateBudget(editingBudget.id, budgetData);
        success(t.budgetUpdated);
      } else {
        await addBudget(budgetData);
        success(t.budgetCreated);
      }
      onClose();
      currencyMask.setValue('');
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : t.errorSavingBudget;
      showError(errorMsg);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="relative w-full sm:w-96 max-w-md p-4 sm:p-5 border rounded-lg bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800 max-h-[90vh] overflow-y-auto min-w-0">
        <div className="flex items-center justify-between mb-6 pb-6 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-lg font-light tracking-tight text-gray-900 dark:text-white">
            {editingBudget ? t.editBudget : t.newBudget}
          </h3>
          <button
            onClick={onClose}
            aria-label="Fechar modal"
            className="text-gray-400 dark:text-gray-500 hover:opacity-70 transition-opacity p-1"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 min-w-0">
          <div>
            <label className="block text-sm font-light text-gray-500 dark:text-gray-400 mb-2">
              {t.type}
            </label>
            <SelectCombobox
              value={watchedType}
              onValueChange={(value) => setValue('type', value as TransactionType, { shouldValidate: true })}
              options={typeOptions}
              placeholder={t.select}
            />
            {errors.type && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.type.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-light text-gray-500 dark:text-gray-400 mb-2">
              {t.category}
            </label>
            <SelectCombobox
              value={watchedCategory}
              onValueChange={(value) => setValue('category', value, { shouldValidate: true })}
              options={categoryOptions}
              placeholder={t.selectCategory}
              searchable={true}
            />
            <p className="mt-1 text-xs font-light text-gray-400 dark:text-gray-500">
              {t.general} - {watchedType === TransactionType.EXPENSE ? t.totalExpense : t.totalIncome}
            </p>
            {errors.category && (
              <p className="mt-1 text-sm text-red-600">{errors.category.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-light text-gray-500 dark:text-gray-400 mb-2">
              {t.amount}
            </label>
            <input
              type="text"
              value={currencyMask.value}
              onChange={(e) => {
                currencyMask.onChange(e);
                const numericValue = parseCurrencyValue(e.target.value);
                setValue('amount', numericValue, { shouldValidate: true });
              }}
              placeholder={t.currencyPlaceholder}
              className={`block w-full px-3 py-2.5 border rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:border-primary-500 dark:focus:border-primary-500 sm:text-sm font-light tracking-tight ${
                errors.amount ? 'border-red-300 dark:border-red-600' : 'border-gray-200 dark:border-gray-800'
              }`}
            />
            <input
              type="hidden"
              {...register('amount', {
                valueAsNumber: true,
              })}
            />
            {errors.amount && (
              <p className="mt-1 text-sm text-red-600">{errors.amount.message}</p>
            )}
          </div>

          {watchedType === TransactionType.EXPENSE && (
            <fieldset>
              <legend className="block text-sm font-light text-gray-500 dark:text-gray-400 mb-2">{t.budgetMeasureLabel}</legend>
              <div className="space-y-1">
                {(['WHOLE', 'OWN_SHARE'] as const).map((option) => (
                  <label key={option} htmlFor={`budget-measure-${option}`} className="flex min-h-[44px] items-center gap-3 text-sm font-light text-gray-900 dark:text-white cursor-pointer">
                    <input
                      id={`budget-measure-${option}`}
                      type="radio"
                      name="budget-measure"
                      value={option}
                      checked={(watchedMeasure ?? 'WHOLE') === option}
                      onChange={() => setValue('measure', option, { shouldValidate: true, shouldDirty: true })}
                      className="h-4 w-4 text-primary-600 border-gray-300 dark:border-gray-700"
                    />
                    {option === 'WHOLE' ? t.budgetMeasureWhole : t.budgetMeasureOwn}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs font-light text-gray-400 dark:text-gray-500">{t.budgetMeasureHint}</p>
            </fieldset>
          )}

          <div className="min-w-0">
            <label className="block text-sm font-light text-gray-500 dark:text-gray-400 mb-2">
              {t.month}
            </label>
            <DatePicker
              value={watchedMonth || new Date()}
              onChange={(date) => {
                if (date) {
                  // Always use the first day of the selected month
                  const monthDate = startOfMonth(date);
                  setValue('month', monthDate, { 
                    shouldValidate: true, 
                    shouldDirty: true,
                    shouldTouch: true
                  });
                }
              }}
              placeholder={t.month}
              className={errors.month ? 'border-red-300 dark:border-red-600' : ''}
              useModal={true}
            />
            <input
              type="hidden"
              {...register('month', {
                valueAsDate: true,
              })}
            />
            {errors.month && (
              <p className="mt-1 text-sm text-red-600">{errors.month.message}</p>
            )}
          </div>

          <div className="flex justify-end space-x-3 pt-6 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 border border-gray-200 dark:border-gray-800 rounded-md text-sm font-light tracking-tight text-gray-900 dark:text-white bg-white dark:bg-gray-900 hover:opacity-70 transition-opacity"
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2.5 text-sm font-light tracking-tight text-white bg-primary-600 dark:bg-primary-500 border border-primary-600 dark:border-primary-500 rounded-md hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? t.loading : editingBudget ? t.update : t.create}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};


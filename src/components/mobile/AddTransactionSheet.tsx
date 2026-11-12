import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../../context/I18nContext';
import { useCurrency } from '../../context/CurrencyContext';
import { useToastContext } from '../../context/ToastContext';
import { useTransactions } from '../../context/TransactionsContext';
import { useDefaultHousehold } from '../../hooks/useDefaultHousehold';
import { useFormAccounts } from '../../hooks/useFormAccounts';
import { useAuthUser } from '../../hooks/api/useAuth';
import { useCategories } from '../../hooks/api/useCategories';
import { createSchemas } from '../../schemas';
import { CategoryType, getCategoriesByType, getCategoryDisplayName, TransactionType } from '../../lib/enums';
import { accountOptionLabel } from '../../utils/accountOptionLabel';
import {
  amountDigitsToCents,
  dateChipDate,
  formatAmountInput,
  orderByRecent,
  readRecent,
  recentStorageKey,
  rememberRecent,
  sheetAccounts,
  sheetCreateError,
  accountsNotReadyError,
  accountsRowMessage,
  accountsRowState,
  situationLabels,
  situationPaid,
  toFullFormPrefill,
  toTransactionInput,
  toTransferPrefill,
  writeRecent,
  type AddSheetState,
} from '../../utils/addSheet';
import { simpleTransactionError } from '../../utils/simpleTransactionRules';
import { DatePicker } from '../DatePicker';
import CategoryCombobox from '../CategoryCombobox';
import type { TransactionModalPrefill } from '../TransactionModal';

/** How many category pills show before "Outra…". */
const CATEGORY_PILLS = 6;

interface AddTransactionSheetProps {
  onClose: () => void;
  /** Opens the full form (installments, recurrence, reference month, split, transfer) with these values. */
  onOpenFullForm: (prefill: TransactionModalPrefill) => void;
}

const pillClass = (selected: boolean) =>
  `min-h-[44px] flex-none rounded-[22px] border px-3.5 text-[14px] font-medium whitespace-nowrap ${
    selected ? 'border-rc-ink bg-rc-ink text-rc-bg' : 'border-rc-line bg-rc-card text-rc-ink2'
  }`;

const AddTransactionSheet = ({ onClose, onOpenFullForm }: AddTransactionSheetProps) => {
  const { t } = useI18n();
  const { getCurrencyInfo } = useCurrency();
  const { success, error: showError } = useToastContext();
  const { addTransaction } = useTransactions();
  const { householdId } = useDefaultHousehold();
  const { accounts, accountsLoading } = useFormAccounts();
  const { data: authUser } = useAuthUser();
  const currency = getCurrencyInfo();
  const [openedAt] = useState(() => new Date());
  const dict = t as unknown as Record<string, string>;
  const schema = createSchemas(t).transactionSchema;

  const [state, setState] = useState<AddSheetState>({
    type: 'EXPENSE',
    amountCents: 0,
    description: '',
    category: '',
    accountId: '',
    date: openedAt,
    paidChoice: null,
  });
  const [amountText, setAmountText] = useState(() => formatAmountInput(0, currency.decimalPlaces, currency.locale));
  const [dateChip, setDateChip] = useState<'today' | 'yesterday' | 'other'>('today');
  const [showOtherCategory, setShowOtherCategory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  const apiType = state.type === 'INCOME' ? CategoryType.INCOME : CategoryType.EXPENSE;
  const storage = typeof window !== 'undefined' ? window.localStorage : null;
  const categoryKey = recentStorageKey(householdId ?? '', state.type, 'category');
  const accountKey = recentStorageKey(householdId ?? '', state.type, 'account');

  const { data: customCategories = [] } = useCategories({ householdId: householdId ?? undefined, type: apiType });
  const customInfo = customCategories.map((c) => ({ id: c.id, name: c.name }));
  const categoryName = (value: string) => getCategoryDisplayName(value, dict, customInfo);

  const defaultCategories = getCategoriesByType(apiType) as string[];
  const orderedCategories = orderByRecent(defaultCategories, readRecent(storage, categoryKey));
  const visibleCategories = orderedCategories.slice(0, CATEGORY_PILLS);
  if (state.category && !visibleCategories.includes(state.category)) visibleCategories.push(state.category);

  const labels = {
    creditCard: dict.creditCard ?? 'Cartão de crédito',
    cash: dict.cash ?? 'Dinheiro',
    myPersonalAccount: dict.myPersonalAccount ?? '(minha)',
    otherMemberPersonalAccount: dict.otherMemberPersonalAccount ?? '(de outro membro)',
  };
  const offeredAccounts = sheetAccounts(accounts);
  const orderedAccounts = orderByRecent(offeredAccounts.map((a) => a.id ?? ''), readRecent(storage, accountKey))
    .map((id) => offeredAccounts.find((a) => a.id === id))
    .filter((a): a is (typeof offeredAccounts)[number] => Boolean(a));

  // The first account in the order is picked when the sheet has none (the form does the same).
  useEffect(() => {
    if (!state.accountId && orderedAccounts.length > 0) {
      setState((prev) => ({ ...prev, accountId: orderedAccounts[0].id ?? '' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedAccounts.length]);

  // Esc closes the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const currencySymbol = new Intl.NumberFormat(currency.locale, { style: 'currency', currency: currency.code })
    .formatToParts(0)
    .find((part) => part.type === 'currency')?.value ?? currency.symbol;

  // Digits enter from the right; the caret stays at the end whatever the touch does (the prototype's rule).
  // Moved at once and again after the browser's own caret placement (focus and touch set it after the event).
  const moveCaretToEnd = (el: HTMLInputElement) => {
    try {
      el.setSelectionRange(el.value.length, el.value.length);
    } catch {
      // Some engines refuse a selection on this input; the digits still enter from the right.
    }
  };
  const keepCaretAtEnd = (el: HTMLInputElement) => {
    moveCaretToEnd(el);
    setTimeout(() => moveCaretToEnd(el), 0);
  };
  // After every change of the amount the caret goes to the end before the next key.
  useLayoutEffect(() => {
    const el = amountRef.current;
    if (el && document.activeElement === el) moveCaretToEnd(el);
  }, [amountText]);

  const onAmountChange = (e: ChangeEvent<HTMLInputElement>) => {
    const cents = amountDigitsToCents(e.target.value);
    setAmountText(formatAmountInput(cents, currency.decimalPlaces, currency.locale));
    setState((prev) => ({ ...prev, amountCents: cents }));
    setError(null);
    keepCaretAtEnd(e.target);
  };

  const pickType = (type: 'EXPENSE' | 'INCOME') => {
    if (type === state.type) return;
    setState((prev) => ({ ...prev, type, category: '' }));
    setShowOtherCategory(false);
  };

  const pickDate = (chip: 'today' | 'yesterday') => {
    setDateChip(chip);
    setState((prev) => ({ ...prev, date: dateChipDate(chip, new Date()) }));
  };

  const remember = (categoryValue: string, accountId: string) => {
    writeRecent(storage, categoryKey, rememberRecent(readRecent(storage, categoryKey), categoryValue));
    writeRecent(storage, accountKey, rememberRecent(readRecent(storage, accountKey), accountId));
  };

  const create = async () => {
    const amountError = sheetCreateError(state);
    if (amountError) {
      setError(amountError);
      amountRef.current?.focus();
      return;
    }
    const notReady = accountsNotReadyError(rowState, state.accountId);
    if (notReady) {
      setError(notReady);
      return;
    }
    const now = new Date();
    const input = toTransactionInput(state, now);
    const refusal = simpleTransactionError(
      { type: input.type, amount: input.amount, paid: input.paid, accountId: input.accountId },
      accounts,
    );
    if (refusal === 'accountRequired') {
      setError(t.accountOrCardRequired);
      return;
    }
    if (refusal === 'insufficientBalance') {
      setError(t.insufficientAvailableBalance);
      return;
    }
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t.error);
      return;
    }
    const { installments: _installments, fromAccountId: _from, toAccountId: _to, ...data } = parsed.data;
    setSaving(true);
    try {
      await addTransaction({
        ...data,
        category: data.category || undefined,
        competenceMonth: null,
      } as Parameters<typeof addTransaction>[0]);
      remember(state.category, state.accountId);
      success(t.transactionCreated);
      onClose();
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : t.error);
    } finally {
      setSaving(false);
    }
  };

  const typeLabel = state.type === 'INCOME' ? 'Recebido em' : 'Pago com';
  const situation = situationLabels(state.type);
  const rowState = accountsRowState(accountsLoading, orderedAccounts.length);
  const situationNow = situationPaid(state.date, new Date(), state.paidChoice);

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-sheet-title"
        className="relative max-h-[92%] w-full overflow-y-auto overflow-x-hidden rounded-t-[26px] bg-rc-card px-4 pt-2"
        style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="mx-auto mb-1.5 h-1 w-10 flex-none rounded-full bg-rc-line" aria-hidden="true" />
        <div className="flex items-center gap-2">
          <h2 id="add-sheet-title" className="flex-1 text-lg font-semibold">Novo lançamento</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-rc-ink2"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div role="group" aria-label="Tipo" className="mt-1 flex gap-1 rounded-[14px] bg-rc-card2 p-[3px]">
          {(['EXPENSE', 'INCOME'] as const).map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={state.type === type}
              onClick={() => pickType(type)}
              className={`min-h-[44px] flex-1 rounded-[11px] text-[13.5px] font-medium ${
                state.type === type ? 'bg-rc-card font-semibold text-rc-ink shadow-sm' : 'text-rc-ink2'
              }`}
            >
              {type === 'EXPENSE' ? 'Despesa' : 'Receita'}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={false}
            onClick={() => onOpenFullForm(toTransferPrefill(state, new Date()))}
            className="min-h-[44px] flex-1 rounded-[11px] text-[13.5px] font-medium text-rc-ink2"
          >
            Transferência
          </button>
        </div>

        <label className="mt-4 flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-rc-ink3">{currencySymbol}</span>
          <span className="sr-only">Valor</span>
          {/* No box: the global input rules (attribute selectors) would paint one, so the field's look is set inline. */}
          <span className="flex min-w-0 flex-1 flex-col">
            <input
              ref={amountRef}
              autoFocus
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={amountText}
              onChange={onAmountChange}
              onFocus={(e) => keepCaretAtEnd(e.currentTarget)}
              onClick={(e) => keepCaretAtEnd(e.currentTarget)}
              onKeyUp={(e: ReactKeyboardEvent<HTMLInputElement>) => keepCaretAtEnd(e.currentTarget)}
              onSelect={(e) => keepCaretAtEnd(e.currentTarget)}
              className="peer h-14 w-full min-w-0 p-0 tabular-nums tracking-tight text-rc-ink"
              style={{
                background: 'transparent',
                border: 0,
                borderRadius: 0,
                boxShadow: 'none',
                outline: 'none',
                fontSize: 46,
                fontWeight: 700,
                letterSpacing: '-0.03em',
              }}
              aria-label="Valor"
            />
            {/* The sign of focus: a thin line under the number, only for keyboard focus. */}
            <span aria-hidden="true" className="block h-0.5 rounded-full bg-transparent peer-focus-visible:bg-rc-accent" />
          </span>
        </label>

        <input
          type="text"
          value={state.description}
          onChange={(e) => setState((prev) => ({ ...prev, description: e.target.value }))}
          placeholder="Descrição (opcional)"
          aria-label="Descrição"
          maxLength={500}
          className="mt-2 min-h-[44px] w-full rounded-xl border border-rc-line bg-rc-card px-3 text-[15px] text-rc-ink"
        />

        <div className="mt-4 text-[13px] font-medium text-rc-ink3">Categoria</div>
        <div role="group" aria-label="Categoria" className="-mx-4 mt-1 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none]">
          {visibleCategories.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={state.category === value}
              onClick={() => {
                setState((prev) => ({ ...prev, category: value }));
                setShowOtherCategory(false);
              }}
              className={pillClass(state.category === value)}
            >
              {categoryName(value)}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={showOtherCategory}
            onClick={() => setShowOtherCategory((v) => !v)}
            className={pillClass(showOtherCategory)}
          >
            Outra…
          </button>
        </div>
        {showOtherCategory && (
          <div className="mt-2">
            <CategoryCombobox
              value={state.category}
              onValueChange={(value: string) => setState((prev) => ({ ...prev, category: value }))}
              placeholder="Escolha uma categoria"
              type={state.type === 'INCOME' ? TransactionType.INCOME : TransactionType.EXPENSE}
              householdId={householdId ?? undefined}
              allowCreate
            />
          </div>
        )}

        <div className="mt-4 text-[13px] font-medium text-rc-ink3">{typeLabel}</div>
        {rowState === 'ready' ? (
  <div role="group" aria-label={typeLabel} className="-mx-4 mt-1 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none]">
            {orderedAccounts.map((account) => (
              <button
                key={account.id}
                type="button"
                aria-pressed={state.accountId === account.id}
                onClick={() => setState((prev) => ({ ...prev, accountId: account.id ?? '' }))}
                className={pillClass(state.accountId === account.id)}
              >
                {accountOptionLabel(account, labels, authUser?.id)}
              </button>
            ))}
          </div>
        ) : (
          <p role="status" className="mt-1 min-h-[44px] text-[14px] text-rc-ink3">{accountsRowMessage(rowState)}</p>
        )}

        <div className="mt-4 text-[13px] font-medium text-rc-ink3">Data</div>
        <div role="group" aria-label="Data" className="-mx-4 mt-1 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none]">
          <button type="button" aria-pressed={dateChip === 'today'} onClick={() => pickDate('today')} className={pillClass(dateChip === 'today')}>Hoje</button>
          <button type="button" aria-pressed={dateChip === 'yesterday'} onClick={() => pickDate('yesterday')} className={pillClass(dateChip === 'yesterday')}>Ontem</button>
          <button type="button" aria-pressed={dateChip === 'other'} onClick={() => setDateChip('other')} className={pillClass(dateChip === 'other')}>Outra data</button>
        </div>
        {dateChip === 'other' && (
          <div className="mt-2">
            <DatePicker
              value={state.date}
              onChange={(date) => setState((prev) => ({ ...prev, date: date ?? new Date() }))}
              placeholder="Data"
              useModal={true}
            />
          </div>
        )}

        <div className="mt-4 text-[13px] font-medium text-rc-ink3">Situação</div>
        <div role="group" aria-label="Situação" className="-mx-4 mt-1 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none]">
          <button type="button" aria-pressed={situationNow} onClick={() => setState((prev) => ({ ...prev, paidChoice: true }))} className={pillClass(situationNow)}>{situation.paid}</button>
          <button type="button" aria-pressed={!situationNow} onClick={() => setState((prev) => ({ ...prev, paidChoice: false }))} className={pillClass(!situationNow)}>{situation.pending}</button>
        </div>

        <button
          type="button"
          onClick={() => onOpenFullForm(toFullFormPrefill(state, new Date()))}
          className="mt-3 flex min-h-[48px] w-full items-center justify-between text-left text-[14px] font-semibold text-rc-accentInk"
        >
          Parcelar, repetir ou dividir
          <span aria-hidden="true">›</span>
        </button>

        {error && (
          <p role="alert" className="mb-2 text-sm font-medium text-rc-red">{error}</p>
        )}

        <button
          type="button"
          onClick={create}
          disabled={saving}
          className="min-h-[52px] w-full rounded-2xl bg-rc-accent text-[16px] font-semibold text-rc-onAccent disabled:opacity-60"
        >
          Lançar
        </button>
      </div>
    </div>
  );
};

export default AddTransactionSheet;

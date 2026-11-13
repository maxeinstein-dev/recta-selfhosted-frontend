import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Circle, Clock, Inbox, Loader2 } from 'lucide-react';
import { useCurrency } from '../../context/CurrencyContext';
import { useSelectedMonth } from '../../context/SelectedMonthContext';
import { useDefaultHousehold } from '../../hooks/useDefaultHousehold';
import { useAccounts } from '../../hooks/api/useAccounts';
import { useCapturesCount } from '../../hooks/api/useCaptures';
import { useDashboardOverview, useTransactions } from '../../hooks/api/useTransactions';
import { useCashFlow } from '../../hooks/api/useCashFlow';
import { useBillsCashFlow, useBillsRecurrences, usePaidMonthExpenses } from '../../hooks/api/useBillsChecklist';
import { useBillPayments } from '../../hooks/useBillPayments';
import { formatCurrency } from '../../utils/format';
import { addDays, allEvents, buildDailySeries, cashAccounts, firstNegativeDate } from '../../utils/cashFlow';
import {
  FILTER_ALL,
  FILTER_OVERDUE,
  billAction,
  billsProgress,
  billsTotalCents,
  buildBills,
  buildDayPills,
  dayNumber,
  filterBills,
  monthEnd,
  monthStart,
  normalizeFilter,
  paidIds,
  recurrenceMap,
  type Bill,
} from '../../utils/billsChecklist';
import {
  USAGE_DAYS,
  accountUsage,
  balanceCells,
  billA11yName,
  billAmountText,
  billName,
  billDetail,
  billSituation,
  billsHint,
  dayPillName,
  invoiceDueText,
  forecastPlan,
  leftoverHint,
  leftoverNote,
  leftoverTitle,
  projectedLeftover,
  nextInvoice,
  overduePillName,
  paidCounterText,
  warningStrips,
  type BillSituationKind,
} from '../../utils/homeMobile';
import { MONTH_NAMES_PT, monthLabelPt } from '../../utils/mobileShell';
import { shortMonthLabel } from '../../utils/cardsMobile';
import { EarlyDiscountNotice } from '../cashflow/EarlyDiscountBits';
import MobileIncomeSplit from '../spending-groups/MobileIncomeSplit';

const CARD = 'rounded-2xl border border-rc-line bg-rc-card p-4';
const MUTED = 'text-sm text-rc-ink2';
const TOUCH = 'min-h-[44px]';
const PILL = `${TOUCH} min-w-[44px] shrink-0 rounded-xl border px-3 text-sm font-medium tabular-nums transition-colors`;

/** 'YYYY-MM-DD' as a local Date at midnight (the transaction list formats its dates with local fields). */
/** Today as 'YYYY-MM-DD' in local time. */
const localDayKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const localDate = (day: string): Date => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));

/** An amount without the currency sign, for the narrow balance cells (the accessible name carries the full one). */
const plainAmount = (cents: number): string => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);

const SITUATION_CLS: Record<BillSituationKind, string> = {
  overdue: 'bg-rc-redSoft text-rc-red',
  pending: 'bg-rc-card2 text-rc-ink2',
  paid: 'bg-rc-greenSoft text-rc-green',
};

/**
 * The Início tab below 768 px (lote R5), first version: the month's leftover (no income bar yet), the balances of the
 * most used accounts, the bills to pay with one badge each and one-tap payment, the next card invoice and the warning
 * strips. The month of the header drives the leftover; the rest is "today": the bills, the invoice and the negative day
 * come from the 30-day cash flow, which always reaches the end of the current month.
 * Paying a bill refreshes balances, invoice, free limit and the Fluxo through the invalidations of the payment hook.
 */
export default function MobileHome() {
  const navigate = useNavigate();
  const { householdId } = useDefaultHousehold();
  const { baseCurrency } = useCurrency();
  const { monthKey } = useSelectedMonth();
  const payments = useBillPayments();
  const { tx, doneKeys, markedIds } = payments;

  const overview = useDashboardOverview({ householdId: householdId || undefined, month: monthKey });
  const accountsQuery = useAccounts({ householdId: householdId ?? '' });
  const cashFlow = useBillsCashFlow({ householdId: householdId ?? undefined });
  const captures = useCapturesCount(householdId ?? undefined);
  const data = cashFlow.data;
  const today = data?.period.from;
  const currency = data?.currency ?? baseCurrency;
  const money = (cents: number): string => formatCurrency(cents / 100, currency);

  // The 30 days of transactions that rank the accounts by use (first page of 100: a ranking, not a ledger)
  const usageQuery = useTransactions({
    householdId: today ? householdId ?? undefined : undefined,
    startDate: today ? localDate(addDays(today, -(USAGE_DAYS - 1))) : undefined,
    endDate: today ? localDate(today) : undefined,
    limit: 100,
  });
  const paidQuery = usePaidMonthExpenses({ householdId: householdId ?? undefined, today });
  const recurrences = useBillsRecurrences(householdId ?? undefined);
  const recurrenceById = useMemo(() => recurrenceMap(recurrences.data), [recurrences.data]);

  const accounts = useMemo(() => cashAccounts(accountsQuery.data?.accounts ?? []), [accountsQuery.data]);
  const usage = useMemo(() => (today ? accountUsage(usageQuery.data?.data ?? [], today) : new Map<string, number>()), [usageQuery.data, today]);
  const cells = useMemo(
    () => balanceCells(accounts.filter((a) => a.id).map((a) => ({ id: a.id as string, name: a.name, balance: Number(a.balance) || 0 })), usage),
    [accounts, usage],
  );

  const events = useMemo(() => (data ? allEvents(data) : []), [data]);
  const bills = useMemo(() => (data && today ? buildBills(events, today, doneKeys) : []), [data, today, events, doneKeys]);
  const invoice = useMemo(() => (today ? nextInvoice(events, today) : null), [events, today]);
  const negativeDate = useMemo(() => (data ? firstNegativeDate(buildDailySeries(data)) : null), [data]);
  const strips = warningStrips({ captures: captures.data ?? 0, negativeDate });

  // The leftover is a forecast: what is posted in the month plus what the cash flow still projects for it (recurrences,
  // payroll, invoices). The current month reuses the 30-day answer above; a future month asks the shortest period that
  // reaches its end; a past month, or one past 90 days, shows only what was posted.
  const plan = forecastPlan(localDayKey(), monthKey);
  const monthFlow = useCashFlow({ householdId: plan.kind === 'flow' ? householdId ?? undefined : undefined, days: plan.kind === 'flow' ? plan.days : 30 });
  const flowFailed = plan.kind === 'flow' && monthFlow.isError;
  const flowLoading = plan.kind === 'flow' && !monthFlow.isError && (!householdId || monthFlow.isPending);
  const projected =
    overview.data && !flowLoading
      ? projectedLeftover({
          income: overview.data.summary?.totalIncome,
          expense: overview.data.summary?.totalExpense,
          events: monthFlow.data && !flowFailed ? allEvents(monthFlow.data) : [],
          today: monthFlow.data?.period.from ?? localDayKey(),
          monthKey,
        })
      : null;
  const leftover = projected?.leftover ?? null;
  const reach = flowFailed ? 'beyond' : projected?.reach ?? 'forecast';
  const monthName = `${MONTH_NAMES_PT[Number(monthKey.slice(5, 7)) - 1]}${monthKey.slice(0, 4) === String(new Date().getFullYear()) ? '' : ` de ${monthKey.slice(0, 4)}`}`;
  const note = flowFailed
    ? 'A previsão não está disponível agora; o valor mostra só o que já foi lançado.'
    : projected
      ? leftoverNote(projected.reach, monthName, projected.addedIncomeCents, projected.addedExpenseCents, money)
      : null;

  const cardName = (cardId: string, fallback: string): string => accountsQuery.data?.accounts.find((a) => a.id === cardId)?.name ?? fallback;
  const dueFormat = (cents: number) => money(cents);

  return (
    <div className="space-y-4" data-testid="mobile-home">
      <h1 className="sr-only">Início</h1>

      <section className={CARD} aria-labelledby="home-balance-title">
        <h2 id="home-balance-title" className="text-sm font-semibold text-rc-ink">{leftoverTitle(reach)}</h2>
        <p className="sr-only">{monthLabelPt(monthKey)}</p>
        {(overview.isPending && !overview.isError) || flowLoading ? (
          <p role="status" className={`${MUTED} mt-2`}>Carregando…</p>
        ) : overview.isError || !leftover ? (
          <div role="alert" className="mt-2 space-y-2">
            <p className="text-sm text-rc-red">Não foi possível carregar o mês.</p>
            <button type="button" onClick={() => void overview.refetch()} className={`${TOUCH} rounded-xl border border-rc-line px-4 text-sm font-medium text-rc-ink`}>Tentar de novo</button>
          </div>
        ) : (
          <>
            <p className={`mt-1 text-3xl font-bold tabular-nums ${leftover.tone === 'negative' ? 'text-rc-red' : leftover.tone === 'positive' ? 'text-rc-green' : 'text-rc-ink'}`} data-testid="home-leftover">
              {money(leftover.cents)}
            </p>
            <p className="mt-1 text-sm text-rc-ink2">{leftoverHint(leftover, money)}</p>
            {note && <p className="mt-1 text-xs text-rc-ink2" data-testid="home-leftover-note">{note}</p>}
          </>
        )}

        {cells.length > 0 && (
          <div role="group" aria-label="Saldos por conta" className="mt-4 grid grid-cols-3 gap-2" data-testid="home-balance-row">
            {cells.map((cell) => {
              const name = cell.kind === 'account' ? cell.name : `Mais ${cell.count} ${cell.count === 1 ? 'conta' : 'contas'}`;
              return (
                <button
                  key={cell.kind === 'account' ? cell.id : 'more'}
                  type="button"
                  onClick={() => navigate('/app/accounts')}
                  aria-label={`${name}: ${money(cell.cents)}`}
                  className={`${TOUCH} min-w-0 rounded-xl bg-rc-card2 px-2 py-2 text-left`}
                >
                  <span className="block truncate text-xs text-rc-ink2">{name}</span>
                  <span className={`block truncate text-sm font-semibold tabular-nums ${cell.cents < 0 ? 'text-rc-red' : 'text-rc-ink'}`}>{plainAmount(cell.cents)}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {strips.map((strip) => (
        <button
          key={strip.id}
          type="button"
          onClick={() => navigate(strip.to)}
          data-testid={`home-strip-${strip.id}`}
          className={`flex w-full ${TOUCH} items-center gap-3 rounded-2xl p-3 text-left ${strip.id === 'negative' ? 'bg-rc-redSoft' : 'bg-rc-accentSoft'}`}
        >
          {strip.id === 'negative' ? <AlertTriangle className="h-5 w-5 flex-none text-rc-red" aria-hidden="true" /> : <Inbox className="h-5 w-5 flex-none text-rc-accentInk" aria-hidden="true" />}
          <span className="min-w-0 flex-1 text-sm text-rc-ink">
            <b className="block font-semibold">{strip.title}</b>
            <span className="block text-rc-ink2">{strip.subtitle}</span>
          </span>
          <ChevronRight className="h-4 w-4 flex-none text-rc-ink2" aria-hidden="true" />
        </button>
      ))}

      <MobileIncomeSplit householdId={householdId ?? undefined} monthKey={monthKey} money={money} />

      <BillsCard
        loading={!householdId || cashFlow.isPending}
        failed={cashFlow.isError || (!cashFlow.isPending && !data)}
        onRetry={() => void cashFlow.refetch()}
        bills={bills}
        today={today}
        currency={currency}
        money={money}
        recurrenceById={recurrenceById}
        payments={payments}
        paidCount={today && !paidQuery.isPending && !paidQuery.isError ? paidIds(paidQuery.data?.data ?? [], monthStart(today), monthEnd(today), markedIds, recurrenceById).size : null}
        onInvoice={(bill) => {
          const params = new URLSearchParams({ card: bill.sourceId });
          if (bill.invoiceMonth) params.set('month', bill.invoiceMonth);
          navigate(`/app/credit-cards?${params.toString()}`);
        }}
        tx={tx}
      />

      {invoice && today && (
        <button
          type="button"
          onClick={() => {
            const params = new URLSearchParams({ card: invoice.sourceId });
            if (invoice.invoiceMonth) params.set('month', invoice.invoiceMonth);
            navigate(`/app/credit-cards?${params.toString()}`);
          }}
          data-testid="home-next-invoice"
          aria-label={`Próxima fatura: ${cardName(invoice.sourceId, invoice.description)}, ${invoiceDueText(invoice.dueDate, today)}, ${invoice.estimated ? 'valor estimado ' : ''}${dueFormat(invoice.amountCents)}`}
          className={`${CARD} block w-full text-left`}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-rc-ink">Próxima fatura</span>
            <span className="flex items-center text-xs font-medium text-rc-accentInk">Cartões<ChevronRight className="h-4 w-4" aria-hidden="true" /></span>
          </span>
          <span className="mt-2 flex min-h-[48px] items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-rc-ink">{cardName(invoice.sourceId, invoice.description)}</span>
              <span className="block truncate text-xs text-rc-ink2">
                {[invoice.invoiceMonth ? shortMonthLabel(invoice.invoiceMonth, new Date().getFullYear()) : '', invoiceDueText(invoice.dueDate, today)].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className={`flex-none text-lg font-semibold tabular-nums ${invoice.overdue ? 'text-rc-red' : 'text-rc-ink'}`}>
              {invoice.estimated ? '≈ ' : ''}
              {dueFormat(invoice.amountCents)}
            </span>
          </span>
        </button>
      )}

      {payments.dialog}
    </div>
  );
}

interface BillsCardProps {
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  bills: Bill[];
  today: string | undefined;
  currency: string;
  money: (cents: number) => string;
  recurrenceById: ReturnType<typeof recurrenceMap>;
  payments: ReturnType<typeof useBillPayments>;
  /** Paid bills of the month; null while it is not known (the counter is then left out). */
  paidCount: number | null;
  onInvoice: (bill: Bill) => void;
  tx: ReturnType<typeof useBillPayments>['tx'];
}

/** "Contas a pagar": opens on "Todas" with the overdue ones on top; one tap on the circle pays a bill. */
function BillsCard({ loading, failed, onRetry, bills, today, currency, money, recurrenceById, payments, paidCount, onInvoice, tx }: BillsCardProps) {
  const [filter, setFilter] = useState<string>(FILTER_ALL);
  const pills = useMemo(() => buildDayPills(bills), [bills]);
  const active = normalizeFilter(filter, bills);
  const visible = useMemo(() => filterBills(bills, active), [bills, active]);
  const progress = billsProgress(bills, paidCount ?? 0);
  const monthName = today ? MONTH_NAMES_PT[Number(today.slice(5, 7)) - 1] : '';
  const hint = billsHint(bills, monthName);
  const counter = paidCount === null ? '' : paidCounterText(progress.paid, progress.total);

  return (
    <section className={CARD} aria-labelledby="home-bills-title" data-testid="home-bills">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="home-bills-title" className="text-sm font-semibold text-rc-ink">Contas a pagar</h2>
        {counter && <span className="text-xs tabular-nums text-rc-ink2">{counter}</span>}
      </div>

      {loading ? (
        <p role="status" className={`${MUTED} mt-2`}>{tx('billsLoading')}</p>
      ) : failed ? (
        <div role="alert" className="mt-2 space-y-2">
          <p className="text-sm text-rc-red">{tx('billsLoadError')}</p>
          <button type="button" onClick={onRetry} className={`${TOUCH} rounded-xl border border-rc-line px-4 text-sm font-medium text-rc-ink`}>{tx('billsRetry')}</button>
        </div>
      ) : (
        <>
          <p className="mt-1 text-2xl font-bold tabular-nums text-rc-ink" data-testid="home-bills-total">{money(billsTotalCents(bills))}</p>
          <p className="text-sm text-rc-ink2">
            {hint.lead}
            {hint.overdue && (
              <>
                {' · '}
                <span className="font-semibold text-rc-red">{hint.overdue}</span>
              </>
            )}
          </p>

          {bills.length > 0 && (
            <div role="group" aria-label="Dias de vencimento" className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
              <button type="button" aria-pressed={active === FILTER_ALL} onClick={() => setFilter(FILTER_ALL)} aria-label="Todas as contas" className={`${PILL} ${active === FILTER_ALL ? 'border-rc-accent bg-rc-accent text-rc-onAccent' : 'border-rc-line text-rc-ink'}`}>
                Todas
              </button>
              {pills.overdue && (
                <button type="button" aria-pressed={active === FILTER_OVERDUE} aria-label={overduePillName(pills.overdue.count)} onClick={() => setFilter(FILTER_OVERDUE)} className={`${PILL} ${active === FILTER_OVERDUE ? 'border-rc-red bg-rc-red text-rc-onRed' : 'border-rc-red text-rc-red'}`}>
                  Atrasadas · {pills.overdue.count}
                </button>
              )}
              {pills.days.map((pill) => (
                <button key={pill.date} type="button" aria-pressed={active === pill.date} aria-label={dayPillName(pill.date, pill.count)} onClick={() => setFilter(pill.date)} className={`${PILL} ${active === pill.date ? 'border-rc-accent bg-rc-accent text-rc-onAccent' : 'border-rc-line text-rc-ink'}`}>
                  {dayNumber(pill.date)}
                </button>
              ))}
            </div>
          )}

          <ul className="mt-2 divide-y divide-rc-line">
            {visible.map((bill) => {
              const action = billAction(bill, recurrenceById);
              const payable = action.type === 'pay' || action.type === 'execute' || action.type === 'payNext' || action.type === 'reserve';
              const situation = billSituation(bill);
              const name = billName(bill);
              const busy = payments.busyKey === bill.key;
              return (
                <li key={bill.key} className="flex items-start gap-2 py-2" data-testid="home-bill">
                  <div className="flex h-11 w-11 flex-none items-center justify-center">
                    {payable ? (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={false}
                        disabled={payments.busy}
                        aria-label={billA11yName(bill, money)}
                        onClick={() => void payments.mark(bill, action, today)}
                        className="flex h-11 w-11 items-center justify-center rounded-full text-rc-ink3 disabled:opacity-60"
                      >
                        {busy ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" /> : <Circle className="h-6 w-6" aria-hidden="true" />}
                      </button>
                    ) : (
                      <Clock className="h-5 w-5 text-rc-ink3" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pt-2.5">
                    <p className="truncate text-sm font-medium text-rc-ink">{name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-rc-ink2">
                      <span className={`inline-flex flex-none items-center rounded-full px-2 py-0.5 font-semibold ${SITUATION_CLS[situation.kind]}`}>{situation.label}</span>
                      <span>{billDetail(bill)}</span>
                    </p>
                    <EarlyDiscountNotice quote={bill.earlyDiscount} today={today} currency={currency} variant="rc" />
                    {action.type === 'payNext' && (
                      <button
                        type="button"
                        disabled={payments.busy}
                        aria-label={`Pagar agora ${name}`}
                        onClick={() => void payments.mark(bill, action, today)}
                        className={`mt-2 inline-flex ${TOUCH} items-center justify-center gap-2 rounded-xl bg-rc-accent px-4 text-sm font-semibold text-rc-onAccent disabled:opacity-60`}
                      >
                        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                        {busy ? 'Pagando…' : 'Pagar agora'}
                      </button>
                    )}
                    {action.type === 'none' && <p className="mt-1 text-xs text-rc-ink2">{action.reason === 'later' ? tx('billsRecurrenceLater') : tx('billsNoAction')}</p>}
                    {action.type === 'invoice' && (
                      <button type="button" aria-label={`Pagar fatura ${name}`} onClick={() => onInvoice(bill)} className={`mt-2 ${TOUCH} rounded-xl border border-rc-line px-4 text-sm font-medium text-rc-ink`}>
                        Pagar fatura
                      </button>
                    )}
                  </div>
                  <p className={`flex-none whitespace-nowrap pt-2.5 text-sm font-semibold tabular-nums ${bill.overdue ? 'text-rc-red' : 'text-rc-ink'}`}>{billAmountText(bill, money)}</p>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

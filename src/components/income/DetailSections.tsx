import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '../../context/I18nContext';
import { useToastContext } from '../../context/ToastContext';
import { useDeleteSub, type PayrollResource } from '../../hooks/api/usePayroll';
import ConfirmModal from '../ConfirmModal';
import {
  addDayKey,
  benefitBreakdown,
  benefitToShow,
  neighbourBenefit,
  benefitWarningKey,
  fgtsBasis,
  fgtsDepositOfMonth,
  lastRealLaunch,
  longDay,
  modeHistory,
  modeInForce,
  monthOf,
  nextBirthdayWithdrawal,
  realMinusExpected,
  salaryInForce,
  shortDay,
  thirteenthDays,
  toCents,
  valueInForce,
  type BenefitEvent,
  type Employment,
  type FgtsModeRecord,
  type Item,
  type LaunchCandidate,
  type PayrollEvents,
  type Vacation,
} from '../../utils/income';
import { capitalize, monthNameOf, monthOnlyOf } from '../../utils/incomeMonth';
import { CARD_CLS, BTN_SECONDARY_TOUCH, EmptyLine, MUTED, Pair, SECTION_TITLE_CLS, errorText, useIncomeTexts, useMoney, useMoneyCents, type IncomeTx } from './shared';
import {
  FgtsBalanceDialog,
  FgtsExpectedDialog,
  FgtsModeDialog,
  FgtsWithdrawalDialog,
  ItemFormDialog,
  ItemValueDialog,
  SalaryFormDialog,
  VacationFormDialog,
} from './PayrollEntryDialogs';

// The sections of the Renda detail page. Each one reads the employment (with its sub-resources) and its forecast
// (events). Writes go through the entry dialogs above, and the row deletes through one confirmation per section.

/** What the sections share: the employment, its forecast, the real launches and the names to show. */
export interface DetailCtx {
  householdId: string;
  employment: Employment;
  events: PayrollEvents | undefined;
  canEdit: boolean;
  today: string;
  launches: LaunchCandidate[];
  accountName: (id: string | null) => string;
  recurrenceName: (id: string | null) => string;
  ownerName: string;
}

const BTN_ICON = 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-gray-600 hover:opacity-70 dark:text-gray-300';
const BTN_ADD = `${BTN_SECONDARY_TOUCH} px-3`;

/** The row delete with its confirmation: returns `ask` for a row and the modal to render once. */
function useRowDelete(ctx: DetailCtx) {
  const tx = useIncomeTexts();
  const del = useDeleteSub();
  const { success, error: showError } = useToastContext();
  const [pending, setPending] = useState<{ resource: PayrollResource; subId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await del.mutateAsync({ householdId: ctx.householdId, employmentId: ctx.employment.id, resource: pending.resource, subId: pending.subId });
      success(tx('incomeSaved'));
      setPending(null);
    } catch (error: unknown) {
      showError(errorText(error, tx));
    } finally {
      setBusy(false);
    }
  };
  const modal = (
    <ConfirmModal
      isOpen={!!pending}
      onClose={() => setPending(null)}
      onConfirm={() => void confirm()}
      title={tx('incomeDeleteRowTitle')}
      message={tx('incomeDeleteRowMessage')}
      confirmText={tx('incomeDeleteRowConfirm')}
      cancelText={tx('incomeFormCancel')}
      variant="danger"
      isLoading={busy}
    />
  );
  return { ask: (resource: PayrollResource, subId: string) => setPending({ resource, subId }), modal };
}

function RowActions({ canEdit, onEdit, onDelete }: { canEdit: boolean; onEdit?: () => void; onDelete?: () => void }) {
  const tx = useIncomeTexts();
  if (!canEdit || (!onEdit && !onDelete)) return null;
  return (
    <div className="flex shrink-0 items-center">
      {onEdit && (
        <button type="button" onClick={onEdit} aria-label={tx('incomeEdit')} className={BTN_ICON}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {onDelete && (
        <button type="button" onClick={onDelete} aria-label={tx('incomeDelete')} className={BTN_ICON}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function SectionHeader({ title, action, onAction, canEdit }: { title: string; action?: string; onAction?: () => void; canEdit: boolean }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h2 className={SECTION_TITLE_CLS}>{title}</h2>
      {canEdit && action && onAction && (
        <button type="button" onClick={onAction} className={BTN_ADD}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          {action}
        </button>
      )}
    </header>
  );
}

/** A small note block, the same tone for the launch comparison and the warnings. */
function Note({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' }) {
  return <p className={tone === 'warn' ? 'text-sm text-amber-700 dark:text-amber-300' : `text-sm text-gray-700 dark:text-gray-300`}>{children}</p>;
}

// ---- Job data --------------------------------------------------------------------------------------------------------

export function DataSection({ ctx }: { ctx: DetailCtx }) {
  const tx = useIncomeTexts();
  const money = useMoney();
  const { employment: e } = ctx;
  const thirteenth = thirteenthDays(e);
  const calendar = e.uf ? `${e.uf}${e.city ? ` · ${e.city}` : ''}` : tx('incomeCalendarNone');
  return (
    <section aria-label={tx('incomeSectionData')} className={`${CARD_CLS} space-y-3`}>
      <h2 className={SECTION_TITLE_CLS}>{tx('incomeSectionData')}</h2>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Pair label={tx('incomeFieldPerson')}>{ctx.ownerName || tx('incomeOwnerNone')}</Pair>
        <Pair label={tx('incomeFieldRegime')}>{tx('incomeRegimeClt')}</Pair>
        <Pair label={tx('incomeFieldAdmission')}>{longDay(e.admissionDate)}</Pair>
        <Pair label={tx('incomeFieldEnd')}>{e.endDate ? longDay(e.endDate) : '—'}</Pair>
        <Pair label={tx('incomeFieldCalendar')}>
          {calendar}
          <span className={`block text-xs ${MUTED}`}>{e.optionalHolidaysOff ? tx('incomeOptionalOffYes') : tx('incomeOptionalOffNo')}</span>
        </Pair>
        <Pair label={tx('incomeFieldDependents')}>{e.dependents}</Pair>
        <Pair label={tx('incomeFieldPayDay')}>{e.payDay}</Pair>
        <Pair label={tx('incomeFieldAccount')}>{ctx.accountName(e.accountId)}</Pair>
        <Pair label={tx('incomeFieldRecurrence')}>
          {e.recurringTransactionId ? ctx.recurrenceName(e.recurringTransactionId) : tx('incomeNoRecurrence')}
        </Pair>
        <Pair label={tx('incomeFieldThirteenth')}>{tx('incomeThirteenthLine', { first: thirteenth.first, second: thirteenth.second })}</Pair>
      </dl>
      {e.recurringTransactionId && <LaunchCompare ctx={ctx} recurringId={e.recurringTransactionId} forSalary money={money} />}
    </section>
  );
}

/**
 * The last real entry of a recurrence, and its difference from the forecast of the same month when both exist. A salary
 * is compared with the net of the competence paid that month; a benefit with the count of its month.
 */
function LaunchCompare({ ctx, recurringId, forSalary, money, expectedCents, paymentMonth }: { ctx: DetailCtx; recurringId: string; forSalary?: boolean; money: (reais: number) => string; expectedCents?: number | null; paymentMonth?: string }) {
  const tx = useIncomeTexts();
  const launch = lastRealLaunch(ctx.launches, recurringId);
  if (!launch) return null;
  let expected: number | null = expectedCents ?? null;
  if (forSalary) {
    const same = ctx.events?.salary.find((s) => monthOf(s.paymentDate) === monthOf(launch.date));
    expected = same ? toCents(same.net) : null;
  } else if (paymentMonth && monthOf(launch.date) !== paymentMonth) {
    expected = null;
  }
  const diff = expected === null ? null : realMinusExpected(launch.amountCents, expected);
  return (
    <div className="space-y-1 rounded-md bg-gray-50 p-3 text-sm dark:bg-gray-800/50">
      <p className="text-gray-900 dark:text-white">{tx('incomeCountLastReal', { amount: money(launch.amountCents / 100), date: longDay(launch.date) })}</p>
      {diff !== null && diff !== 0 && <Note>{tx('incomeCountDiff', { amount: money(diff / 100) })}</Note>}
      {diff !== null && diff < 0 && <Note tone="warn">{tx('incomeCountDiffLow')}</Note>}
    </div>
  );
}

// ---- Salary history --------------------------------------------------------------------------------------------------

export function SalarySection({ ctx }: { ctx: DetailCtx }) {
  const tx = useIncomeTexts();
  const money = useMoneyCents();
  const [adding, setAdding] = useState(false);
  const remove = useRowDelete(ctx);
  const rows = [...ctx.employment.salaries].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const current = salaryInForce(ctx.employment.salaries, ctx.today);
  return (
    <section aria-label={tx('incomeSectionSalary')} className={`${CARD_CLS} space-y-3`}>
      <SectionHeader title={tx('incomeSectionSalary')} action={tx('incomeNewSalary')} onAction={() => setAdding(true)} canEdit={ctx.canEdit} />
      {rows.length === 0 ? (
        <EmptyLine>{tx('incomeSalaryEmpty')}</EmptyLine>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map((s) => (
            <li key={s.id} className="flex min-h-[44px] items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-gray-900 dark:text-white">{money(toCents(s.amount))}</p>
                <p className={`text-xs ${MUTED}`}>{tx('incomeSalaryFrom', { date: longDay(s.startDate) })}</p>
              </div>
              <div className="flex items-center gap-2">
                {current?.id === s.id && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">{tx('incomeSalaryInForce')}</span>}
                <RowActions canEdit={ctx.canEdit} onDelete={() => remove.ask('salaries', s.id)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <SalaryFormDialog open={adding} onClose={() => setAdding(false)} householdId={ctx.householdId} employmentId={ctx.employment.id} />
      {remove.modal}
    </section>
  );
}

// ---- Items and benefits ----------------------------------------------------------------------------------------------

export function ItemsSection({ ctx }: { ctx: DetailCtx }) {
  const tx = useIncomeTexts();
  const money = useMoneyCents();
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [valueFor, setValueFor] = useState<Item | null>(null);
  const remove = useRowDelete(ctx);
  return (
    <section aria-label={tx('incomeSectionItems')} className="space-y-3">
      <SectionHeader title={tx('incomeSectionItems')} action={tx('incomeNewItem')} onAction={() => setEditing('new')} canEdit={ctx.canEdit} />
      {ctx.employment.items.length === 0 && <EmptyLine>{tx('incomeItemEmpty')}</EmptyLine>}
      {ctx.employment.items.map((item) => {
        const perDay = item.calcMode === 'PER_BUSINESS_DAY';
        const rate = valueInForce(item.values, ctx.today);
        const bases = [item.inInssBase && 'INSS', item.inIrrfBase && 'IRRF', item.inFgtsBase && 'FGTS'].filter(Boolean).join(', ');
        const history = [...item.values].sort((a, b) => b.startDate.localeCompare(a.startDate));
        return (
          <article key={item.id} className={`${CARD_CLS} space-y-3`}>
            <header className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="break-words text-base font-light text-gray-900 dark:text-white">{item.name}</h3>
                <p className={`text-xs ${MUTED}`}>
                  {perDay ? tx('incomeItemPerDay') : tx('incomeItemFixed')} · {item.kind === 'DEDUCTION' ? tx('incomeItemKindDeduction') : tx('incomeItemKindEarning')}
                </p>
              </div>
              <RowActions canEdit={ctx.canEdit} onEdit={() => setEditing(item)} onDelete={() => remove.ask('items', item.id)} />
            </header>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Pair label={tx('incomeItemValueNow')}>
                {rate ? (perDay ? tx('incomeItemPerDayRate', { amount: money(toCents(rate.amount)) }) : money(toCents(rate.amount))) : tx('incomeItemNoValue')}
              </Pair>
              {!perDay && <Pair label={tx('incomeFormBases')}>{bases || tx('incomeItemNoBases')}</Pair>}
              {perDay && (
                <>
                  <Pair label={tx('incomeFieldPayDay')}>
                    {tx('incomeItemPayDay', { day: item.payDay ?? '—' })}
                    <span className={`block text-xs ${MUTED}`}>
                      {item.referenceMonthOffset === 1 ? tx('incomeItemOffsetNext') : item.referenceMonthOffset === -1 ? tx('incomeItemOffsetPrev') : tx('incomeItemOffsetSame')}
                    </span>
                  </Pair>
                  {item.marginDays > 0 && <Pair label={tx('incomeFormMargin')}>{tx('incomeItemMargin', { days: item.marginDays })}</Pair>}
                  <Pair label={tx('incomeFieldDestAccount')}>{item.accountId ? ctx.accountName(item.accountId) : tx('incomeItemDestSame')}</Pair>
                  <Pair label={tx('incomeFieldLinkedRecurrence')}>
                    {item.recurringTransactionId ? ctx.recurrenceName(item.recurringTransactionId) : tx('incomeItemNoRecurrence')}
                    {!item.isAvailableCash && <span className={`block text-xs ${MUTED}`}>{tx('incomeItemNotCash')}</span>}
                  </Pair>
                </>
              )}
            </dl>
            {perDay && <BenefitMonth ctx={ctx} item={item} />}
            {history.length > 0 && (
              <div className="space-y-1">
                <p className={`text-xs ${MUTED}`}>{tx('incomeItemHistory')}</p>
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {history.map((v) => (
                    <li key={v.id} className="flex justify-between py-1 text-sm text-gray-900 dark:text-white">
                      <span>{perDay ? tx('incomeItemPerDayRate', { amount: money(toCents(v.amount)) }) : money(toCents(v.amount))}</span>
                      <span className={MUTED}>{longDay(v.startDate)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {ctx.canEdit && (
              <button type="button" onClick={() => setValueFor(item)} className={BTN_ADD}>
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                {tx('incomeItemNewValue')}
              </button>
            )}
          </article>
        );
      })}
      <ItemFormDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        householdId={ctx.householdId}
        employmentId={ctx.employment.id}
        item={editing === 'new' ? null : editing}
      />
      {valueFor && <ItemValueDialog open onClose={() => setValueFor(null)} householdId={ctx.householdId} employmentId={ctx.employment.id} item={valueFor} />}
      {remove.modal}
    </section>
  );
}

/**
 * The count of a benefit paid per business day, for the payment that falls in the current month (the same one the list
 * counts), or the next payment when none falls now. The title names both months: when it was paid and the month it counts.
 */
function BenefitMonth({ ctx, item }: { ctx: DetailCtx; item: Item }) {
  const tx = useIncomeTexts();
  const money = useMoney();
  const { locale } = useI18n();
  const list = ctx.events?.benefits ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const shown = (chosen && list.find((b) => b.itemId === item.id && b.paymentDate === chosen)) || benefitToShow(list, item.id, ctx.today);
  const previous = shown ? neighbourBenefit(list, item.id, shown.paymentDate, -1) : null;
  const next = shown ? neighbourBenefit(list, item.id, shown.paymentDate, 1) : null;
  const move = (target: BenefitEvent | null) => {
    if (target) setChosen(target.paymentDate);
  };
  return (
    <div className="space-y-3 rounded-md border border-gray-200 p-3 dark:border-gray-800">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => move(previous)} disabled={!previous} aria-label={tx('incomeMonthPrev')} className={BTN_ICON}>
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <p className="text-center text-sm font-medium text-gray-900 dark:text-white">
          {shown ? tx('incomeCountTitle', { paid: monthNameOf(monthOf(shown.paymentDate), locale), ref: monthNameOf(shown.referenceMonth, locale) }) : tx('incomeCountNoMonth')}
        </p>
        <button type="button" onClick={() => move(next)} disabled={!next} aria-label={tx('incomeMonthNext')} className={BTN_ICON}>
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      {shown && <BenefitCountBody event={shown} tx={tx} money={money} />}
      {shown && item.recurringTransactionId && (
        <LaunchCompare ctx={ctx} recurringId={item.recurringTransactionId} money={money} expectedCents={toCents(shown.amount)} paymentMonth={monthOf(shown.paymentDate)} />
      )}
      <p className={`text-xs ${MUTED}`}>{tx('incomeCountEstimateNote')}</p>
    </div>
  );
}

function BenefitCountBody({ event, tx, money }: { event: BenefitEvent; tx: IncomeTx; money: (reais: number) => string }) {
  const view = benefitBreakdown(event);
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Pair label={tx('incomeCountWeekdays')}>{view.weekdays}</Pair>
        <Pair label={tx('incomeCountVacation')}>{view.vacationDays}</Pair>
        <Pair label={tx('incomeCountMargin')}>{view.marginDays}</Pair>
        <Pair label={tx('incomeCountCounted')}>{view.countedDays}</Pair>
        <Pair label={tx('incomeCountAmount')}>{money(view.amountCents / 100)}</Pair>
      </dl>
      <p className={`text-sm text-gray-900 dark:text-white`}>{tx('incomeCountPaid', { date: longDay(event.paymentDate) })}</p>
      <div className="space-y-1">
        <p className={`text-xs ${MUTED}`}>{tx('incomeCountHolidays')}</p>
        {view.holidays.length === 0 ? (
          <p className="text-sm text-gray-900 dark:text-white">{tx('incomeCountNoHolidays')}</p>
        ) : (
          <ul className="space-y-0.5 text-sm text-gray-900 dark:text-white">
            {view.holidays.map((h) => (
              <li key={h.date}>{`${shortDay(h.date)} · ${h.name}`}</li>
            ))}
          </ul>
        )}
      </div>
      {view.warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800 dark:text-amber-300">
          {view.warnings.map((w, i) => (
            <li key={`${w.code}-${w.date ?? i}`}>{tx(benefitWarningKey(w.code), { date: longDay(w.date) })}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- Vacations -------------------------------------------------------------------------------------------------------

export function VacationsSection({ ctx }: { ctx: DetailCtx }) {
  const tx = useIncomeTexts();
  const { locale } = useI18n();
  const [adding, setAdding] = useState(false);
  const remove = useRowDelete(ctx);
  const rows = [...ctx.employment.vacations].sort((a, b) => (a.startDate ?? `${a.month ?? ''}-00`).localeCompare(b.startDate ?? `${b.month ?? ''}-00`));
  const paidOn = (v: Vacation) => ctx.events?.vacations.find((e) => e.id === v.id)?.paymentDate ?? null;
  const span = (v: Vacation): string => {
    const days = v.days ?? 30;
    if (v.startDate) return tx('incomeVacationDates', { start: shortDay(v.startDate), end: shortDay(addDayKey(v.startDate, days - 1)), days });
    return tx('incomeVacationMonth', { month: capitalize(monthNameOf(v.month ?? '', locale)), days });
  };
  return (
    <section aria-label={tx('incomeSectionVacations')} className={`${CARD_CLS} space-y-3`}>
      <SectionHeader title={tx('incomeSectionVacations')} action={tx('incomeNewVacation')} onAction={() => setAdding(true)} canEdit={ctx.canEdit} />
      {rows.length === 0 ? (
        <EmptyLine>{tx('incomeVacationEmpty')}</EmptyLine>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map((v) => {
            const pay = paidOn(v);
            return (
              <li key={v.id} className="flex min-h-[44px] items-start justify-between gap-3 py-2">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm text-gray-900 dark:text-white">{span(v)}</p>
                  {v.estimated && <p className={`text-xs ${MUTED}`}>{tx('incomeVacationEstimated')}</p>}
                  {v.sellDays > 0 && <p className={`text-xs ${MUTED}`}>{tx('incomeVacationSold', { days: v.sellDays })}</p>}
                  {pay && <p className={`text-xs ${MUTED}`}>{tx('incomeVacationPaidOn', { date: longDay(pay) })}</p>}
                  {v.note && <p className={`text-xs ${MUTED}`}>{v.note}</p>}
                </div>
                <RowActions canEdit={ctx.canEdit} onDelete={() => remove.ask('vacations', v.id)} />
              </li>
            );
          })}
        </ul>
      )}
      <VacationFormDialog open={adding} onClose={() => setAdding(false)} householdId={ctx.householdId} employmentId={ctx.employment.id} />
      {remove.modal}
    </section>
  );
}

// ---- FGTS ------------------------------------------------------------------------------------------------------------

const WITHDRAWAL_KIND_KEY = { BIRTHDAY: 'incomeWithdrawalKindBirthday', TERMINATION: 'incomeWithdrawalKindTermination', OTHER: 'incomeWithdrawalKindOther' } as const;

export function FgtsSection({ ctx }: { ctx: DetailCtx }) {
  const tx = useIncomeTexts();
  const { locale } = useI18n();
  const money = useMoney();
  const [dialog, setDialog] = useState<'balance' | 'withdrawal' | 'mode' | 'expected' | null>(null);
  const remove = useRowDelete(ctx);
  const fgts = ctx.events?.fgts;
  const basis = fgts ? fgtsBasis(fgts) : null;
  const accumulated = fgts?.accumulatedToday ?? null;
  const deposit = fgts ? fgtsDepositOfMonth(fgts, ctx.today.slice(0, 7)) : 0;
  const mode = modeInForce(ctx.employment.fgtsModes, ctx.today);
  const next = nextBirthdayWithdrawal(ctx.events?.birthdayWithdrawals ?? [], ctx.today);
  const withdrawals = [...ctx.employment.fgtsWithdrawals].sort((a, b) => b.date.localeCompare(a.date));
  const balances = [...ctx.employment.fgtsBalances].sort((a, b) => b.asOfDate.localeCompare(a.asOfDate));
  const history = modeHistory(ctx.employment.fgtsModes);
  const modeText = (m: FgtsModeRecord) => (m.mode === 'BIRTHDAY' ? tx('incomeFgtsModeBirthday', { month: monthOnlyOf(m.birthdayMonth, locale) }) : tx('incomeFgtsModeTermination'));
  return (
    <section aria-label={tx('incomeSectionFgts')} className={`${CARD_CLS} space-y-4`}>
      <h2 className={SECTION_TITLE_CLS}>{tx('incomeSectionFgts')}</h2>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Pair label={tx('incomeFgtsDeposit')}>{money(deposit / 100)}</Pair>
        <Pair label={tx('incomeFgtsAccumulated')}>{accumulated === null ? '—' : money(accumulated)}</Pair>
      </dl>
      {basis && (
        <p className={`text-xs ${MUTED}`}>
          {basis.informed ? tx('incomeFgtsBasisInformed', { amount: money(basis.amountCents / 100), date: longDay(basis.asOfDate) }) : tx('incomeFgtsBasisSince')}
        </p>
      )}
      <p className={`text-xs ${MUTED}`}>{tx('incomeFgtsDisclaimer')}</p>

      {/* Mode in force and its history: a change is a new dated record */}
      <div className="space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-gray-900 dark:text-white">
            {tx('incomeFgtsMode')}: {mode ? modeText(mode) : '—'}
          </p>
          {ctx.canEdit && <button type="button" onClick={() => setDialog('mode')} className={BTN_ADD}>{tx('incomeFgtsModeChange')}</button>}
        </div>
        {history.length > 0 && (
          <div>
            <p className={`text-xs ${MUTED}`}>{tx('incomeFgtsModeHistory')}</p>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {history.map((m) => (
                <li key={m.id} className="py-1 text-sm text-gray-900 dark:text-white">
                  {modeText(m)}
                  <span className={`ml-2 text-xs ${MUTED}`}>{tx('incomeFgtsModeSince', { date: longDay(m.startDate) })}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Next birthday withdrawal, with the expected amount the user can inform */}
      <div className="space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
        <p className={SECTION_TITLE_CLS}>{tx('incomeFgtsNext')}</p>
        {next ? (
          <>
            <p className="text-sm text-gray-900 dark:text-white">{tx('incomeFgtsNextLine', { date: longDay(next.date), amount: money(next.amount) })}</p>
            <p className={`text-xs ${MUTED}`}>
              {next.source === 'informed' ? tx('incomeFgtsNextInformed') : tx('incomeFgtsNextTable', { table: next.tableId ?? '—', balance: money(next.balance) })}
            </p>
          </>
        ) : (
          <EmptyLine>{tx('incomeFgtsNextNone')}</EmptyLine>
        )}
        {ctx.canEdit && mode?.mode === 'BIRTHDAY' && (
          <button type="button" onClick={() => setDialog('expected')} className={BTN_ADD}>{tx('incomeFgtsExpectedLabel')}</button>
        )}
      </div>

      {/* Balances informed from the statement */}
      <div className="space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
        <div className="flex items-center justify-between gap-2">
          <p className={SECTION_TITLE_CLS}>{tx('incomeFgtsBalances')}</p>
          {ctx.canEdit && <button type="button" onClick={() => setDialog('balance')} className={BTN_ADD}>{tx('incomeFgtsNewBalance')}</button>}
        </div>
        {balances.length === 0 ? (
          <EmptyLine>{tx('incomeFgtsWithdrawalsEmpty')}</EmptyLine>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {balances.map((b) => (
              <li key={b.id} className="flex min-h-[44px] items-center justify-between gap-2 py-1 text-sm">
                <span className="text-gray-900 dark:text-white">{money(b.amount)}</span>
                <span className="flex items-center gap-2">
                  <span className={MUTED}>{longDay(b.asOfDate)}</span>
                  <RowActions canEdit={ctx.canEdit} onDelete={() => remove.ask('fgts-balances', b.id)} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Withdrawals, with their type */}
      <div className="space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
        <div className="flex items-center justify-between gap-2">
          <p className={SECTION_TITLE_CLS}>{tx('incomeFgtsWithdrawals')}</p>
          {ctx.canEdit && <button type="button" onClick={() => setDialog('withdrawal')} className={BTN_ADD}>{tx('incomeFgtsNewWithdrawal')}</button>}
        </div>
        {withdrawals.length === 0 ? (
          <EmptyLine>{tx('incomeFgtsWithdrawalsEmpty')}</EmptyLine>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {withdrawals.map((w) => (
              <li key={w.id} className="flex min-h-[44px] items-center justify-between gap-2 py-1 text-sm">
                <div className="min-w-0">
                  <p className="text-gray-900 dark:text-white">{money(w.amount)} · {tx(WITHDRAWAL_KIND_KEY[w.kind])}</p>
                  <p className={`text-xs ${MUTED}`}>{longDay(w.date)}{w.note ? ` · ${w.note}` : ''}</p>
                </div>
                <RowActions canEdit={ctx.canEdit} onDelete={() => remove.ask('fgts-withdrawals', w.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <FgtsBalanceDialog open={dialog === 'balance'} onClose={() => setDialog(null)} householdId={ctx.householdId} employmentId={ctx.employment.id} />
      <FgtsWithdrawalDialog open={dialog === 'withdrawal'} onClose={() => setDialog(null)} householdId={ctx.householdId} employmentId={ctx.employment.id} />
      <FgtsModeDialog open={dialog === 'mode'} onClose={() => setDialog(null)} householdId={ctx.householdId} employmentId={ctx.employment.id} current={mode} />
      {dialog === 'expected' && mode && <FgtsExpectedDialog open onClose={() => setDialog(null)} householdId={ctx.householdId} employmentId={ctx.employment.id} mode={mode} />}
      {remove.modal}
    </section>
  );
}

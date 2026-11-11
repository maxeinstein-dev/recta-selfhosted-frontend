import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { BTN_SECONDARY_TOUCH, CARD_CLS, EmptyLine, MUTED, SECTION_TITLE_CLS, useIncomeTexts, useMoneyCents, type IncomeTx } from '../components/income/shared';
import { useI18n } from '../context/I18nContext';
import { useDefaultHousehold } from '../hooks/useDefaultHousehold';
import { useAuthUser } from '../hooks/api/useAuth';
import { usePeople } from '../hooks/api/usePeople';
import { useEmployments, useHouseholdEvents } from '../hooks/api/usePayroll';
import { findMyPersonId, groupEmploymentsByPerson, isCoupleView, scopePersonId, shortDay, type IncomeScope } from '../utils/income';
import { buildCalendarYear, yearHasPast, yearRange, type CalendarEntry, type CalendarMonth } from '../utils/incomeCalendar';
import { todayIso } from '../components/people/ui';
import { capitalize, monthNameOf, monthOnlyOf } from '../utils/incomeMonth';

const CHIP_CLS = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-light whitespace-nowrap';

/**
 * The calendar of a year: each month of the payment dates, with what is paid in it (salary, benefits, 13th, vacations,
 * birthday withdrawal), the month and year totals, and the estimated part. Past months are dimmed. One vertical list,
 * so it reads on the phone.
 */
const IncomeCalendar = () => {
  const tx = useIncomeTexts();
  const { locale } = useI18n();
  const money = useMoneyCents();
  const { householdId } = useDefaultHousehold();
  const today = todayIso();
  const currentYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [scope, setScope] = useState<IncomeScope>('couple');

  const people = usePeople(householdId, true);
  const authUser = useAuthUser();
  const myPersonId = findMyPersonId(people.data ?? [], authUser.data?.id);
  const everyone = useEmployments(householdId);
  const coupleView = isCoupleView(groupEmploymentsByPerson(people.data ?? [], everyone.data ?? []));
  const noMine = scope === 'mine' && !myPersonId;
  const personId = scopePersonId(scope, myPersonId);
  const range = yearRange(year);
  const events = useHouseholdEvents(householdId, range.from, range.to, personId, true);

  const sets = useMemo(() => (noMine ? [] : (events.data?.employments ?? [])), [noMine, events.data]);
  const calendar = useMemo(() => buildCalendarYear(sets, year, today), [sets, year, today]);
  const employerById = useMemo(() => new Map((everyone.data ?? []).map((e): [string, string] => [e.id, e.employer])), [everyone.data]);
  const personById = useMemo(() => new Map((people.data ?? []).map((p): [string, string] => [p.id, p.name])), [people.data]);
  const personByEmployment = useMemo(
    () => new Map((everyone.data ?? []).map((e): [string, string] => [e.id, personById.get(e.personId ?? '') ?? ''])),
    [everyone.data, personById],
  );

  const loading = everyone.isPending || events.isPending;
  const failed = everyone.isError || events.isError;
  const noEmployments = !loading && !failed && (everyone.data ?? []).length === 0;

  const retry = () => {
    void everyone.refetch();
    void events.refetch();
  };

  let body: ReactNode;
  if (failed) {
    body = (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">{tx('incomeLoadError')}</p>
        <button type="button" onClick={retry} className={BTN_SECONDARY_TOUCH}>{tx('incomeRetry')}</button>
      </div>
    );
  } else if (loading) {
    body = <p role="status" className={`text-sm ${MUTED}`}>{tx('incomeLoading')}</p>;
  } else if (noEmployments) {
    body = (
      <div className={`${CARD_CLS} text-center`}>
        <p className={`text-sm ${MUTED}`}>{tx('incomeEmptyText')}</p>
        <div className="mt-4">
          <Link to="/app/income" className="inline-flex min-h-[44px] items-center text-sm text-primary-600 dark:text-primary-400 hover:underline">{tx('incomeBack')}</Link>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="space-y-6">
        {noMine && <p className={`text-sm ${MUTED}`}>{tx('incomeScopeNoMine')}</p>}

        {/* Year totals */}
        <section aria-label={tx('incomeCalendarYearTotal')} className={CARD_CLS}>
          <p className={`text-xs ${MUTED}`}>{tx('incomeCalendarYearTotal')} {year}</p>
          <dl className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <dt className={`text-xs ${MUTED}`}>{tx('incomeCalendarYearTotal')}</dt>
              <dd className="text-xl font-medium text-emerald-600 dark:text-emerald-400">{money(calendar.totalCents)}</dd>
            </div>
            <div>
              <dt className={`text-xs ${MUTED}`}>{tx('incomeCalendarEstimatedTotal')}</dt>
              <dd className="text-base font-medium text-gray-900 dark:text-white">{money(calendar.estimatedCents)}</dd>
            </div>
            <div>
              <dt className={`text-xs ${MUTED}`}>{tx('incomeCalendarFirmTotal')}</dt>
              <dd className="text-base font-medium text-gray-900 dark:text-white">{money(calendar.firmCents)}</dd>
            </div>
          </dl>
        </section>

        {coupleView && (
          <div role="radiogroup" aria-label={tx('incomeScopeLabel')} className="flex gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1 max-w-xs">
            {(['mine', 'couple'] as const).map((option) => {
              const active = scope === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setScope(option)}
                  className={`min-h-[44px] flex-1 rounded-md px-3 py-2 text-sm font-light transition-colors ${active ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm' : 'text-gray-600 dark:text-gray-400'}`}
                >
                  {option === 'mine' ? tx('incomeScopeMine') : tx('incomeScopeCouple')}
                </button>
              );
            })}
          </div>
        )}

        {yearHasPast(year, today) && <p className={`text-xs ${MUTED}`}>{tx('incomeCalendarPastNote')}</p>}

        {calendar.totalCents === 0 && !noMine && <EmptyLine>{tx('incomeCalendarEmptyYear')}</EmptyLine>}

        {/* Months */}
        <ol className="space-y-3">
          {calendar.months.map((m) => (
            <li key={m.month}>
              <MonthCard
                month={m}
                monthName={capitalize(monthOnlyOf(Number(m.month.slice(5, 7)), locale))}
                money={money}
                tx={tx}
                locale={locale}
                employerOf={(id) => employerById.get(id) ?? ''}
                personOf={(id) => personByEmployment.get(id) ?? ''}
                showPerson={coupleView && scope === 'couple'}
              />
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="pb-8">
      <div className="mb-4">
        <Link to="/app/income" className="inline-flex min-h-[44px] items-center gap-1 text-sm text-gray-600 hover:underline dark:text-gray-400">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {tx('incomeBack')}
        </Link>
      </div>
      <PageHeader title={tx('incomeCalendarTitle')} description={tx('incomeCalendarDescription')}>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setYear((y) => y - 1)} aria-label={tx('incomeCalendarPrevYear')} className={`${BTN_SECONDARY_TOUCH} px-3`}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="min-w-[4rem] text-center text-base font-medium text-gray-900 dark:text-white" aria-live="polite">{year}</span>
          <button type="button" onClick={() => setYear((y) => y + 1)} aria-label={tx('incomeCalendarNextYear')} className={`${BTN_SECONDARY_TOUCH} px-3`}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </PageHeader>
      <div className="max-w-2xl">{body}</div>
    </div>
  );
};

function MonthCard({
  month,
  monthName,
  money,
  tx,
  locale,
  employerOf,
  personOf,
  showPerson,
}: {
  month: CalendarMonth;
  monthName: string;
  money: (cents: number) => string;
  tx: IncomeTx;
  locale: string;
  employerOf: (employmentId: string) => string;
  personOf: (employmentId: string) => string;
  showPerson: boolean;
}) {
  const dim = month.past ? 'opacity-60' : '';
  return (
    <section aria-label={monthName} className={`${CARD_CLS} ${dim}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className={SECTION_TITLE_CLS}>
          {monthName}
          {month.current && <span className={`${CHIP_CLS} ml-2 bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300`}>{tx('incomeCalendarThisMonth')}</span>}
          {month.past && !month.current && <span className={`${CHIP_CLS} ml-2 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300`}>{tx('incomeCalendarPast')}</span>}
        </h2>
        <p className="text-sm font-medium text-gray-900 dark:text-white">{money(month.totalCents)}</p>
      </header>
      {month.entries.length === 0 ? (
        <p className={`mt-2 text-sm ${MUTED}`}>{tx('incomeCalendarMonthEmpty')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
          {month.entries.map((entry) => (
            <EntryRow
              key={entry.key}
              entry={entry}
              money={money}
              tx={tx}
              locale={locale}
              line={[showPerson ? personOf(entry.employmentId) : '', employerOf(entry.employmentId)].filter(Boolean).join(' · ')}
            />
          ))}
        </ul>
      )}
      {month.entries.length > 0 && (
        <p className={`mt-2 text-xs ${MUTED}`}>
          {tx('incomeCalendarEstimatedTotal')}: {money(month.estimatedCents)} · {tx('incomeCalendarFirmTotal')}: {money(month.firmCents)}
        </p>
      )}
    </section>
  );
}

function EntryRow({ entry, money, tx, locale, line }: { entry: CalendarEntry; money: (cents: number) => string; tx: IncomeTx; locale: string; line: string }) {
  const what =
    entry.kind === 'salary'
      ? tx('incomeCalendarSalary', { month: monthNameOf(entry.competence ?? '', locale) })
      : entry.kind === 'thirteenth'
        ? tx('incomeEventThirteenth', { installment: entry.installment ?? 1 })
        : entry.kind === 'vacation'
          ? tx('incomeCalendarVacation', { start: shortDay(entry.periodStart), end: shortDay(entry.periodEnd), days: entry.periodDays ?? 0 })
          : entry.kind === 'birthday'
            ? tx('incomeEventBirthday')
            : tx('incomeEventBenefit', { name: entry.name ?? '', days: entry.days ?? 0 });
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0 flex-1">
        <span className="block text-xs text-gray-500 dark:text-gray-400">{shortDay(entry.date)}</span>
        <span className="block break-words text-sm text-gray-900 dark:text-white">{what}</span>
        {line && <span className="block break-words text-xs text-gray-500 dark:text-gray-400">{line}</span>}
        {!entry.availableCash && <span className="block text-xs text-gray-500 dark:text-gray-400">{tx('incomeEventNoBalance')}</span>}
        {entry.estimated && <span className={`${CHIP_CLS} mt-1 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300`}>{tx('incomeEventEstimated')}</span>}
      </div>
      <span className="whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{money(entry.amountCents)}</span>
    </li>
  );
}

export default IncomeCalendar;

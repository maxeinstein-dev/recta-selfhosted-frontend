import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Briefcase, Plus, Users } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { PageButton } from '../components/PageButton';
import EmploymentFormDialog from '../components/income/EmploymentFormDialog';
import { CARD_CLS, EmptyLine, MUTED, SECTION_TITLE_CLS, useIncomeTexts, useMoneyCents } from '../components/income/shared';
import { useI18n } from '../context/I18nContext';
import { useDefaultHousehold } from '../hooks/useDefaultHousehold';
import { useAuthUser } from '../hooks/api/useAuth';
import { usePeople } from '../hooks/api/usePeople';
import { useEmployments, useHouseholdEvents } from '../hooks/api/usePayroll';
import { canWritePeople } from '../utils/people';
import {
  addMonthKey,
  employmentStatus,
  findMyPersonId,
  groupEmploymentsByPerson,
  isCoupleView,
  longDay,
  monthName,
  monthRange,
  monthTotals,
  scopePersonId,
  upcomingEvents,
  type Employment,
  type EmploymentGroup,
  type IncomeScope,
  type PayrollEvents,
  type UpcomingEvent,
} from '../utils/income';
import { todayIso } from '../components/people/ui';

/** How far ahead the upcoming events reach (months after the current one). */
const UPCOMING_MONTHS = 6;
const UPCOMING_LIMIT = 12;
const CHIP_CLS = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-light whitespace-nowrap';

/** The Renda page: each person's jobs with the month's forecast, the "Só eu / Casal" switch, and the upcoming events. */
const Income = () => {
  const tx = useIncomeTexts();
  const { t, locale } = useI18n();
  const money = useMoneyCents();
  const navigate = useNavigate();
  const { householdId, household } = useDefaultHousehold();
  const canEdit = canWritePeople(household);
  const today = todayIso();
  const month = today.slice(0, 7);
  const monthLabel = monthName(month, locale);

  const people = usePeople(householdId, true);
  const authUser = useAuthUser();
  const myPersonId = findMyPersonId(people.data ?? [], authUser.data?.id);
  const [scope, setScope] = useState<IncomeScope>('couple');
  const [formOpen, setFormOpen] = useState(false);

  // The full list decides whether the switch exists; the scoped one (and the events) is what the screen shows.
  const everyone = useEmployments(householdId);
  const coupleView = isCoupleView(groupEmploymentsByPerson(people.data ?? [], everyone.data ?? []));
  const noMine = scope === 'mine' && !myPersonId;
  const personId = scopePersonId(scope, myPersonId);
  const scoped = useEmployments(householdId, personId);
  const from = monthRange(month).from;
  const to = monthRange(addMonthKey(month, UPCOMING_MONTHS)).to;
  const events = useHouseholdEvents(householdId, from, to, personId);

  const shown = useMemo<Employment[]>(() => (noMine ? [] : (scoped.data ?? [])), [noMine, scoped.data]);
  const groups: EmploymentGroup[] = useMemo(() => groupEmploymentsByPerson(people.data ?? [], shown), [people.data, shown]);
  const sets: PayrollEvents[] = useMemo(() => events.data?.employments ?? [], [events.data]);
  const setById = useMemo(() => new Map(sets.map((s) => [s.employmentId, s])), [sets]);
  const totals = useMemo(() => monthTotals(sets.filter((s) => shown.some((e) => e.id === s.employmentId)), month), [sets, shown, month]);
  const upcoming = useMemo(() => upcomingEvents(sets.filter((s) => shown.some((e) => e.id === s.employmentId)), today).slice(0, UPCOMING_LIMIT), [sets, shown, today]);
  const employerById = useMemo(() => new Map(shown.map((e) => [e.id, e.employer])), [shown]);
  const personByEmployment = useMemo(() => {
    const byPerson = new Map((people.data ?? []).map((p): [string, string] => [p.id, p.name]));
    return new Map(shown.map((e): [string, string] => [e.id, byPerson.get(e.personId ?? '') ?? '']));
  }, [people.data, shown]);

  const loading = everyone.isPending || scoped.isPending || events.isPending;
  const failed = everyone.isError || scoped.isError || events.isError;
  const noPeople = !people.isPending && (people.data ?? []).length === 0;
  const noEmployments = !loading && !failed && (everyone.data ?? []).length === 0;

  const retry = () => {
    void everyone.refetch();
    void scoped.refetch();
    void events.refetch();
  };

  let body: ReactNode;
  if (failed) {
    body = (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">{tx('incomeLoadError')}</p>
        <button type="button" onClick={retry} className="min-h-[44px] rounded-lg border border-gray-200 dark:border-gray-800 px-4 py-2 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-900">
          {tx('incomeRetry')}
        </button>
      </div>
    );
  } else if (loading) {
    body = <p role="status" className={`text-sm ${MUTED}`}>{tx('incomeLoading')}</p>;
  } else if (noPeople) {
    body = (
      <div className={`${CARD_CLS} text-center`}>
        <Users className="mx-auto h-8 w-8 text-gray-400" aria-hidden="true" />
        <p className={`mt-2 ${SECTION_TITLE_CLS}`}>{tx('incomeNoPeopleTitle')}</p>
        <p className={`mt-1 text-sm ${MUTED}`}>{tx('incomeNoPeopleText')}</p>
        <div className="mt-4">
          <Link to="/app/people" className="inline-flex min-h-[44px] items-center text-sm text-primary-600 dark:text-primary-400 hover:underline">
            {t.peoplePage || 'Pessoas'}
          </Link>
        </div>
      </div>
    );
  } else if (noEmployments) {
    body = (
      <div className={`${CARD_CLS} text-center`}>
        <Briefcase className="mx-auto h-8 w-8 text-gray-400" aria-hidden="true" />
        <p className={`mt-2 ${SECTION_TITLE_CLS}`}>{tx('incomeEmptyTitle')}</p>
        <p className={`mt-1 text-sm ${MUTED}`}>{tx('incomeEmptyText')}</p>
        {canEdit && (
          <div className="mt-4">
            <PageButton icon={Plus} onClick={() => setFormOpen(true)}>{tx('incomeEmptyAction')}</PageButton>
          </div>
        )}
      </div>
    );
  } else {
    body = (
      <div className="space-y-6">
        {noMine && <p className={`text-sm ${MUTED}`}>{tx('incomeScopeNoMine')}</p>}

        {/* Month forecast */}
        <section aria-label={tx('incomeMonthTotalLabel')} className={CARD_CLS}>
          <p className={`text-xs ${MUTED}`}>{monthLabel}</p>
          <dl className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <dt className={`text-xs ${MUTED}`}>{tx('incomeMonthSalary')}</dt>
              <dd className="text-base font-medium text-gray-900 dark:text-white">{money(totals.salaryCents)}</dd>
            </div>
            <div>
              <dt className={`text-xs ${MUTED}`}>{tx('incomeMonthBenefits')}</dt>
              <dd className="text-base font-medium text-gray-900 dark:text-white">{money(totals.benefitsCents)}</dd>
            </div>
            <div>
              <dt className={`text-xs ${MUTED}`}>{tx('incomeMonthTotalLabel')}</dt>
              <dd className="text-xl font-medium text-emerald-600 dark:text-emerald-400">{money(totals.totalCents)}</dd>
            </div>
          </dl>
          <p className={`mt-2 text-xs ${MUTED}`}>{tx('incomeMonthHint')}</p>
        </section>

        {/* Scope switch: only when more than one person has jobs */}
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

        {/* Jobs by person */}
        {groups.length === 0 && !noMine && <EmptyLine>{tx('incomeNoActiveEmployments')}</EmptyLine>}
        {groups.map((group) => {
          const groupTotal = monthTotals(group.employments.map((e) => setById.get(e.id)).filter((s): s is PayrollEvents => !!s), month);
          return (
            <section key={group.personId ?? 'none'} aria-label={group.person?.name ?? tx('incomeOwnerNone')} className="space-y-3">
              <header className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-gray-200 dark:border-gray-800 pb-1">
                <h2 className={SECTION_TITLE_CLS}>{group.person?.name ?? tx('incomeOwnerNone')}</h2>
                {coupleView && <p className={`text-xs ${MUTED}`}>{money(groupTotal.totalCents)}</p>}
              </header>
              <ul className="space-y-3">
                {group.employments.map((employment) => {
                  const set = setById.get(employment.id);
                  const own = set ? monthTotals([set], month) : null;
                  const status = employmentStatus(employment, today);
                  return (
                    <li key={employment.id}>
                      <Link to={`/app/income/${employment.id}`} aria-label={tx('incomeOpenDetail', { employer: employment.employer })}
                        className={`${CARD_CLS} block min-h-[44px] transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50`}>
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0 break-words text-base font-light text-gray-900 dark:text-white">{employment.employer}</span>
                          <StatusChip status={status} tx={tx} />
                        </span>
                        {own ? (
                          <span className="mt-2 grid grid-cols-3 gap-2 text-sm">
                            <span className="min-w-0">
                              <span className={`block text-xs ${MUTED}`}>{tx('incomeMonthSalary')}</span>
                              <span className="block text-gray-900 dark:text-white">{money(own.salaryCents)}</span>
                            </span>
                            <span className="min-w-0">
                              <span className={`block text-xs ${MUTED}`}>{tx('incomeMonthBenefits')}</span>
                              <span className="block text-gray-900 dark:text-white">{money(own.benefitsCents)}</span>
                            </span>
                            <span className="min-w-0">
                              <span className={`block text-xs ${MUTED}`}>{tx('incomeMonthTotalLabel')}</span>
                              <span className="block font-medium text-emerald-600 dark:text-emerald-400">{money(own.totalCents)}</span>
                            </span>
                          </span>
                        ) : (
                          <span className={`mt-2 block text-sm ${MUTED}`}>{tx('incomeInactiveNotice')}</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        {/* Upcoming events */}
        <section aria-label={tx('incomeUpcomingTitle')} className="space-y-2">
          <h2 className={SECTION_TITLE_CLS}>{tx('incomeUpcomingTitle')}</h2>
          {upcoming.length === 0 ? (
            <EmptyLine>{tx('incomeUpcomingEmpty')}</EmptyLine>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {upcoming.map((event) => (
                <UpcomingRow key={event.key} event={event} employer={employerById.get(event.employmentId) ?? ''} person={personByEmployment.get(event.employmentId) ?? ''} money={money} tx={tx} onOpen={() => navigate(`/app/income/${event.employmentId}`)} />
              ))}
            </ul>
          )}
        </section>

        {canEdit && (
          <div>
            <PageButton variant="secondary" icon={Plus} onClick={() => setFormOpen(true)}>{tx('incomeNewEmployment')}</PageButton>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="pb-8">
      <PageHeader title={tx('incomeTitle')} description={tx('incomeDescription')}>
        {canEdit && !loading && !failed && !noEmployments && !noPeople && (
          <PageButton icon={Plus} onClick={() => setFormOpen(true)}>{tx('incomeNewEmployment')}</PageButton>
        )}
      </PageHeader>
      <div className="max-w-2xl">{body}</div>
      {formOpen && householdId && (
        <EmploymentFormDialog open={formOpen} onClose={() => setFormOpen(false)} householdId={householdId} employment={null} onCreated={(id) => navigate(`/app/income/${id}`)} />
      )}
    </div>
  );
};

function StatusChip({ status, tx }: { status: 'active' | 'ended' | 'inactive'; tx: ReturnType<typeof useIncomeTexts> }) {
  const tone = status === 'active' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
  const label = status === 'active' ? tx('incomeStatusActive') : status === 'ended' ? tx('incomeStatusEnded') : tx('incomeStatusInactive');
  return <span className={`${CHIP_CLS} ${tone}`}>{label}</span>;
}

function UpcomingRow({
  event,
  employer,
  person,
  money,
  tx,
  onOpen,
}: {
  event: UpcomingEvent;
  employer: string;
  person: string;
  money: (cents: number) => string;
  tx: ReturnType<typeof useIncomeTexts>;
  onOpen: () => void;
}) {
  const what =
    event.kind === 'thirteenth'
      ? tx('incomeEventThirteenth', { installment: event.installment ?? 1 })
      : event.kind === 'vacation'
        ? tx('incomeEventVacation')
        : event.kind === 'birthday'
          ? tx('incomeEventBirthday')
          : tx('incomeEventBenefit', { name: event.name ?? '', days: event.days ?? 0 });
  return (
    <li className="flex min-h-[44px] items-start justify-between gap-3 py-3">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block text-xs text-gray-500 dark:text-gray-400">{longDay(event.date)}</span>
        <span className="block break-words text-sm text-gray-900 dark:text-white">{what}</span>
        <span className="block break-words text-xs text-gray-500 dark:text-gray-400">
          {[person, employer].filter(Boolean).join(' · ')}
          {!event.availableCash && ` · ${tx('incomeEventNoBalance')}`}
        </span>
        {event.estimated && <span className={`${CHIP_CLS} mt-1 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300`}>{tx('incomeEventEstimated')}</span>}
      </button>
      <span className="whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{money(event.amountCents)}</span>
    </li>
  );
}

export default Income;

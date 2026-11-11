import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import EmploymentFormDialog from '../components/income/EmploymentFormDialog';
import {
  DataSection,
  FgtsSection,
  ItemsSection,
  SalarySection,
  VacationsSection,
  type DetailCtx,
} from '../components/income/DetailSections';
import { BTN_SECONDARY_TOUCH, CARD_CLS, MUTED, errorText, recurrenceList, useIncomeTexts } from '../components/income/shared';
import { useAccounts } from '../hooks/api/useAccounts';
import { useRecurringTransactions } from '../hooks/api/useRecurringTransactions';
import { usePeople } from '../hooks/api/usePeople';
import { useTransactions } from '../hooks/api/useTransactions';
import { useDeleteEmployment, useEmployment, useEmploymentEvents } from '../hooks/api/usePayroll';
import { useDefaultHousehold } from '../hooks/useDefaultHousehold';
import { CategoryType } from '../lib/enums';
import { canWritePeople } from '../utils/people';
import { addMonthKey, employmentStatus, monthRange, type LaunchCandidate } from '../utils/income';
import { todayIso } from '../components/people/ui';
import { useToastContext } from '../context/ToastContext';

/** A local Date at midnight for a 'YYYY-MM-DD' (the transaction list formats its dates with local fields). */
const localDate = (day: string): Date => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));

const CHIP_CLS = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-light whitespace-nowrap';

/**
 * The detail of one job: its data, the salary history, the items and benefits (with the month's count of business days),
 * the vacations and the FGTS. Editing the job and deleting it are here too.
 */
const IncomeDetail = () => {
  const tx = useIncomeTexts();
  const navigate = useNavigate();
  const { employmentId = '' } = useParams();
  const { householdId, household } = useDefaultHousehold();
  const canEdit = canWritePeople(household);
  const today = todayIso();
  const current = today.slice(0, 7);
  const { success, error: showError } = useToastContext();

  const employment = useEmployment(householdId, employmentId);
  const people = usePeople(householdId, true);
  const accounts = useAccounts({ householdId: householdId ?? '' });
  const recurrences = useRecurringTransactions({ householdId: householdId ?? '' });
  const events = useEmploymentEvents(householdId, employmentId, monthRange(addMonthKey(current, -2)).from, monthRange(addMonthKey(current, 13)).to);
  const launchesQuery = useTransactions({
    householdId,
    startDate: localDate(monthRange(addMonthKey(current, -3)).from),
    endDate: localDate(monthRange(current).to),
    type: CategoryType.INCOME,
    limit: 100,
  });
  const launches: LaunchCandidate[] = useMemo(
    () =>
      ((launchesQuery.data?.data ?? []) as Array<{ id: string; type?: string; amount: number; date: string; recurringTransactionId?: string | null }>).map((t) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        date: String(t.date).slice(0, 10),
        recurringTransactionId: t.recurringTransactionId ?? null,
      })),
    [launchesQuery.data],
  );

  const deleteMutation = useDeleteEmployment();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const accountName = useMemo(() => {
    const byId = new Map<string, string>((accounts.data?.accounts ?? []).map((a): [string, string] => [a.id, a.name]));
    return (id: string | null) => (id ? byId.get(id) ?? id : tx('incomeNone'));
  }, [accounts.data, tx]);
  const recurrenceName = useMemo(() => {
    const byId = new Map<string, string>(recurrenceList(recurrences.data).map((r): [string, string] => [r.id, r.description]));
    return (id: string | null) => (id ? byId.get(id) ?? tx('incomeItemRecurrenceMissing') : tx('incomeNone'));
  }, [recurrences.data, tx]);

  const removeEmployment = async () => {
    if (!householdId) return;
    setDeleting(true);
    try {
      await deleteMutation.mutateAsync({ householdId, id: employmentId });
      success(tx('incomeDeleted'));
      navigate('/app/income', { replace: true });
    } catch (error: unknown) {
      showError(errorText(error, tx));
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  let body: ReactNode;
  if (employment.isPending || !householdId) {
    body = <p role="status" className={`text-sm ${MUTED}`}>{tx('incomeLoading')}</p>;
  } else if (employment.isError) {
    const notFound = (employment.error as { status?: number } | null)?.status === 404;
    body = (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">{notFound ? tx('incomeNotFound') : tx('incomeErrLoad')}</p>
        <Link to="/app/income" className="text-sm text-primary-600 dark:text-primary-400 hover:underline">{tx('incomeBack')}</Link>
      </div>
    );
  } else {
    const e = employment.data;
    const status = employmentStatus(e, today);
    const owner = (people.data ?? []).find((p) => p.id === e.personId)?.name ?? '';
    const ctx: DetailCtx = {
      householdId,
      employment: e,
      events: events.data,
      canEdit,
      today,
      launches,
      accountName,
      recurrenceName,
      ownerName: owner,
    };
    const statusTone = status === 'active' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
    const statusLabel = status === 'active' ? tx('incomeStatusActive') : status === 'ended' ? tx('incomeStatusEnded') : tx('incomeStatusInactive');
    body = (
      <div className="space-y-6">
        <header className={`${CARD_CLS} space-y-2`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="break-words text-xl font-light text-gray-900 dark:text-white">{e.employer}</h2>
              <p className={`text-sm ${MUTED}`}>{owner || tx('incomeOwnerNone')}</p>
            </div>
            <span className={`${CHIP_CLS} ${statusTone}`}>{statusLabel}</span>
          </div>
          {!e.isActive && <p className="text-sm text-amber-700 dark:text-amber-300">{tx('incomeInactiveNotice')}</p>}
          {canEdit && (
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" onClick={() => setEditing(true)} className={BTN_SECONDARY_TOUCH}>
                <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                {tx('incomeEdit')}
              </button>
              <button type="button" onClick={() => setConfirmDelete(true)} className={`${BTN_SECONDARY_TOUCH} text-red-600 dark:text-red-400`}>
                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                {tx('incomeDelete')}
              </button>
            </div>
          )}
        </header>
        <DataSection ctx={ctx} />
        <SalarySection ctx={ctx} />
        <ItemsSection ctx={ctx} />
        <VacationsSection ctx={ctx} />
        <FgtsSection ctx={ctx} />
        {events.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{tx('incomeLoadError')}</p>}
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
      <div className="max-w-2xl">{body}</div>
      {editing && employment.data && householdId && (
        <EmploymentFormDialog open={editing} onClose={() => setEditing(false)} householdId={householdId} employment={employment.data} />
      )}
      <ConfirmModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void removeEmployment()}
        title={tx('incomeDeleteTitle')}
        message={tx('incomeDeleteMessage')}
        confirmText={tx('incomeDeleteConfirm')}
        cancelText={tx('incomeFormCancel')}
        variant="danger"
        isLoading={deleting}
      />
    </div>
  );
};

export default IncomeDetail;

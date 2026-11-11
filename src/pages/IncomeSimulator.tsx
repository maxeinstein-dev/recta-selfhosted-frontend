import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import SimulatorPanel from '../components/income/SimulatorPanel';
import { MUTED, errorText, useIncomeTexts } from '../components/income/shared';
import { useEmployment } from '../hooks/api/usePayroll';
import { useDefaultHousehold } from '../hooks/useDefaultHousehold';
import { emptySimForm, raiseStart, type SimForm } from '../utils/incomeSimulator';
import { todayIso } from '../components/people/ui';

/**
 * The payroll simulator. Opened from the Renda screen it starts empty; opened from a job's detail
 * (?employmentId=...) it starts as a raise: the gross in force today, the dependents and the fixed monthly items.
 */
const IncomeSimulator = () => {
  const tx = useIncomeTexts();
  const [params] = useSearchParams();
  const employmentId = params.get('employmentId') ?? '';
  const raise = employmentId !== '';
  const { householdId } = useDefaultHousehold();
  const today = todayIso();
  const job = useEmployment(householdId, raise ? employmentId : undefined);

  let body;
  if (raise && job.isPending) {
    body = <p role="status" className={`text-sm ${MUTED}`}>{tx('incomeLoading')}</p>;
  } else if (raise && job.isError) {
    body = (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">{errorText(job.error, tx)}</p>
      </div>
    );
  } else if (raise && job.data) {
    const start = raiseStart(job.data, today);
    body = (
      <>
        <p className={`text-sm ${MUTED}`}>{tx('incomeSimRaiseFrom', { employer: job.data.employer })}</p>
        <SimulatorPanel key={job.data.id} initial={start.form} baselineGross={start.baselineGross} />
      </>
    );
  } else if (!raise) {
    const initial: SimForm = { ...emptySimForm('net'), date: today };
    body = <SimulatorPanel initial={initial} />;
  }

  return (
    <div className="pb-8">
      <div className="mb-4">
        <Link to="/app/income" className="inline-flex min-h-[44px] items-center gap-1 text-sm text-gray-600 hover:underline dark:text-gray-400">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {tx('incomeBack')}
        </Link>
      </div>
      <PageHeader title={tx('incomeSimulatorTitle')} description={tx('incomeSimulatorDescription')} />
      <div className="max-w-2xl">{body}</div>
    </div>
  );
};

export default IncomeSimulator;

import { useEffect, useMemo, useState } from 'react';
import { ListChecks, Plus, Users } from 'lucide-react';
import { useCurrency } from '../context/CurrencyContext';
import { useI18n } from '../context/I18nContext';
import { useDefaultHousehold } from '../hooks/useDefaultHousehold';
import { usePeople, usePeopleBalances } from '../hooks/api/usePeople';
import type { Person } from '../hooks/api/usePeople';
import { formatCurrency } from '../utils/format';
import { balanceSentence, balanceStatus, mergePeopleRows, summarizeBalances } from '../utils/people';
import { PageHeader } from '../components/PageHeader';
import { PageButton } from '../components/PageButton';
import PersonFormDialog from '../components/people/PersonFormDialog';
import PersonDetail from '../components/people/PersonDetail';
import SettlementDialog from '../components/people/SettlementDialog';
import OrganizeSharesDialog from '../components/people/OrganizeSharesDialog';
import { CHECKBOX_CLS, Chip, ERROR_CLS, MUTED_CLS, getErrorMessage } from '../components/people/ui';

const TONE = {
  'owes-me': 'text-green-600 dark:text-green-400',
  'i-owe': 'text-red-600 dark:text-red-400',
  settled: 'text-gray-500 dark:text-gray-400',
} as const;

/** People page: balances (she owes me / I owe / net), the person's ledger, settlements and the organize wizard. */
const People = () => {
  const { t } = useI18n();
  const { baseCurrency } = useCurrency();
  const { householdId, household } = useDefaultHousehold();
  // Writing needs EDITOR or more; a viewer only reads.
  const canEdit = (household as { role?: string } | undefined)?.role !== 'VIEWER';
  const money = (cents: number): string => formatCurrency(cents / 100, baseCurrency);

  const [showInactive, setShowInactive] = useState(false);
  const balancesQuery = usePeopleBalances(householdId);
  const peopleQuery = usePeople(householdId, showInactive);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [settling, setSettling] = useState<Person | null>(null);
  const [organizeOpen, setOrganizeOpen] = useState(false);

  const balances = useMemo(() => balancesQuery.data ?? [], [balancesQuery.data]);
  const rows = useMemo(() => mergePeopleRows(balances, peopleQuery.data ?? [], showInactive), [balances, peopleQuery.data, showInactive]);
  const summary = useMemo(() => summarizeBalances(balances), [balances]);
  const selected = rows.find((row) => row.person.id === selectedId) ?? null;

  // Another household: the person selected there does not exist here.
  useEffect(() => {
    setSelectedId(null);
  }, [householdId]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const loading = balancesQuery.isLoading || peopleQuery.isLoading;
  const netStatus = balanceStatus(summary.netCents / 100);

  return (
    <div className="pb-8">
      <PageHeader title={t.peoplePage || 'Pessoas'} description="Quem divide despesas com você: o que te devem, o que você deve e os acertos.">
        {canEdit && (
          <PageButton variant="secondary" icon={ListChecks} onClick={() => setOrganizeOpen(true)}>
            Organizar divisões
          </PageButton>
        )}
        {canEdit && (
          <PageButton icon={Plus} onClick={openCreate}>
            Nova pessoa
          </PageButton>
        )}
      </PageHeader>

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8" aria-label="Resumo dos saldos">
        <div className="p-4 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-md">
          <dt className={`text-xs ${MUTED_CLS}`}>Elas me devem</dt>
          <dd className="mt-1 text-xl font-light text-green-600 dark:text-green-400">{money(summary.owedToMeCents)}</dd>
        </div>
        <div className="p-4 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-md">
          <dt className={`text-xs ${MUTED_CLS}`}>Eu devo</dt>
          <dd className="mt-1 text-xl font-light text-red-600 dark:text-red-400">{money(summary.iOweCents)}</dd>
        </div>
        <div className="p-4 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-md">
          <dt className={`text-xs ${MUTED_CLS}`}>Líquido</dt>
          <dd className={`mt-1 text-xl font-light ${TONE[netStatus.kind]}`}>
            {summary.netCents < 0 ? '-' : ''}{money(Math.abs(summary.netCents))}
            <span className={`block text-xs ${MUTED_CLS}`}>{netStatus.kind === 'owes-me' ? 'a receber' : netStatus.kind === 'i-owe' ? 'a pagar' : 'quite'}</span>
          </dd>
        </div>
      </dl>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] gap-6">
        <section aria-label="Pessoas" className="space-y-3 min-w-0">
          <label htmlFor="people-show-inactive" className="inline-flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100 cursor-pointer">
            <input id="people-show-inactive" type="checkbox" checked={showInactive} className={CHECKBOX_CLS} onChange={(e) => setShowInactive(e.target.checked)} />
            Mostrar pessoas inativas
          </label>
          {loading && <p className={`text-sm ${MUTED_CLS}`} role="status">Carregando…</p>}
          {balancesQuery.isError && <p role="alert" className={ERROR_CLS}>{getErrorMessage(balancesQuery.error, 'Não foi possível carregar os saldos.')}</p>}
          {!loading && !balancesQuery.isError && rows.length === 0 && (
            <div className="px-4 py-8 text-center bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-md">
              <Users className="h-8 w-8 mx-auto text-gray-400" aria-hidden="true" />
              <p className="mt-2 text-sm text-gray-900 dark:text-white">Nenhuma pessoa ainda.</p>
              <p className={`text-xs ${MUTED_CLS}`}>Cadastre quem divide despesas com você, ou use “Organizar divisões” para criar a partir das notas.</p>
            </div>
          )}
          <ul className="space-y-2">
            {rows.map((row) => {
              const status = balanceStatus(row.balance?.balance ?? 0);
              const active = row.person.id === selectedId;
              return (
                <li key={row.person.id}>
                  <button type="button" onClick={() => setSelectedId(row.person.id)} aria-pressed={active}
                    className={`w-full text-left p-4 rounded-md border transition-colors ${active ? 'border-primary-500 bg-primary-50/40 dark:bg-primary-900/10' : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-base font-light text-gray-900 dark:text-white truncate">{row.person.name}</span>
                      {!row.person.isActive && <Chip tone="gray">inativa</Chip>}
                    </span>
                    <span className={`block text-sm ${TONE[status.kind]}`}>{balanceSentence(row.person.name, row.balance?.balance ?? 0)}</span>
                    {row.balance && <span className={`block text-xs ${MUTED_CLS}`}>{row.balance.openShares === 1 ? '1 parte cadastrada' : `${row.balance.openShares} partes cadastradas`}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="min-w-0">
          {selected ? (
            <PersonDetail key={selected.person.id} householdId={householdId} person={selected.person} balance={selected.balance} canEdit={canEdit}
              onEdit={(person) => { setEditing(person); setFormOpen(true); }} onSettle={setSettling} onDeleted={() => setSelectedId(null)} />
          ) : (
            !loading && rows.length > 0 && <p className={`text-sm ${MUTED_CLS}`}>Escolha uma pessoa para ver o extrato e registrar acertos.</p>
          )}
        </div>
      </div>

      {formOpen && (
        <PersonFormDialog open={formOpen} onClose={() => setFormOpen(false)} householdId={householdId} person={editing}
          onSaved={(person) => { if (!editing) setSelectedId(person.id); }} />
      )}
      {settling && (
        <SettlementDialog open onClose={() => setSettling(null)} householdId={householdId} person={settling}
          balance={rows.find((row) => row.person.id === settling.id)?.balance?.balance ?? 0} />
      )}
      {organizeOpen && <OrganizeSharesDialog open onClose={() => setOrganizeOpen(false)} householdId={householdId} />}
    </div>
  );
};

export default People;

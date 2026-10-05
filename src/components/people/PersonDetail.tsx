import { useMemo, useRef, useState } from 'react';
import { Pencil, Trash2, HandCoins } from 'lucide-react';
import { useDeletePerson, useDeleteSettlement, usePersonLedger } from '../../hooks/api/usePeople';
import type { LedgerEntry, Person, PersonBalance } from '../../hooks/api/usePeople';
import { useToastContext } from '../../context/ToastContext';
import { useCurrency } from '../../context/CurrencyContext';
import { formatCurrency } from '../../utils/format';
import { balanceSentence, balanceStatus, ledgerKindLabel, reaisToCents, signedMoneyText } from '../../utils/people';
import {
  BOX_CLS, BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, BTN_SECONDARY_SM, Chip, ERROR_CLS, H4_CLS, LINK_CLS, MUTED_CLS, TABLE_WRAP_CLS, TBODY_CLS, TD_CLS, TH_CLS,
  THEAD_ROW_CLS, fmtDate, getErrorMessage,
} from './ui';

interface PersonDetailProps {
  householdId: string | undefined;
  person: Person;
  /** Null for a person the balances endpoint leaves out (inactive with a zero balance). */
  balance: PersonBalance | null;
  canEdit: boolean;
  onEdit: (person: Person) => void;
  onSettle: (person: Person) => void;
  /** The person is gone (204): the page stops showing her. */
  onDeleted: () => void;
}

const BALANCE_TONE = { 'owes-me': 'text-green-600 dark:text-green-400', 'i-owe': 'text-red-600 dark:text-red-400', settled: 'text-gray-600 dark:text-gray-400' } as const;

/** The person's detail: balance, actions and the ledger (cursor pages, running balance). */
const PersonDetail = ({ householdId, person, balance, canEdit, onEdit, onSettle, onDeleted }: PersonDetailProps) => {
  const { success, error: showError } = useToastContext();
  const { baseCurrency } = useCurrency();
  const money = (cents: number): string => formatCurrency(cents / 100, baseCurrency);

  const ledger = usePersonLedger(householdId, person.id);
  const deletePerson = useDeletePerson();
  const deleteSettlement = useDeleteSettlement();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const entries = useMemo<LedgerEntry[]>(() => ledger.data?.pages.flatMap((page) => page.data) ?? [], [ledger.data]);
  const total = ledger.data?.pages[ledger.data.pages.length - 1]?.pagination.total;
  const balanceValue = balance?.balance ?? 0;
  const status = balanceStatus(balanceValue);

  const handleDelete = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await deletePerson.mutateAsync(person.id);
      setConfirmingDelete(false);
      if (result.deleted) {
        success('Pessoa excluída.');
        onDeleted();
      } else {
        success('A pessoa tem divisões ou acertos: ela foi desativada em vez de excluída.');
      }
    } catch (err: unknown) {
      showError(getErrorMessage(err, 'Não foi possível excluir a pessoa.'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleUndo = async (id: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await deleteSettlement.mutateAsync(id);
      setUndoId(null);
      success('Acerto desfeito. A transação vinculada continua nas contas.');
    } catch (err: unknown) {
      showError(getErrorMessage(err, 'Não foi possível desfazer o acerto.'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <section aria-label={`Extrato de ${person.name}`} className="space-y-5 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-light tracking-tight text-gray-900 dark:text-white truncate">{person.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {!person.isActive && <Chip tone="gray">inativa</Chip>}
            {person.aliases.map((alias) => <Chip key={alias} tone="blue" title="Apelido">{alias}</Chip>)}
          </div>
          <p className={`mt-2 text-base ${BALANCE_TONE[status.kind]}`}>{balanceSentence(person.name, balanceValue)}</p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onSettle(person)} disabled={busy} className={BTN_PRIMARY}>
              <HandCoins className="h-4 w-4 mr-2" aria-hidden="true" />
              Registrar acerto
            </button>
            <button type="button" onClick={() => onEdit(person)} disabled={busy} className={BTN_SECONDARY}>
              <Pencil className="h-4 w-4 mr-2" aria-hidden="true" />
              Editar
            </button>
            <button type="button" onClick={() => setConfirmingDelete(true)} disabled={busy} className={BTN_SECONDARY}>
              <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
              Excluir
            </button>
          </div>
        )}
      </div>

      {confirmingDelete && (
        <div role="alertdialog" aria-label="Confirmar exclusão" className={BOX_CLS}>
          <p className="text-sm text-gray-900 dark:text-white">Excluir {person.name}?</p>
          <p className={`text-xs ${MUTED_CLS}`}>Se a pessoa tiver divisões ou acertos, ela só é desativada: o histórico e o saldo ficam.</p>
          <div className="flex gap-3">
            <button type="button" onClick={() => void handleDelete()} disabled={busy} className={BTN_DANGER}>{busy ? 'Excluindo…' : 'Excluir'}</button>
            <button type="button" onClick={() => setConfirmingDelete(false)} disabled={busy} className={BTN_SECONDARY}>Cancelar</button>
          </div>
        </div>
      )}

      {balance && (
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          {([
            ['Partes dela', balance.owedToMe],
            ['Suas partes', balance.iOwe],
            ['Ela te pagou', balance.received],
            ['Você pagou', balance.paid],
          ] as const).map(([label, value]) => (
            <div key={label}>
              <dt className={`text-xs ${MUTED_CLS}`}>{label}</dt>
              <dd className="font-medium text-gray-900 dark:text-white">{money(reaisToCents(value))}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="space-y-2">
        <h3 className={H4_CLS}>Extrato</h3>
        {ledger.isLoading && <p className={`text-sm ${MUTED_CLS}`} role="status">Carregando…</p>}
        {ledger.isError && (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className={ERROR_CLS}>{getErrorMessage(ledger.error, 'Não foi possível carregar o extrato.')}</p>
            <button type="button" onClick={() => void ledger.refetch()} className={BTN_SECONDARY_SM}>Tentar de novo</button>
          </div>
        )}
        {!ledger.isLoading && !ledger.isError && entries.length === 0 && (
          <p className={`text-sm ${MUTED_CLS}`}>Nada no extrato ainda: divida uma transação ou registre um acerto.</p>
        )}
        {entries.length > 0 && (
          <div className={TABLE_WRAP_CLS}>
            <table className="w-full text-sm">
              <thead>
                <tr className={THEAD_ROW_CLS}>
                  <th className={TH_CLS}>Data</th>
                  <th className={TH_CLS}>Descrição</th>
                  <th className={TH_CLS}>Tipo</th>
                  <th className={`${TH_CLS} text-right`}>Valor</th>
                  <th className={`${TH_CLS} text-right`}>Saldo</th>
                  <th className={TH_CLS} aria-label="Ações" />
                </tr>
              </thead>
              <tbody className={TBODY_CLS}>
                {entries.map((entry) => {
                  const signedCents = reaisToCents(entry.signed);
                  const after = balanceStatus(entry.balanceAfter);
                  return (
                    <tr key={`${entry.kind}-${entry.id}`} data-entry={entry.id}>
                      <td className={`${TD_CLS} whitespace-nowrap ${MUTED_CLS}`}>{fmtDate(entry.date)}</td>
                      <td className={`${TD_CLS} max-w-[280px]`}>
                        <p className="truncate" title={entry.description}>{entry.description}</p>
                        {entry.kind === 'share' && entry.transactionAmount !== null && (
                          <p className={`text-xs ${MUTED_CLS}`}>de {money(reaisToCents(entry.transactionAmount))}</p>
                        )}
                        {entry.note && <p className={`text-xs ${MUTED_CLS} truncate`} title={entry.note}>{entry.note}</p>}
                      </td>
                      <td className={`${TD_CLS} whitespace-nowrap`}>
                        {ledgerKindLabel(entry)}
                        {entry.source === 'import' && <span className="ml-1"><Chip tone="gray" title="Criada pela organização das divisões">importada</Chip></span>}
                      </td>
                      <td className={`${TD_CLS} whitespace-nowrap text-right ${signedCents >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {signedMoneyText(signedCents)}
                      </td>
                      <td className={`${TD_CLS} whitespace-nowrap text-right`} title={balanceSentence(person.name, entry.balanceAfter)}>
                        <span className={BALANCE_TONE[after.kind]}>{signedMoneyText(reaisToCents(entry.balanceAfter))}</span>
                      </td>
                      <td className={`${TD_CLS} whitespace-nowrap text-right`}>
                        {entry.kind === 'settlement' && canEdit && (
                          undoId === entry.id ? (
                            <span className="inline-flex flex-col items-end gap-1">
                              <span className={`text-xs ${MUTED_CLS}`}>A transação vinculada não é apagada.</span>
                              <span className="inline-flex gap-2">
                                <button type="button" onClick={() => void handleUndo(entry.id)} disabled={busy} className={LINK_CLS}>Desfazer</button>
                                <button type="button" onClick={() => setUndoId(null)} disabled={busy} className={LINK_CLS}>Cancelar</button>
                              </span>
                            </span>
                          ) : (
                            <button type="button" onClick={() => setUndoId(entry.id)} disabled={busy} className={LINK_CLS}
                              aria-label={`Desfazer o acerto de ${fmtDate(entry.date)}`}>Desfazer acerto</button>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {entries.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            {ledger.hasNextPage && (
              <button type="button" onClick={() => void ledger.fetchNextPage()} disabled={ledger.isFetchingNextPage} className={BTN_SECONDARY_SM}>
                {ledger.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
              </button>
            )}
            <span className={`text-xs ${MUTED_CLS}`}>
              {total !== undefined ? `Mostrando ${entries.length} de ${total} lançamentos` : `${entries.length} lançamentos carregados`}
            </span>
            {ledger.isFetchNextPageError && <span role="alert" className={ERROR_CLS}>Não foi possível carregar mais.</span>}
          </div>
        )}
      </div>
    </section>
  );
};

export default PersonDetail;

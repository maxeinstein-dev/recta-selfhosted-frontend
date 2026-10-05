import { useEffect, useMemo, useRef, useState } from 'react';
import { HandCoins } from 'lucide-react';
import { useAccounts } from '../../hooks/api/useAccounts';
import { useTransactions } from '../../hooks/api/useTransactions';
import { CategoryType } from '../../lib/enums';
import { loadSettlementAccount, saveSettlementAccount, useCreateSettlement } from '../../hooks/api/usePeople';
import type { Person, SettlementDirection } from '../../hooks/api/usePeople';
import { useToastContext } from '../../context/ToastContext';
import { useCurrency } from '../../context/CurrencyContext';
import { formatCurrency } from '../../utils/format';
import {
  SETTLEMENT_DIRECTION_LABEL, balanceAfterSettlement, balanceSentence, buildSettlementInput, defaultSettlementDescription, defaultSettlementDraft,
  formatCentsInput, reaisToCents, settlementAccounts, validateSettlement,
} from '../../utils/people';
import type { SettlementDraft, SettlementMode } from '../../utils/people';
import {
  BTN_PRIMARY, BTN_SECONDARY, DialogShell, ERROR_CLS, INPUT_CLS, LABEL_CLS, LINK_CLS, MUTED_CLS, fmtDate, getErrorMessage, todayIso,
} from './ui';

const MODES: Array<{ value: SettlementMode; label: (direction: SettlementDirection) => string }> = [
  { value: 'create', label: (d) => (d === 'RECEIVED' ? 'Criar a receita na conta' : 'Criar a despesa na conta') },
  { value: 'link', label: (d) => (d === 'RECEIVED' ? 'Vincular uma receita que já existe' : 'Vincular uma despesa que já existe') },
  { value: 'none', label: () => 'Só registrar o acerto (sem transação)' },
];

interface SettlementDialogProps {
  open: boolean;
  onClose: () => void;
  householdId: string | undefined;
  person: Person | null;
  /** The person's current balance in reais (> 0: she owes me); the suggested amount. */
  balance: number;
}

/** "Registrar acerto": the amount defaults to the balance; creates the real transaction, links one, or just records it. */
const SettlementDialog = ({ open, onClose, householdId, person, balance }: SettlementDialogProps) => {
  const { success, error: showError } = useToastContext();
  const { baseCurrency } = useCurrency();
  const money = (cents: number): string => formatCurrency(cents / 100, baseCurrency);

  const { data: accountsData } = useAccounts({ householdId: householdId ?? '' });
  const accounts = useMemo(() => settlementAccounts(accountsData?.accounts ?? []), [accountsData]);
  const createMutation = useCreateSettlement();

  const [draft, setDraft] = useState<SettlementDraft | null>(null);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  // The description follows the direction until the user types their own.
  const descriptionEditedRef = useRef(false);
  // Until the user picks a mode, the dialog may move from "no transaction" to "create" when the accounts arrive.
  const modeTouchedRef = useRef(false);
  const accountPickedRef = useRef(false);
  const personRef = useRef(person);
  personRef.current = person;
  const balanceRef = useRef(balance);
  balanceRef.current = balance;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Every opening starts over with the balance as the suggestion.
  useEffect(() => {
    const current = personRef.current;
    if (!open || !current) return;
    descriptionEditedRef.current = false;
    modeTouchedRef.current = false;
    accountPickedRef.current = false;
    setDraft(defaultSettlementDraft(current, balanceRef.current, todayIso(), ''));
    setSearchText(current.name);
    setDebouncedSearch(current.name);
    setFormError(null);
  }, [open, person?.id]);

  // The account: the one used last time in this household when it still exists, else the first. Picked once per
  // opening, so choosing "Selecione a conta" afterwards is respected (the button then asks for an account).
  useEffect(() => {
    if (!open) accountPickedRef.current = false;
  }, [open]);
  useEffect(() => {
    if (!open || !draft || accountPickedRef.current || accounts.length === 0) return;
    accountPickedRef.current = true;
    const remembered = loadSettlementAccount(householdId);
    const pick = accounts.some((a) => a.id === remembered) ? remembered : accounts[0].id;
    setDraft((d) => (d && !d.accountId ? { ...d, accountId: pick, mode: d.mode === 'none' && !modeTouchedRef.current ? 'create' : d.mode } : d));
  }, [open, draft, accounts, householdId]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchText), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const linking = open && draft?.mode === 'link';
  const { data: candidatesData, isFetching: loadingCandidates } = useTransactions({
    householdId: linking ? householdId : undefined,
    type: draft?.direction === 'PAID' ? CategoryType.EXPENSE : CategoryType.INCOME,
    search: debouncedSearch.trim() || undefined,
    limit: 25,
  });
  const candidates = useMemo(() => (linking ? (candidatesData?.data ?? []) : []), [linking, candidatesData]);

  const check = draft ? validateSettlement(draft) : null;
  const amountCents = check?.amountCents ?? null;
  const balanceCents = reaisToCents(balance);
  const selectedCandidate = draft ? candidates.find((c) => c.id === draft.transactionId) : undefined;
  const candidateCents = selectedCandidate ? reaisToCents(Number(selectedCandidate.amount)) : null;

  const patch = (fields: Partial<SettlementDraft>) => setDraft((d) => (d ? { ...d, ...fields } : d));

  const handleDirection = (direction: SettlementDirection) => {
    if (!person) return;
    patch({
      direction,
      transactionId: '',
      ...(descriptionEditedRef.current ? {} : { description: defaultSettlementDescription(person.name, direction) }),
    });
  };

  const handleSave = async () => {
    if (!draft || !person || !householdId || savingRef.current) return;
    const input = buildSettlementInput(draft, householdId);
    if (!input) {
      setFormError('Revise os dados do acerto.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setFormError(null);
    try {
      await createMutation.mutateAsync({ personId: person.id, input });
      if (draft.mode === 'create') saveSettlementAccount(householdId, draft.accountId);
      const created = draft.mode === 'create' ? (draft.direction === 'RECEIVED' ? ' A receita foi lançada na conta.' : ' A despesa foi lançada na conta.') : '';
      success(`Acerto registrado.${created}`);
      onClose();
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Não foi possível registrar o acerto.');
      setFormError(message);
      showError(message);
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const after = amountCents !== null && draft ? balanceAfterSettlement(balanceCents, draft.direction, amountCents) : null;

  return (
    <DialogShell open={open && !!person} onClose={onClose} canClose={!saving} titleId="settlement-dialog-title" widthClass="max-w-xl"
      title={person ? `Registrar acerto com ${person.name}` : 'Registrar acerto'}
      icon={<HandCoins className="h-5 w-5 text-gray-500 dark:text-gray-400 mr-3 flex-shrink-0" aria-hidden="true" />}>
      {person && draft && check && (
        <div className="space-y-4 min-w-0">
          <p className={`text-sm ${MUTED_CLS}`}>Saldo atual: <strong className="font-medium text-gray-900 dark:text-white">{balanceSentence(person.name, balance)}</strong></p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="settle-direction" className={LABEL_CLS}>O que aconteceu</label>
              <select id="settle-direction" value={draft.direction} disabled={saving} className={INPUT_CLS}
                onChange={(e) => handleDirection(e.target.value as SettlementDirection)}>
                {(Object.keys(SETTLEMENT_DIRECTION_LABEL) as SettlementDirection[]).map((d) => (
                  <option key={d} value={d}>{SETTLEMENT_DIRECTION_LABEL[d]}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="settle-amount" className={LABEL_CLS}>Valor</label>
              <input id="settle-amount" type="text" inputMode="decimal" value={draft.amountText} disabled={saving} className={INPUT_CLS} placeholder="0,00"
                aria-invalid={check.errors.amount ? true : undefined} onChange={(e) => patch({ amountText: e.target.value })} />
              {check.errors.amount && <p role="alert" className={`mt-1 ${ERROR_CLS}`}>{check.errors.amount}</p>}
            </div>
            <div>
              <label htmlFor="settle-date" className={LABEL_CLS}>Data</label>
              <input id="settle-date" type="date" value={draft.date} disabled={saving} className={INPUT_CLS} onChange={(e) => patch({ date: e.target.value })} />
              {check.errors.date && <p role="alert" className={`mt-1 ${ERROR_CLS}`}>{check.errors.date}</p>}
            </div>
            <div>
              <label htmlFor="settle-note" className={LABEL_CLS}>Nota</label>
              <input id="settle-note" type="text" maxLength={200} value={draft.note} disabled={saving} className={INPUT_CLS} placeholder="Opcional"
                onChange={(e) => patch({ note: e.target.value })} />
            </div>
          </div>

          {after !== null && (
            <p className={`text-xs ${MUTED_CLS}`} aria-live="polite">Saldo depois do acerto: {balanceSentence(person.name, after / 100)}.</p>
          )}

          <fieldset className="space-y-2" disabled={saving}>
            <legend className={LABEL_CLS}>Transação</legend>
            {MODES.map((mode) => (
              <label key={mode.value} className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100 cursor-pointer">
                <input type="radio" name="settle-mode" value={mode.value} checked={draft.mode === mode.value}
                  onChange={() => { modeTouchedRef.current = true; patch({ mode: mode.value, transactionId: '' }); }} />
                {mode.label(draft.direction)}
              </label>
            ))}
          </fieldset>

          {draft.mode === 'create' && (
            <div className="space-y-3">
              <div>
                <label htmlFor="settle-account" className={LABEL_CLS}>Conta</label>
                <select id="settle-account" value={draft.accountId} disabled={saving} className={INPUT_CLS}
                  aria-invalid={check.errors.account ? true : undefined} onChange={(e) => patch({ accountId: e.target.value })}>
                  <option value="">Selecione a conta</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {check.errors.account && <p role="alert" className={`mt-1 ${ERROR_CLS}`}>{check.errors.account}</p>}
              </div>
              <div>
                <label htmlFor="settle-description" className={LABEL_CLS}>Descrição da transação</label>
                <input id="settle-description" type="text" maxLength={120} value={draft.description} disabled={saving} className={INPUT_CLS}
                  onChange={(e) => { descriptionEditedRef.current = true; patch({ description: e.target.value }); }} />
              </div>
            </div>
          )}

          {draft.mode === 'link' && (
            <div className="space-y-3">
              <div>
                <label htmlFor="settle-search" className={LABEL_CLS}>Buscar a transação</label>
                <input id="settle-search" type="text" value={searchText} disabled={saving} className={INPUT_CLS} placeholder="Parte da descrição"
                  onChange={(e) => setSearchText(e.target.value)} />
              </div>
              <div>
                <label htmlFor="settle-transaction" className={LABEL_CLS}>{draft.direction === 'RECEIVED' ? 'Receita' : 'Despesa'}</label>
                <select id="settle-transaction" value={draft.transactionId} disabled={saving} className={INPUT_CLS}
                  aria-invalid={check.errors.transaction ? true : undefined} onChange={(e) => patch({ transactionId: e.target.value })}>
                  <option value="">{loadingCandidates ? 'Buscando…' : candidates.length === 0 ? 'Nenhuma transação encontrada' : 'Selecione a transação'}</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {fmtDate(String(c.date))} · {c.description} · {money(reaisToCents(Number(c.amount)))}
                    </option>
                  ))}
                </select>
                {check.errors.transaction && <p role="alert" className={`mt-1 ${ERROR_CLS}`}>{check.errors.transaction}</p>}
                <p className={`mt-1 text-xs ${MUTED_CLS}`}>Uma transação que já está ligada a outro acerto é recusada ao salvar.</p>
              </div>
              {candidateCents !== null && amountCents !== null && candidateCents !== amountCents && (
                <p className={`text-xs ${MUTED_CLS}`}>
                  A transação é de {money(candidateCents)} e o acerto de {money(amountCents)}.{' '}
                  <button type="button" className={LINK_CLS} onClick={() => patch({ amountText: formatCentsInput(candidateCents) })}>Usar o valor da transação</button>
                </p>
              )}
            </div>
          )}

          {draft.mode === 'none' && (
            <p className={`text-xs ${MUTED_CLS}`}>Só o saldo da pessoa muda; nenhuma receita ou despesa é lançada nas contas.</p>
          )}

          {formError && <p role="alert" className={ERROR_CLS}>{formError}</p>}

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} disabled={saving} className={BTN_SECONDARY}>Cancelar</button>
            <button type="button" onClick={() => void handleSave()} disabled={saving || !check.ok} className={BTN_PRIMARY}>
              {saving ? 'Registrando…' : 'Registrar acerto'}
            </button>
          </div>
        </div>
      )}
    </DialogShell>
  );
};

export default SettlementDialog;

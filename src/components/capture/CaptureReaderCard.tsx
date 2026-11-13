import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useToastContext } from '../../context/ToastContext';
import { useAccounts } from '../../hooks/api/useAccounts';
import { useCaptureCardRules, useReparseCaptures, useSaveCaptureCardRules } from '../../hooks/api/useCaptures';
import { CAPTURE_APPS, captureAccountOptions } from '../../utils/captureInbox';
import {
  MAX_CARD_RULES,
  cardRulesDraft,
  cardRulesErrors,
  isCardRulesChanged,
  reparseSummary,
  type CardRule,
  type CardRuleError,
} from '../../utils/captureReading';
import SelectCombobox from '../SelectCombobox';
import { BTN_PRIMARY, BTN_SECONDARY, ERROR_CLS, INPUT_CLS, MUTED_CLS } from '../people/ui';

const TOUCH = 'min-h-[44px]';

const ERROR_TEXT: Record<CardRuleError, string> = {
  digits: 'Use os 4 últimos dígitos do cartão.',
  account: 'Escolha a conta.',
  duplicate: 'Este final já está em outra linha do mesmo app.',
  tooMany: `No máximo ${MAX_CARD_RULES} cartões.`,
};

const APP_OPTIONS = CAPTURE_APPS.map((app) => ({ value: app.package, label: app.label }));

interface CaptureReaderCardProps {
  householdId?: string;
  /** EDITOR or more; a viewer sees the rules and cannot change them nor reprocess. */
  canEdit: boolean;
}

/**
 * Settings > Capturas, reader part (P01 D1c): read the pending captures again after a new version of the reader, and
 * the account of each card ending (a card rule wins over the (app, kind) rule above). PUT /captures/card-rules
 * replaces every rule, so the screen edits the whole list.
 */
const CaptureReaderCard = ({ householdId, canEdit }: CaptureReaderCardProps) => {
  const { success, error: showError } = useToastContext();
  const reparse = useReparseCaptures(householdId);
  const rules = useCaptureCardRules(householdId);
  const save = useSaveCaptureCardRules(householdId);
  const accounts = useAccounts({ householdId: householdId ?? '' });
  const options = captureAccountOptions(accounts.data?.accounts ?? []);

  const [draft, setDraft] = useState<CardRule[] | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [lastReparse, setLastReparse] = useState<string | null>(null);
  const serverRules = rules.data ?? [];
  const rows = draft ?? cardRulesDraft(serverRules);
  const dirty = draft !== null && isCardRulesChanged(draft, serverRules);
  const errors = cardRulesErrors(rows);
  const errorAt = (index: number) => errors.find((e) => e.index === index)?.error ?? null;
  const busy = save.isPending || rules.isPending;

  const change = (index: number, patch: Partial<CardRule>) =>
    setDraft(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const remove = (index: number) => setDraft(rows.filter((_, i) => i !== index));
  const add = () => setDraft([...rows, { package: CAPTURE_APPS[0].package, cardLast4: '', accountId: '' }]);

  const handleReparse = async () => {
    if (reparse.isPending) return;
    try {
      const result = await reparse.mutateAsync();
      const text = result ? reparseSummary(result) : 'Capturas lidas de novo.';
      setLastReparse(text);
      success(text);
    } catch {
      showError('Não foi possível reprocessar agora. Tente de novo em instantes.');
    }
  };

  const handleSave = async () => {
    if (!draft || !dirty || save.isPending) return;
    if (errors.length > 0) {
      setShowErrors(true);
      return;
    }
    try {
      await save.mutateAsync(draft);
      setDraft(null);
      setShowErrors(false);
      success('Cartões salvos.');
    } catch (error) {
      const status = (error as { status?: number } | null)?.status;
      showError(status === 404 ? 'Uma das contas não existe mais ou está inativa.' : 'Não foi possível salvar os cartões.');
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg p-4 sm:p-6 mb-4 sm:mb-6">
      <h2 className="text-lg sm:text-xl font-light tracking-tight text-gray-900 dark:text-white mb-2 flex items-center">
        <CreditCard className="h-5 w-5 mr-2" aria-hidden="true" />
        Leitura das notificações
      </h2>
      <p className={`text-sm font-light mb-4 ${MUTED_CLS}`}>
        O Recta lê valor, tipo, estabelecimento e final do cartão do texto da notificação. Avisos e promoções são
        descartados sozinhos e podem ser restaurados.
      </p>

      <section aria-labelledby="capture-reparse-title" className="mb-6">
        <h3 id="capture-reparse-title" className="text-sm font-medium text-gray-900 dark:text-white mb-1">Reprocessar</h3>
        <p className={`text-sm font-light mb-3 ${MUTED_CLS}`}>
          Lê de novo as capturas pendentes que uma versão anterior do leitor não entendeu. As confirmadas não mudam.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => void handleReparse()}
            disabled={!canEdit || reparse.isPending}
            className={`${BTN_SECONDARY} ${TOUCH} w-full sm:w-auto`}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${reparse.isPending ? 'animate-spin' : ''}`} aria-hidden="true" />
            {reparse.isPending ? 'Reprocessando…' : 'Reprocessar'}
          </button>
          <Link
            to="/app/captures?status=DISMISSED"
            className={`${TOUCH} inline-flex items-center text-sm font-light text-primary-600 dark:text-primary-400 hover:underline`}
          >
            Ver avisos descartados
          </Link>
        </div>
        {lastReparse && (
          <p role="status" className={`mt-2 text-sm font-light ${MUTED_CLS}`}>{lastReparse}</p>
        )}
      </section>

      <section aria-labelledby="capture-card-rules-title">
        <h3 id="capture-card-rules-title" className="text-sm font-medium text-gray-900 dark:text-white mb-1">
          Conta pelo final do cartão
        </h3>
        <p className={`text-sm font-light mb-3 ${MUTED_CLS}`}>
          Uma compra no cartão com este final vai para a conta escolhida. Vale antes da conta por tipo de notificação.
        </p>
        {rules.isError && <p role="alert" className={`${ERROR_CLS} mb-3`}>Não foi possível carregar os cartões.</p>}
        {!canEdit && <p className={`text-xs font-light mb-3 ${MUTED_CLS}`}>Só quem edita a casa pode mudar os cartões.</p>}

        {rows.length === 0 && !rules.isPending && (
          <p className={`text-sm font-light mb-3 ${MUTED_CLS}`}>Nenhum cartão cadastrado.</p>
        )}

        <ul className="space-y-3">
          {rows.map((row, index) => {
            const error = showErrors ? errorAt(index) : null;
            const digitsId = `card-rule-digits-${index}`;
            return (
              <li key={index} className="rounded-md border border-gray-100 dark:border-gray-800 p-3">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1.4fr)_auto] sm:items-end">
                  <div className="min-w-0">
                    <span className={`block text-xs font-light mb-1 ${MUTED_CLS}`}>App</span>
                    <SelectCombobox
                      value={row.package}
                      onValueChange={(value) => change(index, { package: value })}
                      options={APP_OPTIONS}
                      disabled={!canEdit || busy}
                    />
                  </div>
                  <div className="min-w-0">
                    <label htmlFor={digitsId} className={`block text-xs font-light mb-1 ${MUTED_CLS}`}>Final</label>
                    <input
                      id={digitsId}
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={4}
                      placeholder="0000"
                      value={row.cardLast4}
                      onChange={(event) => change(index, { cardLast4: event.target.value.replace(/\D/g, '').slice(0, 4) })}
                      disabled={!canEdit || busy}
                      aria-invalid={error === 'digits' || error === 'duplicate'}
                      className={`${INPUT_CLS} ${TOUCH} tabular-nums`}
                    />
                  </div>
                  <div className="min-w-0">
                    <span className={`block text-xs font-light mb-1 ${MUTED_CLS}`}>Conta</span>
                    <SelectCombobox
                      value={row.accountId}
                      onValueChange={(value) => change(index, { accountId: value })}
                      options={options}
                      placeholder="Escolha a conta"
                      disabled={!canEdit || busy}
                    />
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      disabled={busy}
                      aria-label={`Remover o cartão final ${row.cardLast4 || 'sem número'}`}
                      className={`${BTN_SECONDARY} ${TOUCH} sm:w-11 px-3`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      <span className="ml-2 sm:hidden">Remover</span>
                    </button>
                  )}
                </div>
                {error && <p role="alert" className={`${ERROR_CLS} mt-2`}>{ERROR_TEXT[error]}</p>}
              </li>
            );
          })}
        </ul>

        {canEdit && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={add}
              disabled={busy || rows.length >= MAX_CARD_RULES}
              className={`${BTN_SECONDARY} ${TOUCH} w-full sm:w-auto`}
            >
              <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
              Adicionar cartão
            </button>
            <div className="flex flex-col gap-2 sm:flex-row">
              {draft !== null && (
                <button
                  type="button"
                  onClick={() => { setDraft(null); setShowErrors(false); }}
                  disabled={save.isPending}
                  className={`${BTN_SECONDARY} ${TOUCH} w-full sm:w-auto`}
                >
                  Desfazer
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!dirty || save.isPending}
                className={`${BTN_PRIMARY} ${TOUCH} w-full sm:w-auto`}
              >
                {save.isPending ? 'Salvando…' : 'Salvar cartões'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

export default CaptureReaderCard;

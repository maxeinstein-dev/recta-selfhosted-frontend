import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ListChecks, RefreshCw, X } from 'lucide-react';
import { useOrganizeApply, useOrganizePreview, usePeople } from '../../hooks/api/usePeople';
import type { OrganizeApplyResult, OrganizeOptions, OrganizePreview, Person, ShareDirection } from '../../hooks/api/usePeople';
import { useToastContext } from '../../context/ToastContext';
import { useCurrency } from '../../context/CurrencyContext';
import { formatCurrency } from '../../utils/format';
import {
  DEFAULT_OPTIONS_DRAFT, addExtraAlias, buildOrganizeApply, buildOrganizeOptions, buildRegistry, emptyChoices, organizeBlocker,
  organizeFailureMessage, organizeResultLines, organizeSummary, reconcileChoices, removeExtraAlias, reviewAmountCents, setAllProposals, setAllSettlements,
  setAssignment, setProposal, setProposalAmount, setRename, setReview, setSettlement, targetOfDetected,
} from '../../utils/organizeShares';
import type { BuiltOrganize, OrganizeChoices, OrganizeOptionsDraft, PersonGroup, ResolvedReviewLine } from '../../utils/organizeShares';
import { formatCentsInput, reaisToCents } from '../../utils/people';
import {
  BOX_CLS, BTN_PRIMARY, BTN_SECONDARY, BTN_SECONDARY_SM, CHECKBOX_CLS, Chip, DialogShell, ERROR_CLS, ERROR_TOAST_MS, H4_CLS, INPUT_CLS, INPUT_SM_CLS, LABEL_CLS,
  LINK_CLS, MUTED_CLS, TABLE_WRAP_CLS, TBODY_CLS, TD_CLS, TH_CLS, THEAD_ROW_CLS, WARN_BOX_CLS, fmtDate, getErrorMessage,
} from './ui';

const DIRECTION_SHORT: Record<ShareDirection, string> = { THEY_OWE_ME: 'ela me deve', I_OWE_THEM: 'eu devo' };
const BLOCKER_ID = 'organize-apply-blocker';

type PreviewOutcome = 'ok' | 'error' | 'stale';

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

interface AliasEditorProps {
  group: PersonGroup;
  disabled: boolean;
  onAdd: (alias: string) => void;
  onRemove: (alias: string) => void;
}

/** The aliases that go with a person: the detected names are fixed, the ones typed here can be removed. */
const AliasEditor = ({ group, disabled, onAdd, onRemove }: AliasEditorProps) => {
  const [text, setText] = useState('');
  const submit = () => {
    if (!text.trim()) return;
    onAdd(text);
    setText('');
  };
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        {group.aliases.length === 0 && <span className={`text-xs ${MUTED_CLS}`}>Sem apelidos.</span>}
        {group.aliases.map((alias) => {
          const removable = group.extra.includes(alias);
          return (
            <Chip key={alias} tone="blue">
              {alias}
              {removable && (
                <button type="button" onClick={() => onRemove(alias)} disabled={disabled} aria-label={`Remover o apelido ${alias}`} className="ml-1 hover:opacity-70">
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </Chip>
          );
        })}
      </div>
      <div className="flex gap-2 max-w-sm">
        <label htmlFor={`alias-${group.key}`} className="sr-only">Novo apelido de {group.name}</label>
        <input id={`alias-${group.key}`} type="text" value={text} disabled={disabled} placeholder="Novo apelido" className={INPUT_SM_CLS}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
        <button type="button" onClick={submit} disabled={disabled || !text.trim()} className={BTN_SECONDARY_SM}>Adicionar</button>
      </div>
    </div>
  );
};

interface PeopleSectionProps {
  preview: OrganizePreview;
  choices: OrganizeChoices;
  existing: Person[];
  groups: PersonGroup[];
  disabled: boolean;
  onChoices: (fn: (c: OrganizeChoices) => OrganizeChoices) => void;
}

/** Who the detected names are: a new person each, the same new person (a nickname and the full name), or a registered one. */
const PeopleSection = ({ preview, choices, existing, groups, disabled, onChoices }: PeopleSectionProps) => {
  const registry = useMemo(() => buildRegistry(preview, choices.review), [preview, choices.review]);
  if (registry.length === 0) return null;
  const roots = registry.filter((d) => (choices.assignments[d.key] ?? '') === '');
  const activeExisting = existing.filter((p) => p.isActive);
  return (
    <section aria-labelledby="organize-people-title" className="space-y-3 min-w-0">
      <div>
        <h4 id="organize-people-title" className={H4_CLS}>Pessoas novas ({registry.length})</h4>
        <p className={`text-xs ${MUTED_CLS}`}>
          Estes nomes ainda não são pessoas cadastradas. Se dois nomes são a mesma pessoa, junte-os: o outro nome vira apelido.
        </p>
      </div>
      <div className={TABLE_WRAP_CLS}>
        <table className="w-full text-sm">
          <thead>
            <tr className={THEAD_ROW_CLS}>
              <th className={TH_CLS}>Nome encontrado</th>
              <th className={`${TH_CLS} text-right`}>Usos</th>
              <th className={TH_CLS}>É</th>
            </tr>
          </thead>
          <tbody className={TBODY_CLS}>
            {registry.map((detected) => {
              const target = targetOfDetected(registry, choices, existing, detected.key);
              const value = choices.assignments[detected.key] ?? '';
              return (
                <tr key={detected.key}>
                  <td className={TD_CLS}>{detected.name}</td>
                  <td className={`${TD_CLS} text-right`}>{detected.uses}</td>
                  <td className={TD_CLS}>
                    <select value={value} disabled={disabled} aria-label={`Quem é ${detected.name}`} className={INPUT_SM_CLS}
                      onChange={(e) => onChoices((c) => setAssignment(c, registry, detected.key, e.target.value))}>
                      <option value="">Uma pessoa nova</option>
                      {roots.filter((r) => r.key !== detected.key).map((r) => (
                        <option key={r.key} value={`new:${r.key}`}>A mesma que “{r.name}” (nova)</option>
                      ))}
                      {activeExisting.map((p) => <option key={p.id} value={`existing:${p.id}`}>A mesma que “{p.name}” (já cadastrada)</option>)}
                    </select>
                    {value !== '' && target.kind === 'new' && <span className={`block text-xs ${MUTED_CLS}`}>Junta com {target.name}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {groups.map((group) => (
          <div key={group.key} className={BOX_CLS} data-group={group.key}>
            {group.target.kind === 'new' ? (
              <div>
                <label htmlFor={`rename-${group.key}`} className={LABEL_CLS}>Nome da pessoa nova</label>
                <input id={`rename-${group.key}`} type="text" value={choices.renames[group.target.rootKey] ?? group.name} disabled={disabled} className={INPUT_SM_CLS}
                  onChange={(e) => { const rootKey = (group.target as { rootKey: string }).rootKey; onChoices((c) => setRename(c, rootKey, e.target.value)); }} />
              </div>
            ) : (
              <p className="text-sm text-gray-900 dark:text-white">Junta com a pessoa já cadastrada <strong className="font-medium">{group.name}</strong></p>
            )}
            <p className={`text-xs ${MUTED_CLS}`}>
              {group.members.length > 1 ? `${group.members.map((m) => m.name).join(' + ')} · ` : ''}
              {group.used ? (group.target.kind === 'new' ? 'será criada' : 'recebe os apelidos') : 'nada marcado usa esta pessoa: não será criada'}
            </p>
            <AliasEditor group={group} disabled={disabled} onAdd={(alias) => onChoices((c) => addExtraAlias(c, group.key, alias))}
              onRemove={(alias) => onChoices((c) => removeExtraAlias(c, group.key, alias))} />
          </div>
        ))}
      </div>
    </section>
  );
};

interface ReviewRowProps {
  item: ResolvedReviewLine;
  existing: Person[];
  registry: ReturnType<typeof buildRegistry>;
  disabled: boolean;
  money: (cents: number) => string;
  onChange: (key: string, patch: Parameters<typeof setReview>[2]) => void;
}

const ReviewRow = ({ item, existing, registry, disabled, money, onChange }: ReviewRowProps) => {
  const { line, resolution, key } = item;
  const roots = registry;
  const computed = reviewAmountCents(line, resolution);
  return (
    <tr className={resolution.include ? '' : 'bg-gray-50/60 dark:bg-gray-800/20'} data-review={key}>
      <td className="px-3 py-2 align-top">
        <input type="checkbox" checked={resolution.include} disabled={disabled} className={CHECKBOX_CLS} aria-label={`Incluir linha: ${line.description}`}
          onChange={(e) => onChange(key, { include: e.target.checked })} />
      </td>
      <td className={`${TD_CLS} min-w-[200px]`}>
        <p className="truncate max-w-[260px]" title={line.description}>{line.description}</p>
        <p className={`text-xs ${MUTED_CLS}`}>{fmtDate(line.date)} · {money(reaisToCents(line.transactionAmount))}</p>
      </td>
      <td className={`${TD_CLS} min-w-[200px]`}>
        <p className="text-xs break-words">“{line.note}”</p>
        <p className={`text-xs ${MUTED_CLS}`}>{line.reason}</p>
      </td>
      <td className={`${TD_CLS} min-w-[180px]`}>
        <select value={resolution.personRef} disabled={disabled} aria-label={`Pessoa da linha: ${line.description}`} className={INPUT_SM_CLS}
          onChange={(e) => onChange(key, { personRef: e.target.value })}>
          <option value="">Ignorar (nenhuma pessoa)</option>
          <optgroup label="Pessoas">
            {existing.filter((p) => p.isActive).map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}
          </optgroup>
          {roots.length > 0 && (
            <optgroup label="Novas encontradas">
              {roots.map((r) => <option key={r.key} value={`d:${r.key}`}>{r.name}</option>)}
            </optgroup>
          )}
          <option value="new">Nova pessoa…</option>
        </select>
        {resolution.personRef === 'new' && (
          <input type="text" value={resolution.newName} disabled={disabled} placeholder="Nome da nova pessoa" aria-label={`Nome da nova pessoa: ${line.description}`}
            className={`${INPUT_SM_CLS} mt-1`} onChange={(e) => onChange(key, { newName: e.target.value })} />
        )}
      </td>
      <td className={`${TD_CLS} min-w-[130px]`}>
        <select value={resolution.direction} disabled={disabled} aria-label={`Sentido da linha: ${line.description}`} className={INPUT_SM_CLS}
          onChange={(e) => onChange(key, { direction: e.target.value as ShareDirection })}>
          <option value="THEY_OWE_ME">Ela me deve</option>
          <option value="I_OWE_THEM">Eu devo</option>
        </select>
      </td>
      <td className={`${TD_CLS} min-w-[160px]`}>
        <div className="flex gap-1">
          <select value={resolution.mode} disabled={disabled} aria-label={`Valor ou percentual: ${line.description}`} className={`${INPUT_SM_CLS} w-16`}
            onChange={(e) => onChange(key, { mode: e.target.value as 'amount' | 'percent' })}>
            <option value="amount">R$</option>
            <option value="percent">%</option>
          </select>
          {resolution.mode === 'amount' ? (
            <input type="text" inputMode="decimal" value={resolution.amountText} disabled={disabled} placeholder="0,00" aria-label={`Valor da linha: ${line.description}`}
              className={INPUT_SM_CLS} onChange={(e) => onChange(key, { amountText: e.target.value })} />
          ) : (
            <input type="text" inputMode="decimal" value={resolution.percentText} disabled={disabled} placeholder="50" aria-label={`Percentual da linha: ${line.description}`}
              className={INPUT_SM_CLS} onChange={(e) => onChange(key, { percentText: e.target.value })} />
          )}
        </div>
        {resolution.mode === 'percent' && computed !== null && <p className={`text-xs ${MUTED_CLS}`}>= {money(computed)}</p>}
        {item.error && <p role="alert" className={ERROR_CLS}>{item.error}</p>}
      </td>
    </tr>
  );
};

interface FooterProps {
  built: BuiltOrganize;
  blocker: ReturnType<typeof organizeBlocker>;
  applying: boolean;
  refreshing: boolean;
  applyError: string | null;
  money: (cents: number) => string;
  onBack: () => void;
  onApply: () => void;
  onRefresh: () => void;
}

const Footer = ({ built, blocker, applying, refreshing, applyError, money, onBack, onApply, onRefresh }: FooterProps) => {
  const { totals } = built;
  const parts: string[] = [];
  const shares = totals.proposals.count + totals.manual.count;
  if (shares > 0) {
    const theyOwe = totals.proposals.theyOweMeCents + totals.manual.theyOweMeCents;
    const iOwe = totals.proposals.iOweThemCents + totals.manual.iOweThemCents;
    parts.push(`${shares === 1 ? '1 divisão' : `${shares} divisões`} (ela te deve ${money(theyOwe)}${iOwe > 0 ? `, você deve ${money(iOwe)}` : ''})`);
  }
  if (totals.manual.count > 0) parts.push(`${totals.manual.count === 1 ? '1 linha da revisão' : `${totals.manual.count} linhas da revisão`}`);
  if (totals.settlements.count > 0) {
    parts.push(`${totals.settlements.count === 1 ? '1 acerto' : `${totals.settlements.count} acertos`} (recebido ${money(totals.settlements.receivedCents)}${totals.settlements.paidCents > 0 ? `, pago ${money(totals.settlements.paidCents)}` : ''})`);
  }
  if (totals.newPeople > 0) parts.push(`${totals.newPeople === 1 ? '1 pessoa nova' : `${totals.newPeople} pessoas novas`}`);
  const busy = applying || refreshing;
  return (
    <div className="pt-3 border-t border-gray-200 dark:border-gray-800 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-gray-900 dark:text-white min-w-0">{parts.length > 0 ? parts.join(' · ') : 'Nada marcado.'}</p>
        <div className="flex gap-3">
          <button type="button" onClick={onBack} disabled={busy} className={BTN_SECONDARY}>
            <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
            Voltar
          </button>
          <button type="button" onClick={onApply} disabled={busy || blocker !== null} title={blocker?.message}
            aria-describedby={blocker ? BLOCKER_ID : undefined} className={BTN_PRIMARY}>
            {applying ? 'Aplicando…' : 'Aplicar'}
          </button>
        </div>
      </div>
      {blocker && blocker.code !== 'applying' && (
        <p id={BLOCKER_ID} className={`text-xs ${blocker.code === 'none-selected' ? MUTED_CLS : 'text-red-600 dark:text-red-400'}`}>{blocker.message}</p>
      )}
      {applyError && (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">{applyError}</p>
          <button type="button" onClick={onRefresh} disabled={busy} className={BTN_SECONDARY_SM}>Atualizar pré-visualização</button>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

interface OrganizeSharesDialogProps {
  open: boolean;
  onClose: () => void;
  householdId: string | undefined;
}

/** "Organizar divisões": reads the notes of the transactions and proposes people, shares and settlements; one apply. */
const OrganizeSharesDialog = ({ open, onClose, householdId }: OrganizeSharesDialogProps) => {
  const { success, showToast } = useToastContext();
  const { baseCurrency } = useCurrency();
  const money = (cents: number): string => formatCurrency(cents / 100, baseCurrency);

  const { data: peopleData } = usePeople(householdId, true);
  const existing = useMemo(() => peopleData ?? [], [peopleData]);
  const previewMutation = useOrganizePreview();
  const applyMutation = useOrganizeApply();
  const isPreviewing = previewMutation.isPending;
  const applying = applyMutation.isPending;

  const [optionsDraft, setOptionsDraft] = useState<OrganizeOptionsDraft>(DEFAULT_OPTIONS_DRAFT);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [preview, setPreview] = useState<OrganizePreview | null>(null);
  // The options the preview on screen was computed with: the apply echoes THESE, not whatever the form says now.
  const [appliedOptions, setAppliedOptions] = useState<OrganizeOptions | null>(null);
  const [choices, setChoices] = useState<OrganizeChoices>(emptyChoices());
  const [applyError, setApplyError] = useState<string | null>(null);
  const [result, setResult] = useState<OrganizeApplyResult | null>(null);
  const lastPreviewRef = useRef<OrganizePreview | null>(null);
  // Latest-wins: a preview run only touches state while it is the newest run of a mounted dialog.
  const seqRef = useRef(0);
  const mountedRef = useRef(true);
  // Synchronous twin of `applying`: guards closing and a second apply before React re-renders.
  const applyingRef = useRef(false);
  const existingRef = useRef(existing);
  existingRef.current = existing;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setOptionsDraft(DEFAULT_OPTIONS_DRAFT);
    setOptionsError(null);
    setPreview(null);
    setAppliedOptions(null);
    setChoices(emptyChoices());
    setApplyError(null);
    setResult(null);
    lastPreviewRef.current = null;
    return () => {
      seqRef.current += 1;
    };
  }, [open]);

  const built = useMemo(
    () => (preview && householdId ? buildOrganizeApply(householdId, appliedOptions ?? {}, preview, choices, existing) : null),
    [preview, householdId, appliedOptions, choices, existing],
  );
  const registry = useMemo(() => (preview ? buildRegistry(preview, choices.review) : []), [preview, choices.review]);

  const isRefreshing = isPreviewing && preview !== null;
  const blocker = preview ? organizeBlocker(built, { needsRefresh: applyError !== null, applying }) : null;

  const runPreview = async (options: OrganizeOptions): Promise<PreviewOutcome> => {
    seqRef.current += 1;
    const run = seqRef.current;
    const isCurrent = () => mountedRef.current && run === seqRef.current;
    try {
      const data = await previewMutation.mutateAsync(options);
      if (!isCurrent()) return 'stale';
      const prev = lastPreviewRef.current;
      lastPreviewRef.current = data;
      setPreview(data);
      setAppliedOptions(options);
      setApplyError(null);
      setChoices((current) => reconcileChoices(prev, current, data, existingRef.current));
      return 'ok';
    } catch (err: unknown) {
      if (!isCurrent()) return 'stale';
      showToast(getErrorMessage(err, 'Não foi possível analisar as divisões.'), 'error', ERROR_TOAST_MS);
      return 'error';
    }
  };

  const handleAnalyze = () => {
    if (!householdId) return setOptionsError('Nenhuma household selecionada.');
    const { options, error } = buildOrganizeOptions(householdId, optionsDraft);
    setOptionsError(error);
    if (!options) return;
    // Different options mean a different set: nothing carries over from the previous preview.
    lastPreviewRef.current = null;
    setChoices(emptyChoices());
    void runPreview(options);
  };

  const handleRefresh = async () => {
    if (!appliedOptions) return;
    await runPreview(appliedOptions);
  };

  const handleBack = () => {
    seqRef.current += 1;
    setPreview(null);
    setAppliedOptions(null);
    setApplyError(null);
    lastPreviewRef.current = null;
  };

  const handleApply = async () => {
    if (!built || blocker || applying || applyingRef.current) return;
    applyingRef.current = true;
    try {
      const data = await applyMutation.mutateAsync(built.payload);
      success(organizeSummary(data));
      if (mountedRef.current) setResult(data);
    } catch (err: unknown) {
      const message = organizeFailureMessage(getErrorMessage(err, 'Não foi possível aplicar as divisões.'));
      showToast(message, 'error', ERROR_TOAST_MS);
      if (mountedRef.current) setApplyError(message);
    } finally {
      applyingRef.current = false;
    }
  };

  const onChoices = (fn: (c: OrganizeChoices) => OrganizeChoices) => setChoices(fn);
  const busy = applying || isRefreshing;

  const proposals = built?.proposals ?? [];
  const settlements = built?.settlements ?? [];
  const reviewItems = built?.review ?? [];

  return (
    <DialogShell open={open} onClose={onClose} canClose={!applying} titleId="organize-dialog-title" widthClass={preview && !result ? 'max-w-6xl' : 'max-w-2xl'}
      title="Organizar divisões" icon={<ListChecks className="h-5 w-5 text-gray-500 dark:text-gray-400 mr-3 flex-shrink-0" aria-hidden="true" />}>
      {result ? (
        <div className="space-y-4 min-w-0">
          <div>
            <h4 className={H4_CLS}>Organização concluída</h4>
            {organizeResultLines(result).length > 0 ? (
              <ul className="mt-1 text-sm text-gray-900 dark:text-white list-disc list-inside space-y-1">
                {organizeResultLines(result).map((line) => <li key={line}>{line}</li>)}
              </ul>
            ) : <p className="mt-1 text-sm text-gray-900 dark:text-white">Nada foi alterado.</p>}
          </div>
          {result.warnings.length > 0 && (
            <ul className={`${WARN_BOX_CLS} max-h-64 overflow-y-auto`}>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}
          <div className="flex justify-end pt-2">
            <button type="button" onClick={onClose} autoFocus className={BTN_PRIMARY}>Fechar</button>
          </div>
        </div>
      ) : preview && built ? (
        <div className="space-y-5 min-w-0">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <p className={MUTED_CLS}>
              {preview.alreadyDone > 0 ? `${preview.alreadyDone === 1 ? '1 divisão já estava feita' : `${preview.alreadyDone} divisões já estavam feitas`}. ` : ''}
              {appliedOptions?.onlyImported ? 'Só lançamentos do importador' : 'Todos os lançamentos'}
              {appliedOptions?.startDate || appliedOptions?.endDate ? `, ${appliedOptions?.startDate ? `de ${fmtDate(appliedOptions.startDate)}` : ''}${appliedOptions?.endDate ? ` até ${fmtDate(appliedOptions.endDate)}` : ''}` : ''}.
            </p>
            {isRefreshing && (
              <span className={`inline-flex items-center gap-1 text-xs ${MUTED_CLS}`} role="status">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Atualizando…
              </span>
            )}
          </div>

          {preview.warnings.length > 0 && (
            <ul className={WARN_BOX_CLS}>{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}

          <div className={`space-y-6 min-w-0 transition-opacity ${isRefreshing ? 'opacity-60' : ''}`} aria-busy={isRefreshing}>
            {proposals.length + reviewItems.length + settlements.length === 0 && (
              <p className={`text-sm ${MUTED_CLS}`}>Nada para organizar: nenhuma nota de divisão nem acerto encontrado.</p>
            )}

            <PeopleSection preview={preview} choices={choices} existing={existing} groups={built.groups} disabled={busy} onChoices={onChoices} />

            {proposals.length > 0 && (
              <section aria-labelledby="organize-proposals-title" className="space-y-2 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 id="organize-proposals-title" className={H4_CLS}>
                    Divisões das notas ({proposals.length}) <span className={`text-xs font-normal ${MUTED_CLS}`}>{proposals.filter((p) => p.selected).length} marcadas</span>
                  </h4>
                  <div className="flex gap-3">
                    <button type="button" className={LINK_CLS} disabled={busy} onClick={() => onChoices((c) => setAllProposals(c, preview, true))}>Marcar todas</button>
                    <button type="button" className={LINK_CLS} disabled={busy} onClick={() => onChoices((c) => setAllProposals(c, preview, false))}>Desmarcar todas</button>
                  </div>
                </div>
                <p className={`text-xs ${MUTED_CLS}`}>Marcadas como o servidor sugere. Para mudar o valor de uma, digite o valor certo em “Ajustar”.</p>
                <div className={TABLE_WRAP_CLS}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={THEAD_ROW_CLS}>
                        <th className={`${TH_CLS} w-8`} aria-label="Aplicar" />
                        <th className={TH_CLS}>Transação</th>
                        <th className={TH_CLS}>Nota</th>
                        <th className={TH_CLS}>Pessoa</th>
                        <th className={`${TH_CLS} text-right`}>Valor</th>
                        <th className={TH_CLS}>Ajustar</th>
                      </tr>
                    </thead>
                    <tbody className={TBODY_CLS}>
                      {proposals.map((item) => {
                        const p = item.proposal;
                        return (
                          <tr key={p.id} className={item.selected ? '' : 'bg-gray-50/60 dark:bg-gray-800/20'} data-proposal={p.id}>
                            <td className="px-3 py-2 align-top">
                              <input type="checkbox" checked={item.selected} disabled={busy} className={CHECKBOX_CLS}
                                aria-label={`Aplicar divisão: ${p.description} (${p.person.name})`} onChange={(e) => onChoices((c) => setProposal(c, p.id, e.target.checked))} />
                            </td>
                            <td className={`${TD_CLS} min-w-[200px]`}>
                              <p className="truncate max-w-[260px]" title={p.description}>{p.description}</p>
                              <p className={`text-xs ${MUTED_CLS}`}>{fmtDate(p.date)} · {money(reaisToCents(p.transactionAmount))}</p>
                            </td>
                            <td className={`${TD_CLS} text-xs`}>“{p.note}”</td>
                            <td className={TD_CLS}>
                              {p.person.name}
                              {p.person.id === null && <span className="ml-1"><Chip tone="yellow">nova</Chip></span>}
                              <span className={`block text-xs ${MUTED_CLS}`}>{DIRECTION_SHORT[p.direction]}</span>
                            </td>
                            <td className={`${TD_CLS} whitespace-nowrap text-right`}>
                              {money(item.cents)}
                              {item.overrideCents !== null && <span className={`block text-xs ${MUTED_CLS}`}>era {money(reaisToCents(p.amount))}</span>}
                              {item.overrideCents === null && p.percent !== null && <span className={`block text-xs ${MUTED_CLS}`}>{String(p.percent).replace('.', ',')}%</span>}
                            </td>
                            <td className={`${TD_CLS} w-28`}>
                              <input type="text" inputMode="decimal" value={choices.proposalAmounts[p.id] ?? ''} disabled={busy} placeholder={formatCentsInput(reaisToCents(p.amount))}
                                aria-label={`Ajustar o valor: ${p.description} (${p.person.name})`} className={INPUT_SM_CLS}
                                onChange={(e) => onChoices((c) => setProposalAmount(c, p.id, e.target.value))} />
                              {item.error && <p role="alert" className={ERROR_CLS}>{item.error}</p>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {reviewItems.length > 0 && (
              <section aria-labelledby="organize-review-title" className="space-y-2 min-w-0">
                <h4 id="organize-review-title" className={H4_CLS}>
                  Para revisar ({reviewItems.length}) <span className={`text-xs font-normal ${MUTED_CLS}`}>{reviewItems.filter((r) => r.resolution.include).length} marcadas</span>
                </h4>
                <p className={`text-xs ${MUTED_CLS}`}>Textos livres que parecem falar de uma divisão. Escolha a pessoa e o valor (ou o percentual) das que quer registrar; as outras ficam como estão.</p>
                <div className={TABLE_WRAP_CLS}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={THEAD_ROW_CLS}>
                        <th className={`${TH_CLS} w-8`} aria-label="Incluir" />
                        <th className={TH_CLS}>Transação</th>
                        <th className={TH_CLS}>Nota</th>
                        <th className={TH_CLS}>Pessoa</th>
                        <th className={TH_CLS}>Sentido</th>
                        <th className={TH_CLS}>Valor</th>
                      </tr>
                    </thead>
                    <tbody className={TBODY_CLS}>
                      {reviewItems.map((item) => (
                        <ReviewRow key={item.key} item={item} existing={existing} registry={registry} disabled={busy} money={money}
                          onChange={(key, patch) => onChoices((c) => setReview(c, key, patch))} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {settlements.length > 0 && (
              <section aria-labelledby="organize-settlements-title" className="space-y-2 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 id="organize-settlements-title" className={H4_CLS}>
                    Acertos ({settlements.length}) <span className={`text-xs font-normal ${MUTED_CLS}`}>{settlements.filter((s) => s.selected).length} marcados</span>
                  </h4>
                  <div className="flex gap-3">
                    <button type="button" className={LINK_CLS} disabled={busy} onClick={() => onChoices((c) => setAllSettlements(c, preview, true))}>Marcar todos</button>
                    <button type="button" className={LINK_CLS} disabled={busy} onClick={() => onChoices((c) => setAllSettlements(c, preview, false))}>Desmarcar todos</button>
                  </div>
                </div>
                <p className={`text-xs ${MUTED_CLS}`}>Receitas que são o reembolso de uma pessoa: ficam como estão e ganham o vínculo com o acerto.</p>
                <div className={TABLE_WRAP_CLS}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={THEAD_ROW_CLS}>
                        <th className={`${TH_CLS} w-8`} aria-label="Aplicar" />
                        <th className={TH_CLS}>Transação</th>
                        <th className={TH_CLS}>Pessoa</th>
                        <th className={TH_CLS}>O que aconteceu</th>
                        <th className={`${TH_CLS} text-right`}>Valor</th>
                      </tr>
                    </thead>
                    <tbody className={TBODY_CLS}>
                      {settlements.map((item) => {
                        const s = item.settlement;
                        return (
                          <tr key={s.id} className={item.selected ? '' : 'bg-gray-50/60 dark:bg-gray-800/20'} data-settlement={s.id}>
                            <td className="px-3 py-2 align-top">
                              <input type="checkbox" checked={item.selected} disabled={busy} className={CHECKBOX_CLS}
                                aria-label={`Aplicar acerto: ${s.description} (${s.person.name})`} onChange={(e) => onChoices((c) => setSettlement(c, s.id, e.target.checked))} />
                            </td>
                            <td className={`${TD_CLS} min-w-[200px]`}>
                              <p className="truncate max-w-[260px]" title={s.description}>{s.description}</p>
                              <p className={`text-xs ${MUTED_CLS}`}>{fmtDate(s.date)}</p>
                            </td>
                            <td className={TD_CLS}>
                              {s.person.name}
                              {s.person.id === null && <span className="ml-1"><Chip tone="yellow">nova</Chip></span>}
                            </td>
                            <td className={TD_CLS}>{s.direction === 'RECEIVED' ? 'Ela me pagou' : 'Eu paguei a ela'}</td>
                            <td className={`${TD_CLS} whitespace-nowrap text-right`}>{money(item.cents)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>

          <Footer built={built} blocker={blocker} applying={applying} refreshing={isRefreshing} applyError={applyError} money={money}
            onBack={handleBack} onApply={() => void handleApply()} onRefresh={() => void handleRefresh()} />
        </div>
      ) : (
        <div className="space-y-4 min-w-0">
          <p className={`text-sm ${MUTED_CLS}`}>
            Lê as notas dos lançamentos (como “*Dividir com Maria”) e propõe as divisões, os acertos das receitas de reembolso e as pessoas novas.
            Nada é gravado antes de aplicar; rodar de novo não duplica.
          </p>
          <label htmlFor="organize-only-imported" className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100 cursor-pointer">
            <input id="organize-only-imported" type="checkbox" checked={optionsDraft.onlyImported} disabled={isPreviewing} className={CHECKBOX_CLS}
              onChange={(e) => setOptionsDraft((d) => ({ ...d, onlyImported: e.target.checked }))} />
            Só lançamentos do importador
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="organize-start" className={LABEL_CLS}>De (opcional)</label>
              <input id="organize-start" type="date" value={optionsDraft.startDate} disabled={isPreviewing} className={INPUT_CLS}
                onChange={(e) => setOptionsDraft((d) => ({ ...d, startDate: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="organize-end" className={LABEL_CLS}>Até (opcional)</label>
              <input id="organize-end" type="date" value={optionsDraft.endDate} disabled={isPreviewing} className={INPUT_CLS}
                onChange={(e) => setOptionsDraft((d) => ({ ...d, endDate: e.target.value }))} />
            </div>
          </div>
          {optionsError && <p role="alert" className={ERROR_CLS}>{optionsError}</p>}
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className={BTN_SECONDARY}>Cancelar</button>
            <button type="button" onClick={handleAnalyze} disabled={isPreviewing || !householdId} className={BTN_PRIMARY}>
              {isPreviewing ? 'Analisando…' : 'Analisar'}
            </button>
          </div>
        </div>
      )}
    </DialogShell>
  );
};

export default OrganizeSharesDialog;

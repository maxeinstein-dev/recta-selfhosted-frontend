import { useMemo, useState, type FormEvent } from 'react';
import { useSimulateGross, useSimulateNet } from '../../hooks/api/usePayroll';
import { SIM_MAX_LINES, compareNet, compositionOf, isExactNet, newSimLine, simBody, simulationErrorKey, validateSim, withGross, type SimComposition, type SimForm, type SimGrossResult, type SimLine, type SimMode, type SimNetResult, type SimValidation, type SimBody } from '../../utils/incomeSimulator';
import { toCents, type ItemKind } from '../../utils/income';
import { CHECKBOX_CLS, ERROR_CLS, MUTED_CLS, WARN_BOX_CLS } from '../people/ui';
import { BTN_PRIMARY_TOUCH, BTN_SECONDARY_TOUCH, CARD_CLS, EmptyLine, FIELD_CLS, Field, FormError, MUTED, Pair, SECTION_TITLE_CLS, useIncomeTexts, useMoneyCents, type IncomeTx } from './shared';

/** What the last press produced: a net (with the current net for a raise) or a gross. */
type Outcome =
  | { kind: 'net'; body: SimBody; net: SimNetResult; current: SimNetResult | null }
  | { kind: 'gross'; body: SimBody; gross: SimGrossResult };

export interface SimulatorPanelProps {
  /** The form the screen opens with (the plain simulator, or a raise prefilled from a job). */
  initial: SimForm;
  /**
   * Set only for a raise: the gross in force today, in reais (null when the job has no salary in force yet, so there is
   * nothing to compare with). Undefined for the plain simulator.
   */
  baselineGross?: number | null;
}

/**
 * The simulator: the form (gross to net or net to gross, the items, the optional advanced options) and the result. The
 * request goes on the button press only. For a raise the current net is simulated too, with the same items and options.
 */
export default function SimulatorPanel({ initial, baselineGross }: SimulatorPanelProps) {
  const tx = useIncomeTexts();
  const money = useMoneyCents();
  const netMutation = useSimulateNet();
  const grossMutation = useSimulateGross();
  const [form, setForm] = useState<SimForm>(initial);
  const [attempted, setAttempted] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const busy = netMutation.isPending || grossMutation.isPending;
  const check = useMemo(() => validateSim(form), [form]);
  const shown: SimValidation = attempted ? check : { errors: {}, lineErrors: {}, valid: true };
  const raise = baselineGross !== undefined;
  const compareWith = typeof baselineGross === 'number' ? baselineGross : null;

  const update = (patch: Partial<SimForm>) => setForm((current) => ({ ...current, ...patch }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!validateSim(form).valid) return;
    const body = simBody(form);
    setFailure(null);
    try {
      if (form.mode === 'gross') {
        const gross = await grossMutation.mutateAsync(body);
        setOutcome({ kind: 'gross', body, gross });
      } else if (compareWith !== null) {
        const [current, net] = await Promise.all([netMutation.mutateAsync(withGross(body, compareWith)), netMutation.mutateAsync(body)]);
        setOutcome({ kind: 'net', body, net, current });
      } else {
        const net = await netMutation.mutateAsync(body);
        setOutcome({ kind: 'net', body, net, current: null });
      }
    } catch (error: unknown) {
      setOutcome(null);
      setFailure(tx(simulationErrorKey(error)));
    }
  };

  const modeLabel = (mode: SimMode) => (mode === 'net' ? tx('incomeSimModeNet') : tx('incomeSimModeGross'));
  const amountLabel = form.mode === 'net' ? tx('incomeSimAmountNet') : tx('incomeSimAmountGross');

  return (
    <div className="space-y-6">
      <form onSubmit={submit} noValidate className={`${CARD_CLS} space-y-4`}>
        <div role="radiogroup" aria-label={tx('incomeSimulatorTitle')} className="flex gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
          {(['net', 'gross'] as const).map((mode) => {
            const active = form.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => update({ mode })}
                className={`min-h-[44px] flex-1 rounded-md px-3 py-2 text-sm font-light transition-colors ${active ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm' : 'text-gray-600 dark:text-gray-400'}`}
              >
                {modeLabel(mode)}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="sim-amount" label={amountLabel} error={shown.errors.amount ? tx(shown.errors.amount) : undefined}>
            <input
              id="sim-amount"
              inputMode="decimal"
              autoComplete="off"
              value={form.amount}
              onChange={(e) => update({ amount: e.target.value })}
              aria-invalid={!!shown.errors.amount}
              placeholder="0,00"
              className={FIELD_CLS}
            />
          </Field>
          <Field id="sim-date" label={tx('incomeSimDate')} hint={tx('incomeSimDateHint')} error={shown.errors.date ? tx(shown.errors.date) : undefined}>
            <input id="sim-date" type="date" value={form.date} onChange={(e) => update({ date: e.target.value })} aria-invalid={!!shown.errors.date} className={FIELD_CLS} />
          </Field>
          <Field id="sim-dependents" label={tx('incomeSimDependents')} error={shown.errors.dependents ? tx(shown.errors.dependents) : undefined}>
            <input id="sim-dependents" inputMode="numeric" value={form.dependents} onChange={(e) => update({ dependents: e.target.value })} aria-invalid={!!shown.errors.dependents} className={FIELD_CLS} />
          </Field>
          <Field id="sim-worked" label={tx('incomeSimWorkedDays')} hint={tx('incomeSimWorkedDaysHint')} error={shown.errors.workedDays ? tx(shown.errors.workedDays) : undefined}>
            <input id="sim-worked" inputMode="numeric" value={form.workedDays} onChange={(e) => update({ workedDays: e.target.value })} aria-invalid={!!shown.errors.workedDays} className={FIELD_CLS} />
          </Field>
        </div>

        <LinesEditor lines={form.lines} lineErrors={shown.lineErrors} linesError={shown.errors.lines} onChange={(lines) => update({ lines })} tx={tx} />

        <details className="rounded-md border border-gray-200 dark:border-gray-800 p-3">
          <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-medium text-gray-900 dark:text-white">{tx('incomeSimAdvanced')}</summary>
          <div className="mt-2 space-y-4">
            <p className={`text-xs ${MUTED}`}>{tx('incomeSimAdvancedHint')}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="sim-bracket" label={tx('incomeSimBracket')}>
                <select id="sim-bracket" value={form.bracketMethod} onChange={(e) => update({ bracketMethod: e.target.value as SimForm['bracketMethod'] })} className={FIELD_CLS}>
                  <option value="DEDUCTION">{tx('incomeSimBracketDeduction')}</option>
                  <option value="DIRECT">{tx('incomeSimBracketDirect')}</option>
                </select>
              </Field>
              <Field id="sim-rounding" label={tx('incomeSimRounding')}>
                <select id="sim-rounding" value={form.rounding} onChange={(e) => update({ rounding: e.target.value as SimForm['rounding'] })} className={FIELD_CLS}>
                  <option value="TRUNCATE">{tx('incomeSimRoundTruncate')}</option>
                  <option value="ROUND">{tx('incomeSimRoundRound')}</option>
                </select>
              </Field>
            </div>
          </div>
        </details>

        <FormError text={failure} />
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={BTN_PRIMARY_TOUCH}>{busy ? tx('incomeSimSubmitting') : tx('incomeSimSubmit')}</button>
        </div>
      </form>

      {raise && baselineGross === null && <p className={`text-sm ${MUTED}`}>{tx('incomeSimCompareNoBaseline')}</p>}
      {raise && form.mode === 'gross' && compareWith !== null && <p className={`text-sm ${MUTED}`}>{tx('incomeSimCompareOnlyNet')}</p>}
      {outcome && <SimulatorResult outcome={outcome} money={money} tx={tx} />}
    </div>
  );
}

// ---- Lines (verbas) -----------------------------------------------------------------------------------------------

let lineSeq = 0;
const nextLineKey = (): string => {
  lineSeq += 1;
  return `line-${Date.now().toString(36)}-${lineSeq}`;
};

function LinesEditor({
  lines,
  lineErrors,
  linesError,
  onChange,
  tx,
}: {
  lines: SimLine[];
  lineErrors: SimValidation['lineErrors'];
  linesError?: SimValidation['errors']['lines'];
  onChange: (lines: SimLine[]) => void;
  tx: IncomeTx;
}) {
  const patch = (key: string, change: Partial<SimLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...change } : l)));
  return (
    <fieldset className="space-y-3">
      <legend className={SECTION_TITLE_CLS}>{tx('incomeSimLinesTitle')}</legend>
      <p className={`text-xs ${MUTED}`}>{tx('incomeSimLinesHint')}</p>
      {lines.length === 0 && <EmptyLine>{tx('incomeSimNoLines')}</EmptyLine>}
      {lines.map((line, index) => {
        const errors = lineErrors[line.key] ?? {};
        const n = index + 1;
        return (
          <div key={line.key} className="grid grid-cols-1 gap-3 rounded-md border border-gray-100 dark:border-gray-800 p-3 sm:grid-cols-6">
            <div className="min-w-0 sm:col-span-2">
              <label htmlFor={`sim-line-${line.key}-label`} className="block text-xs text-gray-600 dark:text-gray-400">{tx('incomeSimLineLabel')} {n}</label>
              <input id={`sim-line-${line.key}-label`} value={line.label} onChange={(e) => patch(line.key, { label: e.target.value })} aria-invalid={!!errors.label} className={FIELD_CLS} />
              {errors.label && <p role="alert" className={`mt-1 ${ERROR_CLS}`}>{tx(errors.label)}</p>}
            </div>
            <div className="min-w-0">
              <label htmlFor={`sim-line-${line.key}-amount`} className="block text-xs text-gray-600 dark:text-gray-400">{tx('incomeSimLineAmount')} {n}</label>
              <input id={`sim-line-${line.key}-amount`} inputMode="decimal" value={line.amount} onChange={(e) => patch(line.key, { amount: e.target.value })} aria-invalid={!!errors.amount} className={FIELD_CLS} />
              {errors.amount && <p role="alert" className={`mt-1 ${ERROR_CLS}`}>{tx(errors.amount)}</p>}
            </div>
            <div className="min-w-0">
              <label htmlFor={`sim-line-${line.key}-kind`} className="block text-xs text-gray-600 dark:text-gray-400">{tx('incomeSimLineKind')} {n}</label>
              <select id={`sim-line-${line.key}-kind`} value={line.kind} onChange={(e) => patch(line.key, { kind: e.target.value as ItemKind })} className={FIELD_CLS}>
                <option value="EARNING">{tx('incomeSimKindEarning')}</option>
                <option value="DEDUCTION">{tx('incomeSimKindDeduction')}</option>
              </select>
            </div>
            <div className="flex items-end sm:justify-end">
              <button type="button" onClick={() => onChange(lines.filter((l) => l.key !== line.key))} className={BTN_SECONDARY_TOUCH}>{tx('incomeSimLineRemove')}</button>
            </div>
            {line.kind === 'EARNING' && (
              <div className="flex flex-col gap-2 sm:col-span-6 sm:flex-row sm:flex-wrap sm:gap-4">
                {(
                  [
                    ['inInssBase', 'incomeSimBaseInss'],
                    ['inIrrfBase', 'incomeSimBaseIrrf'],
                    ['inFgtsBase', 'incomeSimBaseFgts'],
                  ] as const
                ).map(([field, key]) => (
                  <label key={field} className="inline-flex min-h-[44px] items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input type="checkbox" className={CHECKBOX_CLS} checked={line[field]} onChange={(e) => patch(line.key, { [field]: e.target.checked } as Partial<SimLine>)} />
                    {tx(key)}
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {linesError && <p role="alert" className={ERROR_CLS}>{tx(linesError)}</p>}
      <button
        type="button"
        disabled={lines.length >= SIM_MAX_LINES}
        onClick={() => onChange([...lines, newSimLine(nextLineKey())])}
        className={BTN_SECONDARY_TOUCH}
      >
        {tx('incomeSimLineAdd')}
      </button>
    </fieldset>
  );
}

// ---- Result --------------------------------------------------------------------------------------------------------

type Money = (cents: number) => string;

function SimulatorResult({ outcome, money, tx }: { outcome: Outcome; money: Money; tx: IncomeTx }) {
  const payroll = outcome.kind === 'net' ? outcome.net.payroll : outcome.gross.payroll;
  const comp = compositionOf(payroll);
  return (
    <section aria-label={tx('incomeSimResultTitle')} className="space-y-6">
      {outcome.kind === 'gross' && <GrossSummary result={outcome.gross} body={outcome.body} money={money} tx={tx} />}
      {outcome.kind === 'net' && outcome.current && (
        <RaiseComparison current={compositionOf(outcome.current.payroll).netCents} simulated={comp.netCents} money={money} tx={tx} />
      )}
      <div className={`${CARD_CLS} space-y-4`}>
        <h2 className={SECTION_TITLE_CLS}>{tx('incomeSimResultTitle')}</h2>
        <Composition comp={comp} body={outcome.body} money={money} tx={tx} />
      </div>
    </section>
  );
}

function GrossSummary({ result, body, money, tx }: { result: SimGrossResult; body: SimBody; money: Money; tx: IncomeTx }) {
  const differenceCents = toCents(result.difference);
  const exact = isExactNet(differenceCents);
  return (
    <div className={`${CARD_CLS} space-y-3`}>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Pair label={tx('incomeSimFoundGross')}>
          <span className="text-base font-medium">{money(toCents(result.gross))}</span>
        </Pair>
        <Pair label={tx('incomeSimTargetNet')}>{money(toCents(body.targetNet ?? 0))}</Pair>
        <Pair label={tx('incomeSimReachedNet')}>{money(toCents(result.payroll.net))}</Pair>
      </dl>
      <p className={`text-sm ${exact ? MUTED : 'text-amber-700 dark:text-amber-300'}`}>
        {exact ? tx('incomeSimExact') : tx('incomeSimNotExact', { amount: money(differenceCents) })}
      </p>
    </div>
  );
}

function RaiseComparison({ current, simulated, money, tx }: { current: number; simulated: number; money: Money; tx: IncomeTx }) {
  const cmp = compareNet(current, simulated);
  const sign = cmp.differenceCents > 0 ? '+' : '';
  return (
    <div className={`${CARD_CLS} space-y-3`}>
      <h2 className={SECTION_TITLE_CLS}>{tx('incomeSimCompareTitle')}</h2>
      <p className={`text-xs ${MUTED}`}>{tx('incomeSimCompareHint')}</p>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Pair label={tx('incomeSimCompareCurrent')}>{money(cmp.currentCents)}</Pair>
        <Pair label={tx('incomeSimCompareSimulated')}>{money(cmp.simulatedCents)}</Pair>
        <Pair label={tx('incomeSimCompareDiff')}>
          <span className={`font-medium ${cmp.differenceCents < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {sign}
            {money(cmp.differenceCents)}
          </span>
        </Pair>
      </dl>
    </div>
  );
}

function Composition({ comp, body, money, tx }: { comp: SimComposition; body: SimBody; money: Money; tx: IncomeTx }) {
  const earnings = body.items.filter((i) => i.kind === 'EARNING');
  const deductions = body.items.filter((i) => i.kind === 'DEDUCTION');
  const deductionName = comp.irrf.deduction === 'legal' ? tx('incomeSimDeductionLegal') : tx('incomeSimDeductionSimplified');
  return (
    <div className="space-y-4">
      {comp.projection && <p role="note" className={WARN_BOX_CLS}>{tx('incomeWarnProjection')}</p>}
      {comp.warningKeys.filter((key) => key !== 'incomeWarnProjection').map((key) => (
        <p key={key} className={`text-sm ${MUTED}`}>{tx(key)}</p>
      ))}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Pair label={tx('incomeSimSalary')}>{money(comp.salaryCents)}</Pair>
        <Pair label={tx('incomeSimExtra')}>{money(comp.extraEarningsCents)}</Pair>
        <Pair label={tx('incomeSimGrossTotal')}>{money(comp.grossCents)}</Pair>
        <Pair label={tx('incomeSimInssBase')}>{money(comp.inss.baseCents)}</Pair>
        <Pair label={tx('incomeSimInss')}>{money(comp.inss.valueCents)}</Pair>
        <Pair label={tx('incomeSimIrrfIncome')}>{money(comp.irrf.incomeCents)}</Pair>
        <Pair label={tx('incomeSimIrrfBase')}>{money(comp.irrf.baseCents)}</Pair>
        <Pair label={tx('incomeSimIrrf')}>{money(comp.irrf.valueCents)}</Pair>
        <Pair label={tx('incomeSimDeduction')}>{tx('incomeSimDeductionValue', { kind: deductionName, amount: money(comp.irrf.deductionCents) })}</Pair>
        <Pair label={tx('incomeSimTaxBefore')}>{money(comp.irrf.taxBeforeReductionCents)}</Pair>
        <Pair label={tx('incomeSimReduction')}>{money(comp.irrf.reductionCents)}</Pair>
        <Pair label={tx('incomeSimFixedDeductions')}>{money(comp.fixedDeductionsCents)}</Pair>
        <Pair label={tx('incomeSimFgts')}>{money(comp.fgtsCents)}</Pair>
      </dl>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ItemList title={tx('incomeSimEarnings')} rows={earnings} money={money} tx={tx} />
        <ItemList title={tx('incomeSimDeductions')} rows={deductions} money={money} tx={tx} />
      </div>
      <p className="text-base">
        <span className={MUTED_CLS}>{tx('incomeSimNet')}: </span>
        <span className="text-xl font-medium text-emerald-600 dark:text-emerald-400">{money(comp.netCents)}</span>
      </p>
      <p className={`text-xs ${MUTED}`}>{tx('incomeSimTables', { inss: comp.tables.inss, irrf: comp.tables.irrf, fgts: comp.tables.fgts })}</p>
    </div>
  );
}

function ItemList({ title, rows, money, tx }: { title: string; rows: SimBody['items']; money: Money; tx: IncomeTx }) {
  return (
    <div className="min-w-0">
      <h3 className={`mb-1 text-xs font-medium ${MUTED}`}>{title}</h3>
      {rows.length === 0 ? (
        <EmptyLine>{tx('incomeNone')}</EmptyLine>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map((row, index) => (
            <li key={`${row.label}-${index}`} className="flex items-start justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0 break-words text-gray-900 dark:text-white">{row.label}</span>
              <span className="whitespace-nowrap text-gray-900 dark:text-white">{money(toCents(row.amount))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


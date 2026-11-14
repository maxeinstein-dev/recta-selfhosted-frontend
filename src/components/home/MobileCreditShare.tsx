import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useSpendingByMethod } from '../../hooks/api/useSpendingByMethod';
import { creditShareLine } from '../../utils/creditVsDebit';

const CARD = 'rounded-2xl border border-rc-line bg-rc-card p-4';

/**
 * Início below 768 px (P18): how much of the month's spending went on the credit card, with the three months before
 * it, so the move to debit and Pix shows month by month. By the own share (what others owe on a purchase is left out),
 * over the same spending as the General budget. Hidden while it loads, on an error and when nothing was spent: it is a
 * secondary line, the rest of the Início does not wait for it.
 */
export default function MobileCreditShare({ householdId, monthKey }: { householdId: string | undefined; monthKey: string }) {
  const query = useSpendingByMethod({ householdId, to: monthKey, months: 4 });
  const line = creditShareLine(query.data, 'pt-BR');
  if (!line) return null;
  const before = line.previous[line.previous.length - 1];

  return (
    <section className={CARD} aria-labelledby="home-credit-share-title" data-testid="home-credit-share">
      <h2 id="home-credit-share-title" className="text-sm font-semibold text-rc-ink">No cartão de crédito</h2>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-rc-ink">{line.current.percent}</span>
        <span className="text-sm text-rc-ink2">do que você gastou em {line.current.label}</span>
      </div>
      {line.trend && line.trend !== 'same' && before && (
        <p className={`mt-1 flex items-center gap-1 text-xs font-medium ${line.trend === 'down' ? 'text-rc-green' : 'text-rc-amber'}`}>
          {line.trend === 'down' ? <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />}
          {line.trend === 'down' ? `Menos que em ${before.label} (${before.percent})` : `Mais que em ${before.label} (${before.percent})`}
        </p>
      )}
      {line.previous.length > 0 && (
        <p className="mt-2 text-xs text-rc-ink2 tabular-nums">
          {line.previous.map((p) => `${p.label} ${p.percent}`).join(' · ')}
        </p>
      )}
    </section>
  );
}

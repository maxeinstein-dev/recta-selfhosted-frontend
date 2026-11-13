import { useNavigate } from 'react-router-dom';
import { useIncomeSplit } from '../../hooks/api/useCategoryGroups';
import type { CentsFormatter } from '../../utils/incomeSplit';
import { HousingShare, IncomeSplitBar } from './IncomeSplitViews';

const CARD = 'rounded-2xl border border-rc-line bg-rc-card p-4';

/**
 * Início below 768 px (P05, R6): where the month's income goes, by spending group, and the housing share against 30%.
 * The month of the header drives it. The big number of the Início (the R5 leftover) is not touched: this card measures
 * against the expected income and says so.
 */
export default function MobileIncomeSplit({ householdId, monthKey, money }: { householdId: string | undefined; monthKey: string; money: CentsFormatter }) {
  const navigate = useNavigate();
  const query = useIncomeSplit({ householdId, month: monthKey });
  const toGroups = () => navigate('/app/settings#grupos-de-gasto');

  return (
    <>
      <section className={CARD} aria-labelledby="home-split-title" data-testid="home-income-split">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="home-split-title" className="text-sm font-semibold text-rc-ink">Para onde vai a renda</h2>
          <button type="button" onClick={toGroups} className="min-h-[44px] px-2 text-xs font-medium text-rc-accentInk">Grupos</button>
        </div>
        {query.isPending && householdId ? (
          <p role="status" className="mt-2 text-sm text-rc-ink2">Carregando…</p>
        ) : query.isError || !query.data ? (
          <div role="alert" className="mt-2 space-y-2">
            <p className="text-sm text-rc-red">Não foi possível carregar a divisão da renda.</p>
            <button type="button" onClick={() => void query.refetch()} className="min-h-[44px] rounded-xl border border-rc-line px-4 text-sm font-medium text-rc-ink">Tentar de novo</button>
          </div>
        ) : (
          <div className="mt-1">
            <IncomeSplitBar split={query.data} money={money} />
          </div>
        )}
      </section>

      {query.data && (
        <section className={CARD} aria-labelledby="home-housing-title" data-testid="home-housing">
          <h2 id="home-housing-title" className="mb-2 text-sm font-semibold text-rc-ink">Moradia</h2>
          <HousingShare split={query.data} money={money} onMarkHousing={toGroups} />
        </section>
      )}
    </>
  );
}

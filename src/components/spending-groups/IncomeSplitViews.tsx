import { housingCard, incomeBar, incomeBasisText, incomeLegend, type CentsFormatter, type IncomeSplit } from '../../utils/incomeSplit';

/**
 * The income bar with its legend (P05): one segment per spending group plus the leftover, drawn from the values the
 * server sends. Shared by the mobile Início and the desktop dashboard widget; the numbers are never recalculated here.
 */
export function IncomeSplitBar({ split, money }: { split: IncomeSplit; money: CentsFormatter }) {
  const bar = incomeBar(split);
  const legend = incomeLegend(split, money);
  const described = bar.segments.map((s) => `${s.label} ${money(s.cents)}`).join(', ');
  return (
    <div data-testid="income-split">
      <p className="text-xs text-rc-ink2" data-testid="income-split-basis">{incomeBasisText(split, money)}</p>
      {bar.empty ? (
        <p className="mt-3 text-sm text-rc-ink2">Nenhuma despesa no mês ainda.</p>
      ) : (
        <div
          role="img"
          aria-label={`Divisão da renda: ${described}`}
          className="mt-3 flex h-4 w-full overflow-hidden rounded-full bg-rc-card2"
          data-testid="income-split-bar"
        >
          {bar.segments.map((s) => (
            <span key={s.key} className="h-full" style={{ width: `${s.width}%`, backgroundColor: s.color }} data-segment={s.key} />
          ))}
        </div>
      )}
      {bar.overCents > 0 && (
        <p className="mt-2 text-xs font-medium text-rc-red" data-testid="income-split-over">
          As despesas passam da renda esperada em {money(bar.overCents)}.
        </p>
      )}
      <ul className="mt-3 space-y-1.5" aria-label="Legenda da divisão da renda">
        {legend.map((item) => (
          <li key={item.key} className="flex items-baseline gap-2 text-sm" data-testid={`income-split-legend-${item.key}`}>
            <span className="mt-1 inline-block h-2.5 w-2.5 shrink-0 self-start rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className={`block truncate ${item.key === 'leftover' ? 'font-semibold text-rc-ink' : 'text-rc-ink'}`}>{item.label}</span>
              {item.committed && <span className="block text-xs text-rc-amber">{item.committed}</span>}
            </span>
            <span className="tabular-nums text-rc-ink">{item.amount}</span>
            <span className="w-10 text-right tabular-nums text-xs text-rc-ink2">{item.share}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Housing against the 30% reference; an invitation to mark a group when none is housing. */
export function HousingShare({ split, money, onMarkHousing }: { split: IncomeSplit; money: CentsFormatter; onMarkHousing: () => void }) {
  const card = housingCard(split, money);
  if (card.kind === 'invite') {
    return (
      <div data-testid="housing-invite">
        <p className="text-sm text-rc-ink2">Marque o grupo da moradia (aluguel, condomínio, luz, internet, financiamento) para ver quanto da renda vai para ela.</p>
        <button type="button" onClick={onMarkHousing} className="mt-2 min-h-[44px] rounded-xl border border-rc-line px-4 text-sm font-medium text-rc-accentInk">
          Marcar grupo da moradia
        </button>
      </div>
    );
  }
  if (card.kind === 'noIncome') {
    return (
      <p className="text-sm text-rc-ink" data-testid="housing-no-income">
        <span className="font-semibold tabular-nums">{card.amount}</span> no mês. Sem renda esperada, não há percentual.
      </p>
    );
  }
  return (
    <div data-testid="housing-share">
      <p className="text-sm text-rc-ink">
        <span className={`text-2xl font-bold tabular-nums ${card.over ? 'text-rc-red' : 'text-rc-ink'}`}>{card.share}</span>
        <span className="ml-2 text-rc-ink2">da renda esperada ({card.amount})</span>
      </p>
      <div className="relative mt-2 h-2 w-full rounded-full bg-rc-card2" role="img" aria-label={`Moradia ${card.share} da renda; referência ${card.reference}`}>
        <span className={`absolute inset-y-0 left-0 rounded-full ${card.over ? 'bg-rc-red' : 'bg-rc-accent'}`} style={{ width: `${card.fill}%` }} />
        <span className="absolute -inset-y-1 w-0.5 bg-rc-ink" style={{ left: `${card.referenceAt}%` }} aria-hidden="true" />
      </div>
      <p className="mt-1 text-xs text-rc-ink2">
        {card.over ? `Acima da referência de ${card.reference} da renda.` : `Dentro da referência de ${card.reference} da renda.`}
      </p>
    </div>
  );
}

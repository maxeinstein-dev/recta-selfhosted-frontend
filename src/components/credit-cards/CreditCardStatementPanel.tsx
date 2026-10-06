import { useState } from 'react';
import { ChevronDown, ChevronUp, CalendarClock } from 'lucide-react';
import { formatCurrency } from '../../utils/format';
import { StatementView } from '../../utils/invoiceStatement';

interface CreditCardStatementPanelProps {
  view: StatementView;
  /** Month name for the title, e.g. "novembro". */
  monthName: string;
  baseCurrency: string;
  className?: string;
}

const STATE_STYLES: Record<StatementView['state'], string> = {
  open: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  closed: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  paid: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
};

/**
 * Statement panel of the credit card page: what the bank charges for this invoice, what is still open from earlier ones,
 * the payments and the total debt, with the dates and, for an invoice that has not closed yet, the recurring charges
 * still expected before closing.
 */
export const CreditCardStatementPanel = ({ view, monthName, baseCurrency, className = '' }: CreditCardStatementPanelProps) => {
  const [forecastOpen, setForecastOpen] = useState(false);
  const money = (value: number) => formatCurrency(value, baseCurrency);
  const forecast = view.forecast;

  return (
    <section
      aria-label={`Fatura de ${monthName}`}
      data-testid="statement-panel"
      className={`rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/40 p-4 sm:p-5 ${className}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-4">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">Fatura de {monthName}</h3>
        <span
          data-testid="statement-state"
          className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATE_STYLES[view.state]}`}
        >
          {view.stateLabel}
        </span>
        {view.closingSentence && (
          <span data-testid="statement-dates" className="text-xs font-light text-gray-500 dark:text-gray-400">
            {view.closingSentence}
          </span>
        )}
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-light text-gray-600 dark:text-gray-300">Valor da fatura</dt>
          <dd data-testid="statement-total" className="font-medium text-gray-900 dark:text-white tabular-nums">
            {money(view.statementTotal)}
          </dd>
        </div>
        {view.outstanding !== 0 && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="font-light text-gray-600 dark:text-gray-300">Em aberto de faturas anteriores</dt>
            <dd data-testid="statement-outstanding" className="font-light text-gray-900 dark:text-white tabular-nums">
              {money(view.outstanding)}
            </dd>
          </div>
        )}
        {view.payments > 0 && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="font-light text-gray-600 dark:text-gray-300">Pagamentos</dt>
            <dd data-testid="statement-payments" className="font-light text-green-600 dark:text-green-400 tabular-nums">
              -{money(view.payments)}
            </dd>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-4 pt-2 border-t border-gray-200 dark:border-gray-700">
          <dt className="font-medium text-gray-900 dark:text-white">Dívida total</dt>
          <dd data-testid="statement-debt" className="text-base font-semibold text-gray-900 dark:text-white tabular-nums">
            {money(view.debtTotal)}
          </dd>
        </div>
      </dl>

      {forecast && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700" data-testid="statement-forecast">
          <button
            type="button"
            onClick={() => setForecastOpen((open) => !open)}
            aria-expanded={forecastOpen}
            className="w-full flex items-center justify-between gap-3 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
              <CalendarClock className="h-4 w-4 text-gray-400" aria-hidden="true" />
              Previsto até o fechamento
              <span className="font-light text-gray-500 dark:text-gray-400">
                ({forecast.items.length} {forecast.items.length === 1 ? 'recorrência' : 'recorrências'})
              </span>
            </span>
            <span className="flex items-center gap-2 text-sm tabular-nums text-gray-900 dark:text-white">
              {money(forecast.total)}
              {forecastOpen ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
            </span>
          </button>

          {forecastOpen && (
            <ul className="mt-3 space-y-1.5" data-testid="statement-forecast-items">
              {forecast.items.map((item) => (
                <li key={item.key} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-light text-gray-600 dark:text-gray-300">
                    <span className="tabular-nums text-gray-400 dark:text-gray-500 mr-2">{item.dateLabel}</span>
                    {item.description}
                    {item.estimated && <span className="ml-1 text-xs text-gray-400" title="Valor estimado: acompanha o último lançamento">(estimado)</span>}
                  </span>
                  <span className="tabular-nums font-light text-gray-900 dark:text-white">{money(item.amount)}</span>
                </li>
              ))}
            </ul>
          )}

          <p data-testid="statement-expected" className="mt-3 text-sm font-light text-gray-600 dark:text-gray-300">
            Já lançado <span className="tabular-nums">{money(forecast.posted)}</span> + previsto{' '}
            <span className="tabular-nums">{money(forecast.total)}</span> ={' '}
            <span className="font-medium text-gray-900 dark:text-white tabular-nums">{money(forecast.expectedClosingTotal)}</span> ao fechar
          </p>
        </div>
      )}
    </section>
  );
};

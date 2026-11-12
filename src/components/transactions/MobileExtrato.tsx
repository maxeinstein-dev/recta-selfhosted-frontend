import { useState, type ComponentType, type ReactNode } from 'react';
import { ChevronDown, Download, Search, Upload } from 'lucide-react';
import type { Transaction } from '../../types';
import { SHORT_FILTERS, type ShortFilter } from '../../utils/extratoMobile';
import { TransactionFilters, type TransactionFiltersProps } from './TransactionFilters';

const TOUCH = 'min-h-[44px]';

/** One row of the Extrato, already formatted by the page (the page owns the business rules). */
export interface ExtratoRowView {
  id: string;
  name: string;
  meta: string;
  icon: ComponentType<{ className?: string }>;
  amountText: string;
  positive: boolean;
  transaction: Transaction;
}

/** A day group: its header and the rows of the day. */
export interface ExtratoDayView {
  dayKey: string;
  label: string;
  totalText: string;
  totalPositive: boolean;
  rows: ExtratoRowView[];
}

export interface MobileExtratoProps {
  /** Capture box, rendered on top of the list (the page passes it in). */
  captureBox: ReactNode;
  /** The due-to-confirm panel of the page, shown above the search. */
  dueBox: ReactNode;
  searchInput: string;
  onSearchChange: (value: string) => void;
  shortFilter: ShortFilter;
  onShortFilterChange: (filter: ShortFilter) => void;
  days: ExtratoDayView[];
  loading: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onOpen: (transaction: Transaction) => void;
  onExport: () => void;
  onImport: () => void;
  filters: Omit<TransactionFiltersProps, 'searchInput' | 'onSearchChange' | 'inSheet'>;
}

/**
 * The Extrato of the mobile shell: caixa de capturas, busca, pílulas, "Mais filtros" (the page's own filters, plus
 * export and import, which the desktop has as buttons) and the list by day. Shown below 768 px.
 */
const MobileExtrato = ({
  captureBox,
  dueBox,
  searchInput,
  onSearchChange,
  shortFilter,
  onShortFilterChange,
  days,
  loading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onOpen,
  onExport,
  onImport,
  filters,
}: MobileExtratoProps) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const empty = !loading && days.length === 0;

  return (
    <div className="space-y-0">
      <h1 className="text-2xl font-light tracking-tight text-rc-ink">Extrato</h1>

      {dueBox}
      {captureBox}

      <label className={`mt-3 flex min-h-[48px] items-center gap-2 rounded-2xl border border-rc-line bg-rc-card px-3 text-rc-ink3`}>
        <Search className="h-5 w-5 flex-none" aria-hidden="true" />
        <span className="sr-only">Buscar lançamento</span>
        <input
          type="search"
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar lançamento"
          aria-label="Buscar lançamento"
          className={`${TOUCH} min-w-0 flex-1 border-0 bg-transparent text-base text-rc-ink placeholder:text-rc-ink3 focus:outline-none`}
        />
      </label>

      <div className="-mx-4 mt-2.5 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Filtros rápidos">
        {SHORT_FILTERS.map((f) => {
          const pressed = shortFilter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={pressed}
              onClick={() => onShortFilterChange(f.id)}
              className={`${TOUCH} flex-none rounded-full border px-3.5 text-sm font-medium whitespace-nowrap ${
                pressed ? 'border-rc-ink bg-rc-ink text-rc-bg' : 'border-rc-line bg-rc-card text-rc-ink2'
              }`}
            >
              {f.label}
            </button>
          );
        })}
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-controls="extrato-mais-filtros"
          onClick={() => setMoreOpen((v) => !v)}
          className={`${TOUCH} flex flex-none items-center gap-1 rounded-full border border-rc-line bg-rc-card px-3.5 text-sm font-medium whitespace-nowrap text-rc-ink2`}
        >
          Mais filtros
          <ChevronDown className={`h-4 w-4 transition-transform ${moreOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </div>

      {moreOpen && (
        <div id="extrato-mais-filtros" className="mt-3 space-y-3 rounded-2xl border border-rc-line bg-rc-card p-3">
          <TransactionFilters {...filters} searchInput={searchInput} onSearchChange={onSearchChange} inSheet />
          <div className="flex gap-2">
            <button type="button" onClick={onExport} className={`${TOUCH} flex flex-1 items-center justify-center gap-2 rounded-xl border border-rc-line text-sm font-medium text-rc-ink`}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Exportar CSV
            </button>
            <button type="button" onClick={onImport} className={`${TOUCH} flex flex-1 items-center justify-center gap-2 rounded-xl border border-rc-line text-sm font-medium text-rc-ink`}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              Importar arquivos
            </button>
          </div>
        </div>
      )}

      <div className="mt-2" aria-live="polite">
        {loading && <p role="status" className="py-6 text-center text-sm text-rc-ink3">Carregando lançamentos…</p>}
        {empty && <p className="py-8 text-center text-sm text-rc-ink2">Nenhum lançamento com esse filtro neste mês.</p>}
      </div>

      {!loading &&
        days.map((day) => (
          <section key={day.dayKey} aria-label={day.label}>
            <div className="mt-4 flex items-baseline justify-between gap-2 px-0.5 text-[13px] text-rc-ink2">
              <b className="font-semibold capitalize text-rc-ink">{day.label}</b>
              <span className={`font-semibold tabular-nums ${day.totalPositive ? 'text-rc-green' : ''}`}>{day.totalText}</span>
            </div>
            <ul className="mt-1 rounded-2xl bg-rc-card px-2">
              {day.rows.map((row, index) => {
                const Icon = row.icon;
                return (
                  <li key={row.id} className={index > 0 ? 'border-t border-rc-line' : ''}>
                    <button
                      type="button"
                      onClick={() => onOpen(row.transaction)}
                      className="flex min-h-[56px] w-full min-w-0 items-center gap-3 py-2 text-left"
                    >
                      <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-full ${row.positive ? 'bg-rc-greenSoft text-rc-green' : 'bg-rc-accentSoft text-rc-accentInk'}`}>
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-rc-ink">{row.name}</span>
                        <span className="block truncate text-[12.5px] text-rc-ink3">{row.meta}</span>
                      </span>
                      <span className={`whitespace-nowrap font-semibold tabular-nums ${row.positive ? 'text-rc-green' : 'text-rc-ink'}`}>
                        {row.amountText}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

      {hasMore && !loading && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isLoadingMore}
          className={`${TOUCH} mt-4 w-full rounded-xl border border-rc-line text-sm font-medium text-rc-ink2 disabled:opacity-50`}
        >
          {isLoadingMore ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
    </div>
  );
};

export default MobileExtrato;

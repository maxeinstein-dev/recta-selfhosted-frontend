import { useId, useMemo, useRef, useState } from 'react';
import { MoreVertical, X } from 'lucide-react';
import { useI18n } from '../../context/I18nContext';
import type { Account, Transaction } from '../../types';
import { useCardCommitment } from '../../hooks/api/useCardCommitment';
import { formatCurrency, parseDateFromAPI } from '../../utils/format';
import { format } from 'date-fns';
import {
  buildCommitmentRows,
  firstRiseRow,
  percentText,
  summarizeCommitment,
  commitmentState,
  type CommitmentBadge,
  type CommitmentRow,
} from '../../utils/cardCommitment';
import { cardCommitmentText, type CardCommitmentTextKey } from '../../utils/cardCommitmentTexts';
import { monthLabelPt } from '../../utils/mobileShell';
import {
  approxPrefix,
  cardVisual,
  shadeHex,
  percentPt,
  shortAmount,
  shortMonthLabel,
  bestDayToBuyText,
  cardSituation,
  cardsScreenState,
  carouselIndex,
  columnHeights,
  invoiceBars,
  usageBarWidth,
  usageTone,
} from '../../utils/cardsMobile';
import type { StatementView } from '../../utils/invoiceStatement';
import { TransactionType } from '../../lib/enums';
import { TransactionActionsMenu } from '../TransactionActionsMenu';
import { CreditCardStatementPanel } from './CreditCardStatementPanel';
import { CreditCardsSummary } from '../CreditCardsSummary';
import { useBackLayer } from '../../hooks/useBackLayer';

/** Limit figures of one card, from the same calculation the desktop page uses. */
export interface CardLimitFigures {
  available: number;
  limit: number;
  usagePercent: number;
}

export interface MobileCreditCardsProps {
  loading: boolean;
  /** The invoice request failed (the cards themselves loaded). */
  invoiceError: boolean;
  onRetryInvoice: () => void;
  cards: Account[];
  selectedAccount: Account | undefined;
  onSelectCard: (accountId: string) => void;
  limitsOf: (accountId: string) => CardLimitFigures | null;
  effectiveClosing: number | null;
  /** Null while the invoice is loading or when there is no statement for the month. */
  statementView: StatementView | null;
  invoiceLoading: boolean;
  invoiceTotal: number;
  isPaid: boolean;
  /** Name of the account that paid this statement, when the backend says so. */
  paidWithName: string | null;
  monthName: string;
  purchases: Transaction[];
  purchasesCount: number;
  hasMorePurchases: boolean;
  loadingMorePurchases: boolean;
  onLoadMorePurchases: () => void;
  onPay: () => void;
  onUndoPayment: () => void;
  onEditTransaction: (transaction: Transaction) => void;
  onDeleteTransaction: (transaction: Transaction) => void;
  onMarkAsPaid: (id: string, paid: boolean) => void;
  onViewTransaction: (transaction: Transaction) => void;
  onSplitShares?: (transaction: Transaction) => void;
  onNewCard: () => void;
  onEditCard: (account: Account) => void;
  onDeleteCard: (account: Account) => void;
  onNewPurchase: () => void;
  onImport: () => void;
  /** Review of the card's lines without receipt; undefined when the user cannot review. */
  onReview?: () => void;
  householdId?: string;
  baseCurrency: string;
}

const money = (value: number, currency: string) => formatCurrency(value, currency);

const BTN_PRIMARY =
  'min-h-[44px] w-full rounded-md bg-rc-accent px-4 text-sm font-semibold text-rc-onAccent disabled:opacity-50';
const BTN_GHOST =
  'min-h-[44px] rounded-md border border-rc-line px-4 text-sm font-medium text-rc-ink';
const CARD_BLOCK = 'rounded-2xl bg-rc-card p-4';

/**
 * The Cartões screen below 768 px: a carousel of cards (one at a time, snapping), the statement of the card selected,
 * its purchases, the next invoices, and a "Mais" sheet with the card actions. Only presents; the numbers come from the
 * page, which takes them from the same hooks and calculations as the desktop page.
 */
export default function MobileCreditCards(props: MobileCreditCardsProps) {
  const {
    loading,
    invoiceError,
    onRetryInvoice,
    cards,
    selectedAccount,
    onSelectCard,
    limitsOf,
    effectiveClosing,
    statementView,
    invoiceLoading,
    invoiceTotal,
    isPaid,
    paidWithName,
    monthName,
    purchases,
    purchasesCount,
    hasMorePurchases,
    loadingMorePurchases,
    onLoadMorePurchases,
    householdId,
    baseCurrency,
  } = props;
  const [index, setIndex] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [purchasesOpen, setPurchasesOpen] = useState(false);
  // The Android back button closes the three-dot menu and "Ver compras" before it leaves the screen (below 768 px).
  useBackLayer(moreOpen, () => setMoreOpen(false));
  useBackLayer(purchasesOpen, () => setPurchasesOpen(false));
  const scrollerRef = useRef<HTMLDivElement>(null);
  const screen = cardsScreenState({ loading, error: false, cardCount: cards.length });

  if (screen === 'loading') {
    return (
      <p role="status" className="py-10 text-center text-sm text-rc-ink2">
        Carregando cartões…
      </p>
    );
  }

  if (screen === 'empty') {
    return (
      <div className="space-y-4 py-6 text-center">
        <h1 className="text-xl font-semibold text-rc-ink">Cartões</h1>
        <p className="text-sm text-rc-ink2">Nenhum cartão cadastrado ainda.</p>
        <button type="button" onClick={props.onNewCard} className={`${BTN_PRIMARY} max-w-xs mx-auto`}>
          Cadastrar cartão
        </button>
      </div>
    );
  }

  const onScroll = () => {
    const el = scrollerRef.current;
    const first = el?.firstElementChild as HTMLElement | null | undefined;
    if (!el || !first) return;
    const slide = first.offsetWidth + 12;
    setIndex(carouselIndex(el.scrollLeft, slide, cards.length));
  };

  const limits = selectedAccount ? limitsOf(selectedAccount.id!) : null;
  const situation = statementView
    ? cardSituation({ state: statementView.state, dueLabel: statementView.dueLabel, closingLabel: statementView.closingLabel })
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-rc-ink">Cartões</h1>
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label="Mais opções do cartão"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className="flex h-11 w-11 items-center justify-center rounded-full text-rc-ink2"
        >
          <MoreVertical className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* Carrossel: um cartão por vez, com o próximo na borda. Rola por dentro; a página não rola na horizontal. */}
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        role="group"
        aria-label="Seus cartões"
        className="-mx-4 -my-2 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {cards.map((card, cardIndex) => {
          const figures = limitsOf(card.id!);
          const selected = card.id === selectedAccount?.id;
          const tone = figures ? usageTone(figures.usagePercent) : 'normal';
          const bar = figures ? usageBarWidth(figures.usagePercent) : 0;
          const visual = cardVisual({ name: card.name, color: card.color });
          const dark = visual.text === 'dark';
          const ink = dark ? '#111111' : '#ffffff';
          const soft = dark ? 'rgba(17,17,17,0.75)' : 'rgba(255,255,255,0.82)';
          const track = dark ? 'rgba(17,17,17,0.2)' : 'rgba(255,255,255,0.3)';
          const single = cards.length === 1;
          return (
            <button
              key={card.id}
              type="button"
              onClick={(event) => {
                // Choosing a card also brings it to the middle of the carousel, so the "Cartão N de M" line tells the truth.
                event.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                setIndex(cardIndex);
                onSelectCard(card.id!);
              }}
              aria-pressed={selected}
              aria-label={`${card.name}${figures ? `, limite livre ${money(figures.available, baseCurrency)} de ${money(figures.limit, baseCurrency)}` : ''}`}
              className={`relative flex aspect-[1.586/1] shrink-0 snap-start flex-col items-stretch overflow-hidden rounded-[20px] p-4 text-left shadow-md ${single ? 'w-full' : 'w-[85%]'} ${selected ? 'ring-2 ring-rc-ink ring-offset-2 ring-offset-rc-bg' : 'opacity-85'}`}
              style={{ color: ink, background: `linear-gradient(135deg, ${visual.color} 0%, ${shadeHex(visual.color, 0.25)} 100%)` }}
            >
              {/* Brilho suave, só forma. */}
              <span aria-hidden="true" className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-white/10" />
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold">{card.name}</span>
                {selected && situation && (
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: track }}>
                    {situation.label}
                  </span>
                )}
              </div>
              {/* Chip e número: o cadastro não guarda os quatro últimos dígitos, então aparecem quatro grupos de pontos. */}
              <div className="mt-3 flex items-center gap-3" aria-hidden="true">
                <svg width="38" height="28" viewBox="0 0 38 28">
                  <rect x=".5" y=".5" width="37" height="27" rx="5" fill="#e8d9a6" stroke="#b8974a" />
                  <path d="M13 .5v27M25 .5v27M.5 10h12.5M25 10h12.5M.5 18h12.5M25 18h12.5" stroke="#b8974a" fill="none" />
                </svg>
                <span className="text-[13px] tracking-[0.2em]" style={{ color: soft }}>•••• •••• •••• ••••</span>
              </div>
              <div className="absolute inset-x-4 bottom-4">
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px]" style={{ color: soft }}>Limite livre</div>
                    <div className="text-2xl font-semibold leading-tight tabular-nums">
                      {figures ? money(figures.available, baseCurrency) : '—'}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[11px]" style={{ color: soft }}>Limite</div>
                    <div className="text-sm font-medium tabular-nums">{figures ? money(figures.limit, baseCurrency) : '—'}</div>
                  </div>
                </div>
                <div
                  className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
                  style={{ background: track }}
                  role="img"
                  aria-label={`Uso do limite: ${percentPt(bar)}${tone === 'danger' ? ', acima de 90%' : tone === 'warn' ? ', acima de 70%' : ''}`}
                >
                  <div className="h-full rounded-full" style={{ width: `${bar}%`, background: ink }} />
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {cards.length > 1 && (
        <p className="text-center text-xs text-rc-ink3" aria-live="polite">
          Cartão {index + 1} de {cards.length}
        </p>
      )}

      {selectedAccount && (
        <div className="space-y-4">
          {/* Fatura: estado da fatura do cartão escolhido, no mês do cabeçalho. */}
          <section aria-label={`Fatura de ${monthName}`} className={CARD_BLOCK}>
            {invoiceLoading ? (
              <p role="status" className="text-sm text-rc-ink2">Carregando a fatura…</p>
            ) : invoiceError ? (
              <div className="space-y-3">
                <p role="alert" className="text-sm text-rc-red">Não foi possível carregar a fatura deste mês.</p>
                <button type="button" onClick={onRetryInvoice} className={BTN_GHOST}>
                  Tentar de novo
                </button>
              </div>
            ) : !statementView ? (
              <p className="text-sm text-rc-ink2">Sem fatura neste mês para este cartão.</p>
            ) : statementView.state === 'paid' || isPaid ? (
              <div className="space-y-3">
                <p className="text-2xl font-semibold tabular-nums text-rc-ink">{money(statementView.statementTotal, baseCurrency)}</p>
                {paidWithName && <p className="text-sm text-rc-ink2">Paga com {paidWithName}</p>}
                <button type="button" onClick={props.onUndoPayment} className={`${BTN_GHOST} w-full text-rc-red`}>
                  Desfazer pagamento
                </button>
              </div>
            ) : statementView.state === 'closed' ? (
              <div className="space-y-3">
                <p className="text-2xl font-semibold tabular-nums text-rc-ink">{money(statementView.debtTotal, baseCurrency)}</p>
                <button type="button" onClick={props.onPay} disabled={invoiceTotal <= 0} className={BTN_PRIMARY}>
                  Marcar como paga
                </button>
              </div>
            ) : (
              <OpenStatement
                view={statementView}
                baseCurrency={baseCurrency}
                purchasesCount={purchasesCount}
              />
            )}
          </section>

          {/* Detalhe da fatura: o painel que a página já tem (datas, dívida, previsão de recorrências). */}
          {statementView && !invoiceLoading && !invoiceError && (
            <CreditCardStatementPanel view={statementView} monthName={monthName} baseCurrency={baseCurrency} />
          )}

          {/* Limite e datas do cartão escolhido. */}
          {limits && (
            <section aria-label="Limite e datas" className={CARD_BLOCK}>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-rc-ink2">Vencimento</dt>
                  <dd className="font-medium tabular-nums text-rc-ink">{selectedAccount.dueDay ? `dia ${selectedAccount.dueDay}` : 'Não informado'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-rc-ink2">Fechamento</dt>
                  <dd className="font-medium tabular-nums text-rc-ink">{effectiveClosing ? `dia ${effectiveClosing}` : 'Não informado'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-rc-ink2">Limite total</dt>
                  <dd className="font-medium tabular-nums text-rc-ink">{money(limits.limit, baseCurrency)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-rc-ink2">Uso do limite</dt>
                  <dd className="font-medium tabular-nums text-rc-ink">{percentPt(limits.usagePercent)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-rc-ink2">Melhor dia para comprar</dt>
                  <dd className="font-medium tabular-nums text-rc-ink">{bestDayToBuyText(effectiveClosing) ?? 'Não informado'}</dd>
                </div>
              </dl>
            </section>
          )}

          {/* Compras da fatura: a mesma lista e as mesmas ações do computador. */}
          <section aria-label="Compras da fatura" className={CARD_BLOCK}>
            <button
              type="button"
              onClick={() => setPurchasesOpen((open) => !open)}
              aria-expanded={purchasesOpen}
              aria-controls="card-purchases"
              className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left"
            >
              <span className="text-sm font-semibold text-rc-ink">Ver compras</span>
              <span className="text-xs text-rc-ink2 tabular-nums">
                {purchasesCount} {purchasesCount === 1 ? 'compra' : 'compras'}
              </span>
            </button>
            <div id="card-purchases" hidden={!purchasesOpen}>
              {purchasesOpen && (
                <PurchaseList
                  purchases={purchases}
                  loading={invoiceLoading}
                  hasMore={hasMorePurchases}
                  loadingMore={loadingMorePurchases}
                  onLoadMore={onLoadMorePurchases}
                  baseCurrency={baseCurrency}
                  onEdit={props.onEditTransaction}
                  onDelete={props.onDeleteTransaction}
                  onMarkAsPaid={props.onMarkAsPaid}
                  onView={props.onViewTransaction}
                  onSplitShares={props.onSplitShares}
                />
              )}
            </div>
          </section>

          <CommitmentSection householdId={householdId} accountId={selectedAccount.id!} baseCurrency={baseCurrency} />
        </div>
      )}

      <section aria-label="Todos os cartões" className="pt-2">
        <CreditCardsSummary />
      </section>

      {moreOpen && (
        <MoreSheet
          onClose={() => setMoreOpen(false)}
          hasSelected={!!selectedAccount}
          onNewCard={() => {
            setMoreOpen(false);
            props.onNewCard();
          }}
          onEditCard={() => {
            setMoreOpen(false);
            if (selectedAccount) props.onEditCard(selectedAccount);
          }}
          onDeleteCard={() => {
            setMoreOpen(false);
            if (selectedAccount) props.onDeleteCard(selectedAccount);
          }}
          onNewPurchase={() => {
            setMoreOpen(false);
            props.onNewPurchase();
          }}
          onImport={() => {
            setMoreOpen(false);
            props.onImport();
          }}
          onReview={
            props.onReview
              ? () => {
                  setMoreOpen(false);
                  props.onReview?.();
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function OpenStatement({
  view,
  baseCurrency,
  purchasesCount,
}: {
  view: StatementView;
  baseCurrency: string;
  purchasesCount: number;
}) {
  const expected = view.forecast?.expectedClosingTotal ?? view.statementTotal;
  const bars = invoiceBars(view.statementTotal, expected);
  const estimated = !!view.forecast?.items.some((item) => item.estimated);
  return (
    <div className="space-y-3">
      <p className="text-2xl font-semibold tabular-nums text-rc-ink">{money(view.statementTotal, baseCurrency)}</p>
      <p className="text-xs text-rc-ink2">Lançado até agora</p>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-rc-line" role="img" aria-label={`Lançado ${money(view.statementTotal, baseCurrency)}, previsto ${money(expected, baseCurrency)}`}>
        <div className="h-full bg-rc-accent" style={{ width: `${bars.solid}%` }} />
        <div className="h-full bg-rc-accentSoft" style={{ width: `${bars.rest}%` }} />
      </div>
      <div className="flex justify-between text-xs text-rc-ink2 tabular-nums">
        <span>Lançado {money(view.statementTotal, baseCurrency)}</span>
        <span>
          Previsto <b className="text-rc-ink">{approxPrefix(estimated)}{money(expected, baseCurrency)}</b>
        </span>
      </div>
      <p className="text-xs text-rc-ink2">
        {purchasesCount} {purchasesCount === 1 ? 'compra' : 'compras'}
      </p>
    </div>
  );
}

function PurchaseList({
  purchases,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  baseCurrency,
  onEdit,
  onDelete,
  onMarkAsPaid,
  onView,
  onSplitShares,
}: {
  purchases: Transaction[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  baseCurrency: string;
  onEdit: (t: Transaction) => void;
  onDelete: (t: Transaction) => void;
  onMarkAsPaid: (id: string, paid: boolean) => void;
  onView: (t: Transaction) => void;
  onSplitShares?: (t: Transaction) => void;
}) {
  if (loading) return <p role="status" className="mt-3 text-sm text-rc-ink2">Carregando compras…</p>;
  if (purchases.length === 0) return <p className="mt-3 text-sm text-rc-ink2">Nenhuma compra nesta fatura.</p>;
  return (
    <div className="mt-3">
      <ul className="divide-y divide-rc-line">
        {purchases.map((item) => {
          const isPayment = !!item.attachmentUrl && item.attachmentUrl.startsWith('invoice_pay:');
          const when = safeDayMonth(item.date);
          return (
            <li key={item.id} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-rc-ink">{item.description}</div>
                <div className="truncate text-xs text-rc-ink2">
                  {when} · {item.category}
                  {item.installmentNumber ? ` · ${item.installmentNumber}/${item.totalInstallments}` : ''}
                </div>
              </div>
              <span className={`shrink-0 text-sm font-medium tabular-nums ${isPayment ? 'text-rc-green' : 'text-rc-ink'}`}>
                {isPayment ? '-' : ''}
                {money(item.amount, baseCurrency)}
              </span>
              <TransactionActionsMenu
                transaction={item}
                onEdit={onEdit}
                onDelete={(id: string) => {
                  const found = purchases.find((p) => p.id === id);
                  if (found) onDelete(found);
                }}
                onMarkAsPaid={onMarkAsPaid}
                onView={onView}
                onSplitShares={onSplitShares && !isPayment && item.type === TransactionType.EXPENSE ? onSplitShares : undefined}
              />
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <button type="button" onClick={onLoadMore} disabled={loadingMore} className={`${BTN_GHOST} mt-3 w-full`}>
          {loadingMore ? 'Carregando…' : 'Carregar mais compras'}
        </button>
      )}
    </div>
  );
}

function safeDayMonth(date: Transaction['date'] | string): string {
  try {
    const parsed = date instanceof Date ? date : parseDateFromAPI(String(date));
    if (isNaN(parsed.getTime())) return '';
    return format(parsed, 'dd/MM');
  } catch {
    return '';
  }
}

function CommitmentSection({ householdId, accountId, baseCurrency }: { householdId?: string; accountId: string; baseCurrency: string }) {
  const { t } = useI18n();
  const tx = (key: CardCommitmentTextKey, vars?: Record<string, string | number>) => cardCommitmentText(t, key, vars);
  const [months, setMonths] = useState<number>(6);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const detailId = useId();
  const query = useCardCommitment({ householdId, accountId, months });
  const rows = useMemo(() => buildCommitmentRows(query.data), [query.data]);
  const state = commitmentState(rows);
  const summary = useMemo(() => summarizeCommitment(rows), [rows]);
  const rise = useMemo(() => firstRiseRow(rows), [rows]);
  const heights = columnHeights(rows.map((row) => row.total));
  const selected: CommitmentRow | undefined = rows.find((row) => row.month === selectedMonth);
  const badgeText = (badge: CommitmentBadge) => tx(badge === 'paid' ? 'cardCommitPaid' : 'cardCommitClosed');

  return (
    <section aria-label="Próximas faturas" className={CARD_BLOCK}>
      <h2 className="text-base font-semibold text-rc-ink">Próximas faturas</h2>
      <p className="text-xs text-rc-ink2">Quanto as próximas faturas já comprometem.</p>

      <div role="group" aria-label="Quantos meses" className="mt-3 flex gap-1 rounded-lg bg-rc-card2 p-1">
        {[3, 6, 12].map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={months === option}
            onClick={() => {
              setMonths(option);
              setSelectedMonth(null);
            }}
            className={`min-h-[44px] flex-1 rounded px-2 text-xs font-medium ${months === option ? 'bg-rc-card text-rc-ink shadow-sm' : 'text-rc-ink2'}`}
          >
            {option} meses
          </button>
        ))}
      </div>

      <div className="mt-4">
        {query.isPending ? (
          <p role="status" className="text-sm text-rc-ink2">Carregando as próximas faturas…</p>
        ) : query.isError || !query.data ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-rc-red">Não foi possível carregar as próximas faturas.</p>
            <button type="button" onClick={() => query.refetch()} className={BTN_GHOST}>
              Tentar de novo
            </button>
          </div>
        ) : state === 'empty' ? (
          <p className="text-sm text-rc-ink2">Nenhuma fatura comprometida nos próximos meses.</p>
        ) : (
          <>
            <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="group" aria-label="Meses das próximas faturas">
              {rows.map((row, i) => {
                const on = row.month === selectedMonth;
                return (
                  <button
                    key={row.month}
                    type="button"
                    aria-pressed={on}
                    aria-controls={detailId}
                    aria-label={`${monthLabelPt(row.month)}: ${money(row.total, baseCurrency)}${row.badge ? ` (${badgeText(row.badge)})` : ''}`}
                    onClick={() => setSelectedMonth(on ? null : row.month)}
                    className={`flex min-h-[44px] min-w-[56px] flex-1 flex-col items-center gap-1 rounded-md px-1 py-1 ${on ? 'bg-rc-accentSoft' : ''}`}
                  >
                    <span className="whitespace-nowrap text-[11px] font-medium text-rc-ink2" aria-hidden="true">{shortMonthLabel(row.month, new Date().getFullYear())}</span>
                    <span className="flex h-20 w-full items-end justify-center" aria-hidden="true">
                      <span
                        className={`w-3/5 rounded-t ${row.heaviest ? 'bg-rc-accent' : 'bg-rc-accentSoft'}`}
                        style={{ height: `${heights[i]}%` }}
                      />
                    </span>
                    <span className="whitespace-nowrap text-[11px] tabular-nums text-rc-ink" aria-hidden="true">{shortAmount(row.total)}</span>
                    {row.badge && (
                      <span
                        data-testid="commitment-badge"
                        aria-hidden="true"
                        className={`whitespace-nowrap text-[10px] font-semibold ${row.badge === 'paid' ? 'text-rc-green' : 'text-rc-ink2'}`}
                      >
                        {badgeText(row.badge)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div id={detailId} className="mt-3">
              {selected ? (
                <div className="space-y-2 rounded-lg bg-rc-card2 p-3 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span className="font-semibold text-rc-ink">Fatura de {selected.label}</span>
                      {selected.badge && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            selected.badge === 'paid' ? 'bg-rc-greenSoft text-rc-green' : 'bg-rc-card text-rc-ink2'
                          }`}
                        >
                          {badgeText(selected.badge)}
                        </span>
                      )}
                    </span>
                    <span className="font-semibold tabular-nums text-rc-ink">{money(selected.total, baseCurrency)}</span>
                  </div>
                  <dl className="space-y-1 text-rc-ink2">
                    <Line label={tx('cardCommitInstallments')} value={money(selected.installments, baseCurrency)} />
                    <Line label={tx('cardCommitRecurrences')} value={money(selected.recurrences, baseCurrency)} />
                    <Line label={tx('cardCommitPurchases')} value={money(selected.purchases, baseCurrency)} />
                    <Line label={tx('cardCommitForecast')} value={`${approxPrefix(selected.forecast > 0)}${money(selected.forecast, baseCurrency)}`} />
                  </dl>
                  <p className="text-xs text-rc-ink2">
                    {selected.share !== null
                      ? tx('cardCommitShareOfIncome', { share: percentText(selected.share, 'pt-BR') })
                      : tx('cardCommitNoIncome')}
                  </p>
                  {selected.overIncome && <p className="text-xs font-semibold text-rc-red">{tx('cardCommitOverIncome')}</p>}
                </div>
              ) : (
                <p className="text-xs text-rc-ink3">Toque num mês para ver o detalhe.</p>
              )}
            </div>

            {rise && (
              <p role="note" className="mt-3 rounded-md bg-rc-amberSoft px-3 py-2 text-xs text-rc-amber">
                {tx('cardCommitRiseWarning', { month: rise.label, amount: money(rise.total, baseCurrency), base: rows[0].label })}
              </p>
            )}
            {summary.heaviestLabel && (
              <p className="mt-2 text-xs text-rc-ink2">{tx('cardCommitHeaviestMonth', { month: summary.heaviestLabel })}</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt>{label}</dt>
      <dd className="tabular-nums text-rc-ink">{value}</dd>
    </div>
  );
}

function MoreSheet({
  onClose,
  hasSelected,
  onNewCard,
  onEditCard,
  onDeleteCard,
  onNewPurchase,
  onImport,
  onReview,
}: {
  onClose: () => void;
  hasSelected: boolean;
  onNewCard: () => void;
  onEditCard: () => void;
  onDeleteCard: () => void;
  onNewPurchase: () => void;
  onImport: () => void;
  onReview?: () => void;
}) {
  const titleId = useId();
  const items: { label: string; onClick: () => void; show: boolean; danger?: boolean }[] = [
    { label: 'Nova compra neste cartão', onClick: onNewPurchase, show: hasSelected },
    { label: 'Importar faturas e extratos', onClick: onImport, show: true },
    { label: 'Revisar lançamentos sem comprovante', onClick: onReview ?? (() => {}), show: !!onReview && hasSelected },
    { label: 'Editar cartão', onClick: onEditCard, show: hasSelected },
    { label: 'Novo cartão', onClick: onNewCard, show: true },
    { label: 'Excluir cartão', onClick: onDeleteCard, show: hasSelected, danger: true },
  ];
  return (
    <div className="fixed inset-0 z-[55] flex items-end bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full rounded-t-2xl bg-rc-card p-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 id={titleId} className="text-base font-semibold text-rc-ink">Opções do cartão</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="flex h-11 w-11 items-center justify-center text-rc-ink2">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <ul className="space-y-1">
          {items
            .filter((item) => item.show)
            .map((item) => (
              <li key={item.label}>
                <button
                  type="button"
                  onClick={item.onClick}
                  className={`flex min-h-[44px] w-full items-center gap-3 rounded-md px-3 text-left text-sm ${item.danger ? 'text-rc-red' : 'text-rc-ink'}`}
                >
                  {item.label}
                </button>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}


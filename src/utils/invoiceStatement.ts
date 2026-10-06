/**
 * View model of a credit card statement (invoice) for the credit card page.
 *
 * The backend answers with the legacy fields (previousBalance, currentExpenses, currentPayments, total, isPaid) plus the
 * statement fields (statementTotal, outstandingFromPrevious, debtTotal, closingDate, dueDate, state, forecast). Every
 * new field is optional here: an older backend still renders a correct panel from the legacy ones.
 *
 * Money is compared in whole cents (sums of cents drift in binary) and dates are 'YYYY-MM-DD' strings that are
 * formatted by slicing, never through `new Date`, so the time zone of the browser cannot move a day.
 */

export type StatementState = 'open' | 'closed' | 'paid';

export interface ForecastItemDto {
  recurringTransactionId?: string;
  description: string;
  categoryName?: string;
  date: string;
  amount: number;
  followsLastAmount?: boolean;
}

export interface InvoiceForecastDto {
  applicable: boolean;
  items: ForecastItemDto[];
  total: number;
  expectedClosingTotal: number;
}

export interface InvoiceStatementDto {
  previousBalance?: number;
  currentExpenses?: number;
  currentPayments?: number;
  total?: number;
  isPaid?: boolean;
  statementTotal?: number;
  outstandingFromPrevious?: number;
  debtTotal?: number;
  closingDate?: string | null;
  dueDate?: string | null;
  state?: StatementState;
  forecast?: InvoiceForecastDto | null;
}

export interface StatementForecastItem {
  key: string;
  description: string;
  /** 'dd/MM' */
  dateLabel: string;
  amount: number;
  estimated: boolean;
}

export interface StatementView {
  state: StatementState;
  stateLabel: string;
  /** What the bank charges for this statement. */
  statementTotal: number;
  /** Still owed from earlier statements. */
  outstanding: number;
  payments: number;
  /** previous + statement - payments, never negative. */
  debtTotal: number;
  /** 'dd/MM' or null. */
  closingLabel: string | null;
  dueLabel: string | null;
  /** Sentence for the header, e.g. "fecha em 02/11" / "fechada em 02/10 · vence 09/10". */
  closingSentence: string | null;
  forecast: {
    applicable: boolean;
    items: StatementForecastItem[];
    total: number;
    posted: number;
    expectedClosingTotal: number;
  } | null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const cents = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const money = (c: number): number => c / 100;

/** 'dd/MM' of a 'YYYY-MM-DD' (also of an ISO timestamp, by its date part); '' when it is not a date. */
export function dayMonthLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const day = iso.slice(0, 10);
  if (!ISO_DAY.test(day)) return '';
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

export const STATE_LABELS: Record<StatementState, string> = { open: 'Aberta', closed: 'Fechada', paid: 'Paga' };

/** The state the backend sent, else derived from the legacy fields (paid when flagged, otherwise closed). */
function stateOf(dto: InvoiceStatementDto): StatementState {
  if (dto.state === 'open' || dto.state === 'closed' || dto.state === 'paid') return dto.state;
  return dto.isPaid ? 'paid' : 'closed';
}

export function buildInvoiceStatement(dto: InvoiceStatementDto | null | undefined): StatementView | null {
  if (!dto) return null;
  const state = stateOf(dto);
  const statementC = cents(dto.statementTotal ?? dto.currentExpenses);
  const outstandingC = cents(dto.outstandingFromPrevious ?? dto.previousBalance);
  const paymentsC = cents(dto.currentPayments);
  const debtC = dto.debtTotal !== undefined ? cents(dto.debtTotal) : Math.max(0, outstandingC + statementC - paymentsC);

  const closingLabel = dayMonthLabel(dto.closingDate) || null;
  const dueLabel = dayMonthLabel(dto.dueDate) || null;
  let closingSentence: string | null = null;
  if (closingLabel) {
    closingSentence = state === 'open' ? `fecha em ${closingLabel}` : `fechou em ${closingLabel}`;
    if (dueLabel) closingSentence += ` · vence em ${dueLabel}`;
  } else if (dueLabel) {
    closingSentence = `vence em ${dueLabel}`;
  }

  let forecast: StatementView['forecast'] = null;
  const f = dto.forecast;
  if (f && f.applicable && Array.isArray(f.items) && f.items.length > 0) {
    const items = f.items.map((item, index) => ({
      key: `${item.recurringTransactionId ?? 'r'}:${item.date}:${index}`,
      description: item.description,
      dateLabel: dayMonthLabel(item.date),
      amount: money(cents(item.amount)),
      estimated: item.followsLastAmount === true,
    }));
    const totalC = items.reduce((sum, item) => sum + cents(item.amount), 0);
    forecast = {
      applicable: true,
      items,
      total: money(totalC),
      posted: money(statementC),
      expectedClosingTotal: money(statementC + totalC),
    };
  }

  return {
    state,
    stateLabel: STATE_LABELS[state],
    statementTotal: money(statementC),
    outstanding: money(outstandingC),
    payments: money(paymentsC),
    debtTotal: money(debtC),
    closingLabel,
    dueLabel,
    closingSentence,
    forecast,
  };
}

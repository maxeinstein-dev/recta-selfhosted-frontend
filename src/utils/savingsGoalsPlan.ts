/**
 * Pure logic of the savings goals ("cofrinhos", P03): the plan fields of the goal form and their rules (mirrored from the
 * backend's assertPlanConsistent, so the form says what is missing before the server refuses it), the body of create and
 * update, the provision's monthly preview (mirrored from the backend's plannedCentsFor), the "aporte do mês" of each goal,
 * the contribution request and its errors, and the free and kept money of an account (GET /savings-goals/summary).
 * No React and no imports, so tools/fe-tests/t48_savings_goals.mts runs it under tsx (SAVINGS_PLAN_MODULE points it at a
 * mutated copy).
 *
 * A goal is money MARKED inside an account: a contribution never creates an entry and never changes the account balance,
 * only what of it is free. Money: the API answers in money units; every sum here is done in whole cents.
 */

export type GoalKind = 'RESERVE' | 'PROVISION';

/** What the form holds about the plan. `monthlyContribution` null (or 0) = no fixed monthly value. */
export interface PlanDraft {
  kind: GoalKind;
  monthlyContribution: number | null;
  /** 1..28 */
  contributionDay: number | null;
  /** 'YYYY-MM', provisions only. */
  dueMonth: string | null;
  /** '' = no account. */
  accountId: string;
}

export type PlanError = 'account' | 'day' | 'dayRange' | 'dueMonth';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const toCents = (amount: number): number => Math.round(amount * 100);

const hasMonthly = (d: Pick<PlanDraft, 'monthlyContribution'>): boolean => typeof d.monthlyContribution === 'number' && d.monthlyContribution > 0;

/** A goal has a plan when it is a provision (it always plans) or has a monthly contribution. */
export function hasPlan(d: Pick<PlanDraft, 'kind' | 'monthlyContribution'>): boolean {
  return d.kind === 'PROVISION' || hasMonthly(d);
}

const validDay = (day: unknown): boolean => typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 28;

/** What the form still misses. The backend refuses the same states with a 400. */
export function planErrors(d: PlanDraft): PlanError[] {
  const errors: PlanError[] = [];
  if (d.contributionDay !== null && d.contributionDay !== undefined && !validDay(d.contributionDay)) errors.push('dayRange');
  if (d.kind === 'PROVISION' && !(typeof d.dueMonth === 'string' && MONTH_RE.test(d.dueMonth))) errors.push('dueMonth');
  if (hasPlan(d)) {
    if (!d.accountId) errors.push('account');
    if (d.contributionDay === null || d.contributionDay === undefined) errors.push('day');
  }
  return errors;
}

/**
 * The plan fields of the request. On create the empty ones are left out (the create route takes no null); on update
 * they go as null so a cleared field is cleared. A reserve never sends a due month; a goal with no plan keeps no day.
 */
export function planPayload(d: PlanDraft, mode: 'create' | 'update'): Record<string, unknown> {
  const plan = hasPlan(d);
  const fields: Record<string, unknown> = {
    kind: d.kind,
    monthlyContribution: hasMonthly(d) ? d.monthlyContribution : null,
    contributionDay: plan && validDay(d.contributionDay) ? d.contributionDay : null,
    dueMonth: d.kind === 'PROVISION' && d.dueMonth ? d.dueMonth : null,
  };
  if (mode === 'update') return fields;
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null));
}

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The form's plan fields from a goal of the API (anything unknown falls back to an empty reserve). */
export function planDraftOf(goal: { kind?: unknown; monthlyContribution?: unknown; contributionDay?: unknown; dueMonth?: unknown; accountId?: unknown } | null | undefined): PlanDraft {
  const g = goal ?? {};
  return {
    kind: g.kind === 'PROVISION' ? 'PROVISION' : 'RESERVE',
    monthlyContribution: numOrNull(g.monthlyContribution),
    contributionDay: numOrNull(g.contributionDay),
    dueMonth: typeof g.dueMonth === 'string' && g.dueMonth ? g.dueMonth : null,
    accountId: typeof g.accountId === 'string' ? g.accountId : '',
  };
}

const monthIndex = (month: string): number => Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1);

/**
 * What a provision plans for `month`, as the backend computes it: the typed monthly value, or what is missing divided by
 * the months left up to the due month (inclusive), rounded up; never more than what is missing; nothing after the due month.
 */
export function provisionMonthlyCents(p: { targetCents: number; currentCents: number; monthlyCents: number | null; dueMonth: string | null; month: string }): number {
  const remaining = p.targetCents - p.currentCents;
  if (remaining <= 0 || !p.dueMonth || !MONTH_RE.test(p.dueMonth)) return 0;
  const monthsLeft = monthIndex(p.dueMonth) - monthIndex(p.month) + 1;
  if (monthsLeft <= 0) return 0;
  const wanted = p.monthlyCents !== null && p.monthlyCents > 0 ? p.monthlyCents : Math.ceil(remaining / monthsLeft);
  return Math.min(wanted, remaining);
}

/** `thisMonth` of GET /savings-goals. */
export interface GoalThisMonth {
  month: string;
  status: 'none' | 'pending' | 'done';
  date: string | null;
  plannedAmount: number;
  contributedAmount: number;
}

export interface ThisMonthView {
  status: GoalThisMonth['status'];
  plannedCents: number;
  contributedCents: number;
  /** 'dd/MM' of the contribution day; '' without one. */
  day: string;
  /** Pending and the day already passed. */
  late: boolean;
  /** 'planned': one tap keeps the planned amount (no amount sent); 'ask': the amount is asked first. */
  mode: 'planned' | 'ask';
  canUndo: boolean;
}

export function thisMonthView(tm: GoalThisMonth | null | undefined, today: string): ThisMonthView {
  const status = tm && (tm.status === 'pending' || tm.status === 'done') ? tm.status : 'none';
  const date = tm && typeof tm.date === 'string' && DAY_RE.test(tm.date) ? tm.date : null;
  const plannedCents = tm ? toCents(Number(tm.plannedAmount) || 0) : 0;
  return {
    status,
    plannedCents,
    contributedCents: tm ? toCents(Number(tm.contributedAmount) || 0) : 0,
    day: date ? `${date.slice(8, 10)}/${date.slice(5, 7)}` : '',
    late: status === 'pending' && !!date && date < today,
    mode: status === 'pending' && plannedCents > 0 ? 'planned' : 'ask',
    canUndo: status === 'done',
  };
}

/** "Guardar agora" needs the account the money stays in, and something still missing to the target. */
export function canContribute(goal: { accountId?: string | null; targetAmount: number; currentAmount: number }): boolean {
  return !!goal.accountId && toCents(goal.targetAmount) - toCents(goal.currentAmount) > 0;
}

/** Body of POST /savings-goals/:id/contributions. No amount = the month's planned one; no date = today. */
export function contributionBody(p: { amountCents?: number | null; date?: string | null; confirmDuplicate?: boolean }): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (typeof p.amountCents === 'number' && p.amountCents > 0) body.amount = p.amountCents / 100;
  if (typeof p.date === 'string' && DAY_RE.test(p.date)) body.date = p.date;
  if (p.confirmDuplicate) body.confirmDuplicate = true;
  return body;
}

type ErrLike = { status?: number; message?: string } | null | undefined;

/** The month already has a contribution: ask, then send again with confirmDuplicate. */
export const isDuplicateContribution = (err: unknown): boolean => (err as ErrLike)?.status === 409;

export type ContributionErrorKey = 'goalsErrExceeds' | 'goalsErrNoAccount' | 'goalsErrNothingPlanned' | 'goalsErrContribute';

export function contributionErrorKey(err: unknown): ContributionErrorKey {
  const e = err as ErrLike;
  const msg = String(e?.message ?? '');
  if (e?.status === 400) {
    if (/exceed/i.test(msg)) return 'goalsErrExceeds';
    if (/account/i.test(msg)) return 'goalsErrNoAccount';
    if (/nothing planned/i.test(msg)) return 'goalsErrNothingPlanned';
  }
  return 'goalsErrContribute';
}

/** "Maximum allowed: 12.5" of the 400 that would pass the target; null when absent. */
export function maxAllowedOf(err: unknown): number | null {
  const m = /Maximum allowed:\s*(-?\d+(?:\.\d+)?)/.exec(String((err as ErrLike)?.message ?? ''));
  return m ? Number(m[1]) : null;
}

/** Cents of a masked money text ('1.234,56', 'R$ 0,10'): its digits, the last two being the cents. */
export function parseAmountCents(text: string): number {
  const digits = String(text ?? '').replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

export function amountError(amountCents: number, remainingCents: number): 'goalsErrAmount' | 'goalsErrExceeds' | null {
  if (!(amountCents > 0)) return 'goalsErrAmount';
  if (amountCents > remainingCents) return 'goalsErrExceeds';
  return null;
}

/** One account of GET /savings-goals/summary. */
export interface SummaryAccount {
  accountId: string;
  name: string;
  type: string;
  balance: number;
  allocated: number;
  free: number;
}

export interface AccountSplit {
  balanceCents: number;
  allocatedCents: number;
  freeCents: number;
  negative: boolean;
}

/** Free and kept money by account id (only accounts with a linked goal). Accepts the answer or its envelope. */
export function splitsByAccount(raw: unknown): Map<string, AccountSplit> {
  const r = raw as { accounts?: unknown; data?: { accounts?: unknown } } | null | undefined;
  const list = Array.isArray(r?.accounts) ? r!.accounts : Array.isArray(r?.data?.accounts) ? r!.data!.accounts : [];
  const map = new Map<string, AccountSplit>();
  for (const item of list as SummaryAccount[]) {
    if (!item || typeof item.accountId !== 'string') continue;
    const balanceCents = toCents(Number(item.balance) || 0);
    const allocatedCents = toCents(Number(item.allocated) || 0);
    // free = balance - kept, computed here in cents (the same definition as the backend)
    const freeCents = balanceCents - allocatedCents;
    map.set(item.accountId, { balanceCents, allocatedCents, freeCents, negative: freeCents < 0 });
  }
  return map;
}

/** "Guardar: <nome>" for a reserve line, whether the description already carries the prefix or not. */
export function reserveText(description: string | null | undefined, goalName: string | null | undefined): string {
  const desc = (description ?? '').trim();
  if (/^guardar:/i.test(desc)) return desc;
  const name = desc || (goalName ?? '').trim();
  return name ? `Guardar: ${name}` : 'Guardar';
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { apiClient } from '../../utils/api';
import type { Employment, HouseholdPayrollEvents, PayrollEvents } from '../../utils/income';
import type { SimBody, SimGrossResult, SimNetResult } from '../../utils/incomeSimulator';

/** POST /payroll/simulate/net: gross to net of one month. Nothing is saved and no employment is needed. */
export async function simulateNetRequest(body: SimBody): Promise<SimNetResult> {
  const response = await apiClient.post<SimNetResult>('/payroll/simulate/net', body);
  if (!response.data) throw new Error('Empty simulation response');
  return response.data;
}

/** POST /payroll/simulate/gross: the smallest gross whose net reaches the target. */
export async function simulateGrossRequest(body: SimBody): Promise<SimGrossResult> {
  const response = await apiClient.post<SimGrossResult>('/payroll/simulate/gross', body);
  if (!response.data) throw new Error('Empty simulation response');
  return response.data;
}

/** The simulator runs on a button press, so it is a mutation (not a query): one request per press. */
export function useSimulateNet() {
  return useMutation<SimNetResult, Error, SimBody>({ mutationFn: simulateNetRequest });
}

export function useSimulateGross() {
  return useMutation<SimGrossResult, Error, SimBody>({ mutationFn: simulateGrossRequest });
}

// The payroll routes (GET /payroll/..., see payroll.routes.ts). Money comes in reais. The household is sent on every
// route: it scopes the lookup, so a foreign id is a plain 404.

export type PayrollResource = 'salaries' | 'items' | 'vacations' | 'fgts-balances' | 'fgts-withdrawals' | 'fgts-modes';

export const payrollKeys = {
  all: ['payroll'] as const,
  employments: (householdId: string | null, personId: string | null) => ['payroll', 'employments', householdId, personId] as const,
  employment: (householdId: string | null, id: string) => ['payroll', 'employment', householdId, id] as const,
  events: (householdId: string | null, from: string, to: string, personId: string | null) => ['payroll', 'events', householdId, from, to, personId] as const,
  employmentEvents: (householdId: string | null, id: string, from: string, to: string) => ['payroll', 'employment-events', householdId, id, from, to] as const,
};

const withQuery = (path: string, params: Record<string, string | undefined | null>): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `${path}?${text}` : path;
};

/** Employments of the household (optionally of one person), with their salaries, benefits, vacations and FGTS. */
export function useEmployments(householdId: string | undefined, personId?: string) {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: payrollKeys.employments(householdId ?? null, personId ?? null),
    enabled: !!currentUser && !!householdId,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Employment[]> => {
      const response = await apiClient.get<Employment[]>('/payroll/employments', { householdId, personId });
      return response.data ?? [];
    },
  });
}

export function useEmployment(householdId: string | undefined, id: string | undefined) {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: payrollKeys.employment(householdId ?? null, id ?? ''),
    enabled: !!currentUser && !!householdId && !!id,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Employment> => {
      const response = await apiClient.get<Employment>(`/payroll/employments/${id}`, { householdId });
      if (!response.data) throw new Error('Empty employment response');
      return response.data;
    },
  });
}

/** Forecast events of every active employment of the household (or of one person) in [from, to]. */
export function useHouseholdEvents(householdId: string | undefined, from: string, to: string, personId?: string) {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: payrollKeys.events(householdId ?? null, from, to, personId ?? null),
    enabled: !!currentUser && !!householdId,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<HouseholdPayrollEvents> => {
      const response = await apiClient.get<HouseholdPayrollEvents>('/payroll/events', { householdId, from, to, personId });
      if (!response.data) throw new Error('Empty payroll events response');
      return response.data;
    },
  });
}

/** Forecast events of one employment in [from, to]. */
export function useEmploymentEvents(householdId: string | undefined, id: string | undefined, from: string, to: string) {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: payrollKeys.employmentEvents(householdId ?? null, id ?? '', from, to),
    enabled: !!currentUser && !!householdId && !!id,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<PayrollEvents> => {
      const response = await apiClient.get<PayrollEvents>(`/payroll/employments/${id}/events`, { householdId, from, to });
      if (!response.data) throw new Error('Empty employment events response');
      return response.data;
    },
  });
}

/**
 * After any write of the area: the employments and their events, the cash flow (the 'dashboard' keys) and the card
 * commitment, which counts the income of the same employments (its key starts with 'transactions').
 */
function invalidateIncome(queryClient: ReturnType<typeof useQueryClient>): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: payrollKeys.all }),
    queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    queryClient.invalidateQueries({ queryKey: ['transactions'] }),
  ]);
}

function usePayrollWrite<TVars, TResult = unknown>(write: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation<TResult, Error, TVars>({
    mutationFn: write,
    onSuccess: () => invalidateIncome(queryClient),
  });
}

export interface EmploymentWriteVars {
  householdId: string;
  id?: string;
  body?: Record<string, unknown>;
}

export function useCreateEmployment() {
  return usePayrollWrite(async ({ body }: EmploymentWriteVars): Promise<Employment | undefined> => {
    const response = await apiClient.post<Employment>('/payroll/employments', body);
    return response.data;
  });
}

export function useUpdateEmployment() {
  return usePayrollWrite(async ({ householdId, id, body }: EmploymentWriteVars): Promise<Employment | undefined> => {
    const response = await apiClient.patch<Employment>(withQuery(`/payroll/employments/${id}`, { householdId }), body);
    return response.data;
  });
}

export function useDeleteEmployment() {
  return usePayrollWrite(async ({ householdId, id }: EmploymentWriteVars) => {
    await apiClient.delete(withQuery(`/payroll/employments/${id}`, { householdId }));
  });
}

export interface SubWriteVars {
  householdId: string;
  employmentId: string;
  resource: PayrollResource;
  /** Set on an update or a delete. */
  subId?: string;
  body?: Record<string, unknown>;
}

/** Create, update and delete of the sub-resources of an employment (salaries, items, vacations, FGTS records). */
export function useCreateSub() {
  return usePayrollWrite(async ({ householdId, employmentId, resource, body }: SubWriteVars) => {
    await apiClient.post(withQuery(`/payroll/employments/${employmentId}/${resource}`, { householdId }), body);
  });
}

export function useUpdateSub() {
  return usePayrollWrite(async ({ householdId, employmentId, resource, subId, body }: SubWriteVars) => {
    await apiClient.patch(withQuery(`/payroll/employments/${employmentId}/${resource}/${subId}`, { householdId }), body);
  });
}

export function useDeleteSub() {
  return usePayrollWrite(async ({ householdId, employmentId, resource, subId }: SubWriteVars) => {
    await apiClient.delete(withQuery(`/payroll/employments/${employmentId}/${resource}/${subId}`, { householdId }));
  });
}

/** A new value of a fixed item or per-day benefit (the value history). */
export function useCreateItemValue() {
  return usePayrollWrite(async ({ householdId, employmentId, subId, body }: SubWriteVars) => {
    await apiClient.post(withQuery(`/payroll/employments/${employmentId}/items/${subId}/values`, { householdId }), body);
  });
}

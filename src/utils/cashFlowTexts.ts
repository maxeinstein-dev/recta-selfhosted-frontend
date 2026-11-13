/**
 * Texts of the projected cash flow page ("Fluxo de caixa"). The same keys are in i18n/pt-BR.json and i18n/en-US.json;
 * the other locales fall back to Portuguese here (like the capture reader screen), so a missing key never shows its name.
 * Placeholders are written as {name} and filled by cashFlowText.
 */
export const CASH_FLOW_TEXTS_PT = {
  cashFlowNavLabel: 'Fluxo de caixa',
  cashFlowTitle: 'Fluxo de caixa projetado',
  cashFlowDescription: 'Quanto as contas de dinheiro devem ter dia a dia, usando só o que já se sabe.',
  cashFlowPeriodLabel: 'Período',
  cashFlowDaysUnit: 'dias',
  cashFlowAccountLabel: 'Conta',
  cashFlowAllAccounts: 'Todas as contas de dinheiro',

  cashFlowTodayBalance: 'Saldo de hoje',
  cashFlowLowestBalance: 'Menor saldo',
  cashFlowOnDate: 'em {date}',
  cashFlowFirstNegative: 'Primeiro dia negativo',
  cashFlowNoNegativeDay: 'Nenhum dia negativo',
  cashFlowNegativeWarning: 'A conta fica negativa em {date}. Os eventos desse dia estão na lista abaixo.',
  cashFlowEndBalance: 'Saldo em {date}',

  // Aviso do celular: só fatos calculados, sem sugestão do que fazer (lote R4).
  cashFlowMissingAmount: 'faltam {amount}',
  cashFlowWarnNegativeFrom: 'A conta fica negativa em {date}.',
  cashFlowWarnWorst: 'O pior dia é {date}, quando faltam {amount}.',
  cashFlowWarnBackPositive: 'O saldo volta ao positivo em {date}.',
  cashFlowWarnStaysNegative: 'O saldo não volta ao positivo até {date}.',
  cashFlowTodayWord: 'Hoje',

  cashFlowChartTitle: 'Saldo dia a dia',
  cashFlowChartLabel: 'Gráfico do saldo dia a dia. Menor saldo: {amount}, em {date}.',
  cashFlowZeroLine: 'zero',

  cashFlowEventsTitle: 'Eventos por dia',
  cashFlowNoEvents: 'Nenhum evento previsto neste período. O saldo se mantém.',
  cashFlowEndOfDay: 'Saldo no fim do dia',
  cashFlowDayInflow: 'Entradas',
  cashFlowDayOutflow: 'Saídas',
  cashFlowNoDescription: 'Sem descrição',
  cashFlowSourcePending: 'Pendente',
  cashFlowSourceRecurrence: 'Recorrência',
  cashFlowSourceInvoice: 'Fatura',
  cashFlowSourcePayroll: 'Renda',
  cashFlowSourceReserve: 'Guardar',
  cashFlowFreeBalance: 'Livre · na conta {total}, guardado {kept}',
  cashFlowMarkReserveDone: 'Marcar como feito',
  cashFlowMarkReserveDoneFor: 'Marcar {name} como feito',
  cashFlowSourceOther: 'Outra origem',
  cashFlowCertaintyConfirmed: 'Confirmado',
  cashFlowCertaintyExpected: 'Previsto',
  cashFlowCertaintyEstimated: 'Estimado',
  cashFlowBadgeEstimated: 'Estimado',
  cashFlowBadgeOverdue: 'Atrasado',
  cashFlowOverdueFrom: 'venceu em {date}',

  cashFlowEstimatedOne: 'Um evento é estimado: o valor não é firme.',
  cashFlowEstimatedMany: '{count} eventos são estimados: o valor não é firme.',
  cashFlowNotIncluded:
    'Não inclui o gasto do dia a dia (mercado, combustível, lazer) nem entradas que não são recorrência, como um Pix avulso ou um reembolso.',

  cashFlowUnassignedTitle: 'Faturas sem conta pagadora',
  cashFlowUnassignedIntro:
    'Estas faturas não entraram no saldo, porque não há conta para pagá-las. Vincule uma conta ao cartão, ou pague uma fatura por uma conta, para ela passar a contar.',
  cashFlowUnassignedLine: '{card}, fatura de {month}',
  cashFlowUnassignedNoDue: 'sem dia de vencimento',
  cashFlowUnassignedNoPayer: 'sem conta pagadora',
  cashFlowUnassignedDue: 'vence em {date}',

  cashFlowLoading: 'Calculando a projeção…',
  cashFlowLoadError: 'Não foi possível calcular a projeção.',
  cashFlowRetry: 'Tentar de novo',
  cashFlowCurrencyMismatch:
    'As contas de dinheiro usam moedas diferentes. Escolha uma conta específica para ver a projeção.',
} as const;

export type CashFlowTextKey = keyof typeof CASH_FLOW_TEXTS_PT;

/** The text for [key] in the current locale (translations: the `t` object), or Portuguese when it does not have it. */
export function cashFlowText(
  translations: unknown,
  key: CashFlowTextKey,
  vars?: Record<string, string | number>,
): string {
  const value = (translations as Record<string, unknown> | null | undefined)?.[key];
  const template = typeof value === 'string' && value ? value : CASH_FLOW_TEXTS_PT[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

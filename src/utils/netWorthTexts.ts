/**
 * Texts of the net worth page ("Patrimônio"). Like the cash flow page, the keys may be in the locale files; the other
 * locales fall back to Portuguese here, so a missing key never shows its name. Placeholders are written as {name}.
 */
export const NET_WORTH_TEXTS_PT = {
  netWorthNavLabel: 'Patrimônio',
  netWorthTitle: 'Patrimônio',
  netWorthDescription: 'Quanto você tem ao todo e como isso evolui mês a mês. É acompanhamento, não recomendação.',
  netWorthPeriodLabel: 'Período',
  netWorthMonthsUnit: 'meses',
  netWorthTotalLabel: 'Patrimônio em {month}',
  netWorthChange: '{amount} em relação a {month}',
  netWorthChangePercent: '{amount} ({percent}) em relação a {month}',
  netWorthFormula: 'Contas + investimentos + FGTS − dívida do cartão.',
  netWorthEstimatedNotice: 'Inclui valores estimados: {kinds}.',
  netWorthKindInvestment: 'investimentos sem valor informado',
  netWorthKindFgts: 'FGTS',
  netWorthKindCash: 'contas',
  netWorthKindReserve: 'reservas',
  netWorthKindCard: 'cartões',
  netWorthHistoryNotice:
    'Os meses anteriores são reconstruídos a partir dos lançamentos pagos; o mês atual é o saldo de hoje.',

  netWorthCompositionTitle: 'De que é feito',
  netWorthGroupCash: 'Contas de dinheiro',
  netWorthGroupInvestment: 'Investimentos',
  netWorthGroupReserve: 'Reservas',
  netWorthGroupFgts: 'FGTS',
  netWorthGroupCard: 'Dívida do cartão',
  netWorthBadgeEstimated: 'Estimado',
  netWorthValueOn: 'valor de {date}',
  netWorthNoValue: 'sem valor informado: conta o que foi aportado',
  netWorthFgtsHint: 'Saldo informado mais depósitos calculados. Não é o extrato.',
  netWorthEmpty: 'Ainda não há contas para somar. Cadastre uma conta para ver o patrimônio.',

  netWorthChartTitle: 'Evolução do patrimônio',
  netWorthChartLabel: 'Gráfico do patrimônio mês a mês. Último valor: {amount}.',

  netWorthSavingsTitle: 'Poupança do mês',
  netWorthSavingsBasis: 'Em {month}, sobre a renda realizada (o que já entrou).',
  netWorthSavingsRate: 'Taxa de poupança',
  netWorthSavingsIncome: 'Renda realizada',
  netWorthSavingsExpense: 'Gastos pagos',
  netWorthSavingsSurplus: 'Sobra',
  netWorthSavingsContributed: 'Aportado em investimentos',
  netWorthSavingsContributedHint: 'já está dentro da sobra',
  netWorthSavingsNone: 'Nenhum mês do período tem renda realizada, então não há taxa a mostrar.',

  netWorthValuationTitle: 'Valor de mercado do investimento',
  netWorthValuationIntro:
    'Informe o valor que aparece no extrato da corretora. O rendimento não vira renda do mês; um aporte continua sendo uma transferência para a conta.',
  netWorthValuationNoAccount: 'Cadastre uma conta do tipo Investimento para informar o valor dela.',
  netWorthValuationAccount: 'Conta',
  netWorthValuationDate: 'Data do valor',
  netWorthValuationAmount: 'Valor',
  netWorthValuationSave: 'Salvar valor',
  netWorthValuationSaving: 'Salvando…',
  netWorthValuationSaved: 'Valor salvo.',
  netWorthValuationDeleted: 'Valor removido.',
  netWorthValuationReplaceHint: 'Já existe um valor nesta data: salvar substitui.',
  netWorthValuationHistory: 'Valores informados',
  netWorthValuationNoHistory: 'Nenhum valor informado ainda para esta conta.',
  netWorthValuationDelete: 'Remover o valor de {date}',
  netWorthErrorDate: 'Informe uma data válida.',
  netWorthErrorFuture: 'A data não pode ser futura.',
  netWorthErrorAmount: 'Informe o valor, mesmo que seja zero.',
  netWorthLoadError: 'Não foi possível carregar o patrimônio.',
  netWorthRetry: 'Tentar de novo',
} as const;

export type NetWorthTextKey = keyof typeof NET_WORTH_TEXTS_PT;

/** The text for [key] in the current locale (translations: the `t` object), or Portuguese when it does not have it. */
export function netWorthText(
  translations: unknown,
  key: NetWorthTextKey,
  vars?: Record<string, string | number>,
): string {
  const value = (translations as Record<string, unknown> | null | undefined)?.[key];
  const template = typeof value === 'string' && value ? value : NET_WORTH_TEXTS_PT[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

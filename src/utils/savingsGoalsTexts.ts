/**
 * Texts of the savings goals plan (P03: reserve, provision, "Guardar agora", free and kept money). The same keys are in
 * i18n/pt-BR.json and i18n/en-US.json; the other locales fall back to Portuguese here, so a missing key never shows its
 * name. Placeholders are written as {name} and filled by goalsText.
 */
export const GOALS_TEXTS_PT = {
  goalsKindLabel: 'Tipo',
  goalsKindReserve: 'Reserva',
  goalsKindProvision: 'Provisão',
  goalsKindReserveHint: 'Dinheiro guardado aos poucos, sem data para usar.',
  goalsKindProvisionHint: 'Uma despesa com mês certo (seguro, IPVA): o aporte divide o que falta pelos meses até lá.',
  goalsMonthlyLabel: 'Aporte mensal',
  goalsMonthlyOptionalProvision: 'Deixe vazio para calcular pelo que falta.',
  goalsDayLabel: 'Dia do aporte (1 a 28)',
  goalsDueMonthLabel: 'Mês de vencimento',
  goalsAccountRequired: 'Conta onde o dinheiro fica',
  goalsAccountHint: 'O dinheiro não sai da conta: só fica marcado como guardado.',
  goalsErrAccountRequired: 'Escolha a conta onde o dinheiro fica.',
  goalsErrDayRequired: 'Informe o dia do aporte.',
  goalsErrDayRange: 'O dia vai de 1 a 28.',
  goalsErrDueMonth: 'Informe o mês de vencimento.',
  goalsProvisionPreview: 'Aporte deste mês: {amount}, até {month}.',
  goalsProvisionPast: 'O mês de vencimento já passou: nada a guardar.',

  goalsThisMonth: 'Aporte do mês',
  goalsStatusPending: 'Pendente: {amount} no dia {day}',
  goalsStatusPendingNoDay: 'Pendente: {amount}',
  goalsStatusLate: 'Atrasado',
  goalsStatusDone: 'Feito: {amount}',
  goalsStatusNone: 'Nenhum aporte planejado',
  goalsKeepNow: 'Guardar agora',
  goalsKeepNowFor: 'Guardar agora em {name}',
  goalsKeepMore: 'Guardar mais',
  goalsKeeping: 'Guardando…',
  goalsUndo: 'Desfazer aporte',
  goalsUndoFor: 'Desfazer o último aporte de {name}',
  goalsUndone: 'Aporte desfeito.',
  goalsKeptToast: '{amount} guardado em {name}.',
  goalsAmountLabel: 'Quanto guardar',
  goalsAmountConfirm: 'Guardar',
  goalsAmountCancel: 'Cancelar',
  goalsDuplicateTitle: 'Já houve aporte neste mês',
  goalsDuplicateMessage: '{name} já recebeu um aporte neste mês. Guardar mais um?',
  goalsDuplicateConfirm: 'Guardar mais um',
  goalsErrAmount: 'Informe um valor maior que zero.',
  goalsErrExceeds: 'O valor passa da meta. O máximo é {amount}.',
  goalsErrNoAccount: 'Ligue a meta a uma conta antes de guardar.',
  goalsErrNothingPlanned: 'Nada planejado para este mês: informe o valor.',
  goalsErrContribute: 'Não foi possível guardar.',
  goalsErrUndo: 'Não foi possível desfazer o aporte.',

  goalsAccountBalance: 'Saldo da conta',
  goalsAccountFree: 'Livre',
  goalsAccountKept: 'Guardado',
  goalsFreeNegative: 'O guardado passa do saldo: o livre de {account} está negativo ({amount}).',
  goalsReserveFor: 'Guardar: {name}',
} as const;

export type GoalsTextKey = keyof typeof GOALS_TEXTS_PT;

/** The text for [key] in the current locale (translations: the `t` object), or Portuguese when it does not have it. */
export function goalsText(translations: unknown, key: GoalsTextKey, vars?: Record<string, string | number>): string {
  const value = (translations as Record<string, unknown> | null | undefined)?.[key];
  const template = typeof value === 'string' && value ? value : GOALS_TEXTS_PT[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

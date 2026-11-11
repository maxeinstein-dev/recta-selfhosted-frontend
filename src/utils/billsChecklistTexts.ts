/**
 * Texts of the "Contas a pagar" checklist. The same keys are in i18n/pt-BR.json and i18n/en-US.json; the other locales
 * fall back to Portuguese here (like the cash flow page), so a missing key never shows its name. Placeholders are written
 * as {name} and filled by billsText.
 */
export const BILLS_TEXTS_PT = {
  billsTitle: 'Contas a pagar',
  billsTotalCaption: 'a pagar até o fim do mês, com as atrasadas',
  billsPaidCounter: '{paid} de {total} pagas',
  billsFilterLabel: 'Filtrar por vencimento',
  billsFilterAll: 'Todas',
  billsFilterOverdue: 'Atrasadas',
  billsPillLabel: 'Dia {day}: {count} {noun}',
  billsNounOne: 'conta',
  billsNounMany: 'contas',
  billsOverdueLabel: 'Atrasadas: {count} {noun}',
  billsLoading: 'Carregando as contas…',
  billsLoadError: 'Não foi possível carregar as contas a pagar.',
  billsRetry: 'Tentar de novo',
  billsEmpty: 'Nenhuma conta a pagar neste mês.',
  billsEmptyAllPaid: 'Tudo pago neste mês.',
  billsSourcePending: 'Lançamento',
  billsSourceRecurrence: 'Recorrência',
  billsSourceInvoice: 'Fatura',
  billsSourceOther: 'Outra origem',
  billsBadgeEstimated: 'Estimado',
  billsBadgeOverdue: 'Atrasada',
  billsOverdueFrom: 'venceu em {date}',
  billsDueOn: 'vence em {date}',
  billsMarkPaid: 'Marcar {name} como paga',
  billsPayInvoice: 'Pagar fatura',
  billsPayInvoiceFor: 'Pagar a fatura {name}',
  billsRecurrenceLater: 'Será gerada na data de vencimento.',
  billsNoAction: 'Sem ação nesta tela.',
  billsMarking: 'Marcando…',
  billsPaidToast: 'Conta marcada como paga.',
  billsConfirmValueToast: 'Confirme o valor real para concluir.',
  billsAlreadyGenerated: 'Esta ocorrência já existia e não foi gerada de novo.',
  billsMarkError: 'Não foi possível marcar como paga.',
  billsNoDescription: 'Sem descrição',
} as const;

export type BillsTextKey = keyof typeof BILLS_TEXTS_PT;

/** The text for [key] in the current locale (translations: the `t` object), or Portuguese when it does not have it. */
export function billsText(
  translations: unknown,
  key: BillsTextKey,
  vars?: Record<string, string | number>,
): string {
  const value = (translations as Record<string, unknown> | null | undefined)?.[key];
  const template = typeof value === 'string' && value ? value : BILLS_TEXTS_PT[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

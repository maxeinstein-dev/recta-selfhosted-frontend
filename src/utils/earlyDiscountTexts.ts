/**
 * Texts of the early-payment discount (recurrence form, "Pague até ... e economize" notice, "Pagar agora"). Portuguese is
 * the fallback for every locale, so a missing key never shows its name. Placeholders are written as {name}.
 */
export const EARLY_DISCOUNT_TEXTS_PT = {
  // Form
  earlyDiscountTitle: 'Desconto por pagar antes',
  earlyDiscountDayLabel: 'Desconto se pagar até o dia',
  earlyDiscountDayHelp: 'Dia do mês do vencimento (1 a 31). Deixe em branco se a conta não tem desconto.',
  earlyDiscountTypeLabel: 'Tipo do desconto',
  earlyDiscountTypeFixed: 'Valor fixo (R$)',
  earlyDiscountTypePercent: 'Percentual (%)',
  earlyDiscountValueLabelFixed: 'Desconto em reais',
  earlyDiscountValueLabelPercent: 'Desconto em %',
  earlyDiscountPreview: 'Pagando até o dia {day}: {discounted} (economiza {savings})',
  earlyDiscountPreviewPercentNote: 'O percentual é arredondado para cima no centavo.',

  // Validation (same rules as the server)
  earlyDiscountIncomplete: 'Preencha o dia e o valor do desconto, ou deixe os dois em branco.',
  earlyDiscountDayInvalid: 'O dia do desconto deve ser um número inteiro de 1 a 31.',
  earlyDiscountValueInvalid: 'Digite o desconto com até 2 casas decimais.',
  earlyDiscountAmountNeeded: 'O desconto precisa de um valor da conta maior que zero.',
  earlyDiscountPercentRange: 'O percentual deve ser maior que 0 e menor que 100.',
  earlyDiscountFixedPositive: 'O desconto fixo deve ser maior que zero.',
  earlyDiscountFixedTooBig: 'O desconto fixo deve ser menor que o valor da conta.',
  earlyDiscountNoEffect: 'O desconto deve deixar o valor acima de zero e abaixo do valor da conta.',

  // Notice on a bill / cash flow event
  earlyDiscountNotice: 'Pague até {date} e economize {amount}',
  earlyDiscountLastDay: 'Último dia com desconto',
  earlyDiscountDaysLeftOne: 'Falta 1 dia',
  earlyDiscountDaysLeftMany: 'Faltam {days} dias',
  earlyDiscountChip: 'Desconto até {date}',
  recurrenceDiscountChip: 'Desconto até o dia {day}',

  // Paying now
  earlyPayNow: 'Pagar agora',
  earlyPayNowFor: 'Pagar agora {name}',
  earlyPaying: 'Pagando…',
  earlyPaidToast: 'Conta paga: {amount}.',
  earlyPaidToastPlain: 'Conta paga.',
  earlyPayConflict: 'Esta conta já foi paga ou a recorrência já avançou. A lista foi atualizada.',
  earlyPayInactive: 'Esta recorrência está inativa ou encerrada, então não há conta para pagar.',
  earlyPayError: 'Não foi possível pagar agora. Tente de novo.',
} as const;

export type EarlyDiscountTextKey = keyof typeof EARLY_DISCOUNT_TEXTS_PT;

/** The text for [key] in the current locale (translations: the `t` object), or Portuguese when it does not have it. */
export function earlyDiscountText(
  translations: unknown,
  key: EarlyDiscountTextKey,
  vars?: Record<string, string | number>,
): string {
  const value = (translations as Record<string, unknown> | null | undefined)?.[key];
  const template = typeof value === 'string' && value ? value : EARLY_DISCOUNT_TEXTS_PT[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

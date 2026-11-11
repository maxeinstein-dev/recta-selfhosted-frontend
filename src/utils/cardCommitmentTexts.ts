/**
 * Texts of the card commitment panel (on the credit card page). The same keys are in i18n/pt-BR.json and i18n/en-US.json;
 * other locales fall back to Portuguese here (like the cash flow screen), so a missing key never shows its name.
 * Placeholders are written as {name} and filled by cardCommitmentText.
 */
export const CARD_COMMITMENT_TEXTS_PT = {
  cardCommitTitle: 'Comprometimento do cartão',
  cardCommitDescription: 'Quanto das próximas faturas já está comprometido, com as recorrências que ainda vão cair.',
  cardCommitMonthsLabel: 'Quantidade de meses',
  cardCommitMonthsOption: '{count} meses',

  cardCommitTotal: 'Total previsto no período',
  cardCommitShareOfIncome: '{share} da renda esperada',
  cardCommitNoIncome: 'Sem renda prevista neste mês',
  cardCommitHeaviestMonth: 'Mês mais pesado: {month}',

  cardCommitPosted: 'Já lançado',
  cardCommitForecast: 'Recorrências previstas',
  cardCommitHeaviest: 'Mais pesado',
  cardCommitOverIncome: 'Acima da renda esperada',

  cardCommitRiseWarning:
    'A fatura de {month} ({amount}) passa da fatura de {base}: alguma compra parcelada ou recorrência pesa nos meses seguintes.',

  cardCommitNotIncluded:
    'Renda = só recorrências mensais de receita. Entradas avulsas (Pix, reembolso, ajuda de família) não entram.',

  cardCommitLoading: 'Calculando o comprometimento…',
  cardCommitLoadError: 'Não foi possível calcular o comprometimento.',
  cardCommitRetry: 'Tentar de novo',
  cardCommitEmpty: 'Nenhuma fatura deste cartão tem compromisso previsto nesses meses.',
};

export type CardCommitmentTextKey = keyof typeof CARD_COMMITMENT_TEXTS_PT;

/** The text for a key in the given translations, or the Portuguese one when the locale does not have it yet. */
export function cardCommitmentText(
  translations: unknown,
  key: CardCommitmentTextKey,
  vars?: Record<string, string | number>,
): string {
  const value = (translations as Record<string, unknown> | null | undefined)?.[key];
  const template = typeof value === 'string' && value ? value : CARD_COMMITMENT_TEXTS_PT[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

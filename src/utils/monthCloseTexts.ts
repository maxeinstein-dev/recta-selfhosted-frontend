/**
 * Texts of the month close page ("Fechamento do mês"). The other locales fall back to Portuguese here (like the cash flow
 * page), so a missing key never shows its name. Placeholders are written as {name} and filled by monthCloseText.
 */
export const MONTH_CLOSE_TEXTS_PT = {
  monthCloseNavLabel: 'Fechamento',
  monthCloseTitle: 'Fechamento do mês',
  monthCloseDescription: 'Confira cada conta e cartão com o extrato e veja o que ainda falta. Aqui nada é alterado: cada pendência leva à tela onde se resolve.',
  monthClosePrevious: 'Mês anterior',
  monthCloseNext: 'Próximo mês',
  monthCloseLoading: 'Conferindo o mês…',
  monthCloseLoadError: 'Não foi possível conferir o mês.',
  monthCloseRetry: 'Tentar de novo',

  monthCloseAllDone: 'Nenhuma pendência neste mês.',
  monthClosePendingCount: '{count} pendência(s) neste mês.',

  monthCloseAccountsTitle: 'Contas',
  monthCloseCardsTitle: 'Cartões',
  monthCloseGeneralTitle: 'Geral',
  monthCloseNoAccounts: 'Nenhuma conta de dinheiro.',
  monthCloseSystemBalance: 'Saldo no sistema em {date}',
  monthCloseInvoiceTotal: 'Fatura do mês no sistema',
  monthCloseInvoiceState: 'Fatura {state}',
  monthCloseStateOpen: 'aberta',
  monthCloseStateClosed: 'fechada',
  monthCloseStatePaid: 'paga',

  monthCloseInformedLabel: 'Saldo do extrato',
  monthCloseInformedLabelCard: 'Total da fatura no extrato',
  monthCloseInformedHint: 'Ex.: 1.234,56 (use - para saldo negativo)',
  monthCloseInvalidAmount: 'Digite um valor válido, com até duas casas decimais.',
  monthCloseMatches: 'Bate com o sistema.',
  monthCloseDiffers: 'Não bate: o extrato tem {amount} {direction} que o sistema.',
  monthCloseMore: 'a mais',
  monthCloseLess: 'a menos',
  monthCloseConfer: 'Registrar conferência',
  monthCloseSaving: 'Registrando…',
  monthCloseSaveError: 'Não foi possível registrar a conferência.',

  monthCloseConferredOn: 'Conferido em {date}',
  monthCloseConferredDiffers: 'Conferido em {date}, com diferença de {amount}.',
  monthCloseChanged: 'Conferido em {date}, mas algo deste mês mudou depois. Confira de novo.',

  monthCloseOk: 'Sem pendências',
  monthCloseHasBlockers: 'Com pendências',
  monthCloseBlockPending: '{count} lançamento(s) não pago(s) no mês ({amount})',
  monthCloseBlockInvoiceOpen: 'A fatura ainda não fechou',
  monthCloseBlockReviewQueue: '{count} compra(s) da planilha sem linha no extrato',
  monthCloseBlockUncategorized: '{count} lançamento(s) sem categoria',
  monthCloseBlockCaptures: '{count} notificação(ões) do banco aguardando decisão',
  monthCloseGo: 'Resolver',
} as const;

export type MonthCloseTextKey = keyof typeof MONTH_CLOSE_TEXTS_PT;

/** The text for [key] in the current locale (translations: the `t` object), or Portuguese when it does not have it. */
export function monthCloseText(
  translations: unknown,
  key: MonthCloseTextKey,
  vars?: Record<string, string | number>,
): string {
  const value = (translations as Record<string, unknown> | null | undefined)?.[key];
  const template = typeof value === 'string' && value ? value : MONTH_CLOSE_TEXTS_PT[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

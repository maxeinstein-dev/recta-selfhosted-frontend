/**
 * Texts of the capture reader screen. The same keys are in i18n/pt-BR.json and i18n/en-US.json; the other locales fall
 * back to Portuguese here (like the other recent screens), so a missing key never shows its own name.
 */
export const CAPTURE_TEXTS_PT = {
  captureSectionTitle: 'Leitor de notificações',
  captureSectionIntro:
    'Este aparelho lê as notificações do Nubank e do Mercado Pago e envia o texto ao Recta para você confirmar. Notificações de qualquer outro app não são lidas nem enviadas.',
  captureStatusOk: 'Tudo certo',
  captureStatusAttention: 'Precisa de atenção',
  captureStatusError: 'Não está capturando',
  captureRefresh: 'Atualizar',

  captureLinkTitle: 'Vínculo com o Recta',
  captureLinked: 'Aparelho vinculado',
  captureNotLinked: 'Aparelho não vinculado',
  captureLinkButton: 'Vincular este aparelho',
  captureLinking: 'Vinculando…',
  captureUnlinkButton: 'Desvincular',
  captureUnlinking: 'Desvinculando…',
  captureUnlinkLocalOnly: 'Esquecer só neste aparelho',
  captureLinkedToast: 'Aparelho vinculado.',
  captureUnlinkedToast: 'Aparelho desvinculado.',
  captureLinkFailed: 'Não foi possível vincular o aparelho. Confira a conexão e tente de novo.',
  captureUnlinkFailed:
    'Não foi possível revogar o aparelho no servidor. Tente de novo com internet, ou use "Esquecer só neste aparelho" (o token continua válido no servidor até ser revogado).',
  captureApiUrlMissing: 'Este app foi compilado sem o endereço https da API (VITE_API_BASE_URL).',

  captureAccessTitle: 'Acesso às notificações',
  captureAccessOn: 'Concedido',
  captureAccessOff: 'Não concedido',
  captureAccessOpen: 'Abrir acesso às notificações',
  captureAppInfoOpen: 'Abrir informações do app',
  captureAccessRestrictedHint:
    'Se o app foi instalado por fora da loja e a tela não deixa ativar: abra as informações do app, toque nos três pontos e escolha "Permitir configurações restritas". Depois volte e ative o Recta.',

  captureBatteryTitle: 'Bateria',
  captureBatteryOk: 'Sem restrição',
  captureBatteryRestricted: 'Otimizada: o sistema pode encerrar o leitor',
  captureBatteryOpen: 'Abrir otimização de bateria',
  captureBatteryHint:
    'Escolha "Todos os apps", encontre o Recta e marque "Não otimizar". No One UI, tire também o Recta de "Apps em suspensão".',

  captureQueueTitle: 'Fila de envio',
  capturePending: 'Pendentes',
  captureSent: 'Enviadas',
  captureRejected: 'Recusadas',
  captureLastSent: 'Último envio',
  captureLastError: 'Último erro',
  captureNever: 'Nunca',
  captureSendNow: 'Enviar agora',
  captureSending: 'Agendando…',
  captureSendQueued: 'Envio agendado. Se a API estiver dormindo, pode levar até um minuto.',
  captureSendFailed: 'Não foi possível agendar o envio.',
  captureOpenFailed: 'Não foi possível abrir essa tela de configurações.',

  captureIssuePluginUnavailable: 'O leitor nativo não respondeu. Feche e abra o app.',
  captureIssueSecureStorage: 'O armazenamento seguro deste aparelho não está disponível; o token não pode ser guardado.',
  captureIssueNotLinked: 'Vincule o aparelho para enviar as capturas ao Recta.',
  captureIssueAccessOff: 'Sem o acesso às notificações nada é capturado.',
  captureIssueAuth: 'O servidor recusou o token (revogado ou sem permissão). Desvincule e vincule o aparelho de novo.',
  captureIssueBattery: 'A otimização de bateria pode encerrar o leitor com o app fechado.',
  captureIssueSendFailing: 'Há capturas esperando: o último envio falhou e será repetido automaticamente.',
  captureIssueRejected: 'O servidor recusou algumas notificações; elas ficam guardadas no aparelho e não são reenviadas.',
} as const;

export type CaptureTextKey = keyof typeof CAPTURE_TEXTS_PT;

/** The text for [key] in the current locale, or Portuguese when that locale does not have it yet. */
export function captureText(translations: unknown, key: CaptureTextKey): string {
  const value = (translations as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === 'string' && value ? value : CAPTURE_TEXTS_PT[key];
}

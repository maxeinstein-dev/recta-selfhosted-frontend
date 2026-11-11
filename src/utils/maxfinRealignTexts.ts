/**
 * Texts of the shifted rows / realignment part of the MaxFin importer. The same keys are in i18n/pt-BR.json and
 * i18n/en-US.json; other locales fall back to Portuguese here, so a missing key never shows its name.
 * Placeholders are written as {name} and filled by maxfinRealignText. The `reason` and `detail` texts that come from
 * the server are pt-BR and are shown as they arrive.
 */
export const MAXFIN_REALIGN_TEXTS_PT = {
  maxfinRealignTitle: 'Linhas deslocadas na planilha',
  maxfinRealignNote: 'Realinhar só muda a posição da linha na planilha: valores, datas e descrições não são alterados.',
  maxfinRealignApply: 'Realinhar',
  maxfinRealignApplyLabel: 'Realinhar {section}, linhas {first} a {last}',

  maxfinRealignLinesOne: '{count} linha',
  maxfinRealignLinesMany: '{count} linhas',
  maxfinRealignRange: 'linhas {first} a {last} da planilha',
  maxfinRealignInsertionOne: '{count} lançamento desce {lines} (linhas inseridas acima)',
  maxfinRealignInsertionMany: '{count} lançamentos descem {lines} (linhas inseridas acima)',
  maxfinRealignRemovalOne: '{count} lançamento sobe {lines} (linhas removidas acima)',
  maxfinRealignRemovalMany: '{count} lançamentos sobem {lines} (linhas removidas acima)',
  maxfinRealignRemovedOne: '{count} lançamento removido da planilha continua no Recta e assume a linha que o bloco desocupa',
  maxfinRealignRemovedMany: '{count} lançamentos removidos da planilha continuam no Recta e assumem as linhas que o bloco desocupa',
  maxfinRealignInsertedOne: '{count} linha nova só entra depois deste realinhamento',
  maxfinRealignInsertedMany: '{count} linhas novas só entram depois deste realinhamento',

  maxfinRealignAmbiguous: 'Ambígua',
  maxfinRealignAmbiguousReason: 'Vem desmarcada: {reason}',
  maxfinRealignRequires: 'Precisa ser aplicado junto com: {list}',
  maxfinRealignTickFirst: 'Marque antes: {list}',
  maxfinRealignMissingRequirement: 'Depende de um bloco que não veio na prévia: não dá para aplicar.',
  maxfinRealignUnsupported: 'Este bloco passa dos limites do envio: fica pendente.',
  maxfinRealignRequiresItem: '{section}, linhas {first} a {last}',

  maxfinRealignRowShifted: 'Deslocada',
  maxfinRealignRowShiftedHint: 'Só mudou de linha na planilha: decidida pelo realinhamento do bloco',
  maxfinRealignShiftedCountOne: '{count} deslocada',
  maxfinRealignShiftedCountMany: '{count} deslocadas',
  maxfinRealignRowShiftedDetail: 'Mesmo lançamento que está hoje na linha {from}; vai para a linha {to} ao realinhar',
  maxfinRealignRowBlocked: 'Fica pendente enquanto o realinhamento do bloco não for aplicado',

  maxfinRealignFooterApplyOne: '{count} bloco será realinhado ({moves})',
  maxfinRealignFooterApplyMany: '{count} blocos serão realinhados ({moves})',
  maxfinRealignFooterMovesOne: '{count} lançamento muda de linha',
  maxfinRealignFooterMovesMany: '{count} lançamentos mudam de linha',
  maxfinRealignFooterPendingOne: '{count} bloco deslocado ficará pendente: nada nele será importado nem substituído',
  maxfinRealignFooterPendingMany: '{count} blocos deslocados ficarão pendentes: nada neles será importado nem substituído',

  maxfinRealignNoneSelected: 'Selecione ao menos uma transação ou um realinhamento.',
  maxfinRealignTooMany: 'Há mais blocos deslocados do que o servidor aceita por vez ({max}): atualize a pré-visualização.',

  maxfinRealignResultTitle: 'Realinhamento',
  maxfinRealignRealignedOne: '{count} lançamento realinhado',
  maxfinRealignRealignedMany: '{count} lançamentos realinhados',
  maxfinRealignOutcomeApplied: 'Realinhado ({moved})',
  maxfinRealignOutcomeAlreadyApplied: 'Já estava realinhado',
  maxfinRealignOutcomeDeclined: 'Deixado pendente',
  maxfinRealignOutcomeSkipped: 'Não aplicado',
  maxfinRealignOutcomeUnknown: 'Resultado desconhecido',
  maxfinRealignOutcomeLine: '{label}: {status}',
  maxfinRealignOutcomeLineReason: '{label}: {status}. {reason}',
  maxfinRealignOutcomeLabel: '{section}, linhas {first} a {last}',
  maxfinRealignOutcomeLabelUnknown: 'Bloco {id}',

  maxfinRealignBlocksOne: '{count} bloco deslocado',
  maxfinRealignBlocksMany: '{count} blocos deslocados',
  maxfinRealignShowMoves: 'Ver os lançamentos',
  maxfinRealignMoveLine: 'Linha {from} → {to}: {description} · {amount}',
};

export type MaxFinRealignTextKey = keyof typeof MAXFIN_REALIGN_TEXTS_PT;

/** Fills one text: (key, vars) -> string. */
export type MaxFinRealignTextFn = (key: MaxFinRealignTextKey, vars?: Record<string, string | number>) => string;

/** The text for a key in the given translations, or the Portuguese one when the locale does not have it yet. */
export function maxfinRealignText(
  translations: unknown,
  key: MaxFinRealignTextKey,
  vars?: Record<string, string | number>,
): string {
  const value = (translations as Record<string, unknown> | null | undefined)?.[key];
  const template = typeof value === 'string' && value ? value : MAXFIN_REALIGN_TEXTS_PT[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** The text function of a translations object. */
export function realignTextFor(translations: unknown): MaxFinRealignTextFn {
  return (key, vars) => maxfinRealignText(translations, key, vars);
}

/** Portuguese: the default of every function that takes a text function. */
export const realignTextPt: MaxFinRealignTextFn = realignTextFor(null);

/** One / many form of a count text: key + 'One' when n is 1, key + 'Many' otherwise. */
export function realignPlural(
  tx: MaxFinRealignTextFn,
  base: 'maxfinRealignBlocks' | 'maxfinRealignLines' | 'maxfinRealignInsertion' | 'maxfinRealignRemoval' | 'maxfinRealignRemoved' | 'maxfinRealignInserted'
    | 'maxfinRealignShiftedCount' | 'maxfinRealignFooterApply' | 'maxfinRealignFooterMoves' | 'maxfinRealignFooterPending'
    | 'maxfinRealignRealigned',
  count: number,
  vars: Record<string, string | number> = {},
): string {
  return tx(`${base}${count === 1 ? 'One' : 'Many'}` as MaxFinRealignTextKey, { count, ...vars });
}

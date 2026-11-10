/** Limits the server enforces on the aliases of a recurrence (kept in step with the backend schema). */
export const MAX_ALIASES = 20;
export const MAX_ALIAS_LENGTH = 100;

/** Loose key to spot an alias typed twice (the server normalizes harder: accents, numbers, punctuation). */
const keyOf = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export type AddAliasResult = { ok: true; aliases: string[] } | { ok: false; reason: 'empty' | 'duplicate' | 'limit' };

/** Adds `text` (trimmed, cut to the limit) to the list unless it is empty, repeated or the list is full. */
export function addAlias(aliases: readonly string[], text: string): AddAliasResult {
  const value = text.trim().slice(0, MAX_ALIAS_LENGTH).trim();
  if (!keyOf(value)) return { ok: false, reason: 'empty' };
  if (aliases.length >= MAX_ALIASES) return { ok: false, reason: 'limit' };
  if (aliases.some((a) => keyOf(a) === keyOf(value))) return { ok: false, reason: 'duplicate' };
  return { ok: true, aliases: [...aliases, value] };
}

export function removeAlias(aliases: readonly string[], index: number): string[] {
  return aliases.filter((_, i) => i !== index);
}

/**
 * A PATCH of a transaction answers 409 when another request changed the same row at the same moment (the update
 * claims the row first). Pure, so it also runs under `tsx`.
 */
export const CONFLICT_MESSAGE =
  'Esta transação acabou de ser alterada por outra operação. Atualize a tela e tente de novo.';

export const isConflict = (err: unknown): boolean => (err as { status?: number } | null)?.status === 409;

/** Text for the toast of a failed update: the conflict in pt-BR, otherwise the error's own message. */
export function updateFailureMessage(err: unknown, fallback = 'Não foi possível atualizar a transação.'): string {
  if (isConflict(err)) return CONFLICT_MESSAGE;
  return err instanceof Error && err.message ? err.message : fallback;
}

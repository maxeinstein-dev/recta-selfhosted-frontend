/**
 * Pure logic of the capture account rules (Settings > Capturas): which account receives each (app, kind) of
 * notification. No React, no imports besides the app/kind lists, so tools/fe-tests/t27_captures_inbox.mts runs it
 * under tsx (CAPTURE_RULES_MODULE points it at a mutated copy).
 *
 * GET /captures/account-rules answers every rule of the household; PUT /captures/account-rules REPLACES all of them.
 * So the body is built from the whole list: the rows the screen shows come from the draft, and any rule the screen
 * does not show (another app, another kind) is sent back unchanged. A PUT that dropped it would delete it.
 */
import { CAPTURE_APPS, CAPTURE_KINDS } from './captureInbox';

export interface AccountRule {
  package: string;
  kind: string;
  accountId: string;
}

/** ruleKey(package, kind) -> accountId, '' for "no rule" (the server then gets no row for that pair). */
export type RulesDraft = Record<string, string>;

export const ruleKey = (pkg: string, kind: string): string => `${pkg}|${kind}`;

/** Every (app, kind) pair the screen shows, in screen order. */
export function shownRulePairs(): Array<{ package: string; kind: string }> {
  return CAPTURE_APPS.flatMap((app) => CAPTURE_KINDS.map((kind) => ({ package: app.package, kind })));
}

/** The draft the screen starts from: the shown pairs with their account, '' where there is no rule. */
export function draftFromRules(rules: readonly AccountRule[]): RulesDraft {
  const draft: RulesDraft = {};
  for (const pair of shownRulePairs()) draft[ruleKey(pair.package, pair.kind)] = '';
  for (const rule of rules) {
    const key = ruleKey(rule.package, rule.kind);
    if (key in draft) draft[key] = rule.accountId;
  }
  return draft;
}

/** True when the draft differs from what the server has for the shown pairs. */
export function isRulesDraftChanged(draft: RulesDraft, rules: readonly AccountRule[]): boolean {
  const original = draftFromRules(rules);
  return shownRulePairs().some((pair) => {
    const key = ruleKey(pair.package, pair.kind);
    return (draft[key] ?? '').trim() !== original[key];
  });
}

/**
 * The body of PUT /captures/account-rules: the draft's rules for the shown pairs (blank ones left out), plus the
 * server's rules the screen does not show, in the same order. Sorted by package, then kind, so the same state always
 * sends the same body.
 */
export function buildRulesBody(draft: RulesDraft, rules: readonly AccountRule[]): { rules: AccountRule[] } {
  const shown = new Set(shownRulePairs().map((pair) => ruleKey(pair.package, pair.kind)));
  const kept = rules
    .filter((rule) => !shown.has(ruleKey(rule.package, rule.kind)))
    .map((rule) => ({ package: rule.package, kind: rule.kind, accountId: rule.accountId }));
  const fromDraft: AccountRule[] = [];
  for (const pair of shownRulePairs()) {
    const accountId = (draft[ruleKey(pair.package, pair.kind)] ?? '').trim();
    if (accountId) fromDraft.push({ package: pair.package, kind: pair.kind, accountId });
  }
  const all = [...kept, ...fromDraft].sort((a, b) => a.package.localeCompare(b.package) || a.kind.localeCompare(b.kind));
  return { rules: all };
}

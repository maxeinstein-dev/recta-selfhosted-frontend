/**
 * Pure logic of the "Organizar divisões" wizard: the options of the preview, the default and reconciled choices, the
 * people registry (who is a new person, who is merged into whom, aliases), the resolution of the review lines, the
 * apply payload and the numbers shown next to it (one source for both), the blocker and the result texts. Like
 * cardOfx.ts: no React, no axios and no `import.meta`, so it also runs under `tsx`.
 *
 * The server owns the proposals. The client only chooses among them (proposalIds / settlementIds), resolves the free
 * text lines by hand (`manual`) and says who the new people are (`people`, with aliases and `existingId` to merge).
 * Amounts are integer cents here; reais only on the wire.
 */
import { normalizeLabel } from './maxfinPayload';
import { MAX_ALIASES, MAX_PERSON_NAME, centsToReais, isValidIsoDate, moneyText, parseMoneyToCents, parsePercentToHundredths, reaisToCents } from './people';
import type {
  OrganizeApplyInput, OrganizeApplyPerson, OrganizeApplyResult, OrganizeManualEntry, OrganizeOptions, OrganizePreview, Person,
  ReviewLine, SettlementProposal, ShareDirection, ShareProposal,
} from '../hooks/api/usePeople';

// ---- Options of the preview -----------------------------------------------------------------------------------

export interface OrganizeOptionsDraft {
  onlyImported: boolean;
  /** YYYY-MM-DD or '' */
  startDate: string;
  endDate: string;
}

export const DEFAULT_OPTIONS_DRAFT: OrganizeOptionsDraft = { onlyImported: true, startDate: '', endDate: '' };

export interface OrganizeOptionsResult {
  options: OrganizeOptions | null;
  error: string | null;
}

export function buildOrganizeOptions(householdId: string, draft: OrganizeOptionsDraft): OrganizeOptionsResult {
  if (!householdId) return { options: null, error: 'Nenhuma household selecionada.' };
  if (draft.startDate && !isValidIsoDate(draft.startDate)) return { options: null, error: 'A data inicial é inválida.' };
  if (draft.endDate && !isValidIsoDate(draft.endDate)) return { options: null, error: 'A data final é inválida.' };
  if (draft.startDate && draft.endDate && draft.startDate > draft.endDate) {
    return { options: null, error: 'A data inicial é depois da data final.' };
  }
  const options: OrganizeOptions = { householdId, onlyImported: draft.onlyImported };
  if (draft.startDate) options.startDate = draft.startDate;
  if (draft.endDate) options.endDate = draft.endDate;
  return { options, error: null };
}

// ---- Choices ----------------------------------------------------------------------------------------------------

export interface ReviewResolution {
  include: boolean;
  /** '' (nobody) | 'p:<personId>' (registered) | 'd:<detectedKey>' (detected as new) | 'new' (typed in `newName`) */
  personRef: string;
  newName: string;
  direction: ShareDirection;
  mode: 'amount' | 'percent';
  amountText: string;
  percentText: string;
}

export interface OrganizeChoices {
  proposals: Record<string, boolean>;
  /** Adjusted amount of a proposal (text); '' or absent = the server's amount. A proposal with one goes as `manual`. */
  proposalAmounts: Record<string, string>;
  settlements: Record<string, boolean>;
  /** By review key (the transaction id; a repeated one gets "#2", "#3"...). */
  review: Record<string, ReviewResolution>;
  /** Detected key -> '' (its own new person) | 'new:<detectedKey>' (merged into that new person) | 'existing:<personId>'. */
  assignments: Record<string, string>;
  /** Final name of a new person, by the detected key of its root; '' or absent = the detected name. */
  renames: Record<string, string>;
  /** Aliases typed by the user, by target key ('new:<rootKey>' | 'existing:<personId>'). */
  extraAliases: Record<string, string[]>;
}

export function emptyChoices(): OrganizeChoices {
  return { proposals: {}, proposalAmounts: {}, settlements: {}, review: {}, assignments: {}, renames: {}, extraAliases: {} };
}

/** Review keys: the transaction id, with "#n" when the same transaction comes twice. */
export function reviewKeys(lines: readonly Pick<ReviewLine, 'transactionId'>[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const n = (seen.get(line.transactionId) ?? 0) + 1;
    seen.set(line.transactionId, n);
    return n === 1 ? line.transactionId : `${line.transactionId}#${n}`;
  });
}

export function defaultResolution(line: ReviewLine): ReviewResolution {
  return {
    include: false,
    personRef: line.suggestedPersonId ? `p:${line.suggestedPersonId}` : '',
    newName: '',
    direction: 'THEY_OWE_ME',
    mode: 'amount',
    amountText: '',
    percentText: '',
  };
}

/** What the server marks (proposals and settlements) and nothing resolved by hand. */
export function defaultChoices(preview: OrganizePreview): OrganizeChoices {
  const choices = emptyChoices();
  for (const p of preview.proposals) choices.proposals[p.id] = p.defaultSelected === true;
  for (const s of preview.settlements) choices.settlements[s.id] = s.defaultSelected === true;
  const keys = reviewKeys(preview.review);
  preview.review.forEach((line, index) => {
    choices.review[keys[index]] = defaultResolution(line);
  });
  return choices;
}

/**
 * A new preview (after a failed apply, or new options) keeps the choice of everything that was already there and
 * takes the server default for what is new. A choice about something that vanished is dropped.
 */
export function reconcileChoices(prevPreview: OrganizePreview | null, prev: OrganizeChoices, next: OrganizePreview, existing: readonly Person[]): OrganizeChoices {
  const fresh = defaultChoices(next);
  if (!prevPreview) return fresh;
  const had = {
    proposals: new Set(prevPreview.proposals.map((p) => p.id)),
    settlements: new Set(prevPreview.settlements.map((s) => s.id)),
    review: new Set(reviewKeys(prevPreview.review)),
  };
  const out = emptyChoices();
  for (const id of Object.keys(fresh.proposals)) {
    out.proposals[id] = had.proposals.has(id) && id in prev.proposals ? prev.proposals[id] : fresh.proposals[id];
    if (had.proposals.has(id) && prev.proposalAmounts[id]) out.proposalAmounts[id] = prev.proposalAmounts[id];
  }
  for (const id of Object.keys(fresh.settlements)) {
    out.settlements[id] = had.settlements.has(id) && id in prev.settlements ? prev.settlements[id] : fresh.settlements[id];
  }
  for (const key of Object.keys(fresh.review)) {
    out.review[key] = had.review.has(key) && prev.review[key] ? prev.review[key] : fresh.review[key];
  }
  // People: keep what still refers to something that exists in the new registry.
  const registry = buildRegistry(next, out.review);
  const known = new Set(registry.map((d) => d.key));
  const existingIds = new Set(existing.map((p) => p.id));
  for (const [key, target] of Object.entries(prev.assignments)) {
    if (!known.has(key)) continue;
    if (target === '' || (target.startsWith('new:') && known.has(target.slice(4))) || (target.startsWith('existing:') && existingIds.has(target.slice(9)))) {
      out.assignments[key] = target;
    }
  }
  for (const [key, name] of Object.entries(prev.renames)) if (known.has(key)) out.renames[key] = name;
  for (const [key, aliases] of Object.entries(prev.extraAliases)) {
    if ((key.startsWith('new:') && known.has(key.slice(4))) || (key.startsWith('existing:') && existingIds.has(key.slice(9)))) out.extraAliases[key] = aliases;
  }
  return out;
}

export function setProposal(choices: OrganizeChoices, id: string, selected: boolean): OrganizeChoices {
  return { ...choices, proposals: { ...choices.proposals, [id]: selected } };
}

export function setSettlement(choices: OrganizeChoices, id: string, selected: boolean): OrganizeChoices {
  return { ...choices, settlements: { ...choices.settlements, [id]: selected } };
}

export function setAllProposals(choices: OrganizeChoices, preview: OrganizePreview, selected: boolean): OrganizeChoices {
  const proposals = { ...choices.proposals };
  for (const p of preview.proposals) proposals[p.id] = selected;
  return { ...choices, proposals };
}

export function setAllSettlements(choices: OrganizeChoices, preview: OrganizePreview, selected: boolean): OrganizeChoices {
  const settlements = { ...choices.settlements };
  for (const s of preview.settlements) settlements[s.id] = selected;
  return { ...choices, settlements };
}

export function setProposalAmount(choices: OrganizeChoices, id: string, text: string): OrganizeChoices {
  return { ...choices, proposalAmounts: { ...choices.proposalAmounts, [id]: text } };
}

export function setReview(choices: OrganizeChoices, key: string, patch: Partial<ReviewResolution>): OrganizeChoices {
  const current = choices.review[key];
  if (!current) return choices;
  const next = { ...current, ...patch };
  // Picking somebody ticks the line; "nobody" unticks it.
  if (patch.personRef !== undefined && patch.include === undefined) next.include = patch.personRef !== '';
  return { ...choices, review: { ...choices.review, [key]: next } };
}

// ---- People registry ----------------------------------------------------------------------------------------------

export interface DetectedPerson {
  /** normalizeLabel of the name */
  key: string;
  name: string;
  /** Aliases the server suggested for it. */
  serverAliases: string[];
  /** Proposals, settlements and review lines that mention it. */
  uses: number;
}

/**
 * Everybody the preview mentions without an id (a person to create): the names of proposals and settlements, the
 * `newPeople` list, and the names typed on review lines. Stable order of first appearance.
 */
export function buildRegistry(preview: OrganizePreview, review: Record<string, ReviewResolution> = {}): DetectedPerson[] {
  const byKey = new Map<string, DetectedPerson>();
  const touch = (name: string, aliases: readonly string[] = [], use = 0) => {
    const trimmed = name.trim();
    const key = normalizeLabel(trimmed);
    if (!key) return;
    const found = byKey.get(key) ?? { key, name: trimmed, serverAliases: [], uses: 0 };
    for (const alias of aliases) if (alias.trim() && !found.serverAliases.some((a) => normalizeLabel(a) === normalizeLabel(alias))) found.serverAliases.push(alias.trim());
    found.uses += use;
    byKey.set(key, found);
  };
  for (const p of preview.proposals) if (p.person.id === null) touch(p.person.name, [], 1);
  for (const s of preview.settlements) if (s.person.id === null) touch(s.person.name, [], 1);
  for (const n of preview.newPeople) touch(n.name, n.aliases);
  for (const res of Object.values(review)) if (res.personRef === 'new' && res.newName.trim()) touch(res.newName, [], 1);
  return [...byKey.values()];
}

export type TargetRef =
  | { kind: 'existing'; personId: string; name: string }
  | { kind: 'new'; rootKey: string; name: string };

export function targetKey(target: TargetRef): string {
  return target.kind === 'existing' ? `existing:${target.personId}` : `new:${target.rootKey}`;
}

/** The final name of a new person: the user's rename, else the detected name. */
export function rootName(registry: readonly DetectedPerson[], choices: Pick<OrganizeChoices, 'renames'>, rootKey: string): string {
  const typed = choices.renames[rootKey]?.trim();
  return typed || registry.find((d) => d.key === rootKey)?.name || rootKey;
}

/** Who a detected name ends up being: its own new person, another new person, or a registered one. */
export function targetOfDetected(registry: readonly DetectedPerson[], choices: OrganizeChoices, existing: readonly Person[], detectedKey: string): TargetRef {
  let key = detectedKey;
  for (let hops = 0; hops <= registry.length; hops += 1) {
    const assigned = choices.assignments[key] ?? '';
    if (assigned.startsWith('existing:')) {
      const person = existing.find((p) => p.id === assigned.slice(9));
      if (person) return { kind: 'existing', personId: person.id, name: person.name };
      break;
    }
    if (assigned.startsWith('new:') && assigned.slice(4) !== key && registry.some((d) => d.key === assigned.slice(4))) {
      key = assigned.slice(4);
      continue;
    }
    break;
  }
  return { kind: 'new', rootKey: key, name: rootName(registry, choices, key) };
}

/**
 * Assigns a detected name to a person: '' (its own), 'new:<key>' (merged into another new person) or
 * 'existing:<id>'. Only a root can receive merges (no chains, no cycles); whoever pointed at the name that moves
 * follows it, so the structure always stays flat.
 */
export function setAssignment(choices: OrganizeChoices, registry: readonly DetectedPerson[], detectedKey: string, target: string): OrganizeChoices {
  if (!registry.some((d) => d.key === detectedKey)) return choices;
  if (target.startsWith('new:')) {
    const into = target.slice(4);
    if (into === detectedKey || !registry.some((d) => d.key === into)) return choices;
    if ((choices.assignments[into] ?? '') !== '') return choices;
  }
  const assignments: Record<string, string> = { ...choices.assignments, [detectedKey]: target };
  for (const [key, value] of Object.entries(assignments)) {
    if (key !== detectedKey && value === `new:${detectedKey}`) assignments[key] = target === '' ? value : target;
  }
  // The name that moves away takes its own rename and typed aliases off the books.
  const renames = { ...choices.renames };
  const extraAliases = { ...choices.extraAliases };
  if (target !== '') {
    delete renames[detectedKey];
    delete extraAliases[`new:${detectedKey}`];
  }
  return { ...choices, assignments, renames, extraAliases };
}

export function setRename(choices: OrganizeChoices, rootKey: string, name: string): OrganizeChoices {
  return { ...choices, renames: { ...choices.renames, [rootKey]: name } };
}

export function addExtraAlias(choices: OrganizeChoices, targetKeyValue: string, alias: string): OrganizeChoices {
  const trimmed = alias.trim();
  if (!trimmed) return choices;
  const current = choices.extraAliases[targetKeyValue] ?? [];
  if (current.some((a) => normalizeLabel(a) === normalizeLabel(trimmed))) return choices;
  return { ...choices, extraAliases: { ...choices.extraAliases, [targetKeyValue]: [...current, trimmed] } };
}

export function removeExtraAlias(choices: OrganizeChoices, targetKeyValue: string, alias: string): OrganizeChoices {
  const current = choices.extraAliases[targetKeyValue] ?? [];
  return { ...choices, extraAliases: { ...choices.extraAliases, [targetKeyValue]: current.filter((a) => a !== alias) } };
}

export interface PersonGroup {
  /** 'new:<rootKey>' | 'existing:<personId>' */
  key: string;
  target: TargetRef;
  /** Final name. */
  name: string;
  /** Detected names that end up in it (the root first). */
  members: DetectedPerson[];
  /** Aliases that go with it: the other detected names, the server's suggestions and the typed ones. */
  aliases: string[];
  /** Typed by the user (removable). */
  extra: string[];
  /** Any selected proposal, settlement or manual line points at it. */
  used: boolean;
}

/** Cleans a list of aliases: no empty, no repeat (normalized), none equal to `name` or to a name in `skip`. */
function uniqueAliases(name: string, aliases: readonly string[], skip: readonly string[] = []): string[] {
  const seen = new Set<string>([normalizeLabel(name), ...skip.map(normalizeLabel)]);
  const out: string[] = [];
  for (const raw of aliases) {
    const alias = raw.trim();
    const key = normalizeLabel(alias);
    if (!alias || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

// ---- Review lines ---------------------------------------------------------------------------------------------------

export interface ResolvedReviewLine {
  key: string;
  line: ReviewLine;
  resolution: ReviewResolution;
  /** The line goes in the apply (ticked and valid). */
  included: boolean;
  error: string | null;
  amountCents: number | null;
  target: TargetRef | null;
}

export const REVIEW_MESSAGES = {
  person: 'Escolha a pessoa.',
  newName: 'Informe o nome da nova pessoa.',
  amount: 'Informe um valor maior que zero.',
  percent: 'Informe um percentual entre 0,01 e 100.',
  over: 'O valor passa do valor da transação.',
} as const;

/** The amount of a review line in cents: typed, or the percentage of the transaction (rounded down). */
export function reviewAmountCents(line: Pick<ReviewLine, 'transactionAmount'>, res: ReviewResolution): number | null {
  if (res.mode === 'amount') {
    const cents = parseMoneyToCents(res.amountText);
    return cents !== null && cents > 0 ? cents : null;
  }
  const hundredths = parsePercentToHundredths(res.percentText);
  if (hundredths === null) return null;
  const cents = Math.floor((reaisToCents(line.transactionAmount) * hundredths) / 10000);
  return cents > 0 ? cents : null;
}

export function resolveReviewLines(preview: OrganizePreview, choices: OrganizeChoices, existing: readonly Person[]): ResolvedReviewLine[] {
  const registry = buildRegistry(preview, choices.review);
  const keys = reviewKeys(preview.review);
  return preview.review.map((line, index) => {
    const key = keys[index];
    const resolution = choices.review[key] ?? defaultResolution(line);
    let error: string | null = null;
    let target: TargetRef | null = null;
    if (resolution.personRef.startsWith('p:')) {
      const person = existing.find((p) => p.id === resolution.personRef.slice(2));
      if (person) target = { kind: 'existing', personId: person.id, name: person.name };
      else error = REVIEW_MESSAGES.person;
    } else if (resolution.personRef.startsWith('d:')) {
      const detectedKey = resolution.personRef.slice(2);
      if (registry.some((d) => d.key === detectedKey)) target = targetOfDetected(registry, choices, existing, detectedKey);
      else error = REVIEW_MESSAGES.person;
    } else if (resolution.personRef === 'new') {
      const detectedKey = normalizeLabel(resolution.newName);
      if (detectedKey) target = targetOfDetected(registry, choices, existing, detectedKey);
      else error = REVIEW_MESSAGES.newName;
    } else {
      error = REVIEW_MESSAGES.person;
    }
    const amountCents = reviewAmountCents(line, resolution);
    if (!error && amountCents === null) error = resolution.mode === 'amount' ? REVIEW_MESSAGES.amount : REVIEW_MESSAGES.percent;
    if (!error && amountCents !== null && amountCents > reaisToCents(line.transactionAmount)) error = REVIEW_MESSAGES.over;
    // Unticked lines are never errors: they are simply left out.
    return {
      key, line, resolution, included: resolution.include && error === null, error: resolution.include ? error : null,
      amountCents: error === null ? amountCents : null, target: error === null ? target : null,
    };
  });
}

// ---- Proposals -----------------------------------------------------------------------------------------------------------

export interface ResolvedProposal {
  proposal: ShareProposal;
  selected: boolean;
  /** Adjusted amount in cents, or null when the server amount stands. */
  overrideCents: number | null;
  error: string | null;
  /** What goes in the apply: the override or the server amount. */
  cents: number;
  target: TargetRef | null;
}

export function resolveProposals(preview: OrganizePreview, choices: OrganizeChoices, existing: readonly Person[]): ResolvedProposal[] {
  const registry = buildRegistry(preview, choices.review);
  return preview.proposals.map((proposal) => {
    const selected = choices.proposals[proposal.id] === true;
    const text = (choices.proposalAmounts[proposal.id] ?? '').trim();
    let overrideCents: number | null = null;
    let error: string | null = null;
    if (text) {
      const cents = parseMoneyToCents(text);
      if (cents === null || cents <= 0) error = REVIEW_MESSAGES.amount;
      else if (cents > reaisToCents(proposal.transactionAmount)) error = REVIEW_MESSAGES.over;
      else if (cents !== reaisToCents(proposal.amount)) overrideCents = cents;
    }
    let target: TargetRef | null = null;
    if (proposal.person.id !== null) target = { kind: 'existing', personId: proposal.person.id, name: proposal.person.name };
    else if (registry.some((d) => d.key === normalizeLabel(proposal.person.name))) {
      target = targetOfDetected(registry, choices, existing, normalizeLabel(proposal.person.name));
    }
    return { proposal, selected, overrideCents, error: selected ? error : null, cents: overrideCents ?? reaisToCents(proposal.amount), target };
  });
}

export interface ResolvedSettlement {
  settlement: SettlementProposal;
  selected: boolean;
  cents: number;
  target: TargetRef | null;
}

export function resolveSettlements(preview: OrganizePreview, choices: OrganizeChoices, existing: readonly Person[]): ResolvedSettlement[] {
  const registry = buildRegistry(preview, choices.review);
  return preview.settlements.map((settlement) => {
    let target: TargetRef | null = null;
    if (settlement.person.id !== null) target = { kind: 'existing', personId: settlement.person.id, name: settlement.person.name };
    else if (registry.some((d) => d.key === normalizeLabel(settlement.person.name))) {
      target = targetOfDetected(registry, choices, existing, normalizeLabel(settlement.person.name));
    }
    return { settlement, selected: choices.settlements[settlement.id] === true, cents: reaisToCents(settlement.amount), target };
  });
}

// ---- The apply -------------------------------------------------------------------------------------------------------------

export interface OrganizeTotals {
  proposals: { count: number; theyOweMeCents: number; iOweThemCents: number; adjusted: number };
  manual: { count: number; theyOweMeCents: number; iOweThemCents: number };
  settlements: { count: number; receivedCents: number; paidCents: number };
  /** New people that will be created (used ones only). */
  newPeople: number;
  /** Registered people that receive aliases. */
  mergedPeople: number;
}

export type OrganizeBlockerCode = 'needs-refresh' | 'none-selected' | 'review-invalid' | 'amount-invalid' | 'over-total' | 'people-conflict' | 'applying';

export interface OrganizeBlocker {
  code: OrganizeBlockerCode;
  message: string;
}

export interface BuiltOrganize {
  payload: OrganizeApplyInput;
  totals: OrganizeTotals;
  groups: PersonGroup[];
  review: ResolvedReviewLine[];
  proposals: ResolvedProposal[];
  settlements: ResolvedSettlement[];
  /** Blocking problems with the choices themselves (the dialog adds needs-refresh and applying). */
  problem: OrganizeBlocker | null;
}

function targetName(target: TargetRef): Pick<OrganizeManualEntry, 'personId' | 'personName'> {
  return target.kind === 'existing' ? { personId: target.personId } : { personName: target.name };
}

/** Groups (people that will be created or receive aliases), with their members, aliases and whether anything uses them. */
export function buildGroups(preview: OrganizePreview, choices: OrganizeChoices, existing: readonly Person[], usedTargets: ReadonlySet<string>): PersonGroup[] {
  const registry = buildRegistry(preview, choices.review);
  const groups = new Map<string, PersonGroup>();
  for (const detected of registry) {
    const target = targetOfDetected(registry, choices, existing, detected.key);
    const key = targetKey(target);
    let group = groups.get(key);
    if (!group) {
      group = { key, target, name: target.name, members: [], aliases: [], extra: choices.extraAliases[key] ?? [], used: usedTargets.has(key) };
      groups.set(key, group);
    }
    group.members.push(detected);
  }
  for (const group of groups.values()) {
    // The root first: it is the one the group is named after.
    const rootKeyOfGroup = group.target.kind === 'new' ? group.target.rootKey : '';
    group.members.sort((a, b) => Number(b.key === rootKeyOfGroup) - Number(a.key === rootKeyOfGroup));
    const known = group.target.kind === 'existing'
      ? existing.find((p) => p.id === (group.target as { personId: string }).personId)
      : undefined;
    const skip = known ? [known.name, ...known.aliases] : [];
    const candidates = [
      ...group.members.map((m) => m.name),
      ...group.members.flatMap((m) => m.serverAliases),
      ...group.extra,
    ];
    group.aliases = uniqueAliases(group.name, candidates, skip);
  }
  return [...groups.values()];
}

function overTotalMessage(preview: OrganizePreview, entries: ReadonlyArray<{ transactionId: string; direction: ShareDirection; cents: number }>): string | null {
  const amounts = new Map<string, number>();
  for (const p of preview.proposals) amounts.set(p.transactionId, reaisToCents(p.transactionAmount));
  for (const r of preview.review) amounts.set(r.transactionId, reaisToCents(r.transactionAmount));
  const sums = new Map<string, number>();
  for (const e of entries) sums.set(`${e.transactionId}|${e.direction}`, (sums.get(`${e.transactionId}|${e.direction}`) ?? 0) + e.cents);
  for (const [key, sum] of sums) {
    const [transactionId] = key.split('|');
    const total = amounts.get(transactionId);
    if (total !== undefined && sum > total) {
      const line = preview.proposals.find((p) => p.transactionId === transactionId) ?? preview.review.find((r) => r.transactionId === transactionId);
      return `As partes de "${line?.description ?? transactionId}" somam ${moneyText(sum)}, mais que o valor da transação (${moneyText(total)}).`;
    }
  }
  return null;
}

/**
 * The apply request and every number next to it, from one place. Proposals with an adjusted amount leave
 * `proposalIds` and go as `manual` (the contract has no per-proposal amount); the people list carries only the
 * people that something selected points at.
 */
export function buildOrganizeApply(
  householdId: string,
  applied: Pick<OrganizeOptions, 'startDate' | 'endDate' | 'onlyImported'>,
  preview: OrganizePreview,
  choices: OrganizeChoices,
  existing: readonly Person[],
): BuiltOrganize {
  const proposals = resolveProposals(preview, choices, existing);
  const settlements = resolveSettlements(preview, choices, existing);
  const review = resolveReviewLines(preview, choices, existing);

  const proposalIds: string[] = [];
  const manual: OrganizeManualEntry[] = [];
  const used = new Set<string>();
  const mark = (target: TargetRef | null) => {
    if (target) used.add(targetKey(target));
  };
  const sums: Array<{ transactionId: string; direction: ShareDirection; cents: number }> = [];
  const totals: OrganizeTotals = {
    proposals: { count: 0, theyOweMeCents: 0, iOweThemCents: 0, adjusted: 0 },
    manual: { count: 0, theyOweMeCents: 0, iOweThemCents: 0 },
    settlements: { count: 0, receivedCents: 0, paidCents: 0 },
    newPeople: 0,
    mergedPeople: 0,
  };

  for (const item of proposals) {
    if (!item.selected || item.error) continue;
    const { proposal } = item;
    totals.proposals.count += 1;
    if (proposal.direction === 'THEY_OWE_ME') totals.proposals.theyOweMeCents += item.cents;
    else totals.proposals.iOweThemCents += item.cents;
    sums.push({ transactionId: proposal.transactionId, direction: proposal.direction, cents: item.cents });
    mark(item.target);
    if (item.overrideCents !== null && item.target) {
      totals.proposals.adjusted += 1;
      manual.push({ transactionId: proposal.transactionId, ...targetName(item.target), direction: proposal.direction, amount: centsToReais(item.overrideCents) });
    } else {
      proposalIds.push(proposal.id);
    }
  }

  const settlementIds: string[] = [];
  for (const item of settlements) {
    if (!item.selected) continue;
    settlementIds.push(item.settlement.id);
    totals.settlements.count += 1;
    if (item.settlement.direction === 'RECEIVED') totals.settlements.receivedCents += item.cents;
    else totals.settlements.paidCents += item.cents;
    mark(item.target);
  }

  for (const item of review) {
    if (!item.included || !item.target || item.amountCents === null) continue;
    totals.manual.count += 1;
    if (item.resolution.direction === 'THEY_OWE_ME') totals.manual.theyOweMeCents += item.amountCents;
    else totals.manual.iOweThemCents += item.amountCents;
    sums.push({ transactionId: item.line.transactionId, direction: item.resolution.direction, cents: item.amountCents });
    mark(item.target);
    manual.push({ transactionId: item.line.transactionId, ...targetName(item.target), direction: item.resolution.direction, amount: centsToReais(item.amountCents) });
  }

  const groups = buildGroups(preview, choices, existing, used);
  const people: OrganizeApplyPerson[] = [];
  for (const group of groups) {
    if (!group.used) continue;
    if (group.target.kind === 'new') {
      totals.newPeople += 1;
      people.push({ name: group.name, aliases: group.aliases });
    } else if (group.aliases.length > 0) {
      totals.mergedPeople += 1;
      people.push({ name: group.name, aliases: group.aliases, existingId: group.target.personId });
    }
  }

  const payload: OrganizeApplyInput = { householdId, people, proposalIds, settlementIds, manual };
  if (applied.onlyImported !== undefined) payload.onlyImported = applied.onlyImported;
  if (applied.startDate) payload.startDate = applied.startDate;
  if (applied.endDate) payload.endDate = applied.endDate;

  return { payload, totals, groups, review, proposals, settlements, problem: choicesProblem({ proposals, review, groups, totals, preview, sums, existing }) };
}

function choicesProblem(args: {
  proposals: ResolvedProposal[]; review: ResolvedReviewLine[]; groups: PersonGroup[]; totals: OrganizeTotals; preview: OrganizePreview;
  sums: Array<{ transactionId: string; direction: ShareDirection; cents: number }>; existing: readonly Person[];
}): OrganizeBlocker | null {
  const badReview = args.review.filter((r) => r.resolution.include && r.error !== null).length;
  if (badReview > 0) {
    return { code: 'review-invalid', message: `${badReview === 1 ? '1 linha da revisão marcada está incompleta' : `${badReview} linhas da revisão marcadas estão incompletas`}: complete ou desmarque.` };
  }
  const badAmount = args.proposals.filter((p) => p.selected && p.error !== null).length;
  if (badAmount > 0) {
    return { code: 'amount-invalid', message: `${badAmount === 1 ? '1 valor ajustado é inválido' : `${badAmount} valores ajustados são inválidos`}: corrija ou limpe o ajuste.` };
  }
  const total = args.totals.proposals.count + args.totals.manual.count + args.totals.settlements.count;
  if (total === 0) return { code: 'none-selected', message: 'Marque ao menos uma divisão, linha da revisão ou acerto.' };
  const conflict = peopleConflict(args.groups, args.existing);
  if (conflict) return { code: 'people-conflict', message: conflict };
  const over = overTotalMessage(args.preview, args.sums);
  if (over) return { code: 'over-total', message: over };
  return null;
}

/** A new person whose name is taken by a registered person (or by another new one): merge them instead. */
export function peopleConflict(groups: readonly PersonGroup[], existing: readonly Person[]): string | null {
  const taken = new Map<string, { id: string; name: string }>();
  for (const p of existing) {
    taken.set(normalizeLabel(p.name), { id: p.id, name: p.name });
    for (const a of p.aliases) taken.set(normalizeLabel(a), { id: p.id, name: p.name });
  }
  const seenNew = new Set<string>();
  for (const group of groups) {
    if (!group.used) continue;
    const own = group.target.kind === 'existing' ? existing.find((p) => p.id === (group.target as { personId: string }).personId) : undefined;
    // What the person ends up with: the server caps the aliases of one person.
    if (group.aliases.length + (own?.aliases.length ?? 0) > MAX_ALIASES) return `"${group.name}" passaria de ${MAX_ALIASES} apelidos: tire alguns.`;
    if ([group.name, ...group.aliases].some((n) => n.length > MAX_PERSON_NAME)) return `"${group.name}": nome e apelidos podem ter no máximo ${MAX_PERSON_NAME} caracteres.`;
    if (group.target.kind === 'new' && !normalizeLabel(group.name)) return 'Uma pessoa nova está sem nome.';
    // A new person brings her name too; a registered one only the aliases she receives.
    const names = group.target.kind === 'new' ? [group.name, ...group.aliases] : group.aliases;
    for (const name of names) {
      const key = normalizeLabel(name);
      const owner = taken.get(key);
      if (owner && (group.target.kind === 'new' || owner.id !== (group.target as { personId: string }).personId)) {
        return `"${name}" já é o nome ou apelido de ${owner.name}: junte com essa pessoa em vez de criar outra.`;
      }
      if (seenNew.has(key)) return `"${name}" aparece em duas pessoas novas: junte-as numa só.`;
    }
    for (const name of names) seenNew.add(normalizeLabel(name));
  }
  return null;
}

/**
 * The blocker of the Apply button. A failed apply may have written part of it: the preview on screen is stale
 * until it runs again, whatever else is selected.
 */
export function organizeBlocker(built: BuiltOrganize | null, state: { needsRefresh: boolean; applying: boolean }): OrganizeBlocker | null {
  if (state.applying) return { code: 'applying', message: 'Aplicando…' };
  if (state.needsRefresh) return { code: 'needs-refresh', message: 'Atualize a pré-visualização antes de aplicar de novo.' };
  if (!built) return { code: 'none-selected', message: 'Marque ao menos uma divisão, linha da revisão ou acerto.' };
  return built.problem;
}

/**
 * The apply is one database transaction on the server: a 4xx answer means nothing was written. Only a network failure
 * or an unknown answer (no status, 5xx) may have left it half done.
 */
export function organizeFailureMessage(message: string, status?: number): string {
  const base = message.replace(/[.\s]+$/, '');
  if (status !== undefined && status >= 400 && status < 500) return `${base}. Nada foi gravado: atualize a pré-visualização.`;
  return `${base}. A organização pode ter sido parcial: atualize a pré-visualização.`;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function organizeResultLines(result: OrganizeApplyResult): string[] {
  const lines: string[] = [];
  if (result.peopleCreated > 0) lines.push(`${plural(result.peopleCreated, 'pessoa criada', 'pessoas criadas')}.`);
  if (result.sharesCreated > 0) lines.push(`${plural(result.sharesCreated, 'divisão criada', 'divisões criadas')}.`);
  if (result.settlementsCreated > 0) lines.push(`${plural(result.settlementsCreated, 'acerto criado', 'acertos criados')}.`);
  if (result.skipped > 0) lines.push(`${plural(result.skipped, 'item ignorado', 'itens ignorados')} (já feitos ou que já não existem).`);
  return lines;
}

export function organizeSummary(result: OrganizeApplyResult): string {
  const lines = organizeResultLines(result);
  return lines.length > 0 ? lines.join(' ') : 'Nada foi alterado.';
}


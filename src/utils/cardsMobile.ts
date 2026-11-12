/**
 * Presentation logic of the Cartões screen below 768 px (lote R3). Pure: no React, no imports, so
 * tools/fe-tests/t39_cards_mobile.mts runs it under tsx (CARDS_MOBILE_MODULE points it at a mutated copy).
 *
 * Only shapes what the screen shows. The numbers (statement, forecast, limits, commitment) come from the existing
 * hooks and calculations; nothing here recalculates a bill, a limit or a forecast.
 */

import type { StatementState } from './invoiceStatement';

export interface CardSituationInput {
  state: StatementState | null;
  /** 'dd/MM' or null. */
  dueLabel: string | null;
  /** 'dd/MM' or null. */
  closingLabel: string | null;
}

export interface CardSituation {
  kind: 'open' | 'closed' | 'paid' | 'unknown';
  label: string;
}

/** The short situation of the statement shown on the card: "Aberta · fecha 05/12", "Fechada · vence 12/11", "Paga". */
export function cardSituation(input: CardSituationInput): CardSituation {
  if (input.state === 'paid') return { kind: 'paid', label: 'Paga' };
  if (input.state === 'closed') {
    return { kind: 'closed', label: input.dueLabel ? `Fechada · vence ${input.dueLabel}` : 'Fechada' };
  }
  if (input.state === 'open') {
    return { kind: 'open', label: input.closingLabel ? `Aberta · fecha ${input.closingLabel}` : 'Aberta' };
  }
  return { kind: 'unknown', label: 'Situação indisponível' };
}

/** The width of the limit bar in percent: finite, clamped to 0..100, one decimal. */
export function usageBarWidth(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  const clamped = Math.min(100, Math.max(0, percent));
  return Math.round(clamped * 10) / 10;
}

/** The colour step of the limit bar, with the thresholds the desktop page already uses (70 and 90). */
export function usageTone(percent: number): 'normal' | 'warn' | 'danger' {
  if (percent > 90) return 'danger';
  if (percent > 70) return 'warn';
  return 'normal';
}

/**
 * The bar of the open statement: the solid part is what is posted, the rest up to the expected total at closing is
 * the forecast (hatched). Both in percent of the larger of the two, so the bar never overflows.
 */
export function invoiceBars(posted: number, expectedClosing: number): { solid: number; rest: number } {
  const p = Math.max(0, Number.isFinite(posted) ? posted : 0);
  const e = Math.max(0, Number.isFinite(expectedClosing) ? expectedClosing : 0);
  const scale = Math.max(p, e);
  if (scale === 0) return { solid: 0, rest: 0 };
  const solid = Math.round((Math.min(p, scale) / scale) * 1000) / 10;
  return { solid, rest: Math.round((100 - solid) * 10) / 10 };
}

/**
 * The heights of the columns of the next invoices, in percent of the heaviest one. A month with nothing to pay has
 * no column; a month with something keeps at least `floor` so it stays visible.
 */
export function columnHeights(values: readonly number[], floor = 10): number[] {
  const max = Math.max(0, ...values.map((v) => (Number.isFinite(v) ? v : 0)));
  return values.map((v) => {
    if (!Number.isFinite(v) || v <= 0 || max === 0) return 0;
    return Math.max(floor, Math.round((v / max) * 100));
  });
}

export type CardsScreenState = 'loading' | 'error' | 'empty' | 'ready';

/** Which state the screen shows: loading first, then the error, then the "no card" text, else the cards. */
export function cardsScreenState(input: { loading: boolean; error: boolean; cardCount: number }): CardsScreenState {
  if (input.loading) return 'loading';
  if (input.error) return 'error';
  if (input.cardCount === 0) return 'empty';
  return 'ready';
}

/** The index of the card that the carousel scroll position is on (cards of `slideWidth` px, snapped). */
export function carouselIndex(scrollLeft: number, slideWidth: number, count: number): number {
  if (count <= 0 || !(slideWidth > 0)) return 0;
  const raw = Math.round((Number.isFinite(scrollLeft) ? scrollLeft : 0) / slideWidth);
  return Math.min(count - 1, Math.max(0, raw));
}

/** "≈ " before an estimated amount, so the estimate is marked in the text and not only by colour. */
export function approxPrefix(estimated: boolean): string {
  return estimated ? '≈ ' : '';
}

/** The first day, in local time, of a 'YYYY-MM' month key (the header's month). */
export function monthStartOf(monthKey: string): Date {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

/** "dia 5" for the day to buy (the closing day, as the desktop page shows it), or null when the card has none. */
export function bestDayToBuyText(closingDay: number | null | undefined): string | null {
  return closingDay && closingDay > 0 ? `dia ${closingDay}` : null;
}

const SHORT_MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;

/** "dez" for a month of the current year, "jan 27" for another year; '' for a bad key. */
export function shortMonthLabel(monthKey: string, currentYear: number): string {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return '';
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  if (month < 1 || month > 12) return '';
  const name = SHORT_MONTHS_PT[month - 1];
  return year === currentYear ? name : `${name} ${String(year).slice(2)}`;
}

/** Whole reais with a dot for thousands and no currency sign, for the narrow columns ("1.140"). */
export function shortAmount(value: number): string {
  const whole = Math.round(Number.isFinite(value) ? value : 0);
  const sign = whole < 0 ? '-' : '';
  return sign + String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** A percentage with one decimal and a comma, the pt-BR way: 49 -> "49,0%". */
export function percentPt(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe.toFixed(1).replace('.', ',')}%`;
}

// ---- cor do cartão -------------------------------------------------------------------------------------

/** The colour the card form prefills for every new card: the system default, not a choice of the user. */
export const CARD_DEFAULT_COLOR = '#3b82f6';

export type TextTone = 'light' | 'dark';
const TEXT_COLOR: Record<TextTone, string> = { light: '#ffffff', dark: '#111111' };

function channelLinear(hex: string, offset: number): number {
  const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a '#rrggbb' colour. */
export function relativeLuminance(hex: string): number {
  return 0.2126 * channelLinear(hex, 1) + 0.7152 * channelLinear(hex, 3) + 0.0722 * channelLinear(hex, 5);
}

/** WCAG contrast ratio between two '#rrggbb' colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Light or dark text on the colour, whichever reads better. */
export function textToneOn(background: string): TextTone {
  return contrastRatio(background, TEXT_COLOR.light) >= contrastRatio(background, TEXT_COLOR.dark) ? 'light' : 'dark';
}

interface BrandRule {
  /** Normalised words that name the issuer (lower case, no accents). */
  keys: readonly string[];
  color: string;
}

/** The issuers recognised by the name of the card. Colour only: no logo, no name drawn as a mark. */
const BRANDS: readonly BrandRule[] = [
  { keys: ['nubank'], color: '#820ad1' },
  { keys: ['itau'], color: '#ec7000' },
  { keys: ['bradesco'], color: '#cc092f' },
  { keys: ['santander'], color: '#ec0000' },
  { keys: ['banco do brasil'], color: '#fcd000' },
  { keys: ['caixa'], color: '#005ca9' },
  { keys: ['inter'], color: '#ff7a00' },
  { keys: ['c6'], color: '#242424' },
  { keys: ['xp'], color: '#000000' },
  { keys: ['mercado pago'], color: '#009ee3' },
  { keys: ['picpay'], color: '#21c25e' },
  { keys: ['btg', 'btg pactual'], color: '#0c2340' },
  { keys: ['neon'], color: '#1ccff7' },
  { keys: ['will', 'will bank'], color: '#fdd000' },
  { keys: ['next'], color: '#00e56f' },
  { keys: ['pagbank'], color: '#21a94f' },
  { keys: ['sicredi'], color: '#33a02c' },
  { keys: ['sicoob'], color: '#003641' },
];

/** Name without accents, in lower case, with single spaces. */
export function normalizeCardName(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The brand colour and the text tone of the issuer named in the card's name, or null when it is not recognised. */
export function brandColorFor(name: string): { color: string; text: TextTone } | null {
  const normalized = normalizeCardName(name ?? '');
  if (!normalized) return null;
  for (const brand of BRANDS) {
    if (brand.keys.some((key) => new RegExp(`(^|[^a-z0-9])${key}([^a-z0-9]|$)`).test(normalized))) {
      return { color: brand.color, text: textToneOn(brand.color) };
    }
  }
  return null;
}

export type CardColorSource = 'user' | 'brand' | 'default';

/**
 * The colour of a card, in this order: the colour the user chose; else the brand of the issuer named in the card;
 * else the system default. A stored colour equal to CARD_DEFAULT_COLOR is the form's prefill and counts as no choice.
 */
export function cardVisual(input: { name: string; color?: string | null }): { color: string; text: TextTone; source: CardColorSource } {
  const chosen = input.color && /^#[0-9a-fA-F]{6}$/.test(input.color) && input.color.toLowerCase() !== CARD_DEFAULT_COLOR ? input.color : null;
  if (chosen) return { color: chosen, text: textToneOn(chosen), source: 'user' };
  const brand = brandColorFor(input.name);
  if (brand) return { color: brand.color, text: brand.text, source: 'brand' };
  return { color: CARD_DEFAULT_COLOR, text: textToneOn(CARD_DEFAULT_COLOR), source: 'default' };
}

/** The colour mixed toward black by `share` (0 keeps it, 1 is black), for the lower edge of the card's gradient. */
export function shadeHex(hex: string, share: number): string {
  const k = Math.min(1, Math.max(0, Number.isFinite(share) ? share : 0));
  const channel = (offset: number) => Math.round(parseInt(hex.slice(offset, offset + 2), 16) * (1 - k));
  return '#' + [1, 3, 5].map((o) => channel(o).toString(16).padStart(2, '0')).join('');
}

/**
 * Month names of the Renda area, written with date-fns as the rest of the project does (the same locale list as the
 * month navigator). pt-BR takes "de" between the month and the year, as the prose does ("janeiro de 2027"); the other
 * locales use their own default pattern. No React: tools/fe-tests/t31_income.mts runs it under tsx.
 */
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale/pt-BR';
import { enUS } from 'date-fns/locale/en-US';
import { es } from 'date-fns/locale/es';
import { fr } from 'date-fns/locale/fr';
import { ru } from 'date-fns/locale/ru';
import { ja } from 'date-fns/locale/ja';
import { zhCN } from 'date-fns/locale/zh-CN';
import { arSA } from 'date-fns/locale/ar-SA';

const LOCALES: Record<string, typeof ptBR> = {
  'pt-BR': ptBR,
  'en-US': enUS,
  'es-ES': es,
  'fr-FR': fr,
  'ru-RU': ru,
  'ja-JP': ja,
  'zh-CN': zhCN,
  'ar-SA': arSA,
};

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The locale the names are written in: the one asked for, or pt-BR when the app does not have it. */
function resolvedLocale(locale: string): string {
  return LOCALES[locale] ? locale : 'pt-BR';
}

/** The pattern of a month with its year: "janeiro de 2027" in pt-BR, "January 2027" in en-US. */
function yearPattern(locale: string): string {
  return resolvedLocale(locale) === 'pt-BR' ? "MMMM 'de' yyyy" : 'MMMM yyyy';
}

/** A 'YYYY-MM' as the month name and year ('' for anything else). */
export function monthNameOf(month: string, locale: string): string {
  if (!MONTH_KEY.test(month)) return '';
  const date = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
  return format(date, yearPattern(locale), { locale: LOCALES[resolvedLocale(locale)] });
}

/** A month number (1 to 12) as the month name alone ('' for anything else). */
export function monthOnlyOf(monthNumber: number | null | undefined, locale: string): string {
  if (!Number.isInteger(monthNumber) || (monthNumber as number) < 1 || (monthNumber as number) > 12) return '';
  return format(new Date(2026, (monthNumber as number) - 1, 1), 'MMMM', { locale: LOCALES[resolvedLocale(locale)] });
}

/** The first letter upper-cased, for a name that starts a sentence or a line. */
export const capitalize = (text: string): string => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

import type { FieldCalculation, FieldFormat } from './commands.js';

/**
 * What a field's format and calculation MEAN, applied by this application's own code (ADR-0193 Decision 6, ADR-0226
 * Decision 6, invariant 24): the number a typed value is, how a value is shown, whether a value fits its format, and
 * what a calculation works out to.
 *
 * ONE MODULE for the engine host, which works calculations out and draws a field's shown text, and for the renderer,
 * which checks a value when a person leaves the field (B3a). The grammar of the scripts these mean is `fieldActions.ts`'
 * in the kernel; the meaning is another widely used PDF editor's own `AFNumber_Format`, `AFPercent_Format`, `AFDate_FormatEx`, `AFTime_Format`
 * and `AFSimple_Calculate`, which every reader of the file applies, so what is shown here is what a reader shows.
 *
 * The stored value is never formatted: `/V` keeps what was typed, as another widely used PDF editor keeps it, and the format is how it is SHOWN.
 */

type Separators = Extract<FieldFormat, { kind: 'number' }>['separators'];

/** The right single quotation mark, AF's grouping mark for `sepStyle` 4, by its code point so no editor has to keep it. */
const RIGHT_QUOTE = String.fromCodePoint(0x2019);

/**
 * The marks a typed number may carry around it that are never part of it: a percent, the dollar, euro, pound and yen
 * signs, and both apostrophes a grouping may be written with. By code point, for {@link RIGHT_QUOTE}'s reason.
 */
const AROUND_A_NUMBER = new RegExp(`[\\s%$'${[0x20ac, 0xa3, 0xa5, 0x2019].map((code) => String.fromCodePoint(code)).join('')}]`, 'gu');

/** The thousands mark and the decimal point of each separator style, AF's `sepStyle` 0 to 4. */
const MARKS: Readonly<Record<Separators, { readonly group: string; readonly point: string }>> = {
  'comma-dot': { group: ',', point: '.' },
  'none-dot': { group: '', point: '.' },
  'dot-comma': { group: '.', point: ',' },
  'none-comma': { group: '', point: ',' },
  'apostrophe-dot': { group: RIGHT_QUOTE, point: '.' },
};

/**
 * The number a typed value is, or `undefined` for a value that is not one; an empty value is `undefined` too.
 *
 * Lenient as a reader is: spaces, a currency sign, a percent sign and the grouping marks are passed over, a value in
 * parentheses is negative, and the decimal point is the field's own where it has a format, else whichever of `.` and
 * `,` comes last, so `1,234.5` and `1.234,5` both read as the number they look like.
 */
export function parseFieldNumber(text: string, separators?: Separators): number | undefined {
  let value = text.trim();
  if (value === '') return undefined;
  let negative = false;
  if (/^\(.*\)$/u.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  // A SIGN, A CURRENCY OR A PERCENT is a mark around the number, never part of it.
  value = value.replaceAll(AROUND_A_NUMBER, '');
  if (value.startsWith('-')) {
    negative = !negative;
    value = value.slice(1);
  } else if (value.startsWith('+')) {
    value = value.slice(1);
  }
  const point = separators === undefined ? lastPoint(value) : MARKS[separators].point;
  const other = point === '.' ? ',' : '.';
  value = value.replaceAll(other, '');
  if (point !== '.') value = value.replace(point, '.');
  if (!/^(?:\d+\.?\d*|\.\d+)$/u.test(value)) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? (negative ? -number : number) : undefined;
}

/** The decimal point of a value with no format: the later of `.` and `,`, or `.` when it holds neither. */
function lastPoint(value: string): '.' | ',' {
  return value.lastIndexOf(',') > value.lastIndexOf('.') && !/^\d{1,3}(?:,\d{3})+$/u.test(value) ? ',' : '.';
}

/** A value already in the stored form: digits and a point, no grouping, at most a leading sign. */
const CANONICAL = /^[+-]?(?:\d+\.?\d*|\.\d+)$/u;

/**
 * The number a STORED value is. The stored form is canonical, a point and no grouping, because that is what a fill of a
 * formatted field stores ({@link storedNumber}); a value another program stored in the field's own style is read in it.
 * Canonical first, or `1234.5` in a field written `1.234,5` would read as twelve thousand.
 */
function storedValueNumber(raw: string, separators: Separators): number | undefined {
  const trimmed = raw.trim();
  return CANONICAL.test(trimmed) ? Number(trimmed) : parseFieldNumber(trimmed, separators);
}

/** The number a stored value is, read in its field's format where it has a number format: what a calculation adds up. */
export function fieldNumber(raw: string, format: FieldFormat | null): number | undefined {
  const separators = format !== null && (format.kind === 'number' || format.kind === 'percent') ? format.separators : 'comma-dot';
  return storedValueNumber(raw, separators);
}

/**
 * What a number or percent field stores for what a person typed: the number in the canonical form, so every reader's
 * own format reads it alike (`1.234,5` typed into a field written that way is stored `1234.5`). A value that is not a
 * number is stored as typed, and the check says what is wrong with it.
 */
export function storedNumber(typed: string, format: FieldFormat): string {
  if (format.kind !== 'number' && format.kind !== 'percent') return typed;
  const number = parseFieldNumber(typed, format.separators);
  if (number === undefined) return typed;
  // A PERCENT IS TYPED AS IT IS SHOWN, `12.5` or `12.5%` meaning an eighth, and stored as the fraction AF stores.
  return calculatedText(format.kind === 'percent' ? number / 100 : number);
}

/** A number with its decimals, grouped by thousands, in a separator style. */
function grouped(magnitude: number, decimals: number, separators: Separators): string {
  const { group, point } = MARKS[separators];
  const [whole = '0', fraction] = magnitude.toFixed(decimals).split('.');
  const withGroups = group === '' ? whole : whole.replaceAll(/\B(?=(?:\d{3})+(?!\d))/gu, group);
  return fraction === undefined ? withGroups : `${withGroups}${point}${fraction}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A date as a pattern writes it: `d`, `dd`, `m`, `mm`, `mmm`, `mmmm`, `yy`, `yyyy`, and the separators between. */
function dateText(date: { readonly year: number; readonly month: number; readonly day: number }, pattern: string): string {
  return pattern.replaceAll(/yyyy|yy|mmmm|mmm|mm|m|dd|d/gu, (token) => {
    switch (token) {
      case 'yyyy':
        return String(date.year).padStart(4, '0');
      case 'yy':
        return String(date.year % 100).padStart(2, '0');
      case 'mmmm':
        return MONTHS[date.month - 1] ?? '';
      case 'mmm':
        return (MONTHS[date.month - 1] ?? '').slice(0, 3);
      case 'mm':
        return String(date.month).padStart(2, '0');
      case 'm':
        return String(date.month);
      case 'dd':
        return String(date.day).padStart(2, '0');
      default:
        return String(date.day);
    }
  });
}

/** Whether a day exists in a month: 31 February is not a date, and a format that took it would show one. */
function realDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The date a typed value is, read in the pattern's own order (a `d` first is day first), or as `yyyy-mm-dd`, or with a
 * month written as a word. A two-digit year is 19xx from 50 and 20xx below, as AF reads one.
 */
export function parseFieldDate(text: string, pattern: string): { readonly year: number; readonly month: number; readonly day: number } | undefined {
  const value = text.trim();
  if (value === '') return undefined;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/u.exec(value);
  const parts = value.split(/[^\dA-Za-z]+/u).filter((part) => part !== '');
  let year: number | undefined;
  let month: number | undefined;
  let day: number | undefined;
  if (iso !== null) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    const order = [...pattern.matchAll(/y+|m+|d+/gu)].map((match) => match[0][0]);
    const named = parts.findIndex((part) => /^[A-Za-z]{3,}$/u.test(part));
    if (named >= 0) {
      const word = (parts[named] ?? '').toLowerCase();
      const at = MONTHS.findIndex((name) => name.toLowerCase().startsWith(word.slice(0, 3)));
      if (at < 0) return undefined;
      month = at + 1;
      const numbers = parts.filter((_, index) => index !== named).map(Number);
      const yearAt = numbers.findIndex((number) => number > 31);
      year = yearAt >= 0 ? numbers[yearAt] : numbers[1];
      day = numbers.find((_, index) => index !== (yearAt >= 0 ? yearAt : 1));
    } else {
      if (parts.length !== 3 || parts.some((part) => !/^\d+$/u.test(part))) return undefined;
      const slots = order.length === 3 ? order : ['m', 'd', 'y'];
      for (const [at, slot] of slots.entries()) {
        const number = Number(parts[at]);
        if (slot === 'y') year = number;
        else if (slot === 'm') month = number;
        else day = number;
      }
    }
  }
  if (year === undefined || month === undefined || day === undefined) return undefined;
  if (year < 100) year += year >= 50 ? 1900 : 2000;
  return realDate(year, month, day) ? { year, month, day } : undefined;
}

/** A time typed as `14:05`, `2:05 pm` or with seconds, as hours, minutes and seconds; `undefined` for one that is not. */
export function parseFieldTime(text: string): { readonly hours: number; readonly minutes: number; readonly seconds: number } | undefined {
  const match = /^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm|a|p)?$/iu.exec(text.trim());
  if (match === null) return undefined;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? '0');
  const seconds = Number(match[3] ?? '0');
  const half = match[4]?.toLowerCase();
  if (half !== undefined) {
    if (hours < 1 || hours > 12) return undefined;
    hours = (hours % 12) + (half.startsWith('p') ? 12 : 0);
  }
  return hours < 24 && minutes < 60 && seconds < 60 ? { hours, minutes, seconds } : undefined;
}

/** A time in one of the four patterns. */
function timeText(time: { readonly hours: number; readonly minutes: number; readonly seconds: number }, pattern: Extract<FieldFormat, { kind: 'time' }>['pattern']): string {
  const two = (number: number): string => String(number).padStart(2, '0');
  const twelve = time.hours % 12 === 0 ? 12 : time.hours % 12;
  const half = time.hours < 12 ? 'am' : 'pm';
  switch (pattern) {
    case 'HH:MM':
      return `${two(time.hours)}:${two(time.minutes)}`;
    case 'h:MM tt':
      return `${String(twelve)}:${two(time.minutes)} ${half}`;
    case 'HH:MM:ss':
      return `${two(time.hours)}:${two(time.minutes)}:${two(time.seconds)}`;
    case 'h:MM:ss tt':
      return `${String(twelve)}:${two(time.minutes)}:${two(time.seconds)} ${half}`;
    default: {
      const unhandled: never = pattern;
      return unhandled;
    }
  }
}

/**
 * What a field with this format shows for a stored value. A value the format cannot read is shown as it is, as a
 * reader shows it: the person sees what they typed rather than a blank, and the check below says what is wrong.
 */
export function formatFieldValue(raw: string, format: FieldFormat): string {
  if (raw.trim() === '') return raw;
  switch (format.kind) {
    case 'number': {
      const number = storedValueNumber(raw, format.separators);
      if (number === undefined) return raw;
      const body = grouped(Math.abs(number), format.decimals, format.separators);
      const currency = format.currency ?? '';
      const money = currency === '' ? body : format.currencyBefore === false ? `${body}${currency}` : `${currency}${body}`;
      if (number >= 0 || Number(Math.abs(number).toFixed(format.decimals)) === 0) return money;
      return format.negative === 'parens' ? `(${money})` : `-${money}`;
    }
    case 'percent': {
      const number = storedValueNumber(raw, format.separators);
      if (number === undefined) return raw;
      const body = grouped(Math.abs(number * 100), format.decimals, format.separators);
      return `${number < 0 ? '-' : ''}${body}%`;
    }
    case 'date': {
      const date = parseFieldDate(raw, format.pattern);
      return date === undefined ? raw : dateText(date, format.pattern);
    }
    case 'time': {
      const time = parseFieldTime(raw);
      return time === undefined ? raw : timeText(time, format.pattern);
    }
    default: {
      const unhandled: never = format;
      return unhandled;
    }
  }
}

/** What a value's format says about it: `fits`, or the kind of value the format asks for. */
export type FormatCheck = { readonly fits: true } | { readonly fits: false; readonly wants: FieldFormat['kind'] };

/** Whether a value fits its format; an empty value always does, because whether one is owed is `required`'s question. */
export function checkFieldValue(raw: string, format: FieldFormat): FormatCheck {
  if (raw.trim() === '') return { fits: true };
  const read =
    format.kind === 'date'
      ? parseFieldDate(raw, format.pattern)
      : format.kind === 'time'
        ? parseFieldTime(raw)
        : parseFieldNumber(raw, format.separators);
  return read === undefined ? { fits: false, wants: format.kind } : { fits: true };
}

/**
 * What a calculation works out to over its fields' numbers, AF's own rule: a value that is not a number counts as
 * nothing, so a sum skips it and a product is 0 with it; an average divides by every field named; a minimum and a
 * maximum of nothing are 0.
 */
export function calculate(operation: FieldCalculation['operation'], numbers: readonly (number | undefined)[]): number {
  const values = numbers.map((number) => number ?? 0);
  if (values.length === 0) return 0;
  switch (operation) {
    case 'sum':
      return values.reduce((sum, value) => sum + value, 0);
    case 'product':
      return values.reduce((product, value) => product * value, 1);
    case 'average':
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    default: {
      const unhandled: never = operation;
      return unhandled;
    }
  }
}

/**
 * The text a calculated field stores for a number: the number, with no grouping and a point, at most ten decimals and
 * none trailing, so `0.1 + 0.2` is stored `0.3` and a reader's own format shows it as the field asks.
 */
export function calculatedText(number: number): string {
  if (!Number.isFinite(number)) return '';
  const fixed = number.toFixed(10).replace(/\.?0+$/u, '');
  return fixed === '-0' ? '0' : fixed;
}

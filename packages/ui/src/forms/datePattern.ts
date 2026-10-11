/**
 * The date pattern a new date field is given: the order and separator the person's own locale writes a date in, spelt
 * in the format language a date field's format takes (`dd`, `mm`, `yyyy` and a separator), so the field reads as the
 * person who made it expects (ADR-0226 Decision 13).
 *
 * Read from `Intl` rather than from a table: the locale's own formatter is the authority on how it writes a date (B3a),
 * and a table here would be a second opinion that agrees for the locales somebody thought of.
 */
const FALLBACK = 'mm/dd/yyyy';

export function localDatePattern(locale?: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(
      new Date(2001, 10, 22),
    );
  } catch (error) {
    // A LOCALE `Intl` REFUSES (`RangeError: Incorrect locale information provided`) is the person's settings, never a
    // reason to refuse the field: the fallback is the pattern a date field is most often given.
    if (error instanceof RangeError) return FALLBACK;
    throw error;
  }
  let pattern = '';
  for (const part of parts) {
    if (part.type === 'day') pattern += 'dd';
    else if (part.type === 'month') pattern += 'mm';
    else if (part.type === 'year') pattern += 'yyyy';
    else if (part.type === 'literal') {
      // A LITERAL THE FORMAT LANGUAGE CANNOT CARRY (a Hungarian `. ` keeps its dot and space, a Chinese 年 does not) is
      // written as the nearest it can: each character it can carry is kept and the rest become a slash.
      // Every separator is one ASCII character, so a match per code unit is a match per character.
      const kept = part.value.replace(/[^/\-., ]/gu, '');
      pattern += kept === '' ? '/' : kept;
    }
  }
  return /^(?:dd|mm|yyyy|[/\-., ])+$/u.test(pattern) && pattern.includes('dd') && pattern.includes('mm') ? pattern.trim() : FALLBACK;
}

import type { FIELD_FONTS, FieldCalculation, FieldFormat } from '@monstera/contract';

/**
 * A field's format and calculation, as the standard Acrobat calls every reader knows, written and read as DATA.
 *
 * ## No script is run, here or anywhere (ADR-0193, invariant 24)
 *
 * A format is the `/AA` `/F` action's JavaScript string, `AFNumber_Format(2, 0, 0, 0, "£", true)`, and its keystroke
 * partner under `/K`; a calculation is `/AA` `/C`'s `AFSimple_Calculate("SUM", new Array ("a", "b"))`. Writing these makes
 * the form behave in Acrobat, PDF-XChange and a browser's reader. READING them is a parser that accepts exactly the
 * grammar this module writes, and everything it does not recognise is left exactly as the file had it and reported as no
 * format here: a custom script is kept and never interpreted, which is also what stops this being a way to run one.
 *
 * ## One module owns both directions (B3a)
 *
 * The writer and the reader are the same table, so a format written is a format read, and a second opinion about the
 * grammar cannot appear in the evaluator.
 */

/** The separator styles, as `AFNumber_Format`'s and `AFPercent_Format`'s `sepStyle` numbers them. */
const SEPARATOR_NUMBER = {
  'comma-dot': 0,
  'none-dot': 1,
  'dot-comma': 2,
  'none-comma': 3,
  'apostrophe-dot': 4,
} as const satisfies Record<string, number>;

type Separators = keyof typeof SEPARATOR_NUMBER;

const SEPARATOR_OF = new Map<number, Separators>(
  (Object.entries(SEPARATOR_NUMBER) as [Separators, number][]).map(([name, number]) => [number, name]),
);

/** `AFNumber_Format`'s `negStyle` numbers. */
const NEGATIVE_NUMBER = { minus: 0, red: 1, parens: 2 } as const;

type Negative = keyof typeof NEGATIVE_NUMBER;

const NEGATIVE_OF = new Map<number, Negative>(
  (Object.entries(NEGATIVE_NUMBER) as [Negative, number][]).map(([name, number]) => [number, name]),
);

/** `AFTime_Format`'s `ptf` numbers. */
const TIME_PATTERNS = ['HH:MM', 'h:MM tt', 'HH:MM:ss', 'h:MM:ss tt'] as const;

/** `/DA`'s `Tf` operator: the face's resource name and the size. ONE spelling, read by the writer and the reader alike. */
const TF = /\/([^\0\t\n\f\r ]+)[\0\t\n\f\r ]*(\d*\.\d+|\d+)?[\0\t\n\f\r ]+Tf/u;

/** What a default appearance says about its text: the font resource it names and the size, `0` being the reader's own. */
export function parseDefaultAppearance(da: string | undefined): { readonly resource: string; readonly size: number } | undefined {
  const match = da === undefined ? null : TF.exec(da);
  const resource = match?.[1];
  if (resource === undefined) return undefined;
  return { resource, size: Number(match?.[2] ?? 0) };
}

/** A default appearance with its type size replaced, keeping the face and everything else it says. */
export function withFontSize(da: string | undefined, size: number): string {
  const current = da ?? '/Helv 0 Tf 0 g';
  const match = TF.exec(current);
  if (match === null) return `/Helv ${String(size)} Tf 0 g ${current}`.trim();
  return current.replace(TF, `/${match[1] ?? 'Helv'} ${String(size)} Tf`);
}

/**
 * Which of the standard three a font is: by its `/BaseFont`, or by the resource name where the file names no font.
 * Anything else is read as Helvetica, which is what a reader falls back to.
 */
export function faceOfFont(baseFont: string | undefined, resource: string | undefined): FieldFace {
  const name = (baseFont ?? resource ?? '').toLowerCase();
  if (/times|^tiro|^tibo|^tiit/u.test(name)) return 'times';
  if (/cour|^cour/u.test(name)) return 'courier';
  return 'helvetica';
}

/** One of the faces a field may be set in. */
export type FieldFace = (typeof FIELD_FONTS)[number];

/** The calculation operations as `AFSimple_Calculate` spells them. */
const OPERATION_WORD = { sum: 'SUM', product: 'PRD', average: 'AVG', min: 'MIN', max: 'MAX' } as const;

type Operation = keyof typeof OPERATION_WORD;

const OPERATION_OF = new Map<string, Operation>(
  (Object.entries(OPERATION_WORD) as [Operation, string][]).map(([name, word]) => [word, name]),
);

/** A string as a JavaScript double quoted literal, which is the only place text enters a script this module writes. */
function quoted(text: string): string {
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/** The action pair for a format: what shows the value (`/F`) and what filters a keystroke (`/K`). */
export interface FormatScripts {
  readonly format: string;
  readonly keystroke: string;
}

/** The scripts a format is written as. */
export function formatScripts(format: FieldFormat): FormatScripts {
  switch (format.kind) {
    case 'number': {
      const arguments_ = [
        String(format.decimals),
        String(SEPARATOR_NUMBER[format.separators]),
        String(NEGATIVE_NUMBER[format.negative]),
        '0',
        quoted(format.currency ?? ''),
        String(format.currencyBefore ?? true),
      ].join(', ');
      return { format: `AFNumber_Format(${arguments_});`, keystroke: `AFNumber_Keystroke(${arguments_});` };
    }
    case 'percent': {
      const arguments_ = `${String(format.decimals)}, ${String(SEPARATOR_NUMBER[format.separators])}`;
      return { format: `AFPercent_Format(${arguments_});`, keystroke: `AFPercent_Keystroke(${arguments_});` };
    }
    case 'date':
      return {
        format: `AFDate_FormatEx(${quoted(format.pattern)});`,
        keystroke: `AFDate_KeystrokeEx(${quoted(format.pattern)});`,
      };
    case 'time': {
      const at = String(TIME_PATTERNS.indexOf(format.pattern));
      return { format: `AFTime_Format(${at});`, keystroke: `AFTime_Keystroke(${at});` };
    }
    default: {
      const unhandled: never = format;
      return unhandled;
    }
  }
}

/** A JavaScript string literal's text, un-escaped, or `undefined` for anything that is not one this module wrote. */
function unquote(literal: string): string | undefined {
  if (!/^"(?:[^"\\]|\\["\\])*"$/u.test(literal)) return undefined;
  return literal.slice(1, -1).replaceAll(/\\(["\\])/gu, '$1');
}

const STRING = String.raw`("(?:[^"\\]|\\["\\])*")`;
const NUMBER_FORMAT = new RegExp(
  String.raw`^AFNumber_Format\((\d{1,2}), ?(\d), ?(\d), ?(\d), ?${STRING}, ?(true|false)\);?$`,
  'u',
);
const PERCENT_FORMAT = /^AFPercent_Format\((\d{1,2}), ?(\d)\);?$/u;
const DATE_FORMAT = new RegExp(String.raw`^AFDate_FormatEx\(${STRING}\);?$`, 'u');
const TIME_FORMAT = /^AFTime_Format\((\d)\);?$/u;

/** The format a `/F` script writes, or `undefined` for a script that is not exactly one of the four this module writes. */
export function parseFormat(script: string): FieldFormat | undefined {
  const text = script.trim();
  const number = NUMBER_FORMAT.exec(text);
  if (number !== null) {
    const separators = SEPARATOR_OF.get(Number(number[2]));
    const negative = NEGATIVE_OF.get(Number(number[3]));
    const currency = unquote(number[5] ?? '');
    if (separators === undefined || negative === undefined || currency === undefined) return undefined;
    return {
      kind: 'number',
      decimals: Number(number[1]),
      separators,
      negative,
      ...(currency === '' ? {} : { currency }),
      currencyBefore: number[6] === 'true',
    };
  }
  const percent = PERCENT_FORMAT.exec(text);
  if (percent !== null) {
    const separators = SEPARATOR_OF.get(Number(percent[2]));
    return separators === undefined ? undefined : { kind: 'percent', decimals: Number(percent[1]), separators };
  }
  const date = DATE_FORMAT.exec(text);
  if (date !== null) {
    const pattern = unquote(date[1] ?? '');
    return pattern === undefined || !/^(?:d{1,2}|m{1,4}|y{2}|y{4}|[/\-., ])+$/u.test(pattern)
      ? undefined
      : { kind: 'date', pattern };
  }
  const time = TIME_FORMAT.exec(text);
  if (time !== null) {
    const pattern = TIME_PATTERNS[Number(time[1])];
    return pattern === undefined ? undefined : { kind: 'time', pattern };
  }
  return undefined;
}

/** The script a calculation is written as. */
export function calculationScript(calculation: FieldCalculation): string {
  const names = calculation.fields.map(quoted).join(', ');
  return `AFSimple_Calculate(${quoted(OPERATION_WORD[calculation.operation])}, new Array (${names}));`;
}

const CALCULATION = new RegExp(
  String.raw`^AFSimple_Calculate\(${STRING}, ?new Array ?\(((?:${STRING}(?:, ?)?)+)\)\);?$`,
  'u',
);

/** The calculation a `/C` script writes, or `undefined` for anything else. */
export function parseCalculation(script: string): FieldCalculation | undefined {
  const match = CALCULATION.exec(script.trim());
  if (match === null) return undefined;
  const operation = OPERATION_OF.get(unquote(match[1] ?? '') ?? '');
  if (operation === undefined) return undefined;
  const fields = [...(match[2] ?? '').matchAll(new RegExp(STRING, 'gu'))].map((hit) => unquote(hit[1] ?? ''));
  if (fields.some((name) => name === undefined || name === '')) return undefined;
  return { operation, fields: fields as string[] };
}

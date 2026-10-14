import type { FIELD_BORDER_STYLES, FIELD_CHECK_STYLES, FieldCalculation, FieldFormat, FieldRange } from '@monstera/contract';

import { borderStyleOfName, checkStyleOfCharacter, parseCalculation, parseFormat, parseRange } from './fieldActions.js';

type FieldBorderStyle = (typeof FIELD_BORDER_STYLES)[number];
type FieldCheckStyle = (typeof FIELD_CHECK_STYLES)[number];
import type { PDFObject, PDFWidget } from './mupdfRaw.js';

/**
 * What a field's dictionary says about how it is filled: its inherited flags, its length limit, and the format and
 * calculation it carries as data. ONE reader, which the field list (`formFields.ts`) and the Properties read
 * (`formFieldRead.ts`) both take, so the list and the pane cannot disagree about a field (B3a).
 *
 * Its own module because the two callers import each other's neighbours: the list's module is imported by the
 * Properties read, and a reader living in either would be a cycle.
 */

/** How far up a `/Parent` chain an inherited key is looked for. */
export const MAX_FIELD_ANCESTRY = 32;

/**
 * The border width a widget draws with: `/BS /W`, else the third number of `/Border`, else the format's own default of 1.
 * One reading, which the Properties read and the field appearance's finishing step both take.
 */
export function borderWidthOf(object: PDFObject): number {
  const width = object.get('BS', 'W');
  if (width.isNumber()) return width.asNumber();
  const border = object.get('Border');
  if (border.isArray() && border.length >= 3) {
    const third = border.get(2);
    if (third.isNumber()) return third.asNumber();
  }
  return 1;
}

/** `/Ff` bits, ISO 32000-1 Tables 226, 228 and 230, numbered from 1 as the standard numbers them. */
const FLAG = {
  required: 1 << 1,
  password: 1 << 13,
  edit: 1 << 18,
  multiSelect: 1 << 21,
  doNotSpellCheck: 1 << 22,
  comb: 1 << 24,
} as const;

/** The first object of a field's ancestry that holds the key, nearest first: `/Ff`, `/DA`, `/AA` and the rest inherit. */
export function nearest(object: PDFObject, key: string): PDFObject {
  let at = object;
  for (let hop = 0; hop < MAX_FIELD_ANCESTRY; hop += 1) {
    const found = at.get(key);
    if (!found.isNull()) return found;
    const parent = at.get('Parent');
    if (!parent.isDictionary()) break;
    at = parent;
  }
  return object.get(key);
}

/** The dictionary that holds a field's `/T`: the widget itself where the two are merged, else its nearest parent with one. */
export function fieldDictionaryOf(object: PDFObject): PDFObject {
  let at = object;
  for (let hop = 0; hop < MAX_FIELD_ANCESTRY; hop += 1) {
    if (!at.get('T').isNull()) return at;
    const parent = at.get('Parent');
    if (!parent.isDictionary()) break;
    at = parent;
  }
  return object;
}

/**
 * What a push button's own `/A` does (the owner's F7): nothing, the standard Reset form (ISO 32000-1 12.6.4.12), or
 * anything else (a script, a submit), which is `other` and is never run. The one reading: the listing, the Properties
 * read and the reset's own refusal all take it.
 */
export function buttonActionOf(object: PDFObject): 'none' | 'reset' | 'other' {
  const action = object.get('A');
  if (action.isNull()) return buttonActionNamed(null);
  const kind = action.isDictionary() ? action.get('S') : action;
  return buttonActionNamed(kind.isName() ? kind.asName() : '');
}

/**
 * THE RULE, over the action's `/S` name: `null` where the button has no `/A`, and any other string (an empty one for
 * an `/S` that is not a name) where it has one. Its own function so the pdf-lib edit, which reads another object model,
 * asks this and not a second spelling of it (B3a).
 */
export function buttonActionNamed(subtype: string | null): 'none' | 'reset' | 'other' {
  if (subtype === null) return 'none';
  return subtype === 'ResetForm' ? 'reset' : 'other';
}

/** The fully qualified name of a field object: each `/T` from the root down, joined by dots. */
export function qualifiedNameOf(object: PDFObject): string {
  const parts: string[] = [];
  let at = object;
  for (let hop = 0; hop < MAX_FIELD_ANCESTRY; hop += 1) {
    const partial = at.get('T');
    if (partial.isString()) parts.unshift(partial.asString());
    const parent = at.get('Parent');
    if (!parent.isDictionary()) break;
    at = parent;
  }
  return parts.join('.');
}

/** The script of one `/AA` action, or `undefined` where the action is absent, and `null` where it is one with no readable script. */
export function scriptOf(action: PDFObject): string | null | undefined {
  if (action.isNull()) return undefined;
  const js = action.get('JS');
  return js.isString() ? js.asString() : null;
}

/** What one field's dictionary says about filling it. */
export interface FieldRules {
  readonly required: boolean;
  /** The most characters a text field takes, or `null` for no limit. */
  readonly maxLength: number | null;
  /** A text field drawn one character to a cell, `maxLength` cells across. */
  readonly comb: boolean;
  readonly masked: boolean;
  /** A list that takes several values. */
  readonly multiSelect: boolean;
  /** A dropdown that also takes typing. */
  readonly editable: boolean;
  /** Whether a reader checks the spelling of what is typed: a text field or a dropdown without `DoNotSpellCheck`. */
  readonly spellCheck: boolean;
  /** The format this application can read, or `null`; a script it cannot read is not one, and `customFormat` says so. */
  readonly format: FieldFormat | null;
  readonly customFormat: boolean;
  /** The calculation this application can read, or `null`. */
  readonly calculation: FieldCalculation | null;
  readonly customCalculation: boolean;
  /** The number range this application can read (ADR-0230), or `null`; a script it did not write is `customValidation`. */
  readonly validation: FieldRange | null;
  readonly customValidation: boolean;
}

/** The rules of the field one widget belongs to. A flag is read by the kinds it is defined for, never for the rest. */
export function fieldRulesOf(widget: PDFWidget): FieldRules {
  const object = widget.getObject();
  const flags = nearest(object, 'Ff');
  const bits = flags.isNumber() ? flags.asNumber() : 0;
  const text = widget.isText();
  const choice = widget.isChoice();
  const aa = nearest(object, 'AA');
  const formatScript = aa.isNull() ? undefined : scriptOf(aa.get('F'));
  const calculationScript = aa.isNull() ? undefined : scriptOf(aa.get('C'));
  const format = typeof formatScript === 'string' ? (parseFormat(formatScript) ?? null) : null;
  const calculation = typeof calculationScript === 'string' ? (parseCalculation(calculationScript) ?? null) : null;
  const validationScript = aa.isNull() ? undefined : scriptOf(aa.get('V'));
  const validation = typeof validationScript === 'string' ? (parseRange(validationScript) ?? null) : null;
  const limit = text ? widget.getMaxLen() : 0;
  return {
    required: (bits & FLAG.required) !== 0,
    maxLength: limit > 0 ? limit : null,
    comb: text && limit > 0 && (bits & FLAG.comb) !== 0,
    masked: text && (bits & FLAG.password) !== 0,
    multiSelect: choice && widget.isListBox() && (bits & FLAG.multiSelect) !== 0,
    editable: choice && widget.isComboBox() && (bits & FLAG.edit) !== 0,
    spellCheck: (text || (choice && widget.isComboBox())) && (bits & FLAG.doNotSpellCheck) === 0,
    format,
    customFormat: formatScript !== undefined && format === null,
    calculation,
    customCalculation: calculationScript !== undefined && calculation === null,
    validation,
    customValidation: validationScript !== undefined && validation === null,
  };
}

/**
 * Whether a field shows a mask in place of its value: a text field flagged as a password.
 *
 * MuPDF 1.28.0 draws a text field's appearance from its value and never reads this flag (`pdf-appearance.c` has no branch on
 * `PDF_TX_FIELD_IS_PASSWORD`), so a password field it draws carries its value in the stream and a flatten puts that value on
 * the page. Such a field is therefore always drawn by Monstera, and every place that decides who draws a field takes this.
 */
export function masksItsValue(widget: PDFWidget): boolean {
  return widget.isText() && widget.isPassword();
}

/** How a widget's border is drawn, from `/BS /S` (ADR-0230): solid where it names none. */
export function borderStyleOf(object: PDFObject): FieldBorderStyle {
  const style = object.get('BS', 'S');
  return borderStyleOfName(style.isName() ? style.asName() : undefined);
}

/**
 * The mark a tick box or a radio shows when on, from `/MK /CA` (ADR-0230); where it names none, what every reader draws: a
 * check for a tick box and a dot for a radio, which is the circle style.
 */
export function checkStyleOf(object: PDFObject, radio: boolean): FieldCheckStyle {
  const character = object.get('MK', 'CA');
  return checkStyleOfCharacter(character.isString() ? character.asString() : radio ? 'l' : '4');
}

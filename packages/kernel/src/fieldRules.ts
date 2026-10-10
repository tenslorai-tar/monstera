import type { FieldCalculation, FieldFormat } from '@monstera/contract';

import { parseCalculation, parseFormat } from './fieldActions.js';
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

/** `/Ff` bits, ISO 32000-1 Tables 226, 228 and 230, numbered from 1 as the standard numbers them. */
const FLAG = {
  required: 1 << 1,
  password: 1 << 13,
  edit: 1 << 18,
  multiSelect: 1 << 21,
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
  /** The format this application can read, or `null`; a script it cannot read is not one, and `customFormat` says so. */
  readonly format: FieldFormat | null;
  readonly customFormat: boolean;
  /** The calculation this application can read, or `null`. */
  readonly calculation: FieldCalculation | null;
  readonly customCalculation: boolean;
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
  const limit = text ? widget.getMaxLen() : 0;
  return {
    required: (bits & FLAG.required) !== 0,
    maxLength: limit > 0 ? limit : null,
    comb: text && limit > 0 && (bits & FLAG.comb) !== 0,
    masked: text && (bits & FLAG.password) !== 0,
    multiSelect: choice && widget.isListBox() && (bits & FLAG.multiSelect) !== 0,
    editable: choice && widget.isComboBox() && (bits & FLAG.edit) !== 0,
    format,
    customFormat: formatScript !== undefined && format === null,
    calculation,
    customCalculation: calculationScript !== undefined && calculation === null,
  };
}

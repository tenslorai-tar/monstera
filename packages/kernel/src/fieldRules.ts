import type {
  ButtonStep,
  FIELD_BORDER_STYLES,
  FIELD_CHECK_STYLES,
  FieldActionTrigger,
  FieldCalculation,
  FieldFormat,
  FieldRange,
  FieldScript,
} from '@monstera/contract';
import { MAX_ACTION_CHAIN, MAX_ACTION_FIELDS } from '@monstera/contract/host';

import { type ActionHeads, type ActionModel, type PlainAction, buttonSteps, nodeAt } from './buttonActions.js';
import { borderStyleOfName, checkStyleOfCharacter, parseCalculation, parseFormat, parseKeystroke, parseRange } from './fieldActions.js';

type FieldBorderStyle = (typeof FIELD_BORDER_STYLES)[number];
type FieldCheckStyle = (typeof FIELD_CHECK_STYLES)[number];
import type { PDFDocument, PDFObject, PDFWidget } from './mupdfRaw.js';

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
 * MuPDF's object model as `buttonActions.ts` reads it (ADR-0259): the adapter, never a second classifier. The listing,
 * the Properties read and a press all take {@link buttonStepsOf} and {@link actionNodeAt}.
 */
const mupdfActions = (document: PDFDocument): ActionModel<PDFObject> => ({
  plain: (node) => {
    const subtype = node.get('S');
    const flags = node.get('Flags');
    return {
      subtype: subtype.isName() ? subtype.asName() : null,
      fields: fieldsListed(node.get('Fields')),
      flags: flags.isNumber() ? Math.trunc(flags.asNumber()) : 0,
      destination: destinationOf(document, node.get('D')),
      uri: stringOf(node.get('URI')),
      named: node.get('N').isName() ? node.get('N').asName() : null,
      file: fileOf(node.get('F')),
    };
  },
  next: (node) => {
    const next = node.get('Next');
    if (next.isDictionary()) return [next];
    if (!next.isArray()) return [];
    const nodes: PDFObject[] = [];
    for (let at = 0; at < Math.min(next.length, MAX_ACTION_CHAIN); at += 1) {
      const each = next.get(at);
      if (each.isDictionary()) nodes.push(each);
    }
    return nodes;
  },
  identity: (node) => (node.isIndirect() ? node.asIndirect() : undefined),
});

/**
 * An action's `/D` as `buttonActions.ts` reads it. The page is the index of the page object it names, looked up among
 * this document's pages by object number; an integer, which the standard keeps for a remote document's pages, is taken
 * as an index here only where it is one, since some writers put one in a local `GoTo`.
 */
function destinationOf(document: PDFDocument, value: PDFObject): PlainAction['destination'] {
  if (value.isName() || value.isString()) return 'named';
  if (!value.isArray() || value.length === 0) return null;
  const target = value.get(0);
  const count = document.countPages();
  let page: number | null = null;
  if (target.isIndirect()) {
    const wanted = target.asIndirect();
    for (let at = 0; at < count && page === null; at += 1) {
      const each = document.findPage(at);
      if (each.isIndirect() && each.asIndirect() === wanted) page = at;
    }
  } else if (target.isNumber() && Number.isInteger(target.asNumber()) && target.asNumber() >= 0 && target.asNumber() < count) {
    page = target.asNumber();
  }
  const fit = value.get(1);
  const numbers: (number | null)[] = [];
  for (let at = 2; at < Math.min(value.length, 6); at += 1) {
    const each = value.get(at);
    numbers.push(each.isNumber() ? each.asNumber() : null);
  }
  return { page, fit: fit.isName() ? fit.asName() : null, numbers };
}

/** A string entry as text, or `null` where it is not a string. */
function stringOf(value: PDFObject): string | null {
  return value.isString() ? value.asString() : null;
}

/** A file specification as text (ISO 32000-1, 7.11): a string, or a dictionary's `/UF`, else its `/F`. */
function fileOf(value: PDFObject): string | null {
  if (value.isString()) return value.asString();
  if (!value.isDictionary()) return null;
  return stringOf(value.get('UF')) ?? stringOf(value.get('F'));
}

/** `/Fields` as names, at most one past {@link MAX_ACTION_FIELDS}, or `unreadable` where an entry names no field. */
function fieldsListed(fields: PDFObject): PlainAction['fields'] {
  if (fields.isNull()) return null;
  if (!fields.isArray()) return 'unreadable';
  const names: string[] = [];
  for (let at = 0; at < Math.min(fields.length, MAX_ACTION_FIELDS + 1); at += 1) {
    const entry = fields.get(at);
    if (entry.isString()) names.push(entry.asString());
    else if (entry.isDictionary()) names.push(qualifiedNameOf(entry));
    else return 'unreadable';
  }
  return names;
}

/** Each trigger's first action on a widget: `/A`, and `/AA`'s `/U`, `/D`, `/E` and `/X`, where each is a dictionary. */
function actionHeadsOf(object: PDFObject): ActionHeads<PDFObject> {
  const head = (action: PDFObject): PDFObject | undefined => (action.isDictionary() ? action : undefined);
  return {
    up: head(object.get('A')),
    upAgain: head(object.get('AA', 'U')),
    down: head(object.get('AA', 'D')),
    enter: head(object.get('AA', 'E')),
    exit: head(object.get('AA', 'X')),
  };
}

/** Every step a widget's actions hold, classified once (`buttonActions.ts`). */
export function buttonStepsOf(document: PDFDocument, object: PDFObject): readonly ButtonStep[] {
  return buttonSteps(mupdfActions(document), actionHeadsOf(object));
}

/**
 * The action at one step and what it is, as {@link buttonStepsOf} lists it, or `undefined` where there is no such
 * step. A press's command takes this, so it runs exactly what the listing said would run and nothing past it.
 */
export function actionNodeAt(
  document: PDFDocument,
  object: PDFObject,
  trigger: FieldActionTrigger,
  step: number,
): { readonly node: PDFObject; readonly action: ButtonStep['action'] } | undefined {
  const listed = buttonStepsOf(document, object).find((each) => each.trigger === trigger && each.step === step);
  const node = nodeAt(mupdfActions(document), actionHeadsOf(object), trigger, step);
  return listed === undefined || node === undefined ? undefined : { node, action: listed.action };
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
  /** Every script the field carries that is not run: {@link scriptsNotRunOf}. Empty for a field with none. */
  readonly scripts: readonly FieldScript[];
}

/**
 * The triggers of a field's `/AA` besides its value's four (ISO 32000-1 Table 194 for a widget: enter, exit, down, up,
 * focus, blur, and the page's open, close, visible and invisible): a JavaScript action on any of them is a script a
 * reader runs on that event.
 */
const EVENT_TRIGGERS = ['E', 'X', 'D', 'U', 'Fo', 'Bl', 'PO', 'PC', 'PV', 'PI'] as const;

/** Whether an action dictionary — or any action chained after it by `/Next` — is a JavaScript action. */
function runsScript(action: PDFObject): boolean {
  let at = action;
  for (let hop = 0; hop < MAX_FIELD_ANCESTRY; hop += 1) {
    if (!at.isDictionary()) return false;
    const kind = at.get('S');
    if (kind.isName() && kind.asName() === 'JavaScript') return true;
    const next = at.get('Next');
    // A `/Next` ARRAY is each in turn; one chain followed to its end is enough to answer.
    if (next.isArray()) {
      for (let item = 0; item < next.length; item += 1) if (runsScript(next.get(item))) return true;
      return false;
    }
    at = next;
  }
  return false;
}

/**
 * THE SCRIPTS A FIELD CARRIES THAT MONSTERA DOES NOT RUN (invariant 24; the owner's decision of 2026-10-18), the one
 * answer the field list and the Properties read take. A value script — calculation, validation, format, keystroke — is
 * listed where it is present and is not one of the standard calls `fieldActions.ts` reads as data; a standard one works,
 * so it is not listed. An action is listed where the widget's `/A`, or any of its `/AA` event triggers, runs JavaScript.
 */
export function scriptsNotRunOf(
  object: PDFObject,
  rules: Pick<FieldRules, 'customCalculation' | 'customValidation' | 'customFormat'>,
  keystroke: string | null | undefined,
): FieldScript[] {
  const scripts: FieldScript[] = [];
  if (rules.customCalculation) scripts.push('calculation');
  if (rules.customValidation) scripts.push('validation');
  if (rules.customFormat) scripts.push('format');
  if (keystroke !== undefined && (keystroke === null || parseKeystroke(keystroke) === undefined)) scripts.push('keystroke');
  // THE WIDGET'S OWN `/AA` AND ITS FIELD'S: an event trigger may sit on either, and a merged field and widget is one.
  const triggers = [object.get('AA'), valueActionsOf(object)].flatMap((aa) =>
    aa.isDictionary() ? EVENT_TRIGGERS.map((trigger) => aa.get(trigger)) : [],
  );
  if (runsScript(object.get('A')) || triggers.some(runsScript)) scripts.push('action');
  return scripts;
}

/**
 * The `/AA` that holds a field's VALUE scripts — format, keystroke, validation, calculation — which ISO 32000-1 Table 196
 * puts in the FIELD's dictionary, inherited from there up. Not the widget's own: a widget's `/AA` holds its events
 * (Table 194), and read nearest-first from the widget, one with an event script of its own hid its field's calculation.
 */
function valueActionsOf(object: PDFObject): PDFObject {
  return nearest(fieldDictionaryOf(object), 'AA');
}

/** The rules of the field one widget belongs to. A flag is read by the kinds it is defined for, never for the rest. */
export function fieldRulesOf(widget: PDFWidget): FieldRules {
  const object = widget.getObject();
  const flags = nearest(object, 'Ff');
  const bits = flags.isNumber() ? flags.asNumber() : 0;
  const text = widget.isText();
  const choice = widget.isChoice();
  const aa = valueActionsOf(object);
  const formatScript = aa.isNull() ? undefined : scriptOf(aa.get('F'));
  const calculationScript = aa.isNull() ? undefined : scriptOf(aa.get('C'));
  const format = typeof formatScript === 'string' ? (parseFormat(formatScript) ?? null) : null;
  const calculation = typeof calculationScript === 'string' ? (parseCalculation(calculationScript) ?? null) : null;
  const validationScript = aa.isNull() ? undefined : scriptOf(aa.get('V'));
  const validation = typeof validationScript === 'string' ? (parseRange(validationScript) ?? null) : null;
  const keystrokeScript = aa.isNull() ? undefined : scriptOf(aa.get('K'));
  const limit = text ? widget.getMaxLen() : 0;
  const custom = {
    customFormat: formatScript !== undefined && format === null,
    customCalculation: calculationScript !== undefined && calculation === null,
    customValidation: validationScript !== undefined && validation === null,
  };
  return {
    required: (bits & FLAG.required) !== 0,
    maxLength: limit > 0 ? limit : null,
    comb: text && limit > 0 && (bits & FLAG.comb) !== 0,
    masked: text && (bits & FLAG.password) !== 0,
    multiSelect: choice && widget.isListBox() && (bits & FLAG.multiSelect) !== 0,
    editable: choice && widget.isComboBox() && (bits & FLAG.edit) !== 0,
    spellCheck: (text || (choice && widget.isComboBox())) && (bits & FLAG.doNotSpellCheck) === 0,
    format,
    customFormat: custom.customFormat,
    calculation,
    customCalculation: custom.customCalculation,
    validation,
    customValidation: custom.customValidation,
    scripts: scriptsNotRunOf(object, custom, keystrokeScript),
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

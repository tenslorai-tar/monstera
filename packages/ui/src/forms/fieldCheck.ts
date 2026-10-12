import { type FieldFormat, checkFieldValue, fieldNumber, formatFieldValue, storedNumber } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';

import {
  FORM_FIELD_REQUIRED_EMPTY,
  FORM_FIELD_WANTS_AT_LEAST,
  FORM_FIELD_WANTS_AT_MOST,
  FORM_FIELD_WANTS_BETWEEN,
  FORM_FIELD_WANTS_DATE,
  FORM_FIELD_WANTS_NUMBER,
  FORM_FIELD_WANTS_PERCENT,
  FORM_FIELD_WANTS_TIME,
} from '../messages/en.js';
import type { FillOffer, ListedField } from './fieldFill.js';

/** What a person leaving a text field is told, and the words it names. */
export interface FieldProblem {
  readonly message: MessageKey;
  readonly values: Readonly<Record<string, string>>;
}

/** The sentence for each kind of value a format asks for. */
const WANTS: Readonly<Record<FieldFormat['kind'], MessageKey>> = {
  number: FORM_FIELD_WANTS_NUMBER,
  percent: FORM_FIELD_WANTS_PERCENT,
  date: FORM_FIELD_WANTS_DATE,
  time: FORM_FIELD_WANTS_TIME,
};

/** A value of the right kind, shown as the field shows it: the example the sentence gives. */
const SAMPLE: Readonly<Record<FieldFormat['kind'], string>> = {
  number: '1234.5',
  percent: '0.125',
  date: '2026-10-10',
  time: '14:05',
};

/**
 * What a text field stores for what was typed (ADR-0226 Decision 4): a number or a percent in the canonical form every
 * reader's format reads, anything else as typed. The format's own module decides (`storedNumber`), never this one.
 */
export function storedText(typed: string, offer: Extract<FillOffer, { kind: 'text' }>): string {
  return offer.format === null ? typed : storedNumber(typed, offer.format);
}

/**
 * The required fields that hold nothing, one per field, in the form's order (A1.7): a text or a choice with no value, a
 * tick box not ticked, a radio group with no option on. A field can be found again by its first place on the page.
 */
export function emptyRequired(fields: readonly ListedField[]): readonly ListedField[] {
  const groups = new Map<string, ListedField[]>();
  for (const field of [...fields].sort((a, b) => a.page - b.page || a.index - b.index)) {
    if (!field.required || field.readOnly) continue;
    const group = groups.get(field.name);
    if (group === undefined) groups.set(field.name, [field]);
    else group.push(field);
  }
  const empty: ListedField[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (first === undefined) continue;
    const filled =
      first.kind === 'checkbox' || first.kind === 'radio'
        ? group.some((widget) => widget.on === true)
        : first.values.some((value) => value.trim() !== '');
    if (!filled) empty.push(first);
  }
  return empty;
}

/**
 * What is wrong with a value a person has just left, or nothing. A value that does not fit its format is named with an
 * example of one that does, shown as the field shows it; a required field left empty is named. The value is filled
 * either way: a field never refuses what was typed, it says what it expects.
 */
export function leftFieldProblem(name: string, typed: string, offer: Extract<FillOffer, { kind: 'text' }>): FieldProblem | undefined {
  if (offer.format !== null) {
    const check = checkFieldValue(typed, offer.format);
    if (!check.fits) {
      return { message: WANTS[check.wants], values: { name, example: formatFieldValue(SAMPLE[check.wants], offer.format) } };
    }
  }
  // A RANGE (ADR-0230 Decision 5) is checked on the number the field reads, its format's or a plain one; words that are
  // no number at all were named above where a format asks for one, and a range on its own says so here.
  if (offer.range !== null && typed.trim() !== '') {
    const number = fieldNumber(typed, offer.format);
    const { min, max } = offer.range;
    if (number === undefined || (min !== null && number < min) || (max !== null && number > max)) {
      const message = min === null ? FORM_FIELD_WANTS_AT_MOST : max === null ? FORM_FIELD_WANTS_AT_LEAST : FORM_FIELD_WANTS_BETWEEN;
      return { message, values: { name, min: String(min ?? ''), max: String(max ?? '') } };
    }
  }
  if (offer.required && typed.trim() === '') return { message: FORM_FIELD_REQUIRED_EMPTY, values: { name } };
  return undefined;
}

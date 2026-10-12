import { describe, expect, it } from 'vitest';

import {
  FORM_FIELD_REQUIRED_EMPTY,
  FORM_FIELD_WANTS_AT_LEAST,
  FORM_FIELD_WANTS_AT_MOST,
  FORM_FIELD_WANTS_BETWEEN,
  FORM_FIELD_WANTS_DATE,
  FORM_FIELD_WANTS_NUMBER,
} from '../messages/en.js';
import { emptyRequired, leftFieldProblem, storedText } from './fieldCheck.js';
import type { FillOffer, ListedField } from './fieldFill.js';

const PLAIN: Extract<FillOffer, { kind: 'text' }> = {
  kind: 'text',
  held: '',
  lines: false,
  maxLength: null,
  comb: false,
  masked: false,
  required: false,
  format: null,
  range: null,
};

describe('a field’s number range (ADR-0230)', () => {
  const ranged = { ...PLAIN, range: { min: 1, max: 10 } };

  it('names a number outside the range, with both ends, and keeps quiet inside it', () => {
    expect(leftFieldProblem('Count', '11', ranged)).toStrictEqual({ message: FORM_FIELD_WANTS_BETWEEN, values: { name: 'Count', min: '1', max: '10' } });
    expect(leftFieldProblem('Count', '0.5', ranged)?.message).toBe(FORM_FIELD_WANTS_BETWEEN);
    expect(leftFieldProblem('Count', '10', ranged)).toBeUndefined();
    expect(leftFieldProblem('Count', '1', ranged)).toBeUndefined();
  });

  it('says only the end a range has', () => {
    expect(leftFieldProblem('Age', '-1', { ...PLAIN, range: { min: 0, max: null } })?.message).toBe(FORM_FIELD_WANTS_AT_LEAST);
    expect(leftFieldProblem('Age', '200', { ...PLAIN, range: { min: null, max: 150 } })?.message).toBe(FORM_FIELD_WANTS_AT_MOST);
  });

  it('reads the number through the field’s format, so a formatted value inside the range is accepted', () => {
    const money = { ...ranged, range: { min: 0, max: 2000 }, format: { kind: 'number', decimals: 2, separators: 'comma-dot', negative: 'minus' } as const };
    expect(leftFieldProblem('Total', '1,234.50', money)).toBeUndefined();
    expect(leftFieldProblem('Total', '2,500.00', money)?.message).toBe(FORM_FIELD_WANTS_BETWEEN);
  });

  it('CONTROL: the same value in a field with no range is not named', () => {
    expect(leftFieldProblem('Count', '11', PLAIN)).toBeUndefined();
  });
});

describe('the required fields still empty', () => {
  const field = (page: number, index: number, over: Partial<ListedField>): ListedField => ({
    page,
    index,
    kind: 'text',
    name: `f${String(page)}_${String(index)}`,
    values: [],
    on: null,
    options: [],
    readOnly: false,
    multiline: false,
    rect: null,
    required: true,
    maxLength: null,
    comb: false,
    masked: false,
    multiSelect: false,
    editable: false,
    calculated: false,
    format: null,
    ...over,
  });

  it('names an empty text, an unticked box and a group with no option on, once each, in the form’s order', () => {
    const empty = emptyRequired([
      field(1, 0, { kind: 'radio', name: 'plan', on: false }),
      field(1, 1, { kind: 'radio', name: 'plan', on: false }),
      field(0, 1, { kind: 'checkbox', name: 'agree', on: false }),
      field(0, 0, { name: 'email', values: ['  '] }),
    ]);
    expect(empty.map((each) => each.name)).toStrictEqual(['email', 'agree', 'plan']);
  });

  it('passes over what is filled, what is not required and what is read-only', () => {
    expect(
      emptyRequired([
        field(0, 0, { name: 'email', values: ['ada@example.org'] }),
        field(0, 1, { kind: 'checkbox', name: 'agree', on: true }),
        field(0, 2, { kind: 'radio', name: 'plan', on: false }),
        field(0, 3, { kind: 'radio', name: 'plan', on: true }),
        field(0, 4, { name: 'note', required: false }),
        field(0, 5, { name: 'ref', readOnly: true }),
      ]),
    ).toStrictEqual([]);
  });
});

describe('leaving a text field', () => {
  it('names what a format expects, with an example shown as the field shows it', () => {
    const offer = { ...PLAIN, format: { kind: 'number', decimals: 2, separators: 'dot-comma', negative: 'minus' } } as const;
    expect(leftFieldProblem('Price', 'cheap', offer)).toStrictEqual({ message: FORM_FIELD_WANTS_NUMBER, values: { name: 'Price', example: '1.234,50' } });
    expect(leftFieldProblem('Price', '12,5', offer)).toBeUndefined();
    const date = { ...PLAIN, format: { kind: 'date', pattern: 'dd/mm/yyyy' } } as const;
    expect(leftFieldProblem('Born', '31/02/2001', date)?.message).toBe(FORM_FIELD_WANTS_DATE);
  });

  it('names a required field left empty, and nothing for one that is not required', () => {
    expect(leftFieldProblem('Name', '  ', { ...PLAIN, required: true })).toStrictEqual({ message: FORM_FIELD_REQUIRED_EMPTY, values: { name: 'Name' } });
    // CONTROL: the same empty value, not required.
    expect(leftFieldProblem('Name', '  ', PLAIN)).toBeUndefined();
  });

  it('stores a number in the form every reader reads, and anything else as typed', () => {
    const offer = { ...PLAIN, format: { kind: 'number', decimals: 2, separators: 'dot-comma', negative: 'minus' } } as const;
    expect(storedText('1.234,5', offer)).toBe('1234.5');
    expect(storedText('1.234,5', PLAIN)).toBe('1.234,5');
  });
});

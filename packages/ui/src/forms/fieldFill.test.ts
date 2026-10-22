import { describe, expect, it } from 'vitest';

import { FORMS_HIDDEN, FORMS_MANY_VALUES, FORMS_NOT_FILLABLE, FORMS_READ_ONLY, FORMS_SIGNED, FORMS_TOO_LONG } from '../messages/en.js';
import { type ListedField, fieldFill } from './fieldFill.js';

/**
 * What a field offers, for the page and the Forms panel alike (ADR-0168 Decision 2). The panel's own cases hold the
 * same rules through its controls; these hold the one function both take.
 */

function field(over: Partial<ListedField>): ListedField {
  return {
    page: 0,
    index: 0,
    kind: 'text',
    name: 'applicant.name',
    values: [],
    on: null,
    options: [],
    readOnly: false,
    multiline: false,
    rect: { x0: 0, y0: 0, x1: 10, y1: 10 },
    required: false,
    maxLength: null,
    comb: false,
    masked: false,
    multiSelect: false,
    editable: false,
    calculated: false,
    format: null,
    ...over,
  };
}

describe('fieldFill', () => {
  it('offers a text field for typing, on one line or with line breaks', () => {
    const rules = { maxLength: null, comb: false, masked: false, required: false, format: null, range: null };
    expect(fieldFill(field({ values: ['Ada'] }))).toStrictEqual({ kind: 'text', held: 'Ada', lines: false, ...rules });
    expect(fieldFill(field({ multiline: true }))).toStrictEqual({ kind: 'text', held: '', lines: true, ...rules });
    // THE FIELD'S RULES TRAVEL WITH THE OFFER (ADR-0226 Decision 4), each one as the list carried it.
    expect(fieldFill(field({ maxLength: 4, comb: true, masked: true, required: true }))).toMatchObject({ maxLength: 4, comb: true, masked: true, required: true });
    // A VALUE HOLDING A LINE BREAK is edited with them kept, whatever the field's flag says.
    expect(fieldFill(field({ values: ['a\rb'] }))).toMatchObject({ lines: true });
  });

  it('offers a tick box and a radio as a toggle at the widget’s own state', () => {
    expect(fieldFill(field({ kind: 'checkbox', on: true }))).toStrictEqual({ kind: 'toggle', on: true, radio: false, required: false });
    expect(fieldFill(field({ kind: 'radio', on: false }))).toStrictEqual({ kind: 'toggle', on: false, radio: true, required: false });
  });

  it('offers a choice with the empty choice first, and a held value the document does not offer last', () => {
    expect(fieldFill(field({ kind: 'dropdown', options: ['Dr', 'Ms'], values: ['Ms'] }))).toStrictEqual({
      kind: 'choice',
      held: 'Ms',
      choices: ['', 'Dr', 'Ms'],
      editable: false,
      list: false,
      required: false,
    });
    // CONTROL: a value outside the options is shown rather than read as empty. A LIST BOX SAYS SO (the owner's F2): a
    // list that takes one value is rows at the field, never a dropdown.
    expect(fieldFill(field({ kind: 'listbox', options: ['Dr'], values: ['Prof'] }))).toStrictEqual({
      kind: 'choice',
      held: 'Prof',
      choices: ['', 'Dr', 'Prof'],
      editable: false,
      list: true,
      required: false,
    });
    // A DROPDOWN THAT TAKES TYPING says so; a list never does, whatever its flag.
    expect(fieldFill(field({ kind: 'dropdown', options: ['Dr'], editable: true }))).toMatchObject({ kind: 'choice', editable: true });
    expect(fieldFill(field({ kind: 'listbox', options: ['Dr'], editable: true }))).toMatchObject({ kind: 'choice', editable: false });
  });

  it('offers a list that takes several values with everything it holds, and the options in the document’s order (ADR-0226)', () => {
    expect(fieldFill(field({ kind: 'listbox', multiSelect: true, options: ['a', 'b', 'c'], values: ['c', 'a'] }))).toStrictEqual({
      kind: 'choices',
      held: ['c', 'a'],
      options: ['a', 'b', 'c'],
      required: false,
    });
    // CONTROL: the same two values in a list that takes one cannot be filled here, for the slice's reason.
    expect(fieldFill(field({ kind: 'listbox', options: ['a', 'b', 'c'], values: ['c', 'a'] }))).toMatchObject({ kind: 'none' });
  });

  it('offers a push button, which is pressed and says what it cannot do (A1.9)', () => {
    expect(fieldFill(field({ kind: 'button' }))).toStrictEqual({ kind: 'button', runs: [], kept: [] });
  });

  it('offers a button with actions as one a press carries out, trigger by trigger (ADR-0259)', () => {
    expect(fieldFill(field({ kind: 'button', actions: { runs: ['up', 'enter'], kept: ['down'] } }))).toStrictEqual({
      kind: 'button',
      runs: ['up', 'enter'],
      kept: ['down'],
    });
  });

  it('REFUSES with the reason: read-only, a slice, several values, a kind nobody fills', () => {
    // READ-ONLY WINS over every kind, the document's own word.
    expect(fieldFill(field({ kind: 'checkbox', readOnly: true }))).toStrictEqual({ kind: 'none', reason: FORMS_READ_ONLY });
    expect(fieldFill(field({ values: ['…'], cut: true }))).toStrictEqual({ kind: 'none', reason: FORMS_TOO_LONG });
    expect(fieldFill(field({ kind: 'listbox', values: ['a', 'b'] }))).toStrictEqual({
      kind: 'none',
      reason: FORMS_MANY_VALUES,
      values: { values: 'a, b' },
    });
    expect(fieldFill(field({ kind: 'other' }))).toStrictEqual({ kind: 'none', reason: FORMS_NOT_FILLABLE });
  });

  it('offers a HIDDEN field nothing, whatever its kind, and the same field shown is offered again (ADR-0259)', () => {
    for (const kind of ['text', 'checkbox', 'button'] as const) {
      expect(fieldFill(field({ kind, hidden: true }))).toStrictEqual({ kind: 'none', reason: FORMS_HIDDEN });
      // CONTROL: without the mark the same field is offered, so the refusal above is the mark's.
      expect(fieldFill(field({ kind })).kind).not.toBe('none');
    }
  });

  it('offers an EMPTY signature field for signing, and never a signed one (the owner’s F8)', () => {
    expect(fieldFill(field({ kind: 'signature' }))).toStrictEqual({ kind: 'sign' });
    // CONTROL: the same field holding a signature says so, so a signature is never written over another.
    expect(fieldFill(field({ kind: 'signature', signed: true }))).toStrictEqual({ kind: 'none', reason: FORMS_SIGNED });
    // READ-ONLY STILL WINS, the document's own word.
    expect(fieldFill(field({ kind: 'signature', readOnly: true }))).toStrictEqual({ kind: 'none', reason: FORMS_READ_ONLY });
  });
});

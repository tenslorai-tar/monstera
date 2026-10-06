import { describe, expect, it } from 'vitest';

import { FORMS_MANY_VALUES, FORMS_NOT_FILLABLE, FORMS_READ_ONLY, FORMS_TOO_LONG } from '../messages/en.js';
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
    ...over,
  };
}

describe('fieldFill', () => {
  it('offers a text field for typing, on one line or with line breaks', () => {
    expect(fieldFill(field({ values: ['Ada'] }))).toStrictEqual({ kind: 'text', held: 'Ada', lines: false });
    expect(fieldFill(field({ multiline: true }))).toStrictEqual({ kind: 'text', held: '', lines: true });
    // A VALUE HOLDING A LINE BREAK is edited with them kept, whatever the field's flag says.
    expect(fieldFill(field({ values: ['a\rb'] }))).toMatchObject({ lines: true });
  });

  it('offers a tick box and a radio as a toggle at the widget’s own state', () => {
    expect(fieldFill(field({ kind: 'checkbox', on: true }))).toStrictEqual({ kind: 'toggle', on: true, radio: false });
    expect(fieldFill(field({ kind: 'radio', on: false }))).toStrictEqual({ kind: 'toggle', on: false, radio: true });
  });

  it('offers a choice with the empty choice first, and a held value the document does not offer last', () => {
    expect(fieldFill(field({ kind: 'dropdown', options: ['Dr', 'Ms'], values: ['Ms'] }))).toStrictEqual({
      kind: 'choice',
      held: 'Ms',
      choices: ['', 'Dr', 'Ms'],
    });
    // CONTROL: a value outside the options is shown rather than read as empty.
    expect(fieldFill(field({ kind: 'listbox', options: ['Dr'], values: ['Prof'] }))).toStrictEqual({
      kind: 'choice',
      held: 'Prof',
      choices: ['', 'Dr', 'Prof'],
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
    for (const kind of ['signature', 'button', 'other'] as const) {
      expect(fieldFill(field({ kind })), kind).toStrictEqual({ kind: 'none', reason: FORMS_NOT_FILLABLE });
    }
  });
});

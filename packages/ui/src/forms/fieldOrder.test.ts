import { describe, expect, it } from 'vitest';

import type { ListedField } from './fieldFill.js';
import { nextFillable } from './fieldOrder.js';

const RECT = { x0: 0, y0: 0, x1: 10, y1: 10 };

function field(page: number, index: number, over: Partial<ListedField> = {}): ListedField {
  return {
    page,
    index,
    kind: 'text',
    name: `f${String(page)}_${String(index)}`,
    values: [],
    on: null,
    options: [],
    readOnly: false,
    multiline: false,
    rect: RECT,
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

describe('nextFillable', () => {
  // OUT OF ORDER ON PURPOSE: a list read in parts may arrive in any order, and the walk's order is what Tab follows.
  const form = [field(1, 0), field(0, 1, { readOnly: true }), field(0, 0), field(0, 2, { rect: null }), field(0, 3, { kind: 'checkbox', on: false })];

  it('goes to the next field that can be filled, passing over one that cannot and one with no place', () => {
    expect(nextFillable(form, { page: 0, index: 0 }, false)).toMatchObject({ page: 0, index: 3 });
  });

  it('crosses onto the next page', () => {
    expect(nextFillable(form, { page: 0, index: 3 }, false)).toMatchObject({ page: 1, index: 0 });
  });

  it('wraps past the last to the first, and Shift+Tab goes back', () => {
    expect(nextFillable(form, { page: 1, index: 0 }, false)).toMatchObject({ page: 0, index: 0 });
    expect(nextFillable(form, { page: 1, index: 0 }, true)).toMatchObject({ page: 0, index: 3 });
    expect(nextFillable(form, { page: 0, index: 0 }, true)).toMatchObject({ page: 1, index: 0 });
  });

  it('answers nothing for a form with nothing to fill', () => {
    expect(nextFillable([field(0, 0, { readOnly: true })], { page: 0, index: 0 }, false)).toBeUndefined();
  });
});

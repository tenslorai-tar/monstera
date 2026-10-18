// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import type { DocId } from '@monstera/shared';
import { describe, expect, it, vi } from 'vitest';

import { FORM_SCRIPTS_NAMED, FORM_SCRIPTS_NOTICE_DIALOG_ID } from '../dialogs/formScriptsNotice.js';
import type { ListedField } from './fieldFill.js';
import { formScriptsNoticeOf, useFormScriptsNotice } from './useFormScriptsNotice.js';

/**
 * The notice a form with scripts opens (the owner's decision of 2026-10-18). The fields are the kernel's answer, whose
 * reading of which scripts are never run is `formFieldRules.test.ts`' (a custom calculation is listed, AFSimple_Calculate
 * is not); these cases hold what the window does with that answer: THE CALL MADE OR NOT MADE, since an absent notice and
 * a notice nobody asked for leave the same screen.
 */

function field(over: Partial<ListedField>): ListedField {
  return {
    page: 0,
    index: 0,
    kind: 'text',
    name: 'field',
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

const DOC = 'doc-1' as DocId;

describe('the notice of a form’s scripts', () => {
  it('names a field whose custom calculation is never run, once per document', () => {
    const ask = vi.fn();
    const fields = [field({ index: 0, name: 'Price' }), field({ index: 1, name: 'Total', calculated: true, scripts: ['calculation'] })];
    const { rerender } = renderHook(
      ({ list }) => {
        useFormScriptsNotice(DOC, list, ask);
      },
      { initialProps: { list: fields } },
    );
    expect(ask.mock.calls).toStrictEqual([[FORM_SCRIPTS_NOTICE_DIALOG_ID, { names: ['Total'], more: 0 }]]);
    // A NEW READ OF THE SAME DOCUMENT, after an edit, asks nothing again.
    rerender({ list: [...fields] });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: a form whose calculation is AFSimple_Calculate — calculated, and carrying no script — asks nothing', () => {
    const ask = vi.fn();
    renderHook(() => {
      useFormScriptsNotice(DOC, [field({ name: 'Total', calculated: true })], ask);
    });
    expect(ask).not.toHaveBeenCalled();
  });

  it('names each field once, in the form’s order, and counts the rest', () => {
    const many = Array.from({ length: FORM_SCRIPTS_NAMED + 3 }, (_, at) => field({ index: at, name: `F${String(at)}`, scripts: ['action'] }));
    // A RADIO GROUP'S WIDGETS share one name: one field.
    const fields = [field({ index: 99, name: 'F0', scripts: ['action'] }), ...many];
    expect(formScriptsNoticeOf(fields)).toStrictEqual({
      names: many.slice(0, FORM_SCRIPTS_NAMED).map((each) => each.name),
      more: 3,
    });
  });
});

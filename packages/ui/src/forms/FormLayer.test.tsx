// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { fireEvent, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import { FormLayer, type PageFill } from './FormLayer.js';
import type { ListedField } from './fieldFill.js';

/**
 * A page's form fields, filled where they are (ADR-0168): where each control sits, which fields have none, and what a
 * press sends. The UI half of the pair; the kernel's fill cases hold what a fill does to the document, and
 * `formFill.pw.ts` holds the page in a browser, where a control's own handling of text runs.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function field(over: Partial<ListedField> & Pick<ListedField, 'index'>): ListedField {
  return {
    page: 2,
    kind: 'text',
    name: `field ${String(over.index)}`,
    values: [],
    on: null,
    options: [],
    readOnly: false,
    multiline: false,
    rect: { x0: 10, y0: 700, x1: 110, y1: 720 },
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

function draw(fields: readonly ListedField[]): { container: HTMLElement; fills: PageFill[] } {
  const fills: PageFill[] = [];
  const { container } = render(
    <Wrapped>
      <FormLayer
        fields={fields}
        geometry={{ crop: [0, 0, 612, 792], rotation: 0, zoom: 2 }}
        onFill={(fill) => {
          fills.push(fill);
        }}
        page={2}
      />
    </Wrapped>,
  );
  return { container, fills };
}

function at(container: HTMLElement, index: number): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-form-field="${String(index)}"]`);
}

/** The element a case is about to act on, which must be there: a missing one fails the case by name. */
function must<T>(element: T | null): T {
  if (element === null) throw new Error('the control the case acts on is not there');
  return element;
}

/** A press through the testing library, so the state it sets is rendered before the next line reads the layer. */
function press(element: HTMLElement | null): void {
  if (element === null) throw new Error('no control to press');
  fireEvent.click(element);
}

describe('FormLayer', () => {
  it('puts a field’s control over its rectangle, in PDF space turned the right way up, at the zoom', () => {
    const { container } = draw([field({ index: 0 })]);
    const style = at(container, 0)?.style;
    // x 10..110, y 700..720 on a 792-high page at zoom 2: left 20, top (792 - 720) × 2 = 144, 200 by 40.
    expect([style?.left, style?.top, style?.width, style?.height]).toStrictEqual(['20px', '144px', '200px', '40px']);
  });

  it('has NO control for a field nobody can fill here — CONTROL: the fillable one beside it has one', () => {
    const { container } = draw([
      field({ index: 0, readOnly: true }),
      field({ index: 1, kind: 'signature' }),
      field({ index: 3, values: ['…'], cut: true }),
      field({ index: 4, kind: 'listbox', values: ['a', 'b'] }),
      field({ index: 5, rect: null }),
      field({ index: 6 }),
    ]);
    const controls = [...container.querySelectorAll<HTMLElement>('[data-form-field]')];
    expect(controls.map((element) => element.getAttribute('data-form-field'))).toStrictEqual(['6']);
  });

  it('a PUSH BUTTON has a control, and pressing it says what it cannot do and fills nothing (A1.9)', () => {
    const { container, fills } = draw([field({ index: 2, kind: 'button', name: 'Send' })]);
    const button = at(container, 2);
    if (button === null) throw new Error('the push button has no control');
    fireEvent.click(button);
    expect(fills).toStrictEqual([]);
    expect(container.querySelector('.m-page-field-problem [role="alert"]')?.textContent).toContain('does not run what a form’s buttons are set to do');
  });

  it('a RESET FORM button pressed sends the reset by its own place, and says nothing about scripts (the owner’s F7)', () => {
    // The case above is the control: the same button with no Reset form action says what it cannot do and sends nothing.
    const { container, fills } = draw([field({ index: 5, kind: 'button', name: 'Clear', action: 'reset' })]);
    const button = at(container, 5);
    if (button === null) throw new Error('the reset button has no control');
    fireEvent.click(button);
    expect(fills).toStrictEqual([{ page: 2, index: 5, reset: true }]);
    expect(container.querySelector('.m-page-field-problem')).toBeNull();
  });

  it('draws nothing at all over a page with nothing to fill', () => {
    expect(draw([field({ index: 0, readOnly: true })]).container.querySelector('.m-form-layer')).toBeNull();
  });

  it('a TICK BOX press sends its new state by the field’s own place, and a ticked one is unticked', () => {
    const { container, fills } = draw([field({ index: 3, kind: 'checkbox', on: false }), field({ index: 4, kind: 'checkbox', on: true })]);
    expect(at(container, 3)?.getAttribute('role')).toBe('checkbox');
    expect(at(container, 3)?.getAttribute('aria-checked')).toBe('false');
    at(container, 3)?.click();
    at(container, 4)?.click();
    expect(fills).toStrictEqual([
      { page: 2, index: 3, value: { set: 'button', on: true } },
      { page: 2, index: 4, value: { set: 'button', on: false } },
    ]);
  });

  it('a RADIO press chooses it, and a press on the chosen one clears it, the panel’s rule', () => {
    const { container, fills } = draw([field({ index: 0, kind: 'radio', on: true }), field({ index: 1, kind: 'radio', on: false })]);
    expect(at(container, 0)?.getAttribute('role')).toBe('radio');
    at(container, 1)?.click();
    press(at(container, 0));
    expect(fills).toStrictEqual([
      { page: 2, index: 1, value: { set: 'button', on: true } },
      { page: 2, index: 0, value: { set: 'button', on: false } },
    ]);
  });

  it('a DROPDOWN opens its rows under the field in the page, the empty one first, and choosing one fills it and closes (F4, F5, F6)', () => {
    const { container, fills } = draw([field({ index: 0, kind: 'dropdown', options: ['Dr', 'Ms'], values: ['Dr'] })]);
    const face = must(at(container, 0));
    expect(face.tagName).toBe('BUTTON');
    expect(face.getAttribute('aria-expanded')).toBe('false');
    // CLOSED, NOTHING IS DRAWN OVER THE FIELD but the press: the document's own drawing shows (F11).
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    press(face);
    const rows = [...container.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')];
    // ONE LIST, THE SAME EVERY TIME: the empty choice's sentence first, then the options, the held one chosen.
    expect(rows.map((row) => row.textContent)).toStrictEqual(['(none)', 'Dr', 'Ms']);
    expect(rows.map((row) => row.getAttribute('aria-selected'))).toStrictEqual(['false', 'true', 'false']);
    // IN THE PAGE LAYER, under the field: x 10, y 700..720 at zoom 2 is left 20, the foot at 184.
    const open = must(container.querySelector<HTMLElement>('[role="listbox"]'));
    expect(container.querySelector('.m-form-layer')?.contains(open)).toBe(true);
    expect([open.style.left, open.style.top, open.style.width]).toStrictEqual(['20px', '184px', '200px']);
    press(rows[2] ?? null);
    expect(fills).toStrictEqual([{ page: 2, index: 0, value: { set: 'choice', option: 'Ms' } }]);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it('a dropdown closed with Escape, or by choosing what it holds, sends nothing — CONTROL: the case above sends', () => {
    const { container, fills } = draw([field({ index: 0, kind: 'dropdown', options: ['Dr', 'Ms'], values: ['Dr'] })]);
    press(at(container, 0));
    fireEvent.keyDown(must(container.querySelector('[role="listbox"]')), { key: 'Escape' });
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    press(at(container, 0));
    press(container.querySelectorAll<HTMLElement>('[role="option"]')[1] ?? null);
    expect(fills).toStrictEqual([]);
  });

  it('a LIST BOX THAT TAKES ONE is its rows at the field, never a dropdown, and a press chooses the row pressed (F2)', () => {
    const { container, fills } = draw([field({ index: 0, kind: 'listbox', options: ['English', 'German', 'French'], values: ['German'] })]);
    const list = must(at(container, 0));
    expect(list.getAttribute('role')).toBe('listbox');
    expect(list.getAttribute('aria-multiselectable')).toBe('false');
    const rows = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
    // NO EMPTY ROW: a list shows the document's options, as the document draws it.
    expect(rows.map((row) => row.textContent)).toStrictEqual(['English', 'German', 'French']);
    press(rows[2] ?? null);
    expect(rows.map((row) => row.getAttribute('aria-selected'))).toStrictEqual(['false', 'false', 'true']);
    // THE ROW PRESSED, NOT ITS NEIGHBOUR: French is the third.
    expect(fills).toStrictEqual([{ page: 2, index: 0, value: { set: 'choice', option: 'French' } }]);
  });

  it('a list that takes SEVERAL: a press one row, Ctrl one more, Shift a run, each sent in the document’s order (F2)', () => {
    const { container, fills } = draw([
      field({ index: 0, kind: 'listbox', multiSelect: true, options: ['Music', 'Travel', 'Cooking', 'Sport'], values: [] }),
    ]);
    const rows = [...must(at(container, 0)).querySelectorAll<HTMLElement>('[role="option"]')];
    fireEvent.click(must(rows[2] ?? null));
    fireEvent.click(must(rows[0] ?? null), { ctrlKey: true });
    fireEvent.click(must(rows[1] ?? null), { shiftKey: true });
    expect(fills).toStrictEqual([
      { page: 2, index: 0, value: { set: 'choices', options: ['Cooking'] } },
      { page: 2, index: 0, value: { set: 'choices', options: ['Music', 'Cooking'] } },
      // A RUN FROM THE LAST ROW PRESSED WITHOUT SHIFT, Music, to Travel.
      { page: 2, index: 0, value: { set: 'choices', options: ['Music', 'Travel'] } },
    ]);
  });

  it('a list is drawn in the FIELD’S OWN size and colours at the zoom, never the theme’s (F1) — CONTROL: no look, the paper and black', () => {
    const { container } = draw([
      field({ index: 0, kind: 'listbox', options: ['a'], look: { size: 9, text: [1, 0, 0], fill: [0, 0, 1], top: 0 } }),
      field({ index: 1, kind: 'listbox', options: ['a'] }),
    ]);
    const own = must(at(container, 0));
    expect([own.style.fontSize, own.style.color, own.style.backgroundColor]).toStrictEqual(['18px', 'rgb(255 0 0)', 'rgb(0 0 255)']);
    const plain = must(at(container, 1));
    // AUTOMATIC IS 12 POINTS AT THE ZOOM, and no inline background, so the stylesheet's paper (or tint) shows.
    expect([plain.style.fontSize, plain.style.color, plain.style.backgroundColor]).toStrictEqual(['24px', 'rgb(0 0 0)', '']);
  });

  it('a TEXT FIELD press opens its editor over the field holding its value, and leaving it fills it', () => {
    const { container, fills } = draw([field({ index: 0, values: ['Ada'] })]);
    const rest = at(container, 0);
    expect(rest?.tagName).toBe('BUTTON');
    expect(rest?.getAttribute('aria-label')).toBe('Fill in field 0');
    press(rest);
    const editor = at(container, 0) as HTMLInputElement | null;
    expect(editor?.tagName).toBe('INPUT');
    expect(editor?.value).toBe('Ada');
    // OVER THE FIELD, in its size: the editor takes the control's place exactly.
    expect([editor?.style.left, editor?.style.top, editor?.style.width, editor?.style.height]).toStrictEqual([
      '20px',
      '144px',
      '200px',
      '40px',
    ]);
    fireEvent.change(must(editor), { target: { value: 'Grace' } });
    fireEvent.blur(must(editor));
    expect(fills).toStrictEqual([{ page: 2, index: 0, value: { set: 'text', text: 'Grace' } }]);
    // CLOSED once left, back to the control at rest.
    expect(at(container, 0)?.tagName).toBe('BUTTON');
  });

  it('ESCAPE keeps the field as it was — CONTROL: an editor left untouched sends nothing either', () => {
    const { container, fills } = draw([field({ index: 0, values: ['Ada'] })]);
    press(at(container, 0));
    const editor = at(container, 0) as HTMLInputElement;
    fireEvent.change(editor, { target: { value: 'Grace' } });
    fireEvent.keyDown(editor, { key: 'Escape' });
    fireEvent.blur(editor);
    expect(fills).toStrictEqual([]);
    expect(at(container, 0)?.tagName).toBe('BUTTON');

    press(at(container, 0));
    fireEvent.blur(at(container, 0) as HTMLInputElement);
    expect(fills).toStrictEqual([]);
  });

  it('OUTLINES a selected field where it is, fillable or not, and a press only fills, Ctrl or not (ADR-0226 Decision 7)', () => {
    const fills: PageFill[] = [];
    const { container } = render(
      <Wrapped>
        <FormLayer
          fields={[field({ index: 0, kind: 'checkbox', on: false }), field({ index: 1, readOnly: true })]}
          geometry={{ crop: [0, 0, 612, 792], rotation: 0, zoom: 2 }}
          onFill={(fill) => {
            fills.push(fill);
          }}
          page={2}
          selected={new Set([1])}
        />
      </Wrapped>,
    );
    // THE READ-ONLY FIELD HAS NO CONTROL AND STILL HAS ITS OUTLINE, which is what the Fields list asked for.
    expect(container.querySelector('[data-form-selected="1"]')).not.toBeNull();
    expect(container.querySelector('[data-form-selected="0"]')).toBeNull();
    const tick = must(at(container, 0));
    // SELECTING IS EDIT FIELDS', so a press with Ctrl held is a press like any other and ticks the box.
    fireEvent.pointerDown(tick, { ctrlKey: true });
    fireEvent.click(tick, { ctrlKey: true });
    expect(fills).toHaveLength(1);
  });

  it('a field that takes LINE BREAKS opens a box for them', () => {
    const { container } = draw([field({ index: 0, multiline: true, values: ['1 High Street\nLeeds'] })]);
    press(at(container, 0));
    expect(at(container, 0)?.tagName).toBe('TEXTAREA');
  });
});

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
      field({ index: 2, kind: 'button' }),
      field({ index: 3, values: ['…'], cut: true }),
      field({ index: 4, kind: 'listbox', values: ['a', 'b'] }),
      field({ index: 5, rect: null }),
      field({ index: 6 }),
    ]);
    const controls = [...container.querySelectorAll<HTMLElement>('[data-form-field]')];
    expect(controls.map((element) => element.dataset.formField)).toStrictEqual(['6']);
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

  it('a CHOICE is its options at the field, the empty one first, and choosing fills it', () => {
    const { container, fills } = draw([field({ index: 0, kind: 'dropdown', options: ['Dr', 'Ms'], values: ['Dr'] })]);
    const list = at(container, 0) as HTMLSelectElement | null;
    expect([...(list?.options ?? [])].map((option) => option.value)).toStrictEqual(['', 'Dr', 'Ms']);
    expect(list?.value).toBe('Dr');
    fireEvent.change(must(list), { target: { value: 'Ms' } });
    expect(fills).toStrictEqual([{ page: 2, index: 0, value: { set: 'choice', option: 'Ms' } }]);
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

  it('a field that takes LINE BREAKS opens a box for them', () => {
    const { container } = draw([field({ index: 0, multiline: true, values: ['1 High Street\nLeeds'] })]);
    press(at(container, 0));
    expect(at(container, 0)?.tagName).toBe('TEXTAREA');
  });
});

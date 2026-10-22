// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import type { ButtonStep, FormFieldHandle, FormFieldProperties, FormFieldRead } from '@monstera/contract';
import { asDocId, asDocVersion } from '@monstera/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { FontList } from '../FontPicker.js';
import { activateCatalogue, i18n } from '../i18n.js';
import { panelControlsOutsideCards } from '../propertyCards.js';
import { EN } from '../messages/en.js';
import { CommandRegistry, type CommandContext } from '../registries/commands.js';
import { FieldPropertiesPanel, choicesOfRows } from './FieldPropertiesPanel.js';

/**
 * The Properties tab for selected form fields (ADR-0193).
 *
 * Every case asserts the change handed to `onEdit`, the payload's own shape and ONE member at a time, because that is
 * what reaches `editFormFields`; `App.test.tsx`' dispatch and the kernel's read-back prove the rest. Each control is
 * paired with a control case: the same gesture that changes nothing sends nothing, so a pane that sent on every render
 * would fail here.
 */
function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  // EVERY VIEW A CASE RENDERED, every property group in a card (Addendum 3, `propertyCards.ts`).
  expect(panelControlsOutsideCards(document)).toStrictEqual([]);
  cleanup();
});

const CONTEXT: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(4),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 2,
  openDocuments: [],
};

const TEXT: FormFieldRead = {
  page: 0,
  index: 1,
  kind: 'text',
  name: 'email',
  tooltip: null,
  required: false,
  readOnly: false,
  defaultValue: null,
  font: 'helvetica',
  family: null,
  fontSize: 0,
  borderColour: [0.2, 0.2, 0.2],
  fillColour: null,
  borderWidth: 1,
  borderStyle: 'solid',
  checkStyle: 'check',
  validation: null,
  customValidation: false,
  options: [],
  multiline: false,
  rect: { x0: 0, y0: 0, x1: 10, y1: 10 },
  format: null,
  customFormat: false,
  calculation: null,
  customCalculation: false,
  calculationPosition: null,
  alignment: 'left',
  maxLength: null,
  comb: false,
  masked: false,
  visibility: 'visible',
  buttonLabel: null,
  buttonActionsKept: null,
  textColour: null,
  editable: false,
  multiSelect: false,
  spellCheck: true,
};

const handleOf = (field: FormFieldRead): FormFieldHandle => ({ page: field.page, index: field.index, name: field.name });

/** This computer's fonts as `app.fontFamilies` answers them: one bundled family, which is what a field can be set in. */
const COMPUTER_FONTS: FontList = {
  listed: true,
  families: [{ name: 'Carlito', origin: 'bundled', looksLike: 'Calibri', embedding: 'subset', bold: true, italic: true }],
  more: 0,
};

interface Mounted {
  readonly edits: FormFieldProperties[];
  readonly reads: (readonly FormFieldHandle[])[];
}

function mounted(
  field: FormFieldRead,
  selected: readonly FormFieldHandle[] = [handleOf(field)],
  /** What `document.buttonActions` answers for a push button: nothing, unless a case says. */
  steps: readonly ButtonStep[] = [],
): Mounted {
  const edits: FormFieldProperties[] = [];
  const reads: (readonly FormFieldHandle[])[] = [];
  render(
    <Wrapped>
      <FieldPropertiesPanel
        context={CONTEXT}
        documentFonts={[{ name: 'ABCDEF+Lato-Regular', partial: true }]}
        fonts={COMPUTER_FONTS}
        known={[
          { name: 'email', kind: 'text', options: [] },
          { name: 'phone', kind: 'text', options: [] },
          { name: 'group.first', kind: 'text', options: [] },
          { name: 'clear', kind: 'button', options: [] },
        ]}
        onEdit={(set) => {
          edits.push(set);
        }}
        read={(handles) => {
          reads.push(handles);
          return Promise.resolve([field]);
        }}
        pageCount={5}
        readActions={() => Promise.resolve(steps)}
        registry={new CommandRegistry([])}
        selected={selected}
        version={asDocVersion(4)}
      />
    </Wrapped>,
  );
  return { edits, reads };
}

describe('the field properties pane', () => {
  it('reads the FIRST selected field only, and says so when several are selected', async () => {
    const second: FormFieldRead = { ...TEXT, index: 2, name: 'phone' };
    const seen = mounted(TEXT, [handleOf(TEXT), handleOf(second)]);
    await screen.findByLabelText('Tooltip');
    expect(seen.reads).toStrictEqual([[handleOf(TEXT)]]);
    expect(screen.getByText(/shows the first selected field/u)).toBeTruthy();
    // NAME, CHOICES AND CALCULATION BELONG TO ONE FIELD, so they are not offered for two.
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByLabelText('Calculation')).toBeNull();
  });

  it('sends a tooltip once focus leaves it changed, and sends nothing when it did not change (control)', async () => {
    const seen = mounted(TEXT);
    const box = await screen.findByLabelText('Tooltip');
    fireEvent.blur(box);
    expect(seen.edits, 'control: leaving it untouched sends nothing').toStrictEqual([]);
    fireEvent.change(box, { target: { value: 'Where we write to' } });
    expect(seen.edits, 'typing alone sends nothing').toStrictEqual([]);
    fireEvent.blur(box);
    expect(seen.edits).toStrictEqual([{ tooltip: 'Where we write to' }]);
  });

  it('an emptied tooltip is null, which takes it away', async () => {
    const seen = mounted({ ...TEXT, tooltip: 'old' });
    const box = await screen.findByLabelText('Tooltip');
    fireEvent.change(box, { target: { value: '' } });
    fireEvent.blur(box);
    expect(seen.edits).toStrictEqual([{ tooltip: null }]);
  });

  it('offers Allow typing on a dropdown, Allow several on a list, Check spelling on both text kinds, and sends each as ticked', async () => {
    const dropdown: FormFieldRead = { ...TEXT, kind: 'dropdown', name: 'region', options: ['North', 'South'] };
    const seen = mounted(dropdown);
    fireEvent.click(await screen.findByLabelText('Allow typing'));
    fireEvent.click(screen.getByLabelText('Check spelling'));
    // CONTROL: a dropdown is not a list, so it is not offered several.
    expect(screen.queryByLabelText('Allow several')).toBeNull();
    expect(seen.edits).toStrictEqual([{ editable: true }, { spellCheck: false }]);
    cleanup();
    const list = mounted({ ...TEXT, kind: 'listbox', name: 'interests', options: ['Music'] });
    fireEvent.click(await screen.findByLabelText('Allow several'));
    expect(screen.queryByLabelText('Allow typing')).toBeNull();
    expect(screen.queryByLabelText('Check spelling')).toBeNull();
    expect(list.edits).toStrictEqual([{ multiSelect: true }]);
  });

  it('sends Required and Read only as each is ticked', async () => {
    const seen = mounted(TEXT);
    fireEvent.click(await screen.findByLabelText('Required'));
    fireEvent.click(screen.getByLabelText('Read only'));
    expect(seen.edits).toStrictEqual([{ required: true }, { readOnly: true }]);
  });

  it('sends the face, and the size only when it is a figure in range', async () => {
    const seen = mounted(TEXT);
    // THE ONE FONT PICKER (E2): opened, Times chosen from the standard fonts a field's appearance can name.
    fireEvent.click(await screen.findByRole('button', { name: 'Font: Helvetica' }));
    const times = document.querySelector('[data-font-choice="Times"]');
    if (times === null) throw new Error('Times is not offered');
    fireEvent.click(times);
    const size = screen.getByLabelText('Size (0 is automatic)');
    fireEvent.change(size, { target: { value: '999' } });
    fireEvent.blur(size);
    // A STANDARD FONT takes any real family away, since a text field may hold one (ADR-0229).
    expect(seen.edits, 'a size past the bound is not sent').toStrictEqual([{ font: 'times', family: null }]);
    fireEvent.change(size, { target: { value: '14' } });
    fireEvent.blur(size);
    expect(seen.edits).toStrictEqual([{ font: 'times', family: null }, { fontSize: 14 }]);
  });

  it('offers a text field this computer’s fonts and the document’s, and sends the family chosen (A8.4)', async () => {
    const seen = mounted(TEXT);
    fireEvent.click(await screen.findByRole('button', { name: 'Font: Helvetica' }));
    expect(document.querySelector('[data-font-choice="Lato-Regular"]'), 'the document’s font').not.toBeNull();
    const carlito = document.querySelector('[data-font-choice="Carlito"]');
    if (carlito === null) throw new Error('Carlito is not offered');
    fireEvent.click(carlito);
    expect(seen.edits).toStrictEqual([{ family: 'Carlito' }]);
  });

  it('shows the field’s real family as its font', async () => {
    mounted({ ...TEXT, family: 'Carlito' });
    expect(await screen.findByRole('button', { name: 'Font: Carlito' })).toBeTruthy();
  });

  it('CONTROL: a list box is offered the standard fonts alone, since its value is drawn in them', async () => {
    mounted({ ...TEXT, kind: 'listbox', name: 'many' });
    fireEvent.click(await screen.findByRole('button', { name: 'Font: Helvetica' }));
    expect(document.querySelector('[data-font-choice="Carlito"]')).toBeNull();
    expect(document.querySelector('[data-font-choice="Lato-Regular"]')).toBeNull();
    expect(document.querySelector('[data-font-choice="Times"]')).not.toBeNull();
  });

  it('takes a border colour away with None, and a fill colour is offered the same way', async () => {
    const seen = mounted(TEXT);
    await screen.findByLabelText('Tooltip');
    const nones = screen.getAllByRole('button', { name: 'None' });
    expect(nones.length, 'one None for the border and one for the fill').toBe(2);
    for (const none of nones.slice(0, 1)) fireEvent.click(none);
    expect(seen.edits).toStrictEqual([{ borderColour: null }]);
    for (const none of nones.slice(1)) fireEvent.click(none);
    expect(seen.edits.at(-1)).toStrictEqual({ fillColour: null });
  });

  it('sends a border style, and offers none on a list box, whose border stays solid (A3.1)', async () => {
    const seen = mounted(TEXT);
    fireEvent.change(await screen.findByLabelText('Border style'), { target: { value: 'dashed' } });
    expect(seen.edits).toStrictEqual([{ borderStyle: 'dashed' }]);
    // CONTROL: a text field offers no check style.
    expect(screen.queryByLabelText('Check style')).toBeNull();
  });

  it('CONTROL: a list box is offered no border style', async () => {
    mounted({ ...TEXT, kind: 'listbox', name: 'many' });
    await screen.findByLabelText('Tooltip');
    expect(screen.queryByLabelText('Border style')).toBeNull();
  });

  it('shows a radio’s check style and sends the one chosen', async () => {
    const seen = mounted({ ...TEXT, kind: 'radio', name: 'plan', checkStyle: 'circle' });
    const style = await screen.findByLabelText('Check style');
    expect(style).toHaveProperty('value', 'circle');
    fireEvent.change(style, { target: { value: 'star' } });
    expect(seen.edits).toStrictEqual([{ checkStyle: 'star' }]);
  });

  it('sends a range once focus leaves it, an open end as null, and nothing for the least past the most (control)', async () => {
    const seen = mounted(TEXT);
    const least = await screen.findByLabelText('Least');
    const most = screen.getByLabelText('Most');
    fireEvent.change(least, { target: { value: '5' } });
    fireEvent.change(most, { target: { value: '1' } });
    fireEvent.blur(most);
    expect(seen.edits).toStrictEqual([]);
    fireEvent.change(most, { target: { value: '' } });
    fireEvent.blur(most);
    expect(seen.edits).toStrictEqual([{ validation: { min: 5, max: null } }]);
  });

  it('shows a range already on the field, and emptying both its ends takes it away', async () => {
    const seen = mounted({ ...TEXT, validation: { min: 1, max: 9 } });
    const least = await screen.findByLabelText('Least');
    expect(least).toHaveProperty('value', '1');
    fireEvent.change(least, { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Most'), { target: { value: '' } });
    fireEvent.blur(least);
    expect(seen.edits).toStrictEqual([{ validation: null }]);
  });

  it('CONTROL: a field with a script of its own shows that it is kept and no range to replace it', async () => {
    mounted({ ...TEXT, customValidation: true });
    expect(await screen.findByText(/has a script of its own/u)).toBeTruthy();
    expect(screen.queryByLabelText('Least')).toBeNull();
  });

  it('sends a new name only when no other field holds it, and says why where one does (control)', async () => {
    const seen = mounted(TEXT);
    const name = await screen.findByLabelText('Name');
    fireEvent.change(name, { target: { value: 'phone' } });
    expect(screen.getByRole('alert').textContent).toMatch(/already/u);
    fireEvent.blur(name);
    expect(seen.edits, 'a name another field holds is never sent').toStrictEqual([]);
    fireEvent.change(name, { target: { value: 'group' } });
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.change(name, { target: { value: 'mail_address' } });
    fireEvent.blur(name);
    expect(seen.edits).toStrictEqual([{ name: 'mail_address' }]);
  });

  it('offers a number format, and sends the whole format it chose', async () => {
    const seen = mounted(TEXT);
    fireEvent.change(await screen.findByLabelText('Format'), { target: { value: 'number' } });
    expect(seen.edits).toStrictEqual([
      { format: { kind: 'number', decimals: 2, separators: 'comma-dot', negative: 'minus', currencyBefore: true } },
    ]);
  });

  it('shows a format already on the field and changes one member of it', async () => {
    const format = { kind: 'number', decimals: 2, separators: 'comma-dot', negative: 'minus', currencyBefore: true } as const;
    const seen = mounted({ ...TEXT, format });
    const negative = await screen.findByLabelText('Negative numbers');
    expect(screen.getByLabelText('Format')).toHaveProperty('value', 'number');
    fireEvent.change(negative, { target: { value: 'parens' } });
    expect(seen.edits).toStrictEqual([{ format: { ...format, negative: 'parens' } }]);
  });

  it('None takes a format away', async () => {
    const seen = mounted({ ...TEXT, format: { kind: 'percent', decimals: 0, separators: 'comma-dot' } });
    fireEvent.change(await screen.findByLabelText('Format'), { target: { value: 'none' } });
    expect(seen.edits).toStrictEqual([{ format: null }]);
  });

  it('says a script from another program is kept, and does not show it as no format', async () => {
    mounted({ ...TEXT, customFormat: true });
    await screen.findByLabelText('Format');
    expect(screen.getByText(/script from another program/u)).toBeTruthy();
  });

  it('holds an operation until it has fields to work from, then sends both', async () => {
    const seen = mounted(TEXT);
    fireEvent.change(await screen.findByLabelText('Calculation'), { target: { value: 'sum' } });
    expect(seen.edits, 'an operation with no fields is not sent, and is not dropped').toStrictEqual([]);
    expect(screen.getByLabelText('Calculation')).toHaveProperty('value', 'sum');
    const names = screen.getByLabelText('Fields it works from');
    fireEvent.change(names, { target: { value: 'phone\nemail' } });
    fireEvent.blur(names);
    expect(seen.edits).toStrictEqual([{ calculation: { operation: 'sum', fields: ['phone', 'email'] } }]);
  });

  it('shows the place in the calculation order, from 1, and sends it from 0', async () => {
    const seen = mounted({
      ...TEXT,
      calculation: { operation: 'sum', fields: ['phone'] },
      calculationPosition: 0,
    });
    const order = await screen.findByLabelText('Calculation order (1 is first)');
    expect((order as HTMLInputElement).value).toBe('1');
    fireEvent.change(order, { target: { value: '3' } });
    fireEvent.blur(order);
    expect(seen.edits).toStrictEqual([{ calculationPosition: 2 }]);
  });

  it('offers choices for a dropdown as a list, one row each, and refuses a repeated one (control)', async () => {
    const dropdown: FormFieldRead = { ...TEXT, kind: 'dropdown', name: 'region', options: ['North', 'South'] };
    const seen = mounted(dropdown);
    const second = await screen.findByLabelText('Choice 2');
    fireEvent.change(second, { target: { value: 'North' } });
    fireEvent.blur(second);
    expect(seen.edits, 'a choice given twice is not sent').toStrictEqual([]);
    fireEvent.change(second, { target: { value: 'East' } });
    fireEvent.blur(second);
    expect(seen.edits).toStrictEqual([{ options: ['North', 'East'] }]);
  });

  it('adds, moves, removes and sorts choices, each sent at once (C6)', async () => {
    const seen = mounted({ ...TEXT, kind: 'listbox', name: 'fruit', options: ['Pear', 'Apple'] });
    fireEvent.click(await screen.findByRole('button', { name: 'Add a choice' }));
    expect(seen.edits.at(-1)).toStrictEqual({ options: ['Pear', 'Apple', 'Choice 3'] });
    fireEvent.click(screen.getByRole('button', { name: 'Move choice 3 up' }));
    expect(seen.edits.at(-1)).toStrictEqual({ options: ['Pear', 'Choice 3', 'Apple'] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove choice 2' }));
    expect(seen.edits.at(-1)).toStrictEqual({ options: ['Pear', 'Apple'] });
    fireEvent.click(screen.getByRole('button', { name: 'Sort A to Z' }));
    expect(seen.edits.at(-1)).toStrictEqual({ options: ['Apple', 'Pear'] });
    // CONTROLS: the first cannot go up, and the last one left cannot be removed.
    expect(screen.getByRole('button', { name: 'Move choice 1 up' })).toHaveProperty('disabled', true);
    // WHILE TWO ARE LEFT either may go, so the disabled one below is the count's doing and not the button's.
    expect(screen.getByRole('button', { name: 'Remove choice 2' })).toHaveProperty('disabled', false);
    fireEvent.click(screen.getByRole('button', { name: 'Remove choice 2' }));
    expect(seen.edits.at(-1)).toStrictEqual({ options: ['Apple'] });
    const sent = seen.edits.length;
    const last = screen.getByRole('button', { name: 'Remove choice 1' });
    expect(last).toHaveProperty('disabled', true);
    fireEvent.click(last);
    expect(seen.edits, 'the last choice left is not removed').toHaveLength(sent);
  });

  it('shows the text a person reads and the value apart, and an edit of the text keeps the value (control: a plain list shows none)', async () => {
    const plain: FormFieldRead = { ...TEXT, kind: 'listbox', name: 'plain', options: ['one', 'two'] };
    mounted(plain);
    expect((await screen.findByLabelText<HTMLInputElement>('Stored value of choice 1')).value, 'control: a list with no pairs has no stored values').toBe('');
    cleanup();
    const paired: FormFieldRead = {
      ...TEXT,
      kind: 'listbox',
      name: 'colours',
      options: [{ value: 'r', label: 'Red' }, { value: 'g', label: 'Green' }, 'plain'],
    };
    const seen = mounted(paired);
    const first = await screen.findByLabelText<HTMLInputElement>('Choice 1');
    expect(first.value).toBe('Red');
    expect(screen.getByLabelText<HTMLInputElement>('Stored value of choice 2').value).toBe('g');
    expect(screen.getByLabelText<HTMLInputElement>('Stored value of choice 3').value).toBe('');
    fireEvent.blur(first);
    expect(seen.edits, 'leaving a box with nothing changed sends nothing').toStrictEqual([]);
    fireEvent.change(first, { target: { value: 'Crimson' } });
    fireEvent.blur(first);
    expect(seen.edits).toStrictEqual([{ options: [{ value: 'r', label: 'Crimson' }, { value: 'g', label: 'Green' }, 'plain'] }]);
  });

  it('chooses what the rows send: a row with no value stores its text, and what cannot be sent is not', () => {
    expect(choicesOfRows([{ text: 'Red', value: 'r' }, { text: 'Green', value: '' }], true)).toStrictEqual([{ value: 'r', label: 'Red' }, 'Green']);
    expect(choicesOfRows([{ text: 'Red', value: 'r' }], false), 'a radio’s rows have no value').toStrictEqual(['Red']);
    expect(choicesOfRows([{ text: 'Red', value: 'x' }, { text: 'Green', value: 'x' }], true), 'the same value twice').toBeNull();
    expect(choicesOfRows([{ text: '', value: '' }], true), 'a choice with no text').toBeNull();
    expect(choicesOfRows([], true), 'no choices').toBeNull();
  });

  it('a radio group has the one box per option, the values, and no stored values; its name is the GROUP’s (C5)', async () => {
    mounted({ ...TEXT, kind: 'radio', name: 'plan', options: ['basic', 'plus'] });
    await screen.findByLabelText('Each option’s value, one per line, in the order the options sit');
    expect(screen.getByLabelText<HTMLInputElement>('Choice 2').value).toBe('plus');
    expect(screen.queryByLabelText('Stored value of choice 1')).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('Group name').value).toBe('plan');
  });

  it('a text field offers alignment, a most-characters limit, cells and masking, each sending its one member (E1)', async () => {
    const { edits } = mounted(TEXT);
    fireEvent.change(await screen.findByLabelText('Alignment'), { target: { value: 'right' } });
    const length = screen.getByLabelText('Most characters (0 for no limit)');
    fireEvent.change(length, { target: { value: '6' } });
    fireEvent.blur(length);
    fireEvent.click(screen.getByLabelText('One character per box'));
    fireEvent.click(screen.getByLabelText('Hide what is typed (password)'));
    fireEvent.change(screen.getByLabelText('Shown'), { target: { value: 'no-print' } });
    expect(edits).toStrictEqual([{ alignment: 'right' }, { maxLength: 6 }, { comb: true }, { masked: true }, { visibility: 'no-print' }]);
  });

  describe('a push button’s actions (ADR-0259)', () => {
    const BUTTON: FormFieldRead = { ...TEXT, kind: 'button', name: 'clear', buttonLabel: 'Clear', buttonActionsKept: false };
    const EVERY: ButtonStep = { trigger: 'up', step: 0, action: { kind: 'reset', fields: null } };
    const ONE: ButtonStep = { trigger: 'up', step: 1, action: { kind: 'reset', fields: ['email'] } };

    it('adds an action in place: When, Do, the fields ticked, Save writes the whole list', async () => {
      const { edits } = mounted(BUTTON, undefined, []);
      expect(await screen.findByText(/does nothing yet/u)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Add action' }));
      // EVERY TRIGGER IS OFFERED, by its own words.
      const when = screen.getByLabelText('When');
      expect([...(when as HTMLSelectElement).options].map((option) => option.value)).toStrictEqual(['up', 'down', 'enter', 'exit']);
      fireEvent.change(when, { target: { value: 'down' } });
      // EVERY KIND IS OFFERED, in the owner's order.
      const what = screen.getByLabelText('Do');
      expect([...(what as HTMLSelectElement).options].map((option) => option.textContent)).toStrictEqual(['Go to a page', 'Open a web link', 'Reset the form']);
      fireEvent.change(what, { target: { value: 'reset' } });
      fireEvent.click(screen.getByLabelText('Only the fields ticked below'));
      // CONTROL: nothing ticked is not an action, so Save waits.
      expect(screen.getByRole('button', { name: 'Save action' }).hasAttribute('disabled')).toBe(true);
      // A PUSH BUTTON IS NOT OFFERED: there is nothing in one to reset.
      expect(screen.queryByRole('checkbox', { name: 'clear' })).toBeNull();
      fireEvent.click(screen.getByRole('checkbox', { name: 'email' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save action' }));
      expect(edits).toStrictEqual([{ buttonActions: [{ trigger: 'down', action: { kind: 'reset', fields: ['email'] } }] }]);
    });

    it('lists what the button does, and moves, edits and removes one, each writing the whole list in its new order', async () => {
      const { edits } = mounted(BUTTON, undefined, [EVERY, ONE]);
      expect(await screen.findByText('Pressed and let go: Reset every field')).toBeTruthy();
      expect(screen.getByText('Pressed and let go: Reset 1 field')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Move action 2 up' }));
      fireEvent.click(screen.getByRole('button', { name: 'Remove action 1' }));
      fireEvent.click(screen.getByRole('button', { name: 'Edit action 2' }));
      fireEvent.click(screen.getByLabelText('Every field'));
      fireEvent.click(screen.getByRole('button', { name: 'Save action' }));
      const every = { trigger: 'up', action: EVERY.action };
      const one = { trigger: 'up', action: ONE.action };
      expect(edits).toStrictEqual([
        { buttonActions: [one, every] },
        { buttonActions: [one] },
        { buttonActions: [every, every] },
      ]);
    });

    it('Go to a page: the page typed from 1, sent from 0, at the view chosen; a page past the end is said and not saved', async () => {
      const { edits } = mounted(BUTTON, undefined, []);
      fireEvent.click(await screen.findByRole('button', { name: 'Add action' }));
      const page = screen.getByLabelText('Page');
      fireEvent.change(page, { target: { value: '6' } });
      expect(screen.getByText('Choose a page from 1 to 5.')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Save action' }).hasAttribute('disabled')).toBe(true);
      fireEvent.change(page, { target: { value: '5' } });
      fireEvent.change(screen.getByLabelText('Show it'), { target: { value: 'fit-width' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save action' }));
      expect(edits).toStrictEqual([{ buttonActions: [{ trigger: 'up', action: { kind: 'goTo', page: 4, view: 'fit-width', at: null } }] }]);
    });

    it('CONTROL: a button holding a script lists it, says it is kept, and offers nothing that could write over it', async () => {
      mounted({ ...BUTTON, buttonActionsKept: true }, undefined, [
        EVERY,
        { trigger: 'enter', step: 0, action: { kind: 'kept', subtype: 'JavaScript', runsAs: null } },
      ]);
      expect(await screen.findByText('Pointer moves onto it: JavaScript (kept as it is, never run)')).toBeTruthy();
      expect(screen.getByText(/holds a script or another action Monstera never runs/u)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Add action' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Remove action 1' })).toBeNull();
    });
  });

  it('a push button offers its words, and a limit of 0 sends no limit', async () => {
    const { edits } = mounted({ ...TEXT, kind: 'button', name: 'send', buttonLabel: 'Send' });
    const words = await screen.findByLabelText('Words on the button');
    fireEvent.change(words, { target: { value: 'Submit' } });
    fireEvent.blur(words);
    expect(edits).toStrictEqual([{ buttonLabel: 'Submit' }]);
    cleanup();
    const text = mounted({ ...TEXT, maxLength: 9 });
    const length = await screen.findByLabelText('Most characters (0 for no limit)');
    fireEvent.change(length, { target: { value: '0' } });
    fireEvent.blur(length);
    expect(text.edits).toStrictEqual([{ maxLength: null }]);
  });

  it('CONTROL: a text field has no choices to set, and a tick box has no font', async () => {
    mounted(TEXT);
    await screen.findByLabelText('Tooltip');
    expect(screen.queryByLabelText('Choices')).toBeNull();
    cleanup();
    mounted({ ...TEXT, kind: 'checkbox', name: 'agree' });
    await screen.findByLabelText('Tooltip');
    expect(screen.queryByRole('button', { name: /^Font:/u })).toBeNull();
    expect(screen.queryByLabelText('Format')).toBeNull();
  });

  it('says a field that has changed since it was selected cannot be shown, and sends nothing', async () => {
    const edits: FormFieldProperties[] = [];
    render(
      <Wrapped>
        <FieldPropertiesPanel
          context={CONTEXT}
          documentFonts={[]}
          fonts={COMPUTER_FONTS}
          known={[]}
          onEdit={(set) => {
            edits.push(set);
          }}
          read={() => Promise.resolve([null])}
          pageCount={5}
          readActions={() => Promise.resolve(null)}
          registry={new CommandRegistry([])}
          selected={[handleOf(TEXT)]}
          version={asDocVersion(4)}
        />
      </Wrapped>,
    );
    await waitFor(() => {
      expect(screen.getByText(/has changed since it was selected/u)).toBeTruthy();
    });
    expect(edits).toStrictEqual([]);
  });
});

describe('a write landing while the pane is in use (the forms walk’s A8.4)', () => {
  /** The pane at `version`, its read answered by `answer`; `rerender` moves it on, as a landed write does. */
  function moving(answer: (version: number) => Promise<FormFieldRead>) {
    const pane = (version: number): ReactElement => (
      <Wrapped>
        <FieldPropertiesPanel
          context={CONTEXT}
          documentFonts={[]}
          fonts={COMPUTER_FONTS}
          known={[{ name: 'email', kind: 'text', options: [] }]}
          onEdit={() => undefined}
          read={() => answer(version).then((field) => [field])}
          pageCount={5}
          readActions={() => Promise.resolve(null)}
          registry={new CommandRegistry([])}
          selected={[handleOf(TEXT)]}
          version={asDocVersion(version)}
        />
      </Wrapped>
    );
    const view = render(pane(4));
    return {
      moveTo: (version: number): void => {
        view.rerender(pane(version));
      },
    };
  }

  it('an open font picker stays open while the next read is taken and after it arrives', async () => {
    let landed: (field: FormFieldRead) => void = () => undefined;
    const pane = moving((version) =>
      version === 4 ? Promise.resolve(TEXT) : new Promise<FormFieldRead>((resolve) => (landed = resolve)),
    );
    fireEvent.click(await screen.findByRole('button', { name: /^Font:/u }));
    expect(screen.getByRole('combobox', { name: 'Search fonts' })).toBeTruthy();
    // THE TOOLTIP'S WRITE LANDS: the version moves, and its read is still being taken.
    pane.moveTo(5);
    expect(screen.queryByRole('combobox', { name: 'Search fonts' })).not.toBeNull();
    landed({ ...TEXT, tooltip: 'Written by the forms walk' });
    await waitFor(() => {
      expect(screen.getByLabelText('Tooltip')).toHaveProperty('value', 'Written by the forms walk');
    });
    // AND STILL OPEN once the read that changed another property has arrived.
    expect(screen.queryByRole('combobox', { name: 'Search fonts' })).not.toBeNull();
  });

  it('a read that changed another property leaves a draft being typed here; one that changed this property replaces it', async () => {
    const reads: FormFieldRead[] = [TEXT, { ...TEXT, tooltip: 'From the write' }, { ...TEXT, tooltip: 'From the write', fontSize: 14 }];
    const pane = moving((version) => Promise.resolve(reads[version - 4] ?? TEXT));
    fireEvent.change(await screen.findByLabelText('Size (0 is automatic)'), { target: { value: '11' } });
    pane.moveTo(5);
    await waitFor(() => {
      expect(screen.getByLabelText('Tooltip')).toHaveProperty('value', 'From the write');
    });
    expect(screen.getByLabelText('Size (0 is automatic)')).toHaveProperty('value', '11');
    // CONTROL: a read that changed the size itself puts the document's value back over the draft.
    pane.moveTo(6);
    await waitFor(() => {
      expect(screen.getByLabelText('Size (0 is automatic)')).toHaveProperty('value', '14');
    });
  });
});

// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import type { FormFieldHandle, FormFieldProperties, FormFieldRead } from '@monstera/contract';
import { asDocId, asDocVersion } from '@monstera/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import { CommandRegistry, type CommandContext } from '../registries/commands.js';
import { FieldPropertiesPanel } from './FieldPropertiesPanel.js';

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
  fontSize: 0,
  borderColour: [0.2, 0.2, 0.2],
  fillColour: null,
  borderWidth: 1,
  options: [],
  multiline: false,
  rect: { x0: 0, y0: 0, x1: 10, y1: 10 },
  format: null,
  customFormat: false,
  calculation: null,
  customCalculation: false,
  calculationPosition: null,
};

const handleOf = (field: FormFieldRead): FormFieldHandle => ({ page: field.page, index: field.index, name: field.name });

interface Mounted {
  readonly edits: FormFieldProperties[];
  readonly reads: (readonly FormFieldHandle[])[];
}

function mounted(field: FormFieldRead, selected: readonly FormFieldHandle[] = [handleOf(field)]): Mounted {
  const edits: FormFieldProperties[] = [];
  const reads: (readonly FormFieldHandle[])[] = [];
  render(
    <Wrapped>
      <FieldPropertiesPanel
        context={CONTEXT}
        known={[
          { name: 'email', kind: 'text', options: [] },
          { name: 'phone', kind: 'text', options: [] },
          { name: 'group.first', kind: 'text', options: [] },
        ]}
        onEdit={(set) => {
          edits.push(set);
        }}
        read={(handles) => {
          reads.push(handles);
          return Promise.resolve([field]);
        }}
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

  it('sends Required and Read only as each is ticked', async () => {
    const seen = mounted(TEXT);
    fireEvent.click(await screen.findByLabelText('Required'));
    fireEvent.click(screen.getByLabelText('Read only'));
    expect(seen.edits).toStrictEqual([{ required: true }, { readOnly: true }]);
  });

  it('sends the face, and the size only when it is a figure in range', async () => {
    const seen = mounted(TEXT);
    fireEvent.change(await screen.findByLabelText('Font'), { target: { value: 'times' } });
    const size = screen.getByLabelText('Size (0 is automatic)');
    fireEvent.change(size, { target: { value: '999' } });
    fireEvent.blur(size);
    expect(seen.edits, 'a size past the bound is not sent').toStrictEqual([{ font: 'times' }]);
    fireEvent.change(size, { target: { value: '14' } });
    fireEvent.blur(size);
    expect(seen.edits).toStrictEqual([{ font: 'times' }, { fontSize: 14 }]);
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

  it('offers choices for a dropdown and not for a text field, one a line, and refuses a repeated one (control)', async () => {
    const dropdown: FormFieldRead = { ...TEXT, kind: 'dropdown', name: 'region', options: ['North', 'South'] };
    const seen = mounted(dropdown);
    const choices = await screen.findByLabelText('Choices');
    fireEvent.change(choices, { target: { value: 'North\nSouth\nNorth' } });
    fireEvent.blur(choices);
    expect(seen.edits, 'a choice given twice is not sent').toStrictEqual([]);
    fireEvent.change(choices, { target: { value: 'North\nSouth\nEast' } });
    fireEvent.blur(choices);
    expect(seen.edits).toStrictEqual([{ options: ['North', 'South', 'East'] }]);
  });

  it('CONTROL: a text field has no choices to set, and a tick box has no font', async () => {
    mounted(TEXT);
    await screen.findByLabelText('Tooltip');
    expect(screen.queryByLabelText('Choices')).toBeNull();
    cleanup();
    mounted({ ...TEXT, kind: 'checkbox', name: 'agree' });
    await screen.findByLabelText('Tooltip');
    expect(screen.queryByLabelText('Font')).toBeNull();
    expect(screen.queryByLabelText('Format')).toBeNull();
  });

  it('says a field that has changed since it was selected cannot be shown, and sends nothing', async () => {
    const edits: FormFieldProperties[] = [];
    render(
      <Wrapped>
        <FieldPropertiesPanel
          context={CONTEXT}
          known={[]}
          onEdit={(set) => {
            edits.push(set);
          }}
          read={() => Promise.resolve([null])}
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

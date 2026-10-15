// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import {
  type ChannelResult,
  type ContractClient,
  channels,
  createClient,
} from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { FormsPanel } from './FormsPanel.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';

const DOC = asDocId('00000000-0000-4000-8000-0000000000ff');

/**
 * The Fields list (the owner's K3) — the UI half of the wired-tools pair for `fillFormField`.
 *
 * ## What this file owes, and what it must not try to prove
 *
 * The kernel half lives in `formFields.test.ts`: it proves that the command produces the document effect and survives
 * a round trip, against a real engine. This half proves the other thing, and only it — **that each control dispatches
 * exactly that command, with the handle from the row it sits on**. The client is stubbed, so a case here that claimed
 * a document had changed would be asserting against nothing.
 *
 * ## The client is built from the CONTRACT
 *
 * So every answer these cases invent goes through the real schemas: a panel expecting a shape the channel cannot carry
 * fails here rather than in the product.
 *
 * ## THE HANDLE IS THE SUBJECT, which is why `fills` carries whole payloads
 *
 * `at` is where a row sits in this array and `index` is where the widget sits in the walk on its own page. They agree
 * on a one-page form and diverge on the second, so the second page's rows are what separate a panel that passes the
 * handle from one that passes its own position.
 */
function clientAnswering(
  fields: readonly unknown[],
  options: { refuse?: boolean; truncated?: boolean; version?: number } = {},
): { client: ContractClient; asked: unknown[] } {
  const asked: unknown[] = [];
  // THE RECTANGLE, FILLED IN HERE: this panel reads none, and `null` is a value the channel really answers.
  const rows = fields.map((row) => (typeof row === 'object' && row !== null ? { rect: null, ...row } : row));
  const client = createClient(channels, (id, params) => {
    if (id !== 'document.formFields') throw new Error(`unexpected channel ${id}`);
    asked.push(params);
    return Promise.resolve(
      options.refuse === true
        ? err({ code: 'document-poisoned' })
        : ok({ version: asDocVersion(options.version ?? 1), fields: rows, next: null, truncated: options.truncated ?? false }),
    );
  });
  return { client, asked };
}

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Renders the panel over one answer and records what it asked the shell to do. */
async function panel(
  fields: readonly unknown[],
  options: { refuse?: boolean; truncated?: boolean; version?: number; selected?: readonly string[] } = {},
): Promise<{
  jumps: number[];
  selects: unknown[];
  fills: unknown[];
  // FUNCTIONS, not numbers: every case clicks AFTER this helper returns, and a number captured at return time is the
  // count before the click, which is zero for a working control and zero for a broken one.
  flattens: () => number;
  properties: () => number;
  asked: unknown[];
}> {
  const { client, asked } = clientAnswering(fields, options);
  const jumps: number[] = [];
  const selects: unknown[] = [];
  const fills: unknown[] = [];
  let flattens = 0;
  let properties = 0;
  render(
    <Wrapped>
      <FormsPanel
        client={client}
        docId={DOC}
        onFill={(handle): void => {
          fills.push(handle);
        }}
        onFlatten={(): void => {
          flattens += 1;
        }}
        onJump={(page): void => {
          jumps.push(page);
        }}
        onProperties={(): void => {
          properties += 1;
        }}
        onSelect={(page, index, mode, ordered): void => {
          selects.push({ page, index, mode, ordered });
        }}
        selected={new Set(options.selected ?? [])}
        version={asDocVersion(options.version ?? 1)}
      />
    </Wrapped>,
  );
  await settle();
  return { jumps, fills, selects, flattens: () => flattens, properties: () => properties, asked };
}

/**
 * A field with everything a row needs, so a case names only what it is about. **The channel's own row type**, so a
 * member renamed in the channel is a compile error here rather than *no rows rendered* at run time.
 */
type ChannelField = ChannelResult<'document.formFields'>['fields'][number];

function field(over: Partial<ChannelField>): ChannelField {
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
    rect: null,
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

/** Opens a text value's box in place, by the value's own control, and answers the box. */
function openBox(name: string): HTMLInputElement | HTMLTextAreaElement {
  fireEvent.click(screen.getByRole('button', { name }));
  return screen.getByLabelText<HTMLInputElement | HTMLTextAreaElement>(name);
}

describe('FormsPanel — the tree', () => {
  it('groups the fields under the page a reader counts, each named by the DOCUMENT’S word and its kind', async () => {
    await panel([
      field({ name: 'applicant.name', kind: 'text', page: 0 }),
      field({ name: 'applicant.agrees', kind: 'checkbox', page: 4, on: false }),
    ]);
    expect(screen.getByRole('heading', { name: 'Page 1' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Page 5' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'applicant.name — Text, page 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'applicant.agrees — Tick box, page 5' })).toBeTruthy();
  });

  it('a radio group is ONE row with its options under it, and two groups are two rows', async () => {
    // THE SHAPE A DOCUMENT GIVES: every widget of a group carries the WHOLE group's options, and its own in `option`.
    // Each widget's options were once its own alone here, which no document has, and every option showed the first
    // one's name in the app (the owner's F9) while this case passed.
    await panel([
      field({ name: 'post', kind: 'radio', on: true, index: 1, options: ['First', 'Second'], option: 'First' }),
      field({ name: 'post', kind: 'radio', on: false, index: 2, options: ['First', 'Second'], option: 'Second' }),
      field({ name: 'shift', kind: 'radio', on: false, index: 3, options: ['Night'], option: 'Night' }),
    ]);
    expect(screen.getAllByRole('button', { name: /— Option, page 1/u })).toHaveLength(2);
    expect(screen.getAllByRole('radio').map((option) => option.getAttribute('aria-checked'))).toStrictEqual(['true', 'false', 'false']);
    expect(screen.getByRole('button', { name: 'Second' })).toBeTruthy();
  });

  it('puts no Delete and no empty grey box on a row (K3): an empty value says so in words', async () => {
    await panel([field({ name: 'surname' })]);
    expect(screen.queryByRole('button', { name: /Delete/u })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'surname' }).textContent).toBe('Empty');
  });

  it('the search narrows the rows by name, and says when nothing matches', async () => {
    await panel([field({ name: 'first.name', index: 0 }), field({ name: 'email', index: 1 })]);
    const search = screen.getByRole('searchbox', { name: 'Search fields' });
    fireEvent.change(search, { target: { value: 'MAIL' } });
    expect(screen.queryByRole('button', { name: /first\.name —/u })).toBeNull();
    expect(screen.getByRole('button', { name: /email —/u })).toBeTruthy();
    fireEvent.change(search, { target: { value: 'nothing like it' } });
    expect(screen.getByText('No field has that in its name.')).toBeTruthy();
  });
});

describe('FormsPanel — filling in place', () => {
  it('a click on a text value opens its box there, and leaving it fills, with the handle from the row it sits on', async () => {
    // THE SECOND PAGE'S ROW, deliberately: its list position is 1 and its walk index is 0.
    const { fills } = await panel([
      field({ name: 'first', page: 0, index: 0, values: ['Ada'] }),
      field({ name: 'second', page: 1, index: 0, values: ['Grace'] }),
    ]);
    const input = openBox('second');
    fireEvent.change(input, { target: { value: 'Katherine' } });
    fireEvent.blur(input);
    expect(fills).toStrictEqual([{ page: 1, index: 0, version: asDocVersion(1), value: { set: 'text', text: 'Katherine' } }]);
  });

  it('Enter commits a text field, and the Enter that CONFIRMS A COMPOSITION does not (CR-COR-07)', async () => {
    const { fills } = await panel([field({ name: 'first', values: ['Ada'] })]);
    const input = openBox('first');
    input.focus();
    fireEvent.change(input, { target: { value: 'にほんご' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(fills).toStrictEqual([]);
    // THE BOX IS STILL WHERE THE PERSON IS TYPING: the composing Enter neither filled nor closed it.
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(fills).toMatchObject([{ value: { set: 'text', text: 'にほんご' } }]);
  });

  it('SENDS NOTHING when a text field is left as it was, and a field holding LINE BREAKS keeps them', async () => {
    const { fills } = await panel([field({ name: 'first', values: ['Ada'] }), field({ name: 'address', index: 1, values: ['1 High Street\nLeeds'] })]);
    fireEvent.blur(openBox('first'));
    const box = openBox('address');
    expect(box.tagName).toBe('TEXTAREA');
    fireEvent.blur(box);
    expect(fills).toStrictEqual([]);
    const again = openBox('address');
    fireEvent.change(again, { target: { value: '2 High Street\nLeeds' } });
    fireEvent.blur(again);
    expect(fills).toMatchObject([{ value: { set: 'text', text: '2 High Street\nLeeds' } }]);
  });

  it('a tick box is filled by a click on its mark, as a STATE, not as a toggle', async () => {
    const { fills } = await panel([field({ name: 'applicant.agrees', kind: 'checkbox', on: false, index: 2 })]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'applicant.agrees' }));
    expect(fills).toStrictEqual([{ page: 0, index: 2, version: asDocVersion(1), value: { set: 'button', on: true } }]);
  });

  it('CHOOSES a radio option that is off, and CLEARS the chosen one, each with its own handle', async () => {
    const { fills } = await panel([
      field({ name: 'post', kind: 'radio', on: true, index: 1, options: ['First', 'Second'], option: 'First' }),
      field({ name: 'post', kind: 'radio', on: false, index: 2, options: ['First', 'Second'], option: 'Second' }),
    ]);
    fireEvent.click(screen.getByRole('radio', { name: 'post: Second' }));
    fireEvent.click(screen.getByRole('radio', { name: 'post: First' }));
    expect(fills).toStrictEqual([
      { page: 0, index: 2, version: asDocVersion(1), value: { set: 'button', on: true } },
      { page: 0, index: 1, version: asDocVersion(1), value: { set: 'button', on: false } },
    ]);
  });

  it('DISPATCHES A CHOICE, and offers the empty option as a real value', async () => {
    const { fills } = await panel([
      field({ name: 'applicant.title', kind: 'dropdown', values: ['Dr'], options: ['Dr', 'Mr', 'Ms'], index: 3 }),
    ]);
    const select = screen.getByLabelText('applicant.title');
    fireEvent.change(select, { target: { value: 'Ms' } });
    fireEvent.change(select, { target: { value: '' } });
    expect(fills).toStrictEqual([
      { page: 0, index: 3, version: asDocVersion(1), value: { set: 'choice', option: 'Ms' } },
      { page: 0, index: 3, version: asDocVersion(1), value: { set: 'choice', option: '' } },
    ]);
  });

  it('SHOWS A VALUE THE DOCUMENT DOES NOT OFFER rather than dropping it', async () => {
    await panel([field({ name: 'applicant.title', kind: 'dropdown', values: ['Professor'], options: ['Dr', 'Mr'] })]);
    expect(screen.getByLabelText<HTMLSelectElement>('applicant.title').value).toBe('Professor');
  });

  it('RENDERS NO CONTROL for a read-only field, a value the listing cut, or a field nobody fills, each in its own words', async () => {
    const { fills } = await panel([
      field({ name: 'applicant.reference', values: ['LOCKED'], readOnly: true }),
      field({ name: 'long', index: 1, values: ['a'.repeat(512)], cut: true }),
      field({ name: 'applicant.signature', index: 2, kind: 'signature', signed: true }),
      field({ name: 'unknown', index: 3, kind: 'other' }),
    ]);
    expect(screen.queryByRole('button', { name: 'applicant.reference' })).toBeNull();
    expect(screen.getByText('The document marks this field read-only.')).toBeTruthy();
    expect(screen.getByText('This field holds more text than can be changed here, so it is kept as it is.')).toBeTruthy();
    // A SIGNED SIGNATURE FIELD SAYS SO (the owner's F8), and a kind nobody fills says that.
    expect(screen.getByText('This field is signed.')).toBeTruthy();
    expect(screen.getByText('This field is not one that can be filled here.')).toBeTruthy();
    expect(fills).toStrictEqual([]);
  });

  it('CONTROL: the same long value NOT cut by the listing opens its box, so the cut is what keeps it', async () => {
    await panel([field({ name: 'long', values: ['a'.repeat(512)] })]);
    expect(openBox('long').value).toBe('a'.repeat(512));
  });

  it('SEPARATES read-only from not fillable: a push button says it is not fillable, never read-only', async () => {
    await panel([
      field({ name: 'applicant.reference', values: ['LOCKED'], readOnly: true }),
      field({ name: 'submit', index: 1, kind: 'button' }),
      field({ name: 'applicant.signature', index: 2, kind: 'signature' }),
    ]);
    expect(screen.getAllByText('The document marks this field read-only.')).toHaveLength(1);
    expect(screen.getAllByText('This field is not one that can be filled here.')).toHaveLength(1);
    // AN EMPTY SIGNATURE FIELD SAYS WHERE IT IS SIGNED (the owner's F8): on the page, which offers the signing.
    expect(screen.getAllByText('Press this field on the page to sign it.')).toHaveLength(1);
  });

  it('draws a radio group’s options as radios of ONE group, and a second group as another', async () => {
    await panel([
      field({ name: 'post', kind: 'radio', on: true, index: 1, options: ['First', 'Second'], option: 'First' }),
      field({ name: 'post', kind: 'radio', on: false, index: 2, options: ['First', 'Second'], option: 'Second' }),
      field({ name: 'size', kind: 'radio', on: false, index: 3, options: ['Large'], option: 'Large' }),
    ]);
    const groupOf = (name: string): string | null => screen.getByRole('radio', { name }).getAttribute('data-group');
    expect(groupOf('post: First')).not.toBeNull();
    expect(groupOf('post: First')).toBe(groupOf('post: Second'));
    expect(groupOf('size: Large')).not.toBe(groupOf('post: First'));
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  // THE FILL FROM THIS LIST is `formsTab.pw.ts`' case, in Chromium: jsdom does not refresh `selectedOptions` when an
  // option's `selected` is set (measured 2026-10-11: every option read `selected: true` while the collection still held
  // one), so a change here cannot reach the handler the way a browser's does.
  it('a list that takes several values is a list that takes several, showing every value it holds', async () => {
    await panel([
      field({ name: 'interests', kind: 'listbox', multiSelect: true, values: ['Art', 'Sport'], options: ['Art', 'Music', 'Sport'], index: 4 }),
    ]);
    const list = screen.getByLabelText<HTMLSelectElement>('interests');
    expect(list.multiple).toBe(true);
    expect([...list.options].filter((option) => option.selected).map((option) => option.value)).toStrictEqual(['Art', 'Sport']);
  });
});

describe('FormsPanel — selecting', () => {
  it('jumps to the page a row names, zero-based as the shell expects', async () => {
    const { jumps } = await panel([field({ name: 'later', page: 4 })]);
    fireEvent.click(screen.getByRole('button', { name: 'later — Text, page 5' }));
    expect(jumps).toStrictEqual([4]);
  });

  it('a click on a row SELECTS that field, Ctrl and Shift say how it joins, and a double click opens its properties', async () => {
    const { selects, jumps, properties } = await panel([field({ name: 'first', index: 0 }), field({ name: 'second', index: 1 })]);
    fireEvent.click(screen.getByRole('button', { name: 'first — Text, page 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'second — Text, page 1' }), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'second — Text, page 1' }), { shiftKey: true });
    const ordered = ['0:0', '0:1'];
    expect(selects).toStrictEqual([
      { page: 0, index: 0, mode: 'replace', ordered },
      { page: 0, index: 1, mode: 'toggle', ordered },
      { page: 0, index: 1, mode: 'range', ordered },
    ]);
    expect(jumps).toStrictEqual([0]);
    expect(properties()).toBe(0);
    fireEvent.doubleClick(screen.getByRole('button', { name: 'first — Text, page 1' }));
    expect(properties()).toBe(1);
  });

  it('draws the selected rows as pressed, and ONLY them: two rows are never selected by one click', async () => {
    await panel([field({ name: 'first', index: 0 }), field({ name: 'second', index: 1 })], { selected: ['0:1'] });
    expect(screen.getByRole('button', { name: 'first — Text, page 1' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'second — Text, page 1' }).getAttribute('aria-pressed')).toBe('true');
  });

  // E2: EACH FIELD IN ITS OWN CARD, the selected one's card drawn chosen, and a radio group's options in its ONE card.
  it('E2: each row is its own card, the selected card is marked, and a radio group and its options share one card', async () => {
    await panel(
      [
        field({ name: 'first', index: 0 }),
        field({ name: 'second', index: 1 }),
        field({ name: 'plan', index: 2, kind: 'radio', on: false, options: ['basic', 'premium'], option: 'basic' }),
        field({ name: 'plan', index: 3, kind: 'radio', on: false, options: ['basic', 'premium'], option: 'premium' }),
      ],
      { selected: ['0:1'] },
    );
    const cards = [...document.querySelectorAll('.m-forms-list > .m-list-card')];
    expect(cards).toHaveLength(3);
    expect(cards.map((card) => card.getAttribute('data-list-card-selected'))).toStrictEqual([null, 'true', null]);
    // THE GROUP'S OPTIONS ARE INSIDE ITS CARD, not cards of their own.
    expect(cards[2]?.querySelectorAll('.m-forms-option')).toHaveLength(2);
    expect(document.querySelectorAll('.m-forms-option.m-list-card')).toHaveLength(0);
  });
});

describe('FormsPanel — the states', () => {
  it('says the bound stopped the walk rather than showing a short list quietly', async () => {
    await panel([field({ name: 'one' })], { truncated: true });
    expect(screen.getByText('This document carries more form fields than can be read, so the rest are not listed.')).toBeTruthy();
  });

  it('CONTROL: an unstopped list does not say the rest are not listed', async () => {
    await panel([field({ name: 'one' })]);
    expect(screen.queryByText(/the rest are not listed/u)).toBeNull();
  });

  it('offers Flatten while the list is truncated, because flattening acts on the document and not on the rows listed', async () => {
    const { flattens } = await panel([field({ name: 'one' })], { truncated: true });
    fireEvent.click(screen.getByRole('button', { name: 'Flatten form' }));
    expect(flattens()).toBe(1);
  });

  it('a REFUSAL is its own state, not an empty form', async () => {
    await panel([], { refuse: true });
    expect(screen.getByText('The form fields in this document could not be read.')).toBeTruthy();
    expect(screen.queryByText('This document has no form fields.')).toBeNull();
  });

  it('CONTROL: it renders the empty case as empty', async () => {
    await panel([]);
    expect(screen.getByText('This document has no form fields.')).toBeTruthy();
  });

  it('CONTROL: it asks the channel for the document it was given', async () => {
    const { asked } = await panel([field({ name: 'one' })]);
    expect(asked).toStrictEqual([{ docId: DOC, from: 0 }]);
  });

  it('the flatten control dispatches, and dispatches once; it is not offered on a document with no fields', async () => {
    const { flattens } = await panel([field({ name: 'one' })]);
    expect(flattens()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Flatten form' }));
    expect(flattens()).toBe(1);
  });

  it('CONTROL: no flatten on a form with no fields', async () => {
    await panel([]);
    expect(screen.queryByRole('button', { name: 'Flatten form' })).toBeNull();
  });
});

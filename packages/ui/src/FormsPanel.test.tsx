// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { FormsPanel } from './FormsPanel.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';

const DOC = asDocId('00000000-0000-4000-8000-0000000000ff');

/**
 * The forms panel — the UI half of the wired-tools pair for `fillFormField`.
 *
 * ## What this file owes, and what it must not try to prove
 *
 * The kernel half lives in `formFields.test.ts`: it proves that the command
 * produces the document effect and survives a round trip, against a real
 * engine. This half proves the other thing, and only it — **that each control
 * dispatches exactly that command, with the handle from the row it sits on**.
 * The client is stubbed, so a case here that claimed a document had changed
 * would be asserting against nothing.
 *
 * ## The client is built from the CONTRACT
 *
 * So every answer these cases invent goes through the real schemas: a panel
 * expecting a shape the channel cannot carry fails here rather than in the
 * product, and a `kind` outside the closed union cannot be written at all.
 *
 * ## THE HANDLE IS THE SUBJECT, which is why `fills` carries whole payloads
 *
 * The pair's blind spot is a boundary where a unit changes, and here the unit
 * is an index into a walk: `at` is where a row sits in this array and `index`
 * is where the widget sits in the walk on its own page. They agree on a
 * one-page form and diverge on the second, so the second page's rows are what
 * separate a panel that passes the handle from one that passes its own
 * position.
 */
function clientAnswering(
  fields: readonly unknown[],
  options: { refuse?: boolean; truncated?: boolean; version?: number } = {},
): { client: ContractClient; asked: unknown[] } {
  const asked: unknown[] = [];
  // THE RECTANGLE, FILLED IN HERE rather than at every call site. The channel
  // carries it so a surface can point at a field on the page; THIS panel reads
  // none, so a box in each fixture would be numbers no case could assert.
  // `null` is a value the channel really answers — a page that displays no
  // region — and it is the one that would break a panel which had quietly
  // started depending on a place.
  const rows = fields.map((row) =>
    typeof row === 'object' && row !== null ? { rect: null, ...row } : row,
  );
  const client = createClient(channels, (id, params) => {
    if (id !== 'document.formFields') throw new Error(`unexpected channel ${id}`);
    asked.push(params);
    return Promise.resolve(
      options.refuse === true
        ? err({ code: 'document-poisoned' })
        : ok({
            version: asDocVersion(options.version ?? 1),
            fields: rows,
            truncated: options.truncated ?? false,
          }),
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
  options: { refuse?: boolean; truncated?: boolean; version?: number } = {},
): Promise<{ jumps: number[]; fills: unknown[]; deletes: unknown[]; asked: unknown[] }> {
  const { client, asked } = clientAnswering(fields, options);
  const jumps: number[] = [];
  const fills: unknown[] = [];
  const deletes: unknown[] = [];
  render(
    <Wrapped>
      <FormsPanel
        client={client}
        docId={DOC}
        onDelete={(handle): void => {
          deletes.push(handle);
        }}
        onFill={(handle): void => {
          fills.push(handle);
        }}
        onJump={(page): void => {
          jumps.push(page);
        }}
        version={asDocVersion(options.version ?? 1)}
      />
    </Wrapped>,
  );
  await settle();
  return { jumps, fills, deletes, asked };
}

/** A field with everything a row needs, so a case names only what it is about. */
function field(over: Record<string, unknown>): Record<string, unknown> {
  return {
    page: 0,
    index: 0,
    kind: 'text',
    name: 'applicant.name',
    value: '',
    on: null,
    options: [],
    readOnly: false,
    ...over,
  };
}

describe('FormsPanel', () => {
  it('names each field by the DOCUMENT S word, its kind, and the page a reader counts', async () => {
    // The name is the document's and is rendered rather than translated; the
    // kind and the page are this application's and are not. A panel that
    // translated the name would be rewriting the form's own vocabulary, and one
    // that showed the raw page index would be off by one on every row.
    await panel([
      field({ name: 'applicant.name', kind: 'text', page: 0 }),
      field({ name: 'applicant.agrees', kind: 'checkbox', page: 4, on: false, value: '' }),
    ]);

    expect(screen.getByText('applicant.name — Text, page 1')).toBeTruthy();
    expect(screen.getByText('applicant.agrees — Tick box, page 5')).toBeTruthy();
  });

  it('DISPATCHES A TEXT FILL on blur, with the handle from the row it sits on', async () => {
    // THE SECOND PAGE'S ROW, deliberately. Its list position is 1 and its walk
    // index is 0, so a panel passing its own position would send `index: 1` and
    // fill a field that is not there. That is the pair's blind spot made a
    // case: the two halves speak different index spaces and this is where they
    // meet.
    const { fills } = await panel([
      field({ name: 'first', page: 0, index: 0, value: 'Ada' }),
      field({ name: 'second', page: 1, index: 0, value: 'Grace' }),
    ]);

    const input = screen.getByLabelText('second');
    fireEvent.change(input, { target: { value: 'Katherine' } });
    fireEvent.blur(input);

    expect(fills).toStrictEqual([
      {
        page: 1,
        index: 0,
        version: asDocVersion(1),
        value: { set: 'text', text: 'Katherine' },
      },
    ]);
  });

  it('SENDS NOTHING when a text field is left as it was', async () => {
    // A blur is not an edit. Without this the case above passes for a panel
    // that dispatches on every blur, which would be a command and a log entry
    // every time a person tabbed through a form reading it.
    const { fills } = await panel([field({ name: 'first', value: 'Ada' })]);
    fireEvent.blur(screen.getByLabelText('first'));
    expect(fills).toStrictEqual([]);
  });

  it('DISPATCHES A BUTTON FILL as a STATE, not as a toggle', async () => {
    // `on: true`, not *flip it*. MuPDF's toggle is keyed on `/AS` — measured —
    // so a payload spelling *flip* would carry that ambiguity to the kernel,
    // and the same click would do different things to two documents holding the
    // same data.
    const { fills } = await panel([
      field({ name: 'applicant.agrees', kind: 'checkbox', on: false, index: 2 }),
    ]);
    fireEvent.click(screen.getByLabelText('applicant.agrees'));
    expect(fills).toStrictEqual([
      { page: 0, index: 2, version: asDocVersion(1), value: { set: 'button', on: true } },
    ]);
  });

  it('OFFERS A RADIO AS A BOX THAT CAN BE CLEARED, because the format allows it', async () => {
    // Measured: toggling a PDF radio group's lit widget deselects the whole
    // group. An HTML radio cannot express that — clicking a chosen one does
    // nothing — so rendering it as one would hide a state the document has.
    const { fills } = await panel([
      field({ name: 'applicant.post', kind: 'radio', on: true, index: 1 }),
    ]);
    fireEvent.click(screen.getByLabelText('applicant.post'));
    expect(fills).toStrictEqual([
      { page: 0, index: 1, version: asDocVersion(1), value: { set: 'button', on: false } },
    ]);
  });

  it('DISPATCHES A CHOICE, and offers the empty option as a real value', async () => {
    const { fills } = await panel([
      field({
        name: 'applicant.title',
        kind: 'dropdown',
        value: 'Dr',
        options: ['Dr', 'Mr', 'Ms'],
        index: 3,
      }),
    ]);
    const select = screen.getByLabelText('applicant.title');
    fireEvent.change(select, { target: { value: 'Ms' } });
    // AND THEN CLEARED. The empty option is not a placeholder: clearing a
    // choice stores the empty string, measured, and a list with no empty entry
    // could not return a field to a state a document may arrive in.
    fireEvent.change(select, { target: { value: '' } });

    expect(fills).toStrictEqual([
      { page: 0, index: 3, version: asDocVersion(1), value: { set: 'choice', option: 'Ms' } },
      { page: 0, index: 3, version: asDocVersion(1), value: { set: 'choice', option: '' } },
    ]);
  });

  it('SHOWS A VALUE THE DOCUMENT DOES NOT OFFER rather than dropping it', async () => {
    // MuPDF stores an unlisted value without complaint — measured — so a form
    // can arrive holding one. A `<select>` whose value matches no option
    // renders blank, which reads as an empty field rather than a strange one.
    await panel([
      field({
        name: 'applicant.title',
        kind: 'dropdown',
        value: 'Professor',
        options: ['Dr', 'Mr'],
      }),
    ]);
    const select = screen.getByLabelText('applicant.title');
    expect((select as HTMLSelectElement).value).toBe('Professor');
    expect(screen.getByText('Professor')).toBeTruthy();
  });

  it('RENDERS NO CONTROL for a read-only field, and says whose decision that is', async () => {
    // The wired rule cuts both ways: a control that renders and refuses is a
    // defect, and the honest rendering of *this cannot be filled* is not a
    // control. The message names the document, because *disabled* would read as
    // a fault in the application.
    const { fills } = await panel([
      field({ name: 'applicant.reference', value: 'LOCKED', readOnly: true }),
    ]);
    expect(screen.queryByLabelText('applicant.reference')).toBeNull();
    expect(screen.getByText('The document marks this field read-only.')).toBeTruthy();
    expect(fills).toStrictEqual([]);
  });

  it('SEPARATES read-only from not-fillable, which are different absences', async () => {
    // A locked field is one this document decided about; a signature is not a
    // field anybody types into. One message for both would tell a reader a Send
    // button might become editable if the document changed.
    await panel([
      field({ name: 'applicant.signature', kind: 'signature' }),
      field({ name: 'applicant.submit', kind: 'button', index: 1 }),
    ]);
    expect(screen.getAllByText('This field is not one that can be filled here.')).toHaveLength(2);
    expect(screen.queryByText('The document marks this field read-only.')).toBeNull();
  });

  it('DISPATCHES A DELETE with the handle from the row it sits on', async () => {
    // The second page's row again, for the fill's reason: its list position is
    // 1 and its walk index is 0, and a delete built from the position would
    // take a field that is not there.
    const { deletes } = await panel([
      field({ name: 'first', page: 0, index: 0 }),
      field({ name: 'second', page: 1, index: 0 }),
    ]);
    const buttons = screen.getAllByRole('button', { name: 'Delete this field' });
    buttons[1]?.click();
    expect(deletes).toStrictEqual([{ page: 1, index: 0, version: asDocVersion(1) }]);
  });

  it('OFFERS A DELETE on rows that cannot be filled, because those are different actions', async () => {
    // A signature cannot be filled here and a read-only field is one the
    // document locked — both are statements about the VALUE. Removing the field
    // from the form is a different action, and the reasons the first is refused
    // say nothing about the second. A panel that hid delete wherever it hid
    // fill would make a read-only field permanent.
    const { deletes } = await panel([
      field({ name: 'applicant.signature', kind: 'signature' }),
      field({ name: 'applicant.reference', readOnly: true, index: 1 }),
    ]);
    const buttons = screen.getAllByRole('button', { name: 'Delete this field' });
    expect(buttons).toHaveLength(2);
    buttons[1]?.click();
    expect(deletes).toStrictEqual([{ page: 0, index: 1, version: asDocVersion(1) }]);
  });

  it('jumps to the page a row names, zero-based as the shell expects', async () => {
    const { jumps } = await panel([field({ name: 'later', page: 4 })]);
    screen.getByRole('button', { name: /page 5/u }).click();
    // FIVE ON SCREEN, FOUR IN THE CALL — the two halves of the correspondence
    // in one case, which is the only place they meet.
    expect(jumps).toStrictEqual([4]);
  });

  it('says the bound stopped the walk rather than showing a short list quietly', async () => {
    await panel([field({ name: 'one' })], { truncated: true });
    expect(screen.getByText('Only the first 4,096 form fields are listed.')).toBeTruthy();
  });

  it('a REFUSAL is its own state, not an empty form', async () => {
    // *This document has no fields* and *we could not ask* are different things
    // to tell a person trying to fill something in, and collapsing them makes
    // the second invisible — which is the reassuring answer for a document that
    // is busy or poisoned.
    await panel([], { refuse: true });
    expect(screen.getByText('The form fields in this document could not be read.')).toBeTruthy();
    expect(screen.queryByText('This document has no form fields.')).toBeNull();
  });

  it('CONTROL: it renders the empty case as empty, so the refusal above is not the only path', async () => {
    await panel([]);
    expect(screen.getByText('This document has no form fields.')).toBeTruthy();
  });

  it('CONTROL: it asks the channel for the document it was given', async () => {
    // 4b, and it is the line that separates *this form is empty* from *the
    // panel never asked*. Every case above is satisfied by a panel that renders
    // its own idea of nothing.
    const { asked } = await panel([field({ name: 'one' })]);
    expect(asked).toStrictEqual([{ docId: DOC }]);
  });
});

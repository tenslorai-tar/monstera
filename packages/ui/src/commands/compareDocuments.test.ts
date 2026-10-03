import { channels, createClient } from '@monstera/contract';
import { type DocId, asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { GROUP_COMPARE, GROUP_DISPLAY } from '../messages/en.js';
import type { CommandContext } from '../registries/commands.js';
import { compareDocumentsCommand } from './compareDocuments.js';

const HERE = asDocId('00000000-0000-4000-8000-00000000c0a1');
const OTHER = asDocId('00000000-0000-4000-8000-00000000c0b2');
const THIRD = asDocId('00000000-0000-4000-8000-00000000c0c3');

/** NOT A DEFAULTED PARAMETER for the document: passing `undefined` to one takes the default, which hid the no-document case. */
function contextWith(open: readonly DocId[], focused: { readonly docId: DocId | undefined } = { docId: HERE }): CommandContext {
  const { docId } = focused;
  return {
    selectedPages: [],
    docId,
    version: asDocVersion(1),
    hasSelection: false,
    dirty: false,
    page: 0,
    pageCount: 3,
    openDocuments: open.map((each) => ({ docId: each, version: asDocVersion(1), byteLength: 100, name: `${each}.pdf` })),
  };
}

/** The command, with main answering `document.newerOf` as `newer` — or failing, for `'refused'`. */
function recorded(newer: 'first' | 'second' | 'neither' | 'refused' = 'neither'): {
  shown: (readonly [DocId, DocId])[];
  asked: unknown[];
  command: ReturnType<typeof compareDocumentsCommand>;
} {
  const shown: (readonly [DocId, DocId])[] = [];
  const asked: unknown[] = [];
  const client = createClient(channels, (id, params) => {
    if (id !== 'document.newerOf') throw new Error(`this case does not answer ${id}`);
    asked.push(params);
    return Promise.resolve(newer === 'refused' ? err({ code: 'document-not-open' as const }) : ok({ newer }));
  });
  return { shown, asked, command: compareDocumentsCommand({ client, show: (left, right) => shown.push([left, right]) }) };
}

describe('Review › Compare opens Side by Side (ADR-0131)', () => {
  it('this document on the left and the next open one on the right, when neither file is newer', async () => {
    const { shown, asked, command } = recorded('neither');
    await command.run(contextWith([HERE, OTHER, THIRD]));
    expect(asked).toStrictEqual([{ first: HERE, second: OTHER }]);
    expect(shown).toStrictEqual([[HERE, OTHER]]);
  });

  it('THE NEWER FILE ON THE RIGHT: this document goes right when its file was written later (8a, F-C3)', async () => {
    const newerHere = recorded('first');
    await newerHere.command.run(contextWith([HERE, OTHER]));
    expect(newerHere.shown).toStrictEqual([[OTHER, HERE]]);

    // CONTROL: the other way round leaves this one on the left, so the order is the files' and not a swap.
    const newerThere = recorded('second');
    await newerThere.command.run(contextWith([HERE, OTHER]));
    expect(newerThere.shown).toStrictEqual([[HERE, OTHER]]);
  });

  it('a question main could not answer keeps this document on the left, and still opens the surface', async () => {
    const { shown, command } = recorded('refused');
    await command.run(contextWith([HERE, OTHER]));
    expect(shown).toStrictEqual([[HERE, OTHER]]);
  });

  it('the first OTHER document, wherever this one sits among the tabs', async () => {
    // THIS DOCUMENT IS NOT FIRST, so a command taking `openDocuments[0]` would put it on both sides.
    const { shown, command } = recorded();
    await command.run(contextWith([OTHER, HERE, THIRD]));
    expect(shown).toStrictEqual([[HERE, OTHER]]);
  });

  it('with only this document open, it shows it on both sides, where the right half chooses another', async () => {
    const { shown, asked, command } = recorded();
    await command.run(contextWith([HERE]));
    expect(shown).toStrictEqual([[HERE, HERE]]);
    // NOTHING TO ORDER, so nothing is asked.
    expect(asked).toStrictEqual([]);
  });

  it('CONTROL: it is unavailable with no document, and shows nothing if run there', async () => {
    const { shown, command } = recorded();
    expect(command.when?.(contextWith([], { docId: undefined }))).toBe(false);
    expect(command.when?.(contextWith([HERE]))).toBe(true);
    await command.run(contextWith([], { docId: undefined }));
    expect(shown).toStrictEqual([]);
  });

  it('sits on Review › Compare and last on Home › Display, as v5-02 draws it', () => {
    expect(recorded().command.placements).toStrictEqual([
      { surface: 'ribbon', section: 'review', group: GROUP_COMPARE, order: 10 },
      { surface: 'ribbon', section: 'home', group: GROUP_DISPLAY, order: 208 },
    ]);
  });
});

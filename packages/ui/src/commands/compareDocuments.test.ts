import { type DocId, asDocId, asDocVersion } from '@monstera/shared';
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

function recorded(): { shown: (readonly [DocId, DocId])[]; command: ReturnType<typeof compareDocumentsCommand> } {
  const shown: (readonly [DocId, DocId])[] = [];
  return { shown, command: compareDocumentsCommand({ show: (left, right) => shown.push([left, right]) }) };
}

describe('Review › Compare opens Side by Side (ADR-0131)', () => {
  it('this document on the left and the next open one on the right', async () => {
    const { shown, command } = recorded();
    await command.run(contextWith([HERE, OTHER, THIRD]));
    expect(shown).toStrictEqual([[HERE, OTHER]]);
  });

  it('the first OTHER document, wherever this one sits among the tabs', async () => {
    // THIS DOCUMENT IS NOT FIRST, so a command taking `openDocuments[0]` would put it on both sides.
    const { shown, command } = recorded();
    await command.run(contextWith([OTHER, HERE, THIRD]));
    expect(shown).toStrictEqual([[HERE, OTHER]]);
  });

  it('with only this document open, it shows it on both sides, where the right half chooses another', async () => {
    const { shown, command } = recorded();
    await command.run(contextWith([HERE]));
    expect(shown).toStrictEqual([[HERE, HERE]]);
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

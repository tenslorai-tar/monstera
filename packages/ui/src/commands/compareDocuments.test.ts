import { type ContractClient, channels, createClient } from '@monstera/contract';
import { type DocId, asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { COMPARE_DOCUMENTS_DIALOG_ID, COMPARE_RESULT_DIALOG_ID, MAX_COMPARE_CHANGES } from '../dialogs/compareDocuments.js';
import { GROUP_COMPARE, GROUP_DISPLAY } from '../messages/en.js';
import type { CommandContext } from '../registries/commands.js';
import { type TrackTask, UNTRACKED } from '../runningTask.js';
import { compareDocumentsCommand, compareOpenDocuments } from './compareDocuments.js';

const HERE = asDocId('00000000-0000-4000-8000-00000000c0a1');
const OTHER = asDocId('00000000-0000-4000-8000-00000000c0b2');

/** Each document's pages as lines, and a version per read so a case can move one mid-walk. */
interface Script {
  readonly pages: readonly (readonly string[])[];
  readonly versions?: readonly number[];
  readonly truncatedPages?: readonly number[];
  readonly refusePage?: number;
}

/**
 * A client answering both documents from scripts, recording every text-layer read as
 * `docId:page` — so a case asserts which pages were paired, not only what came out.
 */
function clientFor(here: Script, other: Script): { client: ContractClient; reads: string[] } {
  const reads: string[] = [];
  const scripts = new Map<DocId, Script>([
    [HERE, here],
    [OTHER, other],
  ]);
  const counters = new Map<DocId, number>();
  const client = createClient(channels, (id, params) => {
    const docId = (params as { docId: DocId }).docId;
    const script = scripts.get(docId);
    if (script === undefined) throw new Error(`no script for ${docId}`);
    if (id === 'document.viewModel') {
      return Promise.resolve(
        ok({ version: asDocVersion(script.versions?.[0] ?? 1), pageCount: script.pages.length, rotations: [0], sizes: [{ width: 612, height: 792 }] }),
      );
    }
    if (id !== 'document.pageTextLayer') throw new Error(`unexpected channel ${id}`);
    const page = (params as { page: number }).page;
    reads.push(`${docId === HERE ? 'here' : 'other'}:${String(page)}`);
    if (script.refusePage === page) return Promise.resolve(err({ code: 'document-poisoned' }));
    const read = counters.get(docId) ?? 0;
    counters.set(docId, read + 1);
    return Promise.resolve(
      ok({
        version: asDocVersion(script.versions?.[read + 1] ?? script.versions?.[0] ?? 1),
        lines: (script.pages[page] ?? []).map((text) => ({ text, box: { x0: 0, y0: 0, x1: 1, y1: 1 } })),
        truncated: script.truncatedPages?.includes(page) ?? false,
        kind: 'text' as const,
      }),
    );
  });
  return { client, reads };
}

function contextWith(open: readonly DocId[]): CommandContext {
  return {
    docId: HERE,
    version: asDocVersion(1),
    hasSelection: false,
    dirty: false,
    page: 0,
    pageCount: 3,
    openDocuments: open.map((docId) => ({
      docId,
      version: asDocVersion(1),
      byteLength: 100,
      name: docId === HERE ? 'this.pdf' : 'other.pdf',
    })),
  };
}

describe('compareOpenDocuments — page i against page i, two pages held at a time', () => {
  it('pairs pages by number and lists each page’s changed lines by the number a person reads', async () => {
    const { client, reads } = clientFor(
      { pages: [['Title', 'Due 1 May'], ['same'], ['end']] },
      { pages: [['Title', 'Due 8 May'], ['same'], ['end', 'appendix']] },
    );
    const found = await compareOpenDocuments({ client, track: UNTRACKED }, HERE, OTHER);
    expect(reads).toStrictEqual(['here:0', 'other:0', 'here:1', 'other:1', 'here:2', 'other:2']);
    expect(found).toStrictEqual({
      shared: 3,
      compared: 3,
      extraPages: 0,
      changedLines: 3,
      clippedPages: 0,
      pages: [
        { page: 1, changes: [{ kind: 'removed', text: 'Due 1 May' }, { kind: 'added', text: 'Due 8 May' }] },
        { page: 3, changes: [{ kind: 'added', text: 'appendix' }] },
      ],
    });
  });

  it('compares only the pages both have, and counts the rest by side', async () => {
    const { client, reads } = clientFor({ pages: [['a'], ['b']] }, { pages: [['a'], ['b'], ['c'], ['d']] });
    const found = await compareOpenDocuments({ client, track: UNTRACKED }, HERE, OTHER);
    expect(reads).toHaveLength(4);
    expect(found).toMatchObject({ shared: 2, compared: 2, extraPages: -2, changedLines: 0, pages: [] });
  });

  it('STOPS where a document’s version moves, and says how far it got', async () => {
    // The other document is read at version 1, then 2 on its second page read.
    const { client } = clientFor({ pages: [['a'], ['b'], ['c']] }, { pages: [['a'], ['B'], ['c']], versions: [1, 1, 2] });
    const found = await compareOpenDocuments({ client, track: UNTRACKED }, HERE, OTHER);
    expect(found).toMatchObject({ shared: 3, compared: 1, changedLines: 0 });
  });

  it('a refused read refuses the comparison rather than reporting a part', async () => {
    const { client } = clientFor({ pages: [['a'], ['b']] }, { pages: [['a'], ['b']], refusePage: 1 });
    expect(await compareOpenDocuments({ client, track: UNTRACKED }, HERE, OTHER)).toBe('refused');
  });

  it('counts a page whose text layer was cut short, since lines may be missing from it', async () => {
    const { client } = clientFor({ pages: [['a'], ['b']], truncatedPages: [1] }, { pages: [['a'], ['b']] });
    expect(await compareOpenDocuments({ client, track: UNTRACKED }, HERE, OTHER)).toMatchObject({ clippedPages: 1 });
  });

  it('bounds the LIST and not the count', async () => {
    const many = Array.from({ length: 700 }, (_unused, index) => `line ${String(index)}`);
    const { client } = clientFor({ pages: [many, many] }, { pages: [[], []] });
    const found = await compareOpenDocuments({ client, track: UNTRACKED }, HERE, OTHER);
    if (typeof found === 'string') throw new Error(`expected a comparison, got ${found}`);
    expect(found.changedLines).toBe(1400);
    expect(found.pages.reduce((sum, page) => sum + page.changes.length, 0)).toBe(MAX_COMPARE_CHANGES);
  });

  it('A CANCELLED WALK answers cancelled and stops reading', async () => {
    const { client, reads } = clientFor({ pages: [['a'], ['b'], ['c']] }, { pages: [['a'], ['b'], ['c']] });
    const controller = new AbortController();
    const track: TrackTask = () => ({
      signal: controller.signal,
      step: () => {
        controller.abort();
      },
      end: () => undefined,
    });
    expect(await compareOpenDocuments({ client, track }, HERE, OTHER)).toBe('cancelled');
    expect(reads).toStrictEqual(['here:0', 'other:0']);
  });
});

describe('the compare command', () => {
  function recordingAsk(answers: readonly unknown[]): { ask: (id: string, props: unknown) => Promise<unknown>; opened: { id: string; props: unknown }[] } {
    const queue = [...answers];
    const opened: { id: string; props: unknown }[] = [];
    return {
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve(queue.shift());
      },
      opened,
    };
  }

  it('offers the OTHER open documents, then shows what was found under the chosen one’s name', async () => {
    const { client } = clientFor({ pages: [['x']] }, { pages: [['y']] });
    const { ask, opened } = recordingAsk([{ other: OTHER }, undefined]);
    await compareDocumentsCommand({ client, ask, track: UNTRACKED }).run(contextWith([HERE, OTHER]));
    expect(opened[0]).toStrictEqual({
      id: COMPARE_DOCUMENTS_DIALOG_ID,
      props: { choices: [{ docId: OTHER, name: 'other.pdf' }] },
    });
    expect(opened[1]).toMatchObject({
      id: COMPARE_RESULT_DIALOG_ID,
      props: { kind: 'compared', otherName: 'other.pdf', changedLines: 2 },
    });
  });

  it('CONTROL: with no other document open it says so and reads nothing', async () => {
    const { client, reads } = clientFor({ pages: [['x']] }, { pages: [['y']] });
    const { ask, opened } = recordingAsk([]);
    await compareDocumentsCommand({ client, ask, track: UNTRACKED }).run(contextWith([HERE]));
    expect(opened).toStrictEqual([{ id: COMPARE_RESULT_DIALOG_ID, props: { kind: 'none' } }]);
    expect(reads).toStrictEqual([]);
  });

  it('dismissing the picker compares nothing', async () => {
    const { client, reads } = clientFor({ pages: [['x']] }, { pages: [['y']] });
    const { ask, opened } = recordingAsk([undefined]);
    await compareDocumentsCommand({ client, ask, track: UNTRACKED }).run(contextWith([HERE, OTHER]));
    expect(opened).toHaveLength(1);
    expect(reads).toStrictEqual([]);
  });

  it('sits in Review › Compare, and in Home › Display where the owner’s v5 design draws it', () => {
    const { client } = clientFor({ pages: [] }, { pages: [] });
    expect(compareDocumentsCommand({ client, ask: () => Promise.resolve(undefined), track: UNTRACKED }).placements).toStrictEqual([
      { surface: 'ribbon', section: 'review', group: GROUP_COMPARE, order: 10 },
      { surface: 'ribbon', section: 'home', group: GROUP_DISPLAY, order: 208 },
    ]);
  });
});

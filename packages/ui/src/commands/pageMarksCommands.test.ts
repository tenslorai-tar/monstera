import { type AnnotationStamp, type ContractClient, type PageMarksRead, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { CommandContext } from '../registries/commands.js';
import { editPageMarksCommand, removePageMarksCommand, type SignedEditing } from './documentCommands.js';

/**
 * The UI half of ADR-0246's wired pair: Edit and Remove of each kind of page stamp dispatch exactly the command the
 * read and the dialog decide. The kernel half is `pageMarks.test.ts`, which proves the replace and the remove on a real
 * document, saved and reopened.
 */

const DOC = asDocId('doc-1');

const CONTEXT: CommandContext = {
  selectedPages: [],
  docId: DOC,
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  // NOT THE FIRST PAGE, and NOT ONE THE STAMPS ARE ON: Edit draws on the read's pages, so a command that took the page
  // on show would send `[3]` where the read said `[[0, 1], 5]`.
  page: 3,
  pageCount: 10,
  openDocuments: [{ docId: DOC, version: asDocVersion(1), byteLength: 20, name: 'This one' }],
};

const FONTS = { listed: true, families: [], more: 0 } as const;

const stamp = (): AnnotationStamp => ({ author: 'A. Tester', created: '2026-10-15T09:00:00.000Z' });

const signatures: SignedEditing = {
  warn: () => true,
  onOpened: () => {
    throw new Error('a case opened a copy for an edit without asking for one');
  },
};

/** No stamp of any kind: every kind's pages `null`. */
const NONE = { pages: null, settings: null, others: 0, inline: 0 } as const;

/** The pages the stamps are on, a run and a single page, so a command that sent anything else is seen. */
const STAMPED: readonly (number | [number, number])[] = [[0, 1], 5];

/** A watermark Monstera recorded, every field off its default, so a window filled from defaults is told apart. */
const RECORDED_WATERMARK = {
  text: 'CONFIDENTIAL',
  opacity: 0.45,
  rotationDegrees: 30,
  fontSize: 60,
  family: 'Courier',
  colour: [0.8, 0.1, 0.1],
};

function marksWith(overrides: Partial<PageMarksRead>): PageMarksRead {
  return { watermark: NONE, headerFooter: NONE, bates: NONE, older: 0, ...overrides };
}

/** A client answering the marks read with `marks`, the font read with {@link FONTS}, and every command applied. */
function recording(marks: PageMarksRead): { readonly client: ContractClient; readonly sent: { id: string; params: unknown }[] } {
  const sent: { id: string; params: unknown }[] = [];
  const client = createClient(channels, (id, params) => {
    sent.push({ id, params });
    if (id === 'document.pageMarks') return Promise.resolve(ok({ version: asDocVersion(1), marks }));
    if (id === 'app.fontFamilies') return Promise.resolve(ok(FONTS));
    return Promise.resolve(ok({ version: asDocVersion(2), byteLength: 2048, historyDropped: 0, boxed: [], more: 0, unsealedCopies: [] }));
  });
  return { client, sent };
}

describe('Edit and Remove of a page stamp (ADR-0246)', () => {
  it('EDIT opens the watermark window FILLED with the recorded settings, and sends the answer with the read’s pages and replace', async () => {
    const { client, sent } = recording(
      marksWith({ watermark: { pages: [...STAMPED], settings: JSON.stringify(RECORDED_WATERMARK), others: 0, inline: 0 } }),
    );
    const asked: { id: string; props: unknown }[] = [];
    await editPageMarksCommand('watermark')({
      client,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: (id, props) => {
        asked.push({ id, props });
        // THE ANSWER CARRIES A SCOPE OF ITS OWN, and Edit must not take it: the read's pages are the edit's.
        return Promise.resolve({ ...RECORDED_WATERMARK, text: 'DRAFT', colour: [0, 0, 1], pages: [3] });
      },
    }).run(CONTEXT);

    expect(asked).toStrictEqual([
      { id: 'dialog.watermark-pages', props: { pages: [3], fonts: FONTS, editing: RECORDED_WATERMARK } },
    ]);
    expect(sent.map(({ id }) => id)).toStrictEqual(['document.pageMarks', 'app.fontFamilies', 'document.execute']);
    expect(sent[2]?.params).toStrictEqual({
      docId: DOC,
      command: {
        kind: 'watermarkPages',
        text: 'DRAFT',
        opacity: 0.45,
        rotationDegrees: 30,
        fontSize: 60,
        family: 'Courier',
        colour: [0, 0, 1],
        pages: [[0, 1], 5],
        replace: true,
      },
    });
  });

  it('EDIT of headers and footers and of Bates numbers sends its own add command, with replace', async () => {
    const headerFooter = {
      header: { left: '', centre: 'Draft', right: '' },
      footer: { left: '', centre: 'Page {n}', right: '' },
      family: 'Times',
      fontSize: 11,
      marginPoints: 40,
    };
    const bates = {
      prefix: 'ABC',
      suffix: '',
      start: 431,
      digits: 6,
      edge: 'footer',
      slot: 'right',
      family: 'Helvetica',
      fontSize: 8,
      marginPoints: 30,
    };
    for (const [kind, settings, commandKind] of [
      ['headerFooter', headerFooter, 'headerFooterPages'],
      ['bates', bates, 'batesNumberPages'],
    ] as const) {
      const { client, sent } = recording(
        marksWith({ [kind]: { pages: [...STAMPED], settings: JSON.stringify(settings), others: 0, inline: 0 } }),
      );
      const opened: unknown[] = [];
      await editPageMarksCommand(kind)({
        client,
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: (_id, props) => {
          opened.push(props);
          return Promise.resolve({ ...settings, pages: 'all' });
        },
      }).run(CONTEXT);
      expect(opened).toStrictEqual([{ pages: [3], fonts: FONTS, editing: settings }]);
      expect(sent.at(-1)?.params).toStrictEqual({
        docId: DOC,
        command: { kind: commandKind, ...settings, pages: [[0, 1], 5], replace: true },
      });
    }
  });

  it('EDIT of a stamp whose record is unreadable opens the window on its defaults and still replaces on the read’s pages', async () => {
    // ANOTHER TOOL'S watermark carries no record, and a forged one may carry anything: neither is a fault.
    for (const settings of [null, '{not json', JSON.stringify({ text: '' })]) {
      const { client } = recording(marksWith({ watermark: { pages: [5], settings, others: 1, inline: 0 } }));
      const opened: unknown[] = [];
      await editPageMarksCommand('watermark')({
        client,
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: (_id, props) => {
          opened.push(props);
          return Promise.resolve(undefined);
        },
      }).run(CONTEXT);
      expect(opened).toStrictEqual([{ pages: [3], fonts: FONTS }]);
    }
  });

  it('REMOVE sends removePageMarks naming the kind, and nothing else', async () => {
    for (const kind of ['watermark', 'headerFooter', 'bates'] as const) {
      const { client, sent } = recording(marksWith({ [kind]: { pages: [...STAMPED], settings: null, others: 0, inline: 0 } }));
      const asked: unknown[] = [];
      await removePageMarksCommand(kind)({
        client,
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: (id) => {
          asked.push(id);
          return Promise.resolve(undefined);
        },
      }).run(CONTEXT);
      expect(sent.map(({ id }) => id)).toStrictEqual(['document.pageMarks', 'document.execute']);
      expect(sent[1]?.params).toStrictEqual({ docId: DOC, command: { kind: 'removePageMarks', marks: kind } });
      // NOTHING LEFT TO SAY, so nothing is said.
      expect(asked).toStrictEqual([]);
    }
  });

  it('a document with NONE of the kind sends no command and says so; what was left is said after a removal', async () => {
    // CONTROL: a document whose only marks are of ANOTHER kind. A command that removed whatever it found would send.
    const { client, sent } = recording(
      marksWith({ bates: { pages: [0], settings: null, others: 0, inline: 0 }, older: 2 }),
    );
    const told: { id: string; props: unknown }[] = [];
    const deps = {
      client,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: (id: string, props: unknown) => {
        told.push({ id, props });
        return Promise.resolve(undefined);
      },
    };
    await removePageMarksCommand('watermark')(deps).run(CONTEXT);
    await editPageMarksCommand('watermark')(deps).run(CONTEXT);
    expect(sent.map(({ id }) => id)).toStrictEqual(['document.pageMarks', 'document.pageMarks']);
    const none = { id: 'dialog.page-marks-notice', props: { kind: 'watermark', none: true, older: 2, inline: 0 } };
    expect(told).toStrictEqual([none, none]);

    // AND AFTER A REMOVAL THAT LEFT ANOTHER PROGRAM'S INLINE MARK, the notice says that and not *none*.
    const left = recording(marksWith({ watermark: { pages: [1], settings: null, others: 0, inline: 3 } }));
    const said: unknown[] = [];
    await removePageMarksCommand('watermark')({
      ...deps,
      client: left.client,
      ask: (_id, props) => {
        said.push(props);
        return Promise.resolve(undefined);
      },
    }).run(CONTEXT);
    expect(left.sent.map(({ id }) => id)).toStrictEqual(['document.pageMarks', 'document.execute']);
    expect(said).toStrictEqual([{ kind: 'watermark', none: false, older: 0, inline: 3 }]);
  });

  it('all six sit in Organize › Marks under one Edit marks menu, Edit before Remove for each kind', () => {
    const { client } = recording(marksWith({}));
    const deps = { client, stamp, signatures, onApplied: () => undefined, ask: () => Promise.resolve(undefined) };
    const placed = (['watermark', 'headerFooter', 'bates'] as const)
      .flatMap((kind) => [editPageMarksCommand(kind)(deps), removePageMarksCommand(kind)(deps)])
      .map((command) => {
        const [placement] = command.placements;
        return placement?.surface === 'ribbon' ? [command.id, placement.section, placement.order] : [command.id];
      });
    expect(placed).toStrictEqual([
      ['document.edit-watermark', 'organize', 70],
      ['document.remove-watermark', 'organize', 71],
      ['document.edit-header-footer', 'organize', 80],
      ['document.remove-header-footer', 'organize', 81],
      ['document.edit-bates', 'organize', 90],
      ['document.remove-bates', 'organize', 91],
    ]);
  });
});

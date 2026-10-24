import { createHash } from 'node:crypto';

import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import type { CommandKind, CommandOfKind } from '@monstera/contract';
import { blockEditOf } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';
import { beforeAll, describe, expect, it } from 'vitest';

import { declaredCommands, pagesChangedBy } from './commandDeclarations.js';
import { runsOfContent } from './contentRunsFixture.js';
import type { MupdfSession } from './engineSeam.js';
import { localMupdfExecution } from './mupdfSpecs.js';
import { ColorSpace, Matrix } from './mupdfRaw.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { pageContentStreams } from './pageContent.js';
import { joinedContent } from './textOperators.js';

/**
 * The per-kind drawing check ([ADR-0262](../../../docs/DECISIONS/0262-a-command-declares-the-pages-it-changes.md)
 * Decision 3): each command kind that declares fewer than all pages is run by its own writer on a fixture, every page
 * is drawn before and after, and a page that changed outside the declaration is a red case. A declaration that names
 * too few pages leaves an old page on screen, so a kind no case here covers must declare `'all'` — the table rule below.
 */

/** Three Letter pages, each with its own words; page 1 carries a text field. */
let fixture: Uint8Array;

beforeAll(async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let at = 0; at < 3; at += 1) {
    const page = document.addPage([612, 792]);
    page.drawText(`Page ${String(at + 1)}: the quick brown fox jumps over the lazy dog.`, { x: 72, y: 700, size: 14, font });
  }
  // A SHAPE ON PAGE 1, which Edit object's drawn command moves (ADR-0264).
  document.getPage(1).drawRectangle({ x: 72, y: 600, width: 100, height: 50, color: rgb(0.2, 0.4, 0.8) });
  const field = document.getForm().createTextField('Name');
  field.addToPage(document.getPage(1), { x: 72, y: 500, width: 240, height: 24 });
  fixture = await document.save({ useObjectStreams: false });
});

/** Each page's drawing, as a digest of MuPDF's own raster of it with its annotations, and its size. */
async function drawings(bytes: Uint8Array): Promise<readonly string[]> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) =>
      Array.from({ length: document.countPages() }, (_unused, at) => {
        const pixmap = document.loadPage(at).toPixmap(Matrix.identity, ColorSpace.DeviceRGB, false, true);
        const drawn = `${String(pixmap.getWidth())}x${String(pixmap.getHeight())}:${createHash('sha256').update(pixmap.getPixels()).digest('hex')}`;
        pixmap.destroy();
        return drawn;
      }),
    );
  } finally {
    await mupdfWriter.close(session);
  }
}

/** `prepare` run on the fixture first (a mark to remove), then `command`, each by the MuPDF writer; both images back. */
async function beforeAndAfter(
  command: CommandOfKind<CommandKind>,
  prepare?: CommandOfKind<CommandKind>,
): Promise<{ readonly before: readonly string[]; readonly after: readonly string[] }> {
  const run = async (bytes: Uint8Array, each: CommandOfKind<CommandKind>): Promise<Uint8Array> => {
    const session: MupdfSession = await mupdfWriter.open(bytes);
    try {
      // A KIND THAT DECLARES THE PAGE-RUNS PRE-READ is handed the fixture page's runs, as the host hands PDFium's.
      const reads =
        declaredCommands[each.kind].reads === 'pageRuns' && 'page' in each
          ? await withDocument(session, (document) => runsOfContent(joinedContent(pageContentStreams(document.findPage(each.page)))))
          : undefined;
      await localMupdfExecution.apply({ session, command: each as never, sources: [], reads });
      return await mupdfWriter.serialise(session);
    } finally {
      await mupdfWriter.close(session);
    }
  };
  const start = prepare === undefined ? fixture : await run(fixture, prepare);
  return { before: await drawings(start), after: await drawings(await run(start, command)) };
}

/**
 * The pages whose drawing changed and which `declared` does not name — or `['count']` where the page count changed,
 * which only `'all'` may do. Empty is the declaration held.
 */
function undeclared(before: readonly string[], after: readonly string[], declared: 'all' | readonly number[]): readonly (number | 'count')[] {
  if (declared === 'all') return [];
  if (before.length !== after.length) return ['count'];
  return before.flatMap((drawn, page) => (drawn !== after[page] && !declared.includes(page) ? [page] : []));
}

const VERSION = asDocVersion(1);

/** A mark on page 1, drawn: what `addAnnotation` adds and `removeAnnotation` takes off. */
const MARK: CommandOfKind<'addAnnotation'> = {
  kind: 'addAnnotation',
  page: 1,
  annotation: { type: 'square', rect: { x0: 100, y0: 300, x1: 300, y1: 400 }, colour: [1, 0, 0], opacity: 1, borderWidth: 2 },
  stamp: { author: 'A. Tester', created: '2026-10-23T04:00:00.000Z' },
};

/**
 * One case per kind that declares fewer than all pages: its command, on page 1 of three, and what must be done first.
 * Each changes what page 1 draws, except where the kind declares `'none'`, so a case cannot pass by changing nothing —
 * {@link it}'s second assertion holds that.
 */
const CHECKED: Readonly<Record<string, { readonly command: CommandOfKind<CommandKind>; readonly prepare?: CommandOfKind<CommandKind> }>> = {
  rotatePages: { command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 } },
  cropPages: { command: { kind: 'cropPages', pages: [1], margins: { top: 40, right: 40, bottom: 40, left: 40 } } },
  // NOT fillFormField: one value is drawn by every widget of its field, on any page, and a calculated field elsewhere is
  // filled with it (`formCalculation.ts`), so its page alone would name too few. It declares all.
  addAnnotation: { command: MARK },
  removeAnnotation: { command: { kind: 'removeAnnotation', page: 1, indices: [0], version: VERSION }, prepare: MARK },
  setPageTransition: { command: { kind: 'setPageTransition', pages: [1], style: 'blinds', durationSeconds: 2 } },
  // THE SHAPE ON PAGE 1 moved where it is drawn (ADR-0264): one page's content is spliced, and no other page's.
  editDrawnObject: {
    command: {
      kind: 'editDrawnObject',
      page: 1,
      index: 1,
      object: 'path',
      ordinal: 0,
      box: { left: 72, bottom: 600, right: 172, top: 650 },
      edit: { op: 'place', moveBy: { x: 20, y: -30 }, scaleBy: { x: 1, y: 1 } },
      version: VERSION,
    },
  },
  // PAGE 1'S LINE MOVED by the operator writer (Edit object's text block, ADR-0264 Decision 5): the page gets a new content
  // stream of its own, and a font or a graphics state it adds is a name no other page draws.
  editTextOperators: {
    command: {
      kind: 'editTextOperators',
      page: 1,
      ...blockEditOf([{ lines: [[0]], soft: [false], text: 'Page 2: the quick brown fox jumps over the lazy dog.', place: { move: { x: 20, y: -30 } } }]),
      fit: 'reflow',
      version: VERSION,
    },
  },
};

describe('the pages a command declares it changes (ADR-0262)', () => {
  it('every kind that declares fewer than all pages has a drawing case here, and no case names a kind declared all', () => {
    const narrow = (Object.keys(declaredCommands) as CommandKind[]).filter((kind) => declaredCommands[kind].pages !== 'all').sort();
    expect(narrow).toStrictEqual(Object.keys(CHECKED).sort());
  });

  for (const [kind, { command, prepare }] of Object.entries(CHECKED)) {
    it(`${kind}: every page that changed is one it declares, and it changes what it declares`, async () => {
      const declared = pagesChangedBy(command);
      const { before, after } = await beforeAndAfter(command, prepare);
      expect(undeclared(before, after, declared)).toStrictEqual([]);
      // NOT VACUOUS: a case whose command changed nothing would hold any declaration. A kind declaring none must change
      // no page; any other must change every page it names.
      const changed = before.flatMap((drawn, page) => (drawn !== after[page] ? [page] : []));
      expect(changed).toStrictEqual(declared === 'all' ? changed : [...declared]);
    });
  }

  it('CONTROL: a declaration naming the wrong page is reported, from the same drawings', async () => {
    const { before, after } = await beforeAndAfter({ kind: 'rotatePages', pages: [1], quarterTurns: 1 });
    expect(undeclared(before, after, [0])).toStrictEqual([1]);
    expect(undeclared(before, after, [])).toStrictEqual([1]);
    // AND A COMMAND THAT ADDS A PAGE, which only all may declare.
    const grown = await beforeAndAfter({ kind: 'insertBlankPage', at: 1 });
    expect(undeclared(grown.before, grown.after, [1])).toStrictEqual(['count']);
  });
});

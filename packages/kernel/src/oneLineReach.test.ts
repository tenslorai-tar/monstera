import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { blockEditOf, type CommandOfKind } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bundledFontsFolder, readCatalogueOnce } from './bundledFontsForTests.js';
import { bindEditFaces, bindEditFolders } from './editFaces.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { applyEditTextOperators } from './textOperatorEdit.js';

/**
 * A block of one line grows right as words are added, to its reach, and only then wraps (the owner's test of milestone 1:
 * a tight box wrapped on its first added letter). The editor lays the line out to `oneLineReach` and sends it as the
 * place's `reach`; the writer wraps there, so the lines written are the lines the person saw.
 */

const WORDS = 'Short';
const TYPED = 'Short heading that grows';

async function tightPage(): Promise<{ bytes: Uint8Array; right: number }> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([612, 792]).drawText(WORDS, { x: 72, y: 700, size: 20, font });
  return { bytes: await document.save(), right: 72 + font.widthOfTextAtSize(WORDS, 20) };
}

/**
 * The lines MuPDF reads the page's words on, after the edit is SAVED and the saved file OPENED again. `placed` is what
 * else the place carries: a move or a scale, which the reach the editor sends is worked out for (`placedReach`).
 */
async function linesAfter(reach: number | undefined, placed: { move?: { x: number; y: number }; scale?: number } = {}): Promise<number> {
  const { bytes, right } = await tightPage();
  const read = { textObjects: [0], runs: [{ index: 0, members: [0], text: WORDS, left: 72, right, bottom: 695, top: 715 }] };
  const place = { ...placed, ...(reach === undefined ? {} : { reach }) };
  const command: CommandOfKind<'editTextOperators'> = {
    kind: 'editTextOperators',
    page: 0,
    ...blockEditOf([{ lines: [[0]], soft: [false], text: TYPED, ...(Object.keys(place).length === 0 ? {} : { place }) }]),
    fit: 'reflow',
    version: asDocVersion(1),
  };
  const session = await mupdfWriter.open(bytes);
  let saved: Awaited<ReturnType<typeof mupdfWriter.serialise>>;
  try {
    await applyEditTextOperators(session, command, read);
    saved = await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
  const reopened = await mupdfWriter.open(saved);
  try {
    return await withDocument(reopened, (document) => {
      const json = JSON.parse(document.loadPage(0).toStructuredText().asJSON()) as { blocks: { lines?: { text?: string; y?: number }[] }[] };
      return json.blocks.flatMap((block) => block.lines ?? []).filter((line) => (line.text ?? '').trim() !== '').length;
    });
  } finally {
    await mupdfWriter.close(reopened);
  }
}

describe('a block of one line and its reach', () => {
  beforeEach(() => {
    bindEditFolders(bundledFontsFolder(), null, readCatalogueOnce);
  });
  afterEach(() => {
    bindEditFaces(null);
  });

  it('grows right on one line to its reach, rather than wrapping at its own old end', async () => {
    expect(await linesAfter(540)).toBe(1);
  });

  it('CONTROL: with no reach, the same words wrap at the block’s own right edge, the line breaks the owner saw', async () => {
    expect(await linesAfter(undefined)).toBeGreaterThan(1);
  });

  it('a MOVED box typed in is one line, saved and opened again, at the reach the editor sends for where it now stands', async () => {
    // MOVED 100 RIGHT: alone on the page its column is 612 - 172 = 440, in its own frame 72 + 268 = 340 (`placedReach`).
    expect(await linesAfter(340, { move: { x: 100, y: 0 } })).toBe(1);
    // CONTROL: the same move with no reach wraps at the block's own old end, so the one line above is the reach's.
    expect(await linesAfter(undefined, { move: { x: 100, y: 0 } })).toBeGreaterThan(1);
  });

  it('a SCALED box typed in is one line, saved and opened again, at its reach taken back through the scale', async () => {
    // HALF AS LARGE AGAIN about its top left: its column is 540, in its own unscaled frame 72 + 468 / 1.5 = 384.
    expect(await linesAfter(384, { scale: 1.5 })).toBe(1);
    expect(await linesAfter(undefined, { scale: 1.5 })).toBeGreaterThan(1);
  });
});

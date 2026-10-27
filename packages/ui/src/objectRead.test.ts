import { channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { readPageObjects } from './objectRead.js';
import type { TextBlock } from './textBlock.js';

/**
 * Edit object's read of one page
 * ([ADR-0264](../../../docs/DECISIONS/0264-edit-object-returns-and-an-edit-changes-only-the-bytes-of-the-object-it-names.md)
 * Decision 9): the content walk, the text blocks read as the page is, and the pictures placed on it, at one version.
 */

const DOC = asDocId('00000000-0000-4000-8000-000000000001');
const PLAIN = { size: 11, colour: { r: 10, g: 20, b: 30 }, serif: false, mono: false, italic: false, bold: false };
const BLOCK: TextBlock = {
  box: { x0: 72, y0: 660, x1: 300, y1: 711 },
  lines: [
    { runs: [{ index: 3, text: 'Garden ', style: PLAIN }, { index: 1, text: 'party', style: PLAIN }], box: { x0: 72, y0: 700, x1: 300, y1: 711 }, soft: false, baseline: 703 },
  ],
  style: PLAIN,
  shape: { align: 'left', firstIndent: 0 },
};
const object = (index: number, kind: 'text' | 'path' | 'image' | 'form' | 'unknown', extra: Record<string, unknown> = {}) => ({
  index,
  kind,
  left: index,
  bottom: 0,
  right: index + 10,
  top: 10,
  fill: null,
  ...extra,
});
const mark = (page: number, index: number) => ({
  page,
  index,
  rect: { x0: 10, y0: 20, x1: 110, y1: 90 },
  inReplyTo: null,
  kind: 'stamp' as const,
  style: { colour: [], opacity: 1, borderWidth: null },
  contents: '',
  authored: true,
  author: '',
  created: null,
  blend: 'normal' as const,
  pictured: true as const,
});
const BLOCKS_PART = { next: null, truncated: false, unaddressable: 0, rewrite: 'operators' as const };

function client(versions: { objects: number; marks: number; blocks: number }, asked: Record<string, unknown>[] = [], refused?: string) {
  return createClient(channels, (id, params) => {
    asked.push({ id, ...(params as object) });
    if (id === refused) return Promise.resolve(err({ code: 'engine-unavailable' as const }));
    if (id === 'document.pageObjects') {
      return Promise.resolve(
        ok({
          version: asDocVersion(versions.objects),
          next: null,
          truncated: false,
          objects: [
            object(0, 'path', { fill: { red: 1, green: 2, blue: 3, alpha: 255 } }),
            object(1, 'text'),
            object(2, 'image', { shown: { left: 3, bottom: 1, right: 9, top: 9 } }),
            object(3, 'text'),
            object(4, 'path'),
            object(5, 'unknown'),
          ],
        }),
      );
    }
    if (id === 'document.annotations') {
      return Promise.resolve(ok({ version: asDocVersion(versions.marks), annotations: [mark(4, 0), mark(2, 1)], next: null, truncated: false }));
    }
    if (id === 'document.textBlocks') return Promise.resolve(ok({ version: asDocVersion(versions.blocks), blocks: [BLOCK], ...BLOCKS_PART }));
    throw new Error(`no answer for ${id}`);
  });
}

describe('readPageObjects', () => {
  it('names each drawn object by its kind and its place among its kind, a block by its runs, a picture by its mark', async () => {
    const asked: Record<string, unknown>[] = [];
    const read = await readPageObjects(client({ objects: 4, marks: 4, blocks: 4 }, asked), DOC, 2, true);
    if (!read.ok) throw new Error('refused');
    // THE BLOCKS AS THE PAGE IS, never unpacked: the operator writer names the page as it is.
    expect(asked.find((each) => each['id'] === 'document.textBlocks')).toMatchObject({ page: 2, asItIs: true });
    expect(read.objects.objects.map((each) => [each.source, each.kind, each.index, each.source === 'drawn' ? each.ordinal : null])).toStrictEqual([
      ['drawn', 'path', 0, 0],
      // THE BLOCK STANDS WHERE ITS FIRST RUN IS DRAWN, whatever order its runs are read in.
      ['text', 'text', 1, null],
      ['drawn', 'image', 2, 0],
      ['drawn', 'path', 4, 1],
      // THE PICTURE PLACED ON THIS PAGE, over the content; CONTROL: the one on page 4 is not here.
      ['stamp', 'picture', 1, null],
    ]);
    const [shape, block, picture] = read.objects.objects;
    expect(shape?.source === 'drawn' ? shape.fill : undefined).toStrictEqual({ r: 1, g: 2, b: 3 });
    expect(block?.source === 'text' ? [block.indices, block.block, block.fill] : undefined).toStrictEqual([
      [1, 3],
      { lines: [[3, 1]], soft: [false], text: 'Garden party' },
      { r: 10, g: 20, b: 30 },
    ]);
    // WHAT SHOWS is the box, the engine's own is what the command names it by.
    expect(picture?.source === 'drawn' ? [picture.box, picture.drawn] : undefined).toStrictEqual([
      { x0: 3, y0: 1, x1: 9, y1: 9 },
      { x0: 2, y0: 0, x1: 12, y1: 10 },
    ]);
    // THE LISTING an arrange finds its neighbour in: every object, by what shows of it.
    expect(read.objects.listed.map((each) => each.index)).toStrictEqual([0, 1, 2, 3, 4, 5]);
    expect(read.objects.listed[2]?.box).toStrictEqual({ left: 3, bottom: 1, right: 9, top: 9 });
  });

  it('does not read the blocks for a filter that outlines no text', async () => {
    const asked: Record<string, unknown>[] = [];
    const read = await readPageObjects(client({ objects: 4, marks: 4, blocks: 4 }, asked), DOC, 2, false);
    expect(asked.map((each) => each['id']).sort()).toStrictEqual(['document.annotations', 'document.pageObjects']);
    expect(read.ok && read.objects.objects.some((each) => each.source === 'text')).toBe(false);
  });

  it('answers NO PAGE where the reads answered at different versions, and is not a refusal', async () => {
    expect(await readPageObjects(client({ objects: 4, marks: 5, blocks: 4 }), DOC, 2, true)).toStrictEqual({ ok: false, refused: undefined });
    expect(await readPageObjects(client({ objects: 4, marks: 4, blocks: 5 }), DOC, 2, true)).toStrictEqual({ ok: false, refused: undefined });
  });

  it('a refused content read is the mode’s refusal; a refused block read leaves the pictures and shapes', async () => {
    const refusing = (id: string) => client({ objects: 4, marks: 4, blocks: 4 }, [], id);
    expect(await readPageObjects(refusing('document.pageObjects'), DOC, 2, true)).toStrictEqual({ ok: false, refused: { code: 'engine-unavailable' } });
    const without = await readPageObjects(refusing('document.textBlocks'), DOC, 2, true);
    expect(without.ok ? without.objects.objects.map((each) => each.source) : undefined).toStrictEqual(['drawn', 'drawn', 'drawn', 'stamp']);
  });
});

import { crc32, deflateSync } from 'node:zlib';

import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { CommandOfKind } from '@monstera/contract';

import { applyInsertImagePage, captureInsertImagePage } from './pageImage.js';

/**
 * A page made from an image, read back through a **different parser** than the
 * one that wrote it.
 *
 * ## The fixture is GENERATED, not pasted
 *
 * B10 forbids an unvetted fixture, and a base64 PNG copied from somewhere is
 * exactly that: bytes nobody in this repository can account for, in a public
 * tree. {@link pngOf} builds one from its own dimensions using Node's own
 * `deflateSync` and `crc32`, so every byte is derived here and a case can ask
 * for any size it needs — which is what the page-size assertions turn on.
 *
 * ## What separates a real insert from a plausible one
 *
 * Three things, and each has a case because each fails silently on its own: the
 * page **count** goes up, the new page is at the **index the command named**,
 * and the page is the **image's size** rather than the document's. An
 * implementation that appended a correctly-sized page satisfies the first and
 * third; one that inserted a blank page of the right size satisfies all but the
 * XObject case.
 */

/** A solid-colour truecolour PNG of the given size, built byte by byte. */
function pngOf(width: number, height: number): Uint8Array {
  const chunk = (type: string, body: Uint8Array): Uint8Array => {
    // `charCodeAt` per index rather than spreading the string: a chunk type is
    // four ASCII bytes by PNG's own definition, and spreading yields code
    // points, which is the wrong unit for a byte array even where the two agree.
    const name = new Uint8Array(type.length);
    for (let at = 0; at < type.length; at += 1) name[at] = type.charCodeAt(at);
    const out = new Uint8Array(12 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    out.set(name, 4);
    out.set(body, 8);
    // THE CRC COVERS TYPE AND BODY, not the length — PNG's own rule, and
    // getting it wrong produces a file every decoder refuses, which would make
    // every case here report `unreadable` for a reason nothing names.
    const covered = new Uint8Array(4 + body.length);
    covered.set(name, 0);
    covered.set(body, 4);
    view.setUint32(8 + body.length, crc32(Buffer.from(covered)));
    return out;
  };

  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour, so three bytes a pixel and no palette to build
  // compression, filter and interlace are all 0, which the array already is.

  // Each scanline carries a leading FILTER BYTE of 0 — "none". A raster with
  // the filter bytes omitted decodes as an image one byte narrower per row and
  // progressively skewed, which renders and is wrong.
  const raster = new Uint8Array(height * (1 + width * 3));
  for (let row = 0; row < height; row += 1) {
    const start = row * (1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      raster[start + 1 + x * 3] = 0xc0;
      raster[start + 2 + x * 3] = 0x30;
      raster[start + 3 + x * 3] = 0x30;
    }
  }

  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(Buffer.from(raster)))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

/** Three pages of a known, deliberately non-square size. */
const PAGE_WIDTH = 200;
const PAGE_HEIGHT = 300;
const PAGE_COUNT = 3;

async function threePages(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < PAGE_COUNT; index += 1) {
    document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  }
  return document.save();
}

/** The image size every case uses — different from the page size on both axes. */
const IMAGE_WIDTH = 64;
const IMAGE_HEIGHT = 40;

function command(at: number): CommandOfKind<'insertImagePage'> {
  return {
    kind: 'insertImagePage',
    at,
    bytes: pngOf(IMAGE_WIDTH, IMAGE_HEIGHT),
    mediaType: 'image/png',
  };
}

/** Every page's size, as pdf-lib reads them back. */
async function sizesOf(bytes: Uint8Array): Promise<{ width: number; height: number }[]> {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => page.getSize());
}

/** Whether a page carries at least one image XObject. */
async function hasImage(bytes: Uint8Array, page: number): Promise<boolean> {
  const document = await PDFDocument.load(bytes);
  const node = document.getPages()[page]?.node;
  if (node === undefined) throw new Error(`the document has no page ${String(page)}`);
  const resources = node.Resources();
  const xobjects = resources?.get(PDFName.of('XObject'));
  if (xobjects === undefined) return false;
  const dictionary = document.context.lookup(xobjects);
  if (dictionary === undefined || !('entries' in dictionary)) return false;
  return (dictionary as { entries: () => unknown[] }).entries().length > 0;
}

describe('insertImagePage', () => {
  it('INSERTS AT THE INDEX THE COMMAND NAMED, rather than appending', async () => {
    // THE CASE THE MODULE EXISTS FOR, and the one an `addPage` implementation
    // fails. Appending produces a document with the same page count and the
    // same new page, and every size assertion below still passes — only WHERE
    // it landed separates them, so the index chosen is a middle one.
    const after = await applyInsertImagePage(await threePages(), command(1));
    const sizes = await sizesOf(after);

    expect(sizes).toHaveLength(PAGE_COUNT + 1);
    expect(sizes[1]).toStrictEqual({ width: IMAGE_WIDTH, height: IMAGE_HEIGHT });
    // AND THE ORIGINAL PAGES ARE STILL THEIR OWN SIZE, on both sides of it.
    expect(sizes[0]).toStrictEqual({ width: PAGE_WIDTH, height: PAGE_HEIGHT });
    expect(sizes[2]).toStrictEqual({ width: PAGE_WIDTH, height: PAGE_HEIGHT });
  });

  it('CARRIES THE IMAGE, not just a page of the right size', async () => {
    // The separating case for *inserted a blank page and called it done*: a
    // blank page of the image's dimensions satisfies every size assertion
    // above, and only the XObject says a picture is on it.
    const after = await applyInsertImagePage(await threePages(), command(0));

    expect(await hasImage(after, 0)).toBe(true);
    // CONTROL: a page this command did not touch carries none, so the check
    // above is not one that answers `true` for any page.
    expect(await hasImage(after, 1)).toBe(false);
  });

  it('takes the IMAGE’s size and not the document’s', async () => {
    // A page sized to its neighbours would letterbox or crop the scan, and both
    // are decisions this command has no basis for. The fixture's page and image
    // differ on both axes so neither can pass by coincidence.
    const after = await applyInsertImagePage(await threePages(), command(3));
    const sizes = await sizesOf(after);

    expect(sizes[3]).toStrictEqual({ width: IMAGE_WIDTH, height: IMAGE_HEIGHT });
  });

  it('CLAMPS an index past the end rather than refusing it', async () => {
    // `at` is *where the new page goes*, and the one value past the end a
    // renderer can name is the position after the last page — a real request.
    // Refusing it would make *insert at the end* an error on a document whose
    // length the renderer knows only from a version it may already have lost.
    const after = await applyInsertImagePage(await threePages(), command(99));
    const sizes = await sizesOf(after);

    expect(sizes).toHaveLength(PAGE_COUNT + 1);
    expect(sizes[PAGE_COUNT]).toStrictEqual({ width: IMAGE_WIDTH, height: IMAGE_HEIGHT });
  });

  it('REFUSES bytes that are not the image they claim to be', async () => {
    // The decoder is the validation, which is why the picker's extension filter
    // is only a hint. A `.png` a user renamed reaches here and pdf-lib throws;
    // `documentCommands.ts` turns that into the `unreadable` outcome.
    const notAnImage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    await expect(
      applyInsertImagePage(await threePages(), {
        kind: 'insertImagePage',
        at: 0,
        bytes: notAnImage,
        mediaType: 'image/png',
      }),
    ).rejects.toThrow();
  });

  it('CAPTURE REFUSES, always, and says why', async () => {
    // ADR-0009's 2026-08-19 decision: not invertible is an outcome the bus
    // answers with a checkpoint, not a throw. The reason is asserted because it
    // travels into the log entry, and a checkpoint whose reason is empty is one
    // nobody can audit.
    const captured = await captureInsertInvertible();

    expect(captured.captured).toBe(false);
    if (captured.captured) throw new Error('an insert reported recordable prior state');
    expect(captured.reason).toContain('no recordable prior state');
  });
});

/** Named so the assertion above reads as what it is rather than as a call. */
function captureInsertInvertible(): ReturnType<typeof captureInsertImagePage> {
  return captureInsertImagePage();
}

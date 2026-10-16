import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import * as mupdf from './mupdfRaw.js';
import { applySetPageBackground } from './pageBackground.js';
import { appendRevision, openForWriting, wholeFile } from './pdfLibSession.js';

/**
 * A pdf-lib command writes its result as an APPENDED revision (ADR-0127): the input, byte for byte, then one update.
 * The command suites assert what each command draws, and every one of them would pass against a whole rewrite as well —
 * so this is the case that separates the two routes, read back by MuPDF rather than by the library that wrote it.
 */

async function document(pages: number): Promise<Uint8Array> {
  const created = await PDFDocument.create();
  const font = await created.embedFont(StandardFonts.Helvetica);
  for (let at = 0; at < pages; at += 1) created.addPage([612, 792]).drawText(`Page ${String(at + 1)}`, { x: 72, y: 700, font });
  return created.save();
}

/**
 * A document loaded WHOLE, the route no command takes since the signer moved to the appended one (ADR-0149): the
 * controls below need a load that is not for an incremental update, and pinning the flag is what the load rule asks.
 */
function loadedWhole(image: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(image, { updateMetadata: false });
}

/** MuPDF's reading: versions, and whether it had to repair. */
function readBack(image: Uint8Array): { readonly versions: number; readonly repaired: boolean; readonly pages: number } {
  const opened = mupdf.PDFDocument.openDocument(image, 'application/pdf');
  if (!(opened instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
  try {
    return { versions: opened.countVersions(), repaired: opened.wasRepaired(), pages: opened.countPages() };
  } finally {
    opened.destroy();
  }
}

const startsWith = (whole: Uint8Array, prefix: Uint8Array): boolean =>
  whole.byteLength > prefix.byteLength && prefix.every((byte, at) => whole[at] === byte);

describe('a pdf-lib command appends its revision (ADR-0127)', () => {
  it('the page background’s result is its input, byte for byte, with ONE revision appended that MuPDF reads unrepaired', async () => {
    // THE PAGE BACKGROUND, a pdf-lib command: the watermark this case used moved to the MuPDF writer (ADR-0235).
    const input = await document(3);
    const stamped = await applySetPageBackground(input, { kind: 'setPageBackground', pages: 'all', red: 1, green: 1, blue: 0.9 });

    expect(startsWith(stamped, input)).toBe(true);
    expect(readBack(stamped)).toStrictEqual({ versions: readBack(input).versions + 1, repaired: false, pages: 3 });
  });

  it('CONTROL: a whole save of the same edit is NOT its input with something appended, so the case can fail', async () => {
    const input = await document(3);
    const whole = await loadedWhole(input);
    whole.getPage(0).drawText('DRAFT', { x: 72, y: 72 });
    const rewritten = await whole.save();

    expect(startsWith(rewritten, input)).toBe(false);
  });

  it('appendRevision refuses a document loaded whole, and takes one opened for writing — CONTROL in the second line', async () => {
    await expect(appendRevision(await loadedWhole(await document(1)))).rejects.toThrow(/forIncrementalUpdate/u);
    await expect(appendRevision(await openForWriting(await document(1)))).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('pdf-lib writes without handing the loop back every 50 objects (KKKKKKKK-2)', () => {
  /** How many zero-delay timers `write` starts: pdf-lib's hand-back is one per 50 objects. */
  async function timersDuring(write: () => Promise<Uint8Array>): Promise<number> {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    try {
      await write();
      return spy.mock.calls.filter(([, delay]) => (delay ?? 0) === 0).length;
    } finally {
      spy.mockRestore();
    }
  }

  it('wholeFile and appendRevision start no timer; CONTROL: pdf-lib’s own save starts one per 50 objects', async () => {
    const bytes = await document(120);
    const pages = await PDFDocument.load(bytes);
    const revised = await openForWriting(bytes);
    // A REVISION OF MORE THAN 50 OBJECTS, or the default would start no timer either and the zero would prove nothing.
    for (let at = 0; at < 120; at += 1) revised.addPage([612, 792]);
    expect(await timersDuring(() => wholeFile(pages))).toBe(0);
    expect(await timersDuring(() => appendRevision(revised))).toBe(0);
    // THE CONTROL: the same document through the default, so a zero above is the option and not a document too small.
    expect(await timersDuring(() => pages.save())).toBeGreaterThan(3);
  });

  it('every pdf-lib write in the kernel goes through this module, so none can take the default', () => {
    const source = join(import.meta.dirname);
    const writers = readdirSync(source)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'pdfLibSession.ts')
      .filter((name) => /\.(?:save|commit)\(/u.test(readFileSync(join(source, name), 'utf8')));
    // POSITIVE CONTROL: the pattern finds the calls in the module that owns them.
    expect(/\.(?:save|commit)\(/u.test(readFileSync(join(source, 'pdfLibSession.ts'), 'utf8'))).toBe(true);
    expect(writers).toStrictEqual([]);
  });
});

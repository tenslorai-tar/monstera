import { PDFDocument } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { type ByteImage, type MupdfSession } from './engineSeam.js';
import { mupdfWriter } from './mupdfWriter.js';

/**
 * The seam's one live adapter, exercised end to end.
 *
 * A declared API is not a working one — that is this project's most expensive
 * recurring lesson, and MuPDF is where it was learned: `rearrangePages` is
 * declared, exists, and destroys `/AcroForm`. So these open a real document,
 * serialise it, and read the result back with a **different** library than the
 * one that wrote it, rather than asserting that the calls exist.
 */

let pdf: ByteImage;

beforeAll(async () => {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  document.addPage([612, 792]);
  pdf = await document.save();
});

describe('mupdfWriter — session lifecycle', () => {
  it('opens canonical bytes and serialises back to a document another engine can read', async () => {
    const session = await mupdfWriter.open(pdf);
    try {
      const written = await mupdfWriter.serialise(session);

      // Read back with pdf-lib, not MuPDF. A round trip verified by the engine
      // that produced it proves the engine is self-consistent and nothing else.
      const reopened = await PDFDocument.load(written, { updateMetadata: false });
      expect(reopened.getPageCount()).toBe(2);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('does not retain the image it was opened from', async () => {
    const mutable = Uint8Array.from(pdf);
    const session = await mupdfWriter.open(mutable);
    try {
      const written = await mupdfWriter.serialise(session);
      // The kernel owns the canonical bytes (ADR-0009 §8) and must be free to
      // drop or overwrite the buffer it handed over. If the engine were reading
      // through to it, this would corrupt the session.
      mutable.fill(0);
      const again = await mupdfWriter.serialise(session);
      // Bytes, not length. Length is a proxy, and it cannot separate a clean
      // serialisation from a corrupted one of the same size — the assertion
      // would then rest entirely on the engine happening to throw. The exact
      // quantity is right here and equal, so comparing anything coarser is the
      // instrument reporting a rounder number than the one it holds.
      expect(Array.from(again)).toStrictEqual(Array.from(written));
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a session from elsewhere is refused rather than dereferenced', async () => {
    // Fabricating one is now a COMPILE error — MupdfSession is branded — so
    // the assertion has to be written here, in the file making it. What the
    // WeakMap covers is what the brand cannot: a token that is nominally a
    // session but was never minted by this adapter.
    const forged = { engine: 'mupdf' } as unknown as MupdfSession;
    await expect(mupdfWriter.serialise(forged)).rejects.toThrow(/not produced by this adapter/);
  });

  it('CONTROL: bytes that are not a PDF are refused at open', async () => {
    await expect(mupdfWriter.open(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });

  it('CONTROL: closing twice is refused rather than freeing the document again', async () => {
    const session = await mupdfWriter.open(pdf);
    await mupdfWriter.close(session);

    // The token survives; the entry behind it does not. Without that, the
    // second close reaches `destroy()` on an already-freed native document —
    // a fault inside the engine rather than an error in the caller's hands.
    await expect(mupdfWriter.close(session)).rejects.toThrow(/already been closed/);
    await expect(mupdfWriter.serialise(session)).rejects.toThrow(/already been closed/);
  });
});

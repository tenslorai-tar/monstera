import { PDFDocument } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ByteImage, MupdfSession } from './engineSeam.js';
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

/**
 * The serialised bytes are the caller's, not the engine's.
 *
 * ## Found by the stage audit of `909c388..9608a39`, from a real failure
 *
 * `saveToBuffer().asUint8Array()` answers `HEAPU8.subarray(...)` — a window onto
 * the wasm heap. When the heap grows, `HEAPU8` is replaced and every earlier
 * view is **detached**; `pageAnnotations.test.ts` reached that while holding a
 * serialised document across later engine work, and handing those bytes back to
 * `openDocument` threw *"Cannot perform Construct on a detached ArrayBuffer"*.
 *
 * `ByteImage` is what the service holds across commands and what the save
 * pipeline writes to disk, so this is the one array that must not be a window
 * onto somebody else's allocator.
 *
 * ## The assertion is OWNERSHIP, not survival
 *
 * A case that grew the heap and then read the bytes would depend on how much
 * growth this machine's engine happens to need — it passed a probe that opened
 * twelve documents and failed inside a test file, which makes it a threshold
 * nobody can state. What is exact is the property itself: a copy owns its
 * `ArrayBuffer`, so `byteLength` and `buffer.byteLength` agree, and a subarray
 * of a multi-megabyte heap cannot.
 */
describe('mupdfWriter — the bytes it hands out', () => {
  it('answers an array that OWNS its buffer, rather than a view into the engine', async () => {
    const session = await mupdfWriter.open(pdf);
    try {
      const written = await mupdfWriter.serialise(session);
      expect(written.byteLength).toBeGreaterThan(0);
      expect(written.buffer.byteLength).toBe(written.byteLength);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: the engine’s own answer fails that test, so it can fail', () => {
    // Without this the assertion above is one every `Uint8Array` in a test
    // happens to satisfy, and nothing says it separates a copy from a view.
    // This reaches past the adapter deliberately — it is the shape the adapter
    // used to return, and the point is that it is distinguishable.
    // NARROWED RATHER THAN CAST: `openDocument` is typed as returning the base
    // `Document`, and `mupdfWriter.ts` narrows the same way for the same reason
    // — a non-PDF opens successfully and answers a document with no
    // `saveToBuffer` on it.
    const document = mupdf.PDFDocument.openDocument(pdf, 'application/pdf');
    if (!(document instanceof mupdf.PDFDocument)) throw new Error('the fixture is not a PDF');
    try {
      const view = document.saveToBuffer('').asUint8Array();
      expect(view.byteLength).toBeGreaterThan(0);
      expect(view.buffer.byteLength).toBeGreaterThan(view.byteLength);
    } finally {
      document.destroy();
    }
  });
});

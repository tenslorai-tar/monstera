import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ByteImage, MupdfSession } from './engineSeam.js';
import { accessFor, mupdfWriter, withDocument } from './mupdfWriter.js';

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

/**
 * Encrypted documents — Stage 7's first feature row
 * ([ADR-0055](../../../docs/DECISIONS/0055-a-password-crosses-into-the-host-and-unlocking-is-an-open.md)).
 *
 * ## Every case asserts a BLOCK COUNT, never the absence of a throw
 *
 * This is the whole shape of the defect these exist for. A document whose key
 * is wrong does not fail to open, does not throw, and does not answer an empty
 * document — it answers a **structurally sound document whose streams decrypt
 * to garbage**, which `toStructuredText` reports as zero blocks and MuPDF
 * mentions only on stderr. So `open` resolving proves nothing, and a case that
 * asserted it would pass against the broken engine.
 *
 * ## The fixture carries real text, and that is not decoration
 *
 * An empty page answers zero blocks whatever the key is, so it is a fixture the
 * bug handles correctly — the audit's own *never build a fixture the bug also
 * handles* rule. `drawText` with an embedded standard font is what makes the
 * two states distinguishable.
 */
describe('mupdfWriter — encrypted documents', () => {
  const USER = 'reader-secret';
  const OWNER = 'owner-secret';

  /** A one-page document with real glyphs on it. */
  let written: ByteImage;

  beforeAll(async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    document.addPage([612, 792]).drawText('Monstera encrypted document row', {
      font,
      size: 24,
      x: 72,
      y: 720,
    });
    written = await document.save();
  });

  /**
   * The same bytes under `aes-256`, with whichever passwords are named.
   *
   * MuPDF's own writer, because §3's matrix makes MuPDF the writer of record
   * for encryption: a fixture encrypted by a second library would be a case
   * about that library's interpretation of the format.
   */
  const encrypted = (options: string): ByteImage => {
    const source = mupdf.PDFDocument.openDocument(written, 'application/pdf');
    // NARROWED RATHER THAN CAST, for the reason the ownership control above
    // gives: `openDocument` is typed as returning the base `Document`, and a
    // non-PDF opens successfully and answers one with no `saveToBuffer`.
    if (!(source instanceof mupdf.PDFDocument)) throw new Error('the fixture is not a PDF');
    try {
      return Uint8Array.from(source.saveToBuffer(`encrypt=aes-256,${options}`).asUint8Array());
    } finally {
      source.destroy();
    }
  };

  /** How many structured-text blocks page 0 answers, through a live session. */
  const blocksThrough = (session: MupdfSession): Promise<number> =>
    withDocument(session, (document) => {
      const structured = JSON.parse(document.loadPage(0).toStructuredText().asJSON()) as {
        blocks?: readonly unknown[];
      };
      return structured.blocks?.length ?? 0;
    });

  it('CONTROL: the unencrypted fixture has text on it, so zero blocks means something', async () => {
    // Without this every assertion below is satisfied by a fixture with nothing
    // on it, and a broken decrypt would be indistinguishable from an empty
    // page. It also pins `access: 1` — a document with no `/Encrypt`
    // dictionary — which is the value the encrypted cases must NOT answer.
    const session = await mupdfWriter.open(written);
    try {
      expect(await blocksThrough(session)).toBeGreaterThan(0);
      expect(accessFor(session)).toBe(1);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('opens with the user password and READS THE TEXT, answering access 2', async () => {
    const bytes = encrypted(`user-password=${USER},owner-password=${OWNER}`);
    const session = await mupdfWriter.open(bytes, USER);
    try {
      expect(await blocksThrough(session)).toBeGreaterThan(0);
      expect(accessFor(session)).toBe(2);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('tells the OWNER password apart from the user’s, which a boolean could not', async () => {
    // The permission rows later in this stage turn entirely on this
    // distinction, and MuPDF answers it precisely — so the seam carries the
    // bitfield rather than collapsing it and forcing a second opinion later.
    const bytes = encrypted(`user-password=${USER},owner-password=${OWNER}`);
    const session = await mupdfWriter.open(bytes, OWNER);
    try {
      expect(accessFor(session)).toBe(4);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('refuses with NEEDS-PASSWORD when none was offered', async () => {
    const bytes = encrypted(`user-password=${USER},owner-password=${OWNER}`);
    await expect(mupdfWriter.open(bytes)).rejects.toMatchObject({
      name: 'DocumentLocked',
      reason: 'needs-password',
    });
  });

  it('refuses with WRONG-PASSWORD when one was, which is a different sentence', async () => {
    // Two refusals rather than one, because the surfaces differ: the first
    // prompt says nothing happened yet and the second says the last attempt was
    // refused. A single code would make the second prompt unable to say so.
    const bytes = encrypted(`user-password=${USER},owner-password=${OWNER}`);
    await expect(mupdfWriter.open(bytes, 'not-the-password')).rejects.toMatchObject({
      name: 'DocumentLocked',
      reason: 'wrong-password',
    });
  });

  it('carries NO password on the refusal, because an error is what gets logged whole', async () => {
    const bytes = encrypted(`user-password=${USER},owner-password=${OWNER}`);
    const refusal = await mupdfWriter.open(bytes, USER + '-typo').catch((error: unknown) => error);
    // The whole error, not a field of it: a password that reached `message` or
    // rode along as an extra property would be in every diagnostic that
    // stringifies a rejection.
    expect(JSON.stringify(refusal, Object.getOwnPropertyNames(refusal))).not.toContain(USER);
  });

  it('THE CONTROL FOR THE BAN: needsPassword() after authenticating empties the page', () => {
    // REACHES PAST THE ADAPTER DELIBERATELY, like the ownership control above
    // and for the same reason: this is the behaviour `monstera/no-needs-password`
    // exists to prevent, and the rule stops the application from being able to
    // express it — so the only place left that can demonstrate it is a case
    // that calls the engine directly.
    //
    // Without this the ban is a rule with a paragraph behind it. With it, the
    // paragraph is a measurement: the same document, the same session, one call
    // in between, and the page goes from having text to having none.
    //
    // NO DISABLE COMMENT, and that is the scoping working rather than luck:
    // `monstera/no-needs-password` is registered against shipped source and
    // ignores `**/*.test.ts`, for the reason every rule in that block records —
    // the fixture that names the banned form is what proves a rule sees, and it
    // must not be the thing the rule reports.
    const bytes = encrypted(`user-password=${USER},owner-password=${OWNER}`);
    const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
    try {
      expect(document.authenticatePassword(USER)).toBe(2);
      const blocks = (): number =>
        (
          JSON.parse(document.loadPage(0).toStructuredText().asJSON()) as {
            blocks?: readonly unknown[];
          }
        ).blocks?.length ?? 0;

      const before = blocks();
      expect(before).toBeGreaterThan(0);

      document.needsPassword();

      expect(
        blocks(),
        'needsPassword() is pdf_authenticate_password(doc, "") — a failed attempt that ' +
          're-derives and so destroys the key the successful one left',
      ).toBe(0);
    } finally {
      document.destroy();
    }
  });
});

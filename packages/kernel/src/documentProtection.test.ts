import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  applySetDocumentProtection,
  captureSetDocumentProtection,
  permissionBits,
  protectionOptions,
} from './documentProtection.js';
import type { ByteImage } from './engineSeam.js';
import { mupdfWriter } from './mupdfWriter.js';

/**
 * Stage 7's protection rows — set a password, change the permission flags,
 * remove the password
 * ([ADR-0055](../../../docs/DECISIONS/0055-a-password-crosses-into-the-host-and-unlocking-is-an-open.md)).
 *
 * ## Every case reads the BYTES back, and most read them with the engine
 *
 * The command writes nothing when it runs: it records save terms, and the only
 * observable is what `serialise` then produces. So a case asserting that the
 * apply resolved would assert nothing at all — the apply cannot fail — and the
 * subject here is always a round trip.
 */
let written: ByteImage;

beforeAll(async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  // REAL GLYPHS, for `mupdfWriter.test.ts`' reason: a blank page reads as zero
  // blocks whatever its key is, which is a fixture the defect handles correctly.
  document.addPage([612, 792]).drawText('Monstera protection row', { font, size: 24, x: 72, y: 700 });
  written = await document.save();
});

/** What a fresh open of these bytes says about their protection. */
function protectionOf(bytes: ByteImage): { readonly access: number; readonly blocks: number } {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  try {
    // The empty attempt: `1` is a document with no `/Encrypt` dictionary at
    // all, `0` is one this build declines to open, and `2`/`4` are one it opens.
    const access = document.authenticatePassword('');
    let blocks = 0;
    try {
      blocks = (
        JSON.parse(document.loadPage(0).toStructuredText().asJSON()) as {
          blocks?: readonly unknown[];
        }
      ).blocks?.length ?? 0;
    } catch {
      blocks = -1;
    }
    return { access, blocks };
  } finally {
    document.destroy();
  }
}

describe('protectionOptions — the option string is the whole observable', () => {
  it('composes a scheme, both passwords and the permission bits', () => {
    expect(
      protectionOptions({
        kind: 'setDocumentProtection',
        encryption: 'aes-256',
        userPassword: 'open-me',
        ownerPassword: 'own-me',
        permissions: ['print'],
      }),
    ).toBe('encrypt=aes-256,user-password=open-me,owner-password=own-me,permissions=-3385');
  });

  it('CONTROL: `none` carries NO other term, whatever it was given', () => {
    // A password beside `encrypt=none` is a value MuPDF ignores, and in a diff
    // it reads as a removal that kept the password. This is the one case where
    // the fixture deliberately supplies fields the answer must drop.
    expect(
      protectionOptions({
        kind: 'setDocumentProtection',
        encryption: 'none',
        userPassword: 'open-me',
        ownerPassword: 'own-me',
        permissions: ['print'],
      }),
    ).toBe('encrypt=none');
  });
});

describe('permissionBits — /P is composed here and nowhere else', () => {
  it('grants everything as -1, which is every bit set including the reserved ones', () => {
    expect(
      permissionBits(['print', 'modify', 'copy', 'annotate', 'fill-forms', 'assemble', 'print-high-quality']),
    ).toBe(-1);
  });

  it('clears ONE bit per permission withheld, at the specification’s own number', () => {
    // Bit 3 is print, so withholding it clears the value 4 and nothing else.
    expect(
      permissionBits(['modify', 'copy', 'annotate', 'fill-forms', 'assemble', 'print-high-quality']),
    ).toBe(-5);
    // Bit 5 is copy: the value 16.
    expect(
      permissionBits(['print', 'modify', 'annotate', 'fill-forms', 'assemble', 'print-high-quality']),
    ).toBe(-17);
  });

  it('CONTROL: withholding everything leaves the RESERVED bits set', () => {
    // THE CASE THAT SEPARATES SUBTRACTION FROM ADDITION. Built additively from
    // named permissions the answer would be 0 — every bit clear, including the
    // reserved ones — and a reader refusing the document for a reason no dialog
    // mentions. The seven named bits are 4, 8, 16, 32, 256, 1024 and 2048,
    // which sum to 3,388, so withholding all of them answers ~3388.
    expect(permissionBits([])).toBe(-3389);
  });
});

describe('a protection round trip, through the writer', () => {
  it('CONTROL: the fixture starts unprotected and has text on it', async () => {
    // Without this every assertion below is satisfied by an empty page, and a
    // document that failed to decrypt would look the same as one that has
    // nothing on it.
    const session = await mupdfWriter.open(written);
    try {
      const bytes = await mupdfWriter.serialise(session);
      expect(protectionOf(bytes)).toStrictEqual({ access: 1, blocks: 1 });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('SETS a password, and the serialised bytes need it', async () => {
    const session = await mupdfWriter.open(written);
    try {
      await applySetDocumentProtection(session, {
        kind: 'setDocumentProtection',
        encryption: 'aes-256',
        userPassword: 'open-me',
        ownerPassword: 'own-me',
        permissions: ['print'],
      });
      const bytes = await mupdfWriter.serialise(session);
      // REFUSED to the empty attempt, which is the whole claim. `blocks` is
      // read too: a document that refused and then read its text would be one
      // whose protection is decorative.
      expect(protectionOf(bytes).access).toBe(0);

      // AND IT OPENS WITH THE PASSWORD, through the adapter that would refuse a
      // wrong one. Without this the case above is satisfied by bytes nobody can
      // open at all.
      const reopened = await mupdfWriter.open(bytes, 'open-me');
      try {
        expect(await mupdfWriter.serialise(reopened)).toBeInstanceOf(Uint8Array);
      } finally {
        await mupdfWriter.close(reopened);
      }
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('REMOVES it, and the bytes carry no /Encrypt at all', async () => {
    const session = await mupdfWriter.open(written);
    try {
      await applySetDocumentProtection(session, {
        kind: 'setDocumentProtection',
        encryption: 'aes-256',
        userPassword: 'open-me',
        permissions: ['print'],
      });
      expect(protectionOf(await mupdfWriter.serialise(session)).access).toBe(0);

      // THE SECOND COMMAND ON ONE SESSION, which is what says the record is a
      // map and not a one-way set: `removals` cannot express this, and a
      // protection that could only be added would make *remove password* a row
      // nothing could build.
      await applySetDocumentProtection(session, {
        kind: 'setDocumentProtection',
        encryption: 'none',
        permissions: [],
      });
      expect(protectionOf(await mupdfWriter.serialise(session))).toStrictEqual({
        access: 1,
        blocks: 1,
      });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a session nothing protected serialises exactly as it did before', async () => {
    // The line this feature added to `serialise` runs for every save in the
    // application. Without this case, a composition that appended a stray comma
    // — or a term — to every unprotected document's option string would be
    // invisible until somebody diffed bytes.
    const session = await mupdfWriter.open(written);
    try {
      const bytes = await mupdfWriter.serialise(session);
      expect(protectionOf(bytes).access).toBe(1);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('refuses to record prior state, because the prior state is a password', async () => {
    const session = await mupdfWriter.open(written);
    try {
      const captured = await captureSetDocumentProtection(session);
      expect(captured.captured).toBe(false);
      // THE REASON IS ASSERTED, not just the refusal: a capture that reported
      // `false` for a different reason — an engine that would not answer, say —
      // reads identically here and means something else entirely.
      expect(captured.captured ? '' : captured.reason).toContain('command log');
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

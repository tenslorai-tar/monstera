import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import type { CommandOfKind } from '@monstera/contract';
import * as mupdf from './mupdfRaw.js';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  applySetDocumentProtection,
  captureSetDocumentProtection,
  invertSetDocumentProtection,
  permissionBits,
  protectionOptions,
  protectedWritingOf,
} from './documentProtection.js';
import { applyPdfLibImage } from './pdfLibWriter.js';
import type { ByteImage } from './engineSeam.js';
import { mupdfWriter, restoreSessionProtection } from './mupdfWriter.js';

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

it('protection undo keeps the known opening key for the next pdf-lib command', async () => {
  const session = await mupdfWriter.open(written);
  try {
    const original = { kind: 'setDocumentProtection', encryption: 'aes-256', userPassword: 'first,open"key', ownerPassword: 'first-owner', permissions: ['print'] } satisfies CommandOfKind<'setDocumentProtection'>;
    await applySetDocumentProtection(session, original);
    const captured = await captureSetDocumentProtection(session);
    if (!captured.captured) throw new Error(captured.reason);
    expect(captured.prior).toMatchObject({ standing: 'protected', userPassword: original.userPassword });
    await applySetDocumentProtection(session, { ...original, permissions: ['copy'] });
    await mupdfWriter.serialise(session);
    await invertSetDocumentProtection(session, captured.prior);
    const writing = await protectedWritingOf(session);
    if (writing === undefined) throw new Error('the restored document lost its protection');
    const plain = await writing.plain();
    expect((await PDFDocument.load(plain)).getPageCount()).toBe(1);
    const marked = await applyPdfLibImage(plain, { kind: 'watermarkPages', pages: 'all', text: 'Protection undo proof', opacity: 0.3, rotationDegrees: 0, fontSize: 24 }, undefined);
    const saved = await writing.protect(marked);
    await expect(mupdfWriter.open(saved)).rejects.toThrow('encrypted');
    await mupdfWriter.close(await mupdfWriter.open(saved, original.userPassword));
    await mupdfWriter.close(await mupdfWriter.open(saved, original.ownerPassword));
  } finally {
    await mupdfWriter.close(session);
  }
});

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
    ).toBe('encrypt=aes-256,user-password="open-me",owner-password="own-me",permissions=-3385');
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

  it('a password is the WHOLE password, whatever it holds: commas, equals signs, quotes, non-ASCII', async () => {
    // CR-DOC-06: the option string is comma-separated, so `a,b` was written as `a` and the person who typed `a,b` was
    // locked out. Each password below opens the document, and the separating half: its first piece alone does not.
    for (const password of ['a,b', 'k=v', 'a,user-password=x', 'say "hi"', '"', '""', 'trailing,', 'pässwörd ✓', 'a\\b']) {
      const session = await mupdfWriter.open(written);
      try {
        await applySetDocumentProtection(session, { kind: 'setDocumentProtection', encryption: 'aes-256', userPassword: password });
        const bytes = await mupdfWriter.serialise(session);
        const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
        try {
          expect({ password, empty: document.authenticatePassword('') }).toStrictEqual({ password, empty: 0 });
          const piece = password.split(/[,=]/u)[0] ?? '';
          if (piece !== password && piece !== '') {
            expect({ password, piece: document.authenticatePassword(piece) }).toStrictEqual({ password, piece: 0 });
          }
          expect({ password, whole: document.authenticatePassword(password) > 0 }).toStrictEqual({ password, whole: true });
        } finally {
          document.destroy();
        }
      } finally {
        await mupdfWriter.close(session);
      }
    }
  });

  it('the OWNER password is held whole too, beside a user password that has a comma', async () => {
    const session = await mupdfWriter.open(written);
    try {
      await applySetDocumentProtection(session, {
        kind: 'setDocumentProtection',
        encryption: 'aes-256',
        userPassword: 'open,me',
        ownerPassword: 'own,me',
      });
      const document = mupdf.PDFDocument.openDocument(await mupdfWriter.serialise(session), 'application/pdf');
      try {
        // MuPDF answers 4 for the owner password and 2 for the user one (`pdf_authenticate_password`).
        expect([document.authenticatePassword('own'), document.authenticatePassword('own,me')]).toStrictEqual([0, 4]);
      } finally {
        document.destroy();
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

});

/**
 * The undo of a protect is its inverse, and no checkpoint
 * ([ADR-0171](../../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md) Decision 8):
 * each case captures, applies, inverts and reads the serialised bytes back.
 */
describe('a protect, undone by its inverse', () => {
  const PROTECT = {
    kind: 'setDocumentProtection',
    encryption: 'aes-256',
    userPassword: 'open-me',
  } as const;

  /** Captures, protects with `PROTECT`, then inverts with what was captured; answers the session's bytes. */
  async function protectAndUndo(bytes: ByteImage, password?: string): Promise<ByteImage> {
    const session = await mupdfWriter.open(bytes, password);
    try {
      const captured = await captureSetDocumentProtection(session);
      if (!captured.captured) throw new Error(`the capture refused: ${captured.reason}`);
      await applySetDocumentProtection(session, PROTECT);
      // THE PROTECT TOOK, so the inverse below has something to undo: without this, an apply that did nothing passes.
      expect(protectionOf(await mupdfWriter.serialise(session)).access).toBe(0);
      await invertSetDocumentProtection(session, captured.prior);
      return await mupdfWriter.serialise(session);
    } finally {
      await mupdfWriter.close(session);
    }
  }

  it('an unprotected document comes back unprotected, with its text', async () => {
    expect(protectionOf(await protectAndUndo(written))).toStrictEqual({ access: 1, blocks: 1 });
  });

  it('a second protect is undone to the FIRST one’s terms: the document needs the first password, not the second', async () => {
    const session = await mupdfWriter.open(written);
    try {
      await applySetDocumentProtection(session, { kind: 'setDocumentProtection', encryption: 'aes-256', userPassword: 'first' });
      const captured = await captureSetDocumentProtection(session);
      if (!captured.captured) throw new Error(`the capture refused: ${captured.reason}`);
      expect(captured.prior.standing).toBe('protected');
      await applySetDocumentProtection(session, { kind: 'setDocumentProtection', encryption: 'aes-256', userPassword: 'second' });
      await invertSetDocumentProtection(session, captured.prior);
      const bytes = await mupdfWriter.serialise(session);
      await expect(mupdfWriter.open(bytes, 'second')).rejects.toThrow();
      const reopened = await mupdfWriter.open(bytes, 'first');
      await mupdfWriter.close(reopened);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a document carrying its OWN encryption is not captured: its undo is a checkpoint, encrypted as the file is', async () => {
    const maker = await mupdfWriter.open(written);
    await applySetDocumentProtection(maker, { kind: 'setDocumentProtection', encryption: 'aes-256', userPassword: 'its-own' });
    const encrypted = await mupdfWriter.serialise(maker);
    await mupdfWriter.close(maker);

    const session = await mupdfWriter.open(encrypted, 'its-own');
    try {
      const captured = await captureSetDocumentProtection(session);
      expect(captured.captured ? '' : captured.reason).toContain('its own encryption');
      // AND WHAT THE BUS WOULD CHECKPOINT is the file's own form: it needs the file's password.
      const checkpoint = await mupdfWriter.serialise(session);
      expect(protectionOf(checkpoint).access).toBe(0);
      await mupdfWriter.close(await mupdfWriter.open(checkpoint, 'its-own'));
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL, the measurement the refusal rests on: recording no terms after a protect drew keeps the NEW key', async () => {
    // Were MuPDF to keep the opened encryption in the session, an `as-opened` inverse that recorded nothing would be
    // exact and the refusal above a needless checkpoint. This is the reading that says it does not.
    const maker = await mupdfWriter.open(written);
    await applySetDocumentProtection(maker, { kind: 'setDocumentProtection', encryption: 'aes-256', userPassword: 'its-own' });
    const encrypted = await mupdfWriter.serialise(maker);
    await mupdfWriter.close(maker);

    const session = await mupdfWriter.open(encrypted, 'its-own');
    try {
      await applySetDocumentProtection(session, PROTECT);
      await mupdfWriter.serialise(session);
      await restoreSessionProtection(session, undefined);
      const bytes = await mupdfWriter.serialise(session);
      await expect(mupdfWriter.open(bytes, 'its-own')).rejects.toThrow();
      await mupdfWriter.close(await mupdfWriter.open(bytes, 'open-me'));
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('UNPROTECTED is restored as unprotected on a session opened again from the protected copy', async () => {
    // A REMOVAL'S SAVE RENEWAL, in miniature: the session the undo runs against was opened from the bytes the protect
    // produced. The prior was captured on the plain session, so `unprotected` must decrypt this one.
    const plain = await mupdfWriter.open(written);
    const captured = await captureSetDocumentProtection(plain);
    await applySetDocumentProtection(plain, PROTECT);
    const protectedBytes = await mupdfWriter.serialise(plain);
    await mupdfWriter.close(plain);
    if (!captured.captured) throw new Error(`the capture refused: ${captured.reason}`);
    expect(captured.prior).toStrictEqual({ standing: 'unprotected' });

    const renewed = await mupdfWriter.open(protectedBytes, 'open-me');
    try {
      await invertSetDocumentProtection(renewed, captured.prior);
      expect(protectionOf(await mupdfWriter.serialise(renewed))).toStrictEqual({ access: 1, blocks: 1 });
    } finally {
      await mupdfWriter.close(renewed);
    }
  });

  it('CONTROL: the same renewed session with no terms recorded keeps the protect’s encryption', async () => {
    // Separates `unprotected` from recording nothing: were the inverse spelt that way, the case above would read this.
    const plain = await mupdfWriter.open(written);
    await applySetDocumentProtection(plain, PROTECT);
    const protectedBytes = await mupdfWriter.serialise(plain);
    await mupdfWriter.close(plain);

    const renewed = await mupdfWriter.open(protectedBytes, 'open-me');
    try {
      await restoreSessionProtection(renewed, undefined);
      expect(protectionOf(await mupdfWriter.serialise(renewed)).access).toBe(0);
    } finally {
      await mupdfWriter.close(renewed);
    }
  });
});

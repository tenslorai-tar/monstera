import { PDFDocument } from '@cantoo/pdf-lib';
import forge from 'node-forge';
import { beforeAll, describe, expect, it } from 'vitest';

import { applySetDocumentProtection, protectedImageOf } from './documentProtection.js';
import { NO_TIMESTAMPS, signPrepared } from './documentSign.js';
import type { ByteImage, MupdfSession } from './engineSeam.js';
import { lockedPageTree } from './lockedPageTreeFixture.js';
import * as mupdf from './mupdfRaw.js';
import { mupdfWriter, signaturesKeptBySave, withDocument } from './mupdfWriter.js';
import { applyPlaceImage } from './pageAnnotations.js';
import { prepareSignature } from './signaturePlaceholder.js';
import { placeholderRequestOf } from './signatureHole.js';
import { readSignatures } from './signatureRead.js';
import { applySignDocument } from './signpdfWriter.js';

/**
 * Every appended save of a signed document opens, however many one session makes (the owner's ruling of 2026-11-06,
 * `mupdfWriter.ts`' `rebasedOn`). MuPDF took the section an appended save into memory wrote as the document's last,
 * while the next save still appended to the bytes the session was opened from, so the second save's `/Prev` named an
 * offset of a file that was not there, and a plain reader found no pages.
 *
 * Each case reads every saved file as another application would: a PLAIN open, with no repair (`mupdfOpen.ts` rebuilds a
 * broken chain, which would hide the fault), its page count, every earlier file's bytes as its prefix, and this build's
 * signature reader on a fresh session.
 */

const PASSPHRASE = 'a passphrase';
const USER = 'open-me';
const OWNER = 'own-me';
const PAGES = 2;
let unsigned: ByteImage;
let certificate: Uint8Array;

beforeAll(async () => {
  const document = await PDFDocument.create();
  for (let at = 0; at < PAGES; at += 1) document.addPage([300, 300]);
  unsigned = await document.save();
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  cert.setSubject([{ name: 'commonName', value: 'Monstera Test' }]);
  cert.setIssuer([{ name: 'commonName', value: 'Monstera Test' }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const der = forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], PASSPHRASE, { algorithm: '3des' })).getBytes();
  certificate = Uint8Array.from(der, (character: string) => character.charCodeAt(0));
}, 60_000);

const command = { kind: 'signDocument' as const, bytes: new Uint8Array(), passphrase: PASSPHRASE, name: 'Grace Hopper' };

/** How many pages a PLAIN open reads, the way another application reads the file: no repair, no password. */
function plainPages(bytes: ByteImage): number {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  try {
    return document.countPages();
  } finally {
    document.destroy();
  }
}

const STAMP = { author: 'Priya Raman', created: '2026-11-06T09:00:00.000Z' } as const;

/** A small opaque PNG, made by MuPDF itself (B10: nothing committed). */
function png(): Uint8Array {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 8, 4], false);
  try {
    pixmap.clear(128);
    return pixmap.asPNG().slice();
  } finally {
    pixmap.destroy();
  }
}

/**
 * The newest cross-reference section, read as a reader starts: the last `startxref`'s offset, and the `/Prev` of the
 * trailer that section ends in (a classic table's, or the cross-reference stream's dictionary). `undefined` when it has
 * none, which is the first section's shape.
 */
function newestSection(bytes: ByteImage): { readonly at: number; readonly previous: number | undefined } {
  const text = Buffer.from(bytes).toString('latin1');
  const starts = [...text.matchAll(/startxref\s+(\d+)/g)];
  const last = starts.at(-1);
  if (last?.[1] === undefined) throw new Error('the file has no startxref, so no section could be read');
  const at = Number(last[1]);
  const section = text.slice(at, last.index);
  const previous = /\/Prev\s+(\d+)/.exec(section)?.[1];
  return { at, previous: previous === undefined ? undefined : Number(previous) };
}

/** Whether each signature in `bytes` covers what it signed, read on a fresh session. */
async function covering(bytes: ByteImage, password?: string): Promise<boolean[]> {
  const session = await mupdfWriter.open(bytes, password);
  try {
    return (await readSignatures(session, bytes)).map((each) => each.coversDocument);
  } finally {
    await mupdfWriter.close(session);
  }
}

/**
 * Three appended saves of `signed` from ONE session, every file checked. `every`: a change before each save; `first`: a
 * change before the first only, so the second and third change nothing.
 */
async function threeSaves(signed: ByteImage, change: 'every' | 'first', password?: string): Promise<void> {
  const session: MupdfSession = await mupdfWriter.open(signed, password);
  try {
    let earlier: ByteImage = signed;
    for (let round = 1; round <= 3; round += 1) {
      if (change === 'every' || round === 1) await withDocument(session, (document) => {
        document.findPage(0).put('Rotate', (round * 90) % 360);
      });
      const saved = await mupdfWriter.serialise(session);
      expect(plainPages(saved), `save ${String(round)}: the page count a plain reader finds`).toBe(PAGES);
      // APPENDED: every earlier file, the signed one included, is this one's first bytes, unchanged.
      expect(Buffer.from(saved.subarray(0, earlier.byteLength)).equals(Buffer.from(earlier)), `save ${String(round)} keeps the earlier bytes`).toBe(true);
      expect(Buffer.from(saved.subarray(0, signed.byteLength)).equals(Buffer.from(signed))).toBe(true);
      expect(await covering(saved, password), `save ${String(round)}: the signature covers what it signed`).toStrictEqual([true]);
      if (change === 'every') expect(saved.byteLength).toBeGreaterThan(earlier.byteLength);
      earlier = saved;
    }
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('appended saves of a signed document, any number from one session', () => {
  it('CONTROL: the signed file itself opens plainly with its pages, and its signature covers it', async () => {
    const signed = await applySignDocument(unsigned, { ...command, bytes: certificate });
    expect(plainPages(signed)).toBe(PAGES);
    expect(await covering(signed)).toStrictEqual([true]);
  }, 60_000);

  it('three saves in a row with a change between them', async () => {
    await threeSaves(await applySignDocument(unsigned, { ...command, bytes: certificate }), 'every');
  }, 60_000);

  it('three saves in a row with no change between them, after one change before the first', async () => {
    await threeSaves(await applySignDocument(unsigned, { ...command, bytes: certificate }), 'first');
  }, 60_000);

  /**
   * THE APPLICATION'S OWN SEQUENCE OF WRITES, the one the owner's report found faulty after the FIRST Save: on open the
   * signatures panel serialises the session (`engine/signatures`); placing a picture is followed by main's image refresh,
   * which serialises it again as held (`documentCommands`' `currentInto`, the host's `engine/serialise`); and Save is a
   * third serialise, as a file a person keeps. A serialise with no change since the session opened returns the file's own
   * bytes and writes nothing, so the refresh is the first appended write and Save the second, with no change between
   * them; without the rebase Save's section sat at the refresh's offset and named itself as its `/Prev` (measured
   * 2026-11-06, a plain open reading 0 pages). Called at the writer, where both host routes end: the case does not
   * cross `composition.ts` or the pipe, which pass these options through unchanged.
   */
  it('the application’s sequence: the signatures read on open, a picture, the image refresh, then Save twice', async () => {
    const signed = await applySignDocument(unsigned, { ...command, bytes: certificate });
    const session = await mupdfWriter.open(signed);
    try {
      const onOpen = await mupdfWriter.serialise(session);
      expect(Buffer.from(onOpen).equals(Buffer.from(signed)), 'a serialise with no change writes nothing').toBe(true);
      expect(await readSignatures(session, onOpen)).toHaveLength(1);
      await applyPlaceImage(session, {
        kind: 'placeImage',
        pages: [0],
        rect: { x0: 50, y0: 50, x1: 150, y1: 100 },
        bytes: png(),
        stamp: STAMP,
      });
      let earlier: ByteImage = signed;
      let wrote = 0;
      for (const [step, write] of [
        ['the image refresh', () => mupdfWriter.serialise(session)],
        ['Save', () => mupdfWriter.serialise(session, { marks: 'engraved' })],
        ['the refresh after Save', () => mupdfWriter.serialise(session)],
        ['a second Save', () => mupdfWriter.serialise(session, { marks: 'engraved' })],
      ] as const) {
        const saved = await write();
        expect(plainPages(saved), `${step}: the page count a plain reader finds`).toBe(PAGES);
        const { at, previous } = newestSection(saved);
        expect(previous, `${step}: the newest section does not name itself`).not.toBe(at);
        expect(Buffer.from(saved.subarray(0, earlier.byteLength)).equals(Buffer.from(earlier)), `${step} keeps the earlier bytes`).toBe(true);
        expect(await covering(saved), `${step}: the signature covers what it signed`).toStrictEqual([true]);
        if (!Buffer.from(saved).equals(Buffer.from(earlier))) {
          // A SECTION WAS WRITTEN, so it names the last file's newest one.
          expect(previous, `${step}: the newest section names the last file's`).toBe(newestSection(earlier).at);
          wrote += 1;
          earlier = saved;
        }
      }
      // THE PICTURE IS IN THE FILE: the refresh appended it, and the case is not one where nothing was ever written.
      expect(wrote).toBeGreaterThan(0);
    } finally {
      await mupdfWriter.close(session);
    }
  }, 60_000);

  /**
   * A FILE THE FAULT ALREADY WROTE, as in the owner's item 8: its last section names itself. It opens with the repair,
   * and MuPDF then refuses to append to a repaired document, so its next save rewrites the file whole. The file that
   * comes out is sound, and the signature no longer covers it; the save says so before it is made (`signaturesKept`,
   * the question ADR-0149 puts to the person). Pinned as it is, not as it should be: the owner's decision.
   */
  it('a file the fault already wrote opens repaired, is said beforehand to break its signature, and saves sound', async () => {
    const signed = await applySignDocument(unsigned, { ...command, bytes: certificate });
    // THE FAULT'S SHAPE, written as the build before the rebase wrote it: two appended saves from one document.
    const raw = mupdf.PDFDocument.openDocument(signed, 'application/pdf');
    if (!(raw instanceof mupdf.PDFDocument)) throw new Error('the case expected a PDF');
    let damaged: ByteImage;
    try {
      raw.findPage(0).put('Rotate', 90);
      raw.saveToBuffer('incremental').destroy();
      damaged = raw.saveToBuffer('incremental').asUint8Array().slice();
    } finally {
      raw.destroy();
    }
    expect(plainPages(damaged), 'CONTROL: the damaged file reads no pages plainly').toBe(0);
    expect(newestSection(damaged).previous).toBe(newestSection(damaged).at);
    // THE SIGNED REVISION IS INTACT inside it, so this build's reader still says the signature covers what it signed.
    expect(await covering(damaged)).toStrictEqual([true]);
    const session = await mupdfWriter.open(damaged);
    try {
      expect(await signaturesKeptBySave(session)).toStrictEqual({ signatures: 1, kept: false });
      const saved = await mupdfWriter.serialise(session);
      expect(plainPages(saved)).toBe(PAGES);
      expect(await covering(saved)).toStrictEqual([false]);
    } finally {
      await mupdfWriter.close(session);
    }
  }, 60_000);

  it('a protected document whose PAGE TREE IS IN AN ENCRYPTED OBJECT STREAM, signed, saves three times (ADR-0291 Q4)', async () => {
    // THE SHAPE qpdf writes with --encrypt and --object-streams=generate, built byte by byte; its signature added by
    // MuPDF's own append, so the object streams stay as written. A value in a /Sig field is what the save counts.
    const holder = mupdf.PDFDocument.openDocument(lockedPageTree(USER, OWNER), 'application/pdf');
    if (!(holder instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
    holder.authenticatePassword(USER);
    const value = holder.addObject(holder.newDictionary());
    value.put('Type', holder.newName('Sig'));
    value.put('Filter', holder.newName('Adobe.PPKLite'));
    value.put('Contents', holder.newString('00'));
    const field = holder.addObject(holder.newDictionary());
    field.put('FT', holder.newName('Sig'));
    field.put('T', holder.newString('Signature1'));
    field.put('V', value);
    const fields = holder.newArray();
    fields.push(field);
    const form = holder.newDictionary();
    form.put('Fields', fields);
    form.put('SigFlags', 3);
    holder.getTrailer().get('Root').put('AcroForm', form);
    const signed = holder.saveToBuffer('incremental').asUint8Array().slice();
    holder.destroy();
    // THE SHAPE, asserted: a reader with no password finds no pages, which is what the check used to read.
    expect(plainPages(signed)).toBe(0);

    const session = await mupdfWriter.open(signed, USER);
    try {
      expect(await signaturesKeptBySave(session)).toStrictEqual({ signatures: 1, kept: true });
      let earlier: ByteImage = signed;
      for (let round = 1; round <= 3; round += 1) {
        await withDocument(session, (document) => {
          document.findPage(0).put('Rotate', (round * 90) % 360);
        });
        const saved = await mupdfWriter.serialise(session);
        // APPENDED, and whole: every earlier file is its first bytes, and with its password it reads its page.
        expect(Buffer.from(saved.subarray(0, earlier.byteLength)).equals(Buffer.from(earlier)), `save ${String(round)}`).toBe(true);
        expect(saved.byteLength).toBeGreaterThan(earlier.byteLength);
        const reopened = await mupdfWriter.open(saved, USER);
        try {
          expect(await withDocument(reopened, (document) => document.countPages())).toBe(1);
        } finally {
          await mupdfWriter.close(reopened);
        }
        earlier = saved;
      }
    } finally {
      await mupdfWriter.close(session);
    }
  }, 60_000);

  it('a protected document, signed under its key and saved three times with a change between', async () => {
    const protect = await mupdfWriter.open(unsigned);
    let protectedFile: ByteImage;
    try {
      await applySetDocumentProtection(protect, {
        kind: 'setDocumentProtection',
        encryption: 'aes-256',
        userPassword: USER,
        ownerPassword: OWNER,
        permissions: ['print'],
      });
      protectedFile = await mupdfWriter.serialise(protect);
    } finally {
      await mupdfWriter.close(protect);
    }
    // SIGNED THE WAY THE HOST SIGNS A PROTECTED DOCUMENT: the revision appended under its key (`appendedUnderKey`).
    const holding = await mupdfWriter.open(protectedFile, USER);
    let signed: ByteImage;
    try {
      const signing = { ...command, bytes: certificate };
      const protection = await protectedImageOf(holding);
      if (protection === undefined) throw new Error('the case expected a protected session');
      const prepared = await prepareSignature(protection.image, placeholderRequestOf(signing), { password: protection.password });
      signed = await signPrepared(prepared, signing, NO_TIMESTAMPS);
    } finally {
      await mupdfWriter.close(holding);
    }
    await threeSaves(signed, 'every', USER);
  }, 60_000);
});

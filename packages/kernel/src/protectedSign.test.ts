import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import type { CommandOfKind } from '@monstera/contract/host';
import forge from 'node-forge';
import { beforeAll, describe, expect, it } from 'vitest';

import { applySetDocumentProtection, protectedImageOf } from './documentProtection.js';
import { NO_TIMESTAMPS, signPrepared } from './documentSign.js';
import type { ByteImage, MupdfSession } from './engineSeam.js';
import * as mupdf from './mupdfRaw.js';
import { appendedUnderKey, mupdfWriter } from './mupdfWriter.js';
import { applySignDocument } from './signpdfWriter.js';
import { prepareSignature } from './signaturePlaceholder.js';
import { placeholderRequestOf } from './signatureHole.js';
import { readSignatures } from './signatureRead.js';

/**
 * A signature on a protected document, appended under the file's own key
 * ([ADR-0227](../../../docs/DECISIONS/0227-a-signature-on-a-protected-document-is-appended-under-the-files-own-key.md)),
 * against the real engine.
 *
 * Each case signs the way the MuPDF host does: the session's protected bytes and the password they open with
 * (`protectedImageOf`), the placeholder appended under that key (`prepareSignature` given the password), and `main`'s
 * fill (`signPrepared`). What a case then asserts is read from the SIGNED FILE, never from the steps that made it.
 *
 * The certificate is minted per run, `documentSign.test.ts`' reason.
 */

const PASSPHRASE = 'protected-signing';
const USER = 'open-me';
const OWNER = 'own-me';

let unsigned: ByteImage;
let certificate: Uint8Array;

beforeAll(async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([400, 600]).drawText('A protected document to sign', { font, size: 18, x: 20, y: 540 });
  unsigned = await document.save();

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  const attrs = [{ name: 'commonName', value: 'Monstera Test' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], PASSPHRASE, { algorithm: '3des' });
  const der = forge.asn1.toDer(p12).getBytes();
  certificate = Uint8Array.from(der, (character: string) => character.charCodeAt(0));
}, 60_000);

const command = {
  kind: 'signDocument' as const,
  bytes: new Uint8Array(),
  passphrase: PASSPHRASE,
  name: 'Grace Hopper',
  reason: 'I approve this protected document',
};

/** A drawn look, one stroke, placed on the first page. Typed from the command, so a wrong shape does not compile. */
const VISIBLE: NonNullable<CommandOfKind<'signDocument'>['appearance']> = {
  page: 0,
  rect: { x0: 40, y0: 40, x1: 240, y1: 100 },
  mark: {
    kind: 'drawn',
    strokes: [
      [
        [0.05, 0.1],
        [0.5, 0.3],
        [0.95, 0.05],
      ],
    ],
  },
};

/** `unsigned`, protected with both passwords, written and opened again with `password`. */
async function protectedBytes(): Promise<ByteImage> {
  const session = await mupdfWriter.open(unsigned);
  try {
    await applySetDocumentProtection(session, {
      kind: 'setDocumentProtection',
      encryption: 'aes-256',
      userPassword: USER,
      ownerPassword: OWNER,
      permissions: ['print'],
    });
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Signs `session` the way the host does, and answers the signed bytes and the protected bytes they were appended to. */
async function signed(
  session: MupdfSession,
  extra: Partial<typeof command> & { readonly appearance?: typeof VISIBLE } = {},
): Promise<{ readonly before: ByteImage; readonly after: ByteImage }> {
  const signing = { ...command, ...extra, bytes: certificate };
  const protection = await protectedImageOf(session);
  if (protection === undefined) throw new Error('the case expected a protected session');
  const prepared = await prepareSignature(protection.image, placeholderRequestOf(signing), { password: protection.password });
  return { before: protection.image, after: await signPrepared(prepared, signing, NO_TIMESTAMPS) };
}

/** What a fresh open of `bytes` with `password` reads: the access it was granted, and every signature. */
async function readBack(bytes: ByteImage, password?: string) {
  const session = await mupdfWriter.open(bytes, password);
  try {
    return await readSignatures(session, bytes);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** The `/Contents` hex of every signature in `bytes`, read from the raw file. */
function contentsHex(bytes: ByteImage): string[] {
  return [...Buffer.from(bytes).toString('latin1').matchAll(/\/Contents <([0-9A-Fa-f]{64,})>/gu)].map((match) => match[1] ?? '');
}

describe('a signature on a protected document (ADR-0227)', () => {
  it('is APPENDED to the protected bytes, which are left exactly as they were', async () => {
    const session = await mupdfWriter.open(await protectedBytes(), USER);
    try {
      const { before, after } = await signed(session);
      expect(Buffer.from(after.subarray(0, before.byteLength)).equals(Buffer.from(before))).toBe(true);
      expect(after.byteLength).toBeGreaterThan(before.byteLength);
    } finally {
      await mupdfWriter.close(session);
    }
  }, 60_000);

  it('STAYS PROTECTED: the signed file refuses an open with no password, and opens with each of its two', async () => {
    const session = await mupdfWriter.open(await protectedBytes(), USER);
    try {
      const { after } = await signed(session);
      await expect(mupdfWriter.open(after)).rejects.toThrow();
      for (const password of [USER, OWNER]) {
        const read = await readBack(after, password);
        expect(read.map((signature) => [signature.signer, signature.coversDocument, signature.coversWholeFile])).toStrictEqual([
          ['Grace Hopper', true, true],
        ]);
      }
    } finally {
      await mupdfWriter.close(session);
    }
  }, 60_000);

  it('writes the signature’s /Contents IN CLEAR (a DER SEQUENCE) and every other new string encrypted', async () => {
    const session = await mupdfWriter.open(await protectedBytes(), USER);
    try {
      const { before, after } = await signed(session);
      const appended = Buffer.from(after.subarray(before.byteLength)).toString('latin1');
      const [hex] = contentsHex(after);
      // A PKCS#7 SignedData is a DER SEQUENCE with a long length: 30 82. Encrypted, it would be noise.
      expect(hex?.slice(0, 4).toLowerCase()).toBe('3082');
      // CONTROL, in the same revision: the reason and the signer's name are not readable in the file.
      expect(appended.includes('I approve this protected document')).toBe(false);
      expect(appended.includes('Grace Hopper')).toBe(false);
    } finally {
      await mupdfWriter.close(session);
    }
  }, 60_000);

  it('places a VISIBLE signature: the widget has its rectangle and an appearance, and the signature covers the file', async () => {
    const session = await mupdfWriter.open(await protectedBytes(), USER);
    try {
      const { after } = await signed(session, { appearance: VISIBLE });
      const read = await readBack(after, USER);
      expect(read.map((signature) => signature.coversDocument)).toStrictEqual([true]);
      const opened = await mupdfWriter.open(after, USER);
      try {
        const widget = (await readSignatureWidgets(opened))[0];
        expect(widget?.rect).toStrictEqual([40, 40, 240, 100]);
        expect(widget?.hasAppearance).toBe(true);
      } finally {
        await mupdfWriter.close(opened);
      }
    } finally {
      await mupdfWriter.close(session);
    }
  }, 60_000);

  it('signs an ALREADY-SIGNED protected document: the first signature keeps its bytes and both verify', async () => {
    const first = await mupdfWriter.open(await protectedBytes(), USER);
    let once: ByteImage;
    try {
      once = (await signed(first)).after;
    } finally {
      await mupdfWriter.close(first);
    }
    const second = await mupdfWriter.open(once, USER);
    try {
      const { before, after } = await signed(second, { name: 'Second signer' });
      // THE SESSION'S SERIALISE OF A SIGNED DOCUMENT APPENDS (ADR-0008 rule 2), so the protected bytes ARE the first file.
      expect(Buffer.from(before).equals(Buffer.from(once))).toBe(true);
      const read = await readBack(after, USER);
      expect(read.map((signature) => [signature.signer, signature.coversDocument, signature.coversWholeFile])).toStrictEqual([
        ['Grace Hopper', true, false],
        ['Second signer', true, true],
      ]);
    } finally {
      await mupdfWriter.close(second);
    }
  }, 120_000);

  it('signs a signed protected file whose object numbers have a GAP, which a compacted readable copy would renumber', async () => {
    // THE HARD SHAPE. A file that is already signed serialises by APPENDING, so a gap another program left (an object
    // nothing references) is still there when it is signed. A readable copy written with `garbage=compact` would shift
    // every later number, and the revision's page and catalogue would be copied onto other objects. Measured: with that
    // one option this case and the already-signed one go red, and the plain `garbage` the copy uses keeps them green.
    const withGap = await PDFDocument.load(unsigned, { updateMetadata: false });
    withGap.context.register(withGap.context.obj({ Orphan: true }));
    const signedPlain = await signedUnprotected(await withGap.save({ useObjectStreams: false }));
    const image = protectedWithoutCollecting(signedPlain);
    const session = await mupdfWriter.open(image, USER);
    try {
      const { before, after } = await signed(session, { name: 'Second signer' });
      expect(Buffer.from(before).equals(Buffer.from(image))).toBe(true);
      const read = await readBack(after, USER);
      expect(read.map((signature) => [signature.signer, signature.coversDocument])).toContainEqual(['Second signer', true]);
      // THE PAGE IS STILL THE PAGE: a revision copied onto the wrong numbers loses it.
      const opened = await mupdfWriter.open(after, USER);
      try {
        expect(await readSignatureWidgets(opened)).toHaveLength(2);
      } finally {
        await mupdfWriter.close(opened);
      }
    } finally {
      await mupdfWriter.close(session);
    }
  }, 120_000);

  it('signs a document opened with its OWNER password, which the pdf-lib route has to refuse (ADR-0220)', async () => {
    const session = await mupdfWriter.open(await protectedBytes(), OWNER);
    try {
      const { after } = await signed(session);
      const read = await readBack(after, USER);
      expect(read.map((signature) => signature.coversDocument)).toStrictEqual([true]);
    } finally {
      await mupdfWriter.close(session);
    }
  }, 60_000);

  it('CONTROL: without the password the placeholder is placed on the protected bytes, and pdf-lib refuses them', async () => {
    const session = await mupdfWriter.open(await protectedBytes(), USER);
    try {
      const protection = await protectedImageOf(session);
      if (protection === undefined) throw new Error('the case expected a protected session');
      await expect(prepareSignature(protection.image, placeholderRequestOf({ ...command, bytes: certificate }))).rejects.toThrow(
        /encrypted/iu,
      );
    } finally {
      await mupdfWriter.close(session);
    }
  }, 60_000);

  it('CONTROL: an unprotected session has no protected image, so it is signed as it always was', async () => {
    const session = await mupdfWriter.open(unsigned);
    try {
      expect(await protectedImageOf(session)).toBeUndefined();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('verifies with poppler’s pdfsig, an outside validator, where it is installed', async (context) => {
    const probe = spawnSync('pdfsig', ['-v'], { encoding: 'utf8' });
    if (probe.error !== undefined) {
      context.skip();
      return;
    }
    const session = await mupdfWriter.open(await protectedBytes(), USER);
    const folder = mkdtempSync(join(tmpdir(), 'monstera-protected-sign-'));
    try {
      const { after } = await signed(session, { appearance: VISIBLE });
      const file = join(folder, 'signed.pdf');
      writeFileSync(file, after);
      const checked = spawnSync('pdfsig', ['-upw', USER, file], { encoding: 'utf8' });
      expect(checked.stdout).toContain('Signature Validation: Signature is Valid.');
      expect(checked.stdout).toContain('Total document signed');
    } finally {
      rmSync(folder, { recursive: true, force: true });
      await mupdfWriter.close(session);
    }
  }, 60_000);
});

describe('appendedUnderKey: a created object gets a NEW number in the protected file', () => {
  it('never writes over an object the protected file has, whatever number the readable revision gave it', async () => {
    const image = await protectedBytes();
    // A REVISION THAT CALLS OBJECT 1 CREATED (`existing: 0`): kept at its number, the copy would land on the protected
    // file's object 1, which is the shape of a readable copy's next free number being this file's `/Encrypt`.
    const appended = await appendedUnderKey(image, USER, (readable) =>
      Promise.resolve({ bytes: readable, written: [1], existing: 0 }),
    );
    const revision = Buffer.from(appended.subarray(image.byteLength)).toString('latin1');
    const numbers = [...revision.matchAll(/^(\d+) 0 obj$/gmu)].map((match) => Number(match[1]));
    expect(numbers).toHaveLength(1);
    expect(numbers).not.toContain(1);
    // AND THE FILE STILL OPENS with its password: nothing it had was written over.
    const session = await mupdfWriter.open(appended, USER);
    await mupdfWriter.close(session);
  }, 60_000);
});

/** `bytes` signed by the unprotected route, the one every signature before ADR-0227 took. */
function signedUnprotected(bytes: ByteImage): Promise<ByteImage> {
  return applySignDocument(bytes, { ...command, bytes: certificate, name: 'First signer' });
}

/** `bytes` protected by MuPDF WITHOUT collecting, as another program may write a file: every object keeps its number. */
function protectedWithoutCollecting(bytes: ByteImage): ByteImage {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  try {
    if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
    return document.saveToBuffer(`encrypt=aes-256,user-password=${USER},owner-password=${OWNER}`).asUint8Array().slice();
  } finally {
    document.destroy();
  }
}

/** Each signature widget's rectangle and whether it carries a normal appearance, read through the engine. */
async function readSignatureWidgets(
  session: MupdfSession,
): Promise<readonly { readonly rect: readonly number[]; readonly hasAppearance: boolean }[]> {
  const { withDocument } = await import('./mupdfWriter.js');
  return withDocument(session, (document) => {
    const found: { rect: number[]; hasAppearance: boolean }[] = [];
    const fields = document.getTrailer().get('Root').get('AcroForm').get('Fields');
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields.get(index);
      if (field.get('FT').asName() !== 'Sig') continue;
      const rect = field.get('Rect');
      found.push({
        rect: [0, 1, 2, 3].map((at) => rect.get(at).asNumber()),
        // AN INVISIBLE WIDGET HAS NO `/AP`, and a lookup on MuPDF's null object throws rather than answering null.
        hasAppearance: !field.get('AP').isNull() && field.get('AP').get('N').isStream(),
      });
    }
    return found;
  });
}

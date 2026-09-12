import {
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  StandardFonts,
} from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';
import forge from 'node-forge';
import { beforeAll, describe, expect, it } from 'vitest';

import { applySignDocument, withSignaturePlaceholder } from './documentSign.js';
import type { ByteImage } from './engineSeam.js';
import { mupdfWriter } from './mupdfWriter.js';
import {
  SignatureAppearanceRefusedError,
  SignatureCredentialRefusedError,
} from './signingRefusals.js';
import { readSignatures } from './signatureRead.js';

/**
 * Signing — Stage 7's PKCS#7 row, paying ADR-0054's gate.
 *
 * ## The certificate is MINTED HERE, not committed
 *
 * B10 forbids committing a binary and an unvetted fixture, and a private key is
 * the worst example of both. `node-forge` builds a self-signed P12 in memory
 * for each run, exactly as the gate's own spike did — so nothing on disk is a
 * credential and nothing has to be rotated.
 *
 * ## The load-bearing case does NOT ask the signer whether it worked
 *
 * That is the gate's own sentence and it is the point: a signature that
 * "worked" over the wrong bytes is the failure nothing else here would see. The
 * case recomputes SHA-256 over the two covered spans and compares it with the
 * `messageDigest` attribute the signature actually attests.
 */
let unsigned: ByteImage;
let certificate: Uint8Array;

const PASSPHRASE = 'spike-passphrase';

beforeAll(async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([400, 600]).drawText('A document to sign', { font, size: 18, x: 20, y: 540 });
  unsigned = await document.save();

  // A SELF-SIGNED P12, built the way ADR-0054's spike built one.
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  const attrs = [
    { name: 'commonName', value: 'Monstera Test' },
    { name: 'organizationName', value: 'Tenslor Inc.' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], PASSPHRASE, {
    algorithm: '3des',
  });
  const der = forge.asn1.toDer(p12).getBytes();
  certificate = Uint8Array.from(der, (character: string) => character.charCodeAt(0));
}, 60_000);

/** The command every case here signs with. */
const command = {
  kind: 'signDocument' as const,
  bytes: new Uint8Array(),
  passphrase: PASSPHRASE,
  name: 'Grace Hopper',
  reason: 'I approve this document',
  location: 'Arlington',
};

describe('the placeholder this build writes', () => {
  it('carries the literal token shape `findByteRange` requires', async () => {
    // ADR-0054 Decision 3. Four NUMBERS is the obvious shape and is refused
    // with a message that names the wrong thing, so this asserts the shape
    // rather than trusting that signing later succeeds — a case that only ever
    // saw a signed file could not tell a correct placeholder from one the
    // signer happened to tolerate.
    //
    // **THE SPACING IS pdf-lib's, and it is not the ADR's.** Decision 3 writes
    // the requirement as `/ByteRange [0 /********** …]`; `@cantoo/pdf-lib`
    // serialises an array as `[ 0 /********** … ]`, with spaces inside the
    // brackets, and `@signpdf` accepts it — the gate case below signs this very
    // document. So what the ADR pins is the **token shape** (a number then
    // three names of ten asterisks) rather than a byte-exact string, and this
    // case asserts the tokens in the order they must appear.
    const placed = await withSignaturePlaceholder(unsigned, { ...command, bytes: certificate });
    const text = Buffer.from(placed).toString('latin1');
    // The slot ESCAPED, one backslash per asterisk: `*` is a quantifier, and
    // the first draft interpolated ten of them unescaped and produced
    // *Nothing to repeat* — a regular expression that refuses to compile,
    // which is at least loud.
    const slot = '\\*'.repeat(10);
    expect(text).toMatch(
      new RegExp(`/ByteRange \\[\\s*0\\s+/${slot}\\s+/${slot}\\s+/${slot}\\s*\\]`, 'u'),
    );
  });

  it('is NOT compressed into an object stream, which is what the signer reads', async () => {
    // ADR-0054 Decision 3's second constraint: `@signpdf` locates the
    // `/Contents` hole in the raw bytes. A compressed signature dictionary is
    // invisible to it, and the failure is *no byte range found* rather than
    // anything naming compression.
    const placed = await withSignaturePlaceholder(unsigned, { ...command, bytes: certificate });
    const text = Buffer.from(placed).toString('latin1');
    expect(text).toContain('/Type /Sig');
    expect(text).toContain('/SubFilter /adbe.pkcs7.detached');
  });

  it('registers the field in /AcroForm with /SigFlags and one entry in /Fields', async () => {
    // BOTH HALVES, because either alone passes for a placeholder a reader would
    // not treat as a signature: `/SigFlags` without a field is a document that
    // announces a signature it does not have, and a field without the flag is
    // one some readers never look for.
    const placed = await withSignaturePlaceholder(unsigned, { ...command, bytes: certificate });
    const back = await PDFDocument.load(placed, { updateMetadata: false });
    const acroForm = back.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    expect(acroForm).toBeDefined();
    expect(acroForm?.lookup(PDFName.of('SigFlags'), PDFNumber).asNumber()).toBe(3);
    expect(acroForm?.lookup(PDFName.of('Fields'), PDFArray).size()).toBe(1);
  });
});

describe('a CERTIFYING signature', () => {
  it('writes both halves — the /DocMDP transform AND the catalogue’s /Perms', async () => {
    // BOTH, because a reader honours neither alone: `/Reference` without
    // `/Perms` is a transform nothing points at, and `/Perms` without
    // `/Reference` names a signature that makes no claim. Either alone would
    // produce a document that opens, signs and verifies, and certifies nothing.
    const placed = await withSignaturePlaceholder(unsigned, {
      ...command,
      bytes: certificate,
      certify: 'form-fill',
    });
    const text = Buffer.from(placed).toString('latin1');
    expect(text).toContain('/TransformMethod /DocMDP');
    expect(text).toContain('/Perms');
    // `/P 2` — ISO 32000-2 table 257's *filling in forms and signing is
    // permitted*. The number is asserted rather than the word, because the
    // number is what a reader acts on and the mapping is this build's.
    expect(text).toMatch(/\/P 2\b/u);
  });

  it('CONTROL: an ordinary signature writes NEITHER', async () => {
    // Without this, a placeholder that always certified would pass the case
    // above — and every approval signature in the product would silently claim
    // authorship and lock the document.
    const placed = await withSignaturePlaceholder(unsigned, { ...command, bytes: certificate });
    const text = Buffer.from(placed).toString('latin1');
    expect(text).not.toContain('DocMDP');
    expect(text).not.toContain('/Perms');
  });

  it('the three levels write three different /P values', async () => {
    // The mapping is the whole of what this build contributes here, and a table
    // that answered one number for every word would pass the case above.
    const levels = ['no-changes', 'form-fill', 'form-fill-and-annotate'] as const;
    const written = await Promise.all(
      levels.map(async (certify) => {
        const placed = await withSignaturePlaceholder(unsigned, {
          ...command,
          bytes: certificate,
          certify,
        });
        return /\/P (\d)\b/u.exec(Buffer.from(placed).toString('latin1'))?.[1];
      }),
    );
    expect(written).toStrictEqual(['1', '2', '3']);
  });
});

describe('applySignDocument', () => {
  it('signs, and the signed file is EXACTLY as long as its placeholder', async () => {
    // The property the whole scheme rests on, and the apply asserts it too —
    // this is the case that says the assertion can be true.
    const placed = await withSignaturePlaceholder(unsigned, { ...command, bytes: certificate });
    const signed = await applySignDocument(unsigned, { ...command, bytes: certificate });
    expect(signed.byteLength).toBe(placed.byteLength);
  }, 60_000);

  it('THE GATE: the messageDigest matches SHA-256 of exactly the covered ranges', async () => {
    // ADR-0054's own verification, without asking the signer whether it worked.
    const signed = await applySignDocument(unsigned, { ...command, bytes: certificate });
    const text = Buffer.from(signed).toString('latin1');

    const ranges = /\/ByteRange \[(\d+) (\d+) (\d+) (\d+)\]/u.exec(text);
    expect(ranges, 'the signed file carries a resolved byte range').not.toBeNull();
    if (ranges === null) return;
    const [a, b, c, d] = [
      Number(ranges[1]),
      Number(ranges[2]),
      Number(ranges[3]),
      Number(ranges[4]),
    ];
    // THE RANGES DESCRIBE THE FILE THEY ARE IN, which is the claim a reader
    // takes on trust: the two spans plus the hole are the whole document.
    expect(b + d + (c - b)).toBe(signed.byteLength);

    const covered = Buffer.concat([
      Buffer.from(signed.subarray(a, a + b)),
      Buffer.from(signed.subarray(c, c + d)),
    ]);
    const digest = forge.md.sha256.create();
    digest.update(covered.toString('latin1'));

    // THE SIGNATURE'S OWN ATTESTATION, parsed out of the PKCS#7 rather than
    // recomputed from anything this test controls.
    const hole = /\/Contents <([0-9A-Fa-f]+)>/u.exec(text);
    expect(hole, 'the signed file carries a PKCS#7 blob').not.toBeNull();
    if (hole === null) return;
    // THE PADDING IS TRIMMED BY BYTE, not by hex character — and the first
    // draft trimmed characters, which is a flake with a clock in it. The P12
    // is minted per run, so the signature's length varies; whenever its last
    // byte happened to end in a `0` nibble, `replace(/0+$/)` ate half a byte
    // and left an odd-length string, and node-forge answered *Too few bytes to
    // read ASN.1 value*. It passed for several runs before it did not.
    const whole = Buffer.from(hole[1] ?? '', 'hex');
    let end = whole.length;
    while (end > 0 && whole[end - 1] === 0) end -= 1;
    const der = whole.subarray(0, end).toString('latin1');
    const message = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der)) as unknown as {
      rawCapture: { authenticatedAttributes: unknown[] };
    };

    // THE OID FROM THE TABLE, and its absence is a throw rather than a `find`
    // that silently matches nothing: `forge.pki.oids` is typed as an index
    // signature, so a mistyped key reads as `undefined` and every attribute
    // would then "contain" it.
    const messageDigestOid = forge.pki.oids['messageDigest'];
    expect(messageDigestOid, 'node-forge knows the messageDigest OID').toBeDefined();
    if (messageDigestOid === undefined) return;

    const attributes = message.rawCapture.authenticatedAttributes;
    const attested = attributes
      .map((attribute) => forge.asn1.toDer(attribute as never).getBytes())
      .find((bytes) => bytes.includes(forge.asn1.oidToDer(messageDigestOid).getBytes()));
    expect(attested, 'the signature carries a messageDigest attribute').toBeDefined();
    expect(attested).toContain(digest.digest().getBytes());
  }, 60_000);

  it('CONTROL: a WRONG passphrase refuses rather than signing something', async () => {
    // Without this the cases above are satisfied by a signer that ignores the
    // credential entirely — which would sign every document with whatever key
    // it found first.
    //
    // BY NAME, because main answers `wrong-passphrase` for this class and for
    // nothing else — so `rejects.toThrow()` would pass for a signer whose
    // refusal arrived unnamed and was then reported to a person as `internal`.
    await expect(
      applySignDocument(unsigned, { ...command, bytes: certificate, passphrase: 'not-it' }),
    ).rejects.toBeInstanceOf(SignatureCredentialRefusedError);
  }, 60_000);

  it('CONTROL: a file that is not a PKCS#12 refuses, and by the same name', async () => {
    // THE SAME CLASS, and that is the format's limit: the MAC check fails
    // identically for both, so nothing downstream of the signer can separate
    // them either (`signingRefusals.ts`).
    await expect(
      applySignDocument(unsigned, { ...command, bytes: unsigned }),
    ).rejects.toBeInstanceOf(SignatureCredentialRefusedError);
  }, 60_000);
});

/**
 * Reading back what was just signed — the verification row, end to end.
 *
 * ## The two halves are tested TOGETHER because neither is the claim alone
 *
 * A verifier that always answers *intact* passes every case over a correctly
 * signed document. What separates it is a document that was signed and then
 * **changed**, and the only honest way to make one is to sign and then edit.
 */
describe('readSignatures', () => {
  it('CONTROL: an unsigned document reports no signatures', async () => {
    const session = await mupdfWriter.open(unsigned);
    try {
      expect(await readSignatures(session, unsigned)).toStrictEqual([]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('reads the signer, the organisation and the reason back out', async () => {
    const signed = await applySignDocument(unsigned, { ...command, bytes: certificate });
    const session = await mupdfWriter.open(signed);
    try {
      const [read] = await readSignatures(session, signed);
      expect(read).toBeDefined();
      expect(read?.signer).toBe('Grace Hopper');
      // FROM THE CERTIFICATE, not from the signature dictionary: the `/Name`
      // above is what the signer typed, and this is what their certificate
      // says. A reader that answered both from one source would report a name
      // an issuer never vouched for.
      expect(read?.organisation).toBe('Tenslor Inc.');
      expect(read?.reason).toBe('I approve this document');
    } finally {
      await mupdfWriter.close(session);
    }
  }, 60_000);

  it('THE CLAIM: a freshly signed document reports coversDocument', async () => {
    const signed = await applySignDocument(unsigned, { ...command, bytes: certificate });
    const session = await mupdfWriter.open(signed);
    try {
      const [read] = await readSignatures(session, signed);
      expect(read?.coversDocument).toBe(true);
      expect(read?.coversWholeFile).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  }, 60_000);

  it('THE CONTROL: a document CHANGED after signing reports coversDocument FALSE', async () => {
    // Without this, a verifier that answers `true` unconditionally passes every
    // case above — and a signature indicator that always says *intact* is the
    // specific lie this row exists to prevent.
    const signed = await applySignDocument(unsigned, { ...command, bytes: certificate });

    // ONE BYTE, inside the FIRST covered span, and it is the `/Reason` string
    // rather than the page's text: pdf-lib compresses content streams, so the
    // words on the page are not findable as bytes — the first draft searched
    // for them and got -1. A PDF string in the signature dictionary is plain,
    // is inside the covered range, and leaves the file parseable.
    //
    // The ranges are unchanged, so this is exactly the state a tampered
    // document is in: the signature intact, the bytes it attests not.
    const tampered = Uint8Array.from(signed);
    const at = Buffer.from(signed).indexOf('I approve this document');
    expect(at, 'the reason string is in the signed bytes').toBeGreaterThan(-1);
    tampered[at] = 'X'.charCodeAt(0);

    const session = await mupdfWriter.open(tampered);
    try {
      const [read] = await readSignatures(session, tampered);
      expect(read?.coversDocument).toBe(false);
    } finally {
      await mupdfWriter.close(session);
    }
  }, 60_000);
});

describe('a VISIBLE signature', () => {
  /**
   * A page rendered WITH annotation appearances, and MuPDF's own page transform.
   *
   * **The pixels are the observable**, and the transform is MuPDF's rather than
   * this build's: a case that computed where the box should be with the same
   * arithmetic the writer used would agree with any mistake in it.
   * `pdf_page_transform` is what MuPDF itself draws the page with.
   */
  function rendered(bytes: Uint8Array): {
    readonly width: number;
    readonly samples: Uint8Array;
    readonly transform: readonly number[];
  } {
    const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
    if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
    try {
      const page = document.loadPage(0);
      const pixmap = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceGray, false, true);
      return {
        width: pixmap.getWidth(),
        samples: Uint8Array.from(pixmap.getPixels()),
        transform: [...page.getTransform()],
      };
    } finally {
      document.destroy();
    }
  }

  /** A user-space rectangle's box in rendered pixels, through the page transform. */
  function seen(
    transform: readonly number[],
    rect: { x0: number; y0: number; x1: number; y1: number },
  ): [number, number, number, number] {
    const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = transform;
    const corners = [
      [rect.x0, rect.y0],
      [rect.x1, rect.y1],
    ].map(([x = 0, y = 0]) => [a * x + c * y + e, b * x + d * y + f] as const);
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  /** Dark samples inside a pixel box, and how many distinct columns hold one. */
  function inkIn(
    page: ReturnType<typeof rendered>,
    [left, top, right, bottom]: readonly [number, number, number, number],
  ): { readonly samples: number; readonly columns: number } {
    let samples = 0;
    const columns = new Set<number>();
    for (let y = Math.ceil(top); y < Math.floor(bottom); y += 1) {
      for (let x = Math.ceil(left); x < Math.floor(right); x += 1) {
        if ((page.samples[y * page.width + x] ?? 255) < 128) {
          samples += 1;
          columns.add(x);
        }
      }
    }
    return { samples, columns: columns.size };
  }

  /** The first field's widget, read back with pdf-lib. */
  async function widgetOf(bytes: Uint8Array): Promise<PDFDict> {
    const document = await PDFDocument.load(bytes);
    const fields = document.catalog
      .lookup(PDFName.of('AcroForm'), PDFDict)
      .lookup(PDFName.of('Fields'), PDFArray);
    return fields.lookup(0, PDFDict);
  }

  /** An empty region of the fixture page, drawn right to left and top to bottom. */
  const RECT = { x0: 300, y0: 180, x1: 100, y1: 100 };
  const ORDERED = { x0: 100, y0: 100, x1: 300, y1: 180 };

  let picture: Uint8Array;
  beforeAll(() => {
    // A BLACK PNG, made by the engine rather than committed (B10).
    const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 40, 20], false);
    pixmap.clear(0);
    picture = pixmap.asPNG();
  });

  it('writes the ordered rectangle and an /AP /N stream — and the invisible CONTROL writes neither', async () => {
    const visible = await widgetOf(
      await withSignaturePlaceholder(unsigned, {
        ...command,
        appearance: { page: 0, rect: RECT, mark: { kind: 'typed', text: 'Grace Hopper', font: 'times-italic' } },
      }),
    );
    const rect = visible.lookup(PDFName.of('Rect'), PDFArray).asArray();
    expect(rect.map((value) => (value as PDFNumber).asNumber())).toStrictEqual([100, 100, 300, 180]);
    expect(visible.lookupMaybe(PDFName.of('AP'), PDFDict)?.get(PDFName.of('N'))).toBeDefined();

    const invisible = await widgetOf(await withSignaturePlaceholder(unsigned, command));
    const none = invisible.lookup(PDFName.of('Rect'), PDFArray).asArray();
    expect(none.map((value) => (value as PDFNumber).asNumber())).toStrictEqual([0, 0, 0, 0]);
    expect(invisible.lookupMaybe(PDFName.of('AP'), PDFDict)).toBeUndefined();
  });

  const typedLook: { kind: 'typed'; text: string; font: 'helvetica' } = {
    kind: 'typed',
    text: 'Grace Hopper',
    font: 'helvetica',
  };
  const drawnLook: { kind: 'drawn'; strokes: [number, number][][] } = {
    kind: 'drawn',
    strokes: [
      [
        [0.05, 0.1],
        [0.5, 0.3],
        [0.95, 0.05],
      ],
    ],
  };

  it.each([
    ['typed', typedLook],
    ['drawn', drawnLook],
    ['image', 'picture'],
  ] as const)(
    'THE OBSERVABLE: a %s signature renders INK inside its rectangle and still covers the document',
    async (_look, given) => {
      const mark =
        given === 'picture'
          ? { kind: 'image' as const, bytes: picture, mediaType: 'image/png' as const }
          : given;
      const signed = await applySignDocument(unsigned, {
        ...command,
        bytes: certificate,
        appearance: { page: 0, rect: RECT, mark },
      });

      const page = rendered(signed);
      const box = seen(page.transform, ORDERED);
      expect(inkIn(page, box).samples, 'ink inside the placed rectangle').toBeGreaterThan(50);

      // THE CONTROL: the same box on the invisibly signed document is blank, so
      // the ink above is the appearance and not something the fixture drew.
      const plain = rendered(await applySignDocument(unsigned, { ...command, bytes: certificate }));
      expect(inkIn(plain, seen(plain.transform, ORDERED)).samples).toBe(0);

      // THE APPEARANCE IS INSIDE THE SIGNATURE, not beside it.
      const session = await mupdfWriter.open(signed);
      try {
        const [read] = await readSignatures(session, signed);
        expect(read?.coversDocument).toBe(true);
      } finally {
        await mupdfWriter.close(session);
      }
    },
    60_000,
  );

  it.each([0, 90, 180, 270])('ON A PAGE TURNED %i° the appearance is upright as the page is SEEN', async (turn) => {
    // A HORIZONTAL LINE with a dot BELOW it, and the assertion is about which
    // ROWS hold which. Upright, the topmost inked rows are the line — wide
    // across the box as displayed — and the bottommost are the dot, which is
    // narrow. Without the counter-rotation the line is vertical on screen and no
    // row is wide; with the wrong direction the wide rows are at the bottom. A
    // bounding box cannot tell any of those apart, which is why the first draft
    // of this case, asserting ink in the box's top third, failed on a correct
    // drawing: the kernel CENTRES the ink it fits, and measured at 90° the line
    // sat at rows 188–210 of a box running 100–300.
    const document = await PDFDocument.create();
    document.addPage([400, 600]).setRotation(degrees(turn));
    const turned = await document.save();

    const signed = await withSignaturePlaceholder(turned, {
      ...command,
      appearance: {
        page: 0,
        rect: ORDERED,
        mark: {
          kind: 'drawn',
          strokes: [
            [
              [0, 0],
              [1, 0],
            ],
            [
              [0.5, 0.3],
              [0.5, 0.3],
            ],
          ],
        },
      },
    });

    const page = rendered(signed);
    const [left, top, right, bottom] = seen(page.transform, ORDERED);
    const across = right - left;

    // THE INK, ONE ROW AT A TIME, grouped into runs of consecutive inked rows:
    // the line is one run and the dot, a gap below it, is another.
    const groups: number[][] = [];
    let previous = Number.NEGATIVE_INFINITY;
    for (let row = Math.ceil(top); row < Math.floor(bottom); row += 1) {
      const { columns } = inkIn(page, [left, row, right, row + 1]);
      if (columns === 0) continue;
      if (row !== previous + 1) groups.push([]);
      groups[groups.length - 1]?.push(columns);
      previous = row;
    }

    expect(groups.length, 'a line and, separately, a dot').toBe(2);
    expect(Math.max(...(groups[0] ?? [0])) / across, 'the LINE is on top, as seen').toBeGreaterThan(0.6);
    expect(Math.max(...(groups[1] ?? [across])) / across, 'the DOT is below it').toBeLessThan(0.2);
  });

  it('REFUSES text the chosen font cannot encode, by name', async () => {
    const refused = applySignDocument(unsigned, {
      ...command,
      bytes: certificate,
      appearance: { page: 0, rect: RECT, mark: { kind: 'typed', text: 'Grace ✓', font: 'courier' } },
    });
    await expect(refused).rejects.toBeInstanceOf(SignatureAppearanceRefusedError);
    await expect(refused).rejects.toMatchObject({ reason: 'unencodable-text' });
  });

  it.each(['image/png', 'image/jpeg'] as const)(
    'REFUSES a %s its decoder cannot read, by name',
    async (mediaType) => {
      const refused = applySignDocument(unsigned, {
        ...command,
        bytes: certificate,
        appearance: {
          page: 0,
          rect: RECT,
          mark: { kind: 'image', bytes: Uint8Array.of(1, 2, 3, 4), mediaType },
        },
      });
      await expect(refused).rejects.toMatchObject({ reason: 'unreadable-image' });
    },
  );

  it('REFUSES a page the document does not have, and a rectangle with no area', async () => {
    const typed = { kind: 'typed', text: 'Grace Hopper', font: 'courier' } as const;
    await expect(
      withSignaturePlaceholder(unsigned, { ...command, appearance: { page: 1, rect: RECT, mark: typed } }),
    ).rejects.toThrow(/outside this document/);
    await expect(
      withSignaturePlaceholder(unsigned, {
        ...command,
        appearance: { page: 0, rect: { x0: 100, y0: 100, x1: 100, y1: 180 }, mark: typed },
      }),
    ).rejects.toThrow(/area/);
  });
});

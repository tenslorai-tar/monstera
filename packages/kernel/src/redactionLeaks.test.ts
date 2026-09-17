import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFStream,
  PDFString,
  StandardFonts,
  TextRenderingMode,
  concatTransformationMatrix,
  decodePDFRawStream,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setTextRenderingMode,
} from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { MupdfSession } from './engineSeam.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { applyApplyRedactions } from './pageRedact.js';

/**
 * The redaction leak corpus: seven places a redacted secret can survive a burn-in.
 *
 * ## Read back by a DIFFERENT reader
 *
 * MuPDF writes the burn-in, so MuPDF reading it back shares every blind spot it has.
 * pdf-lib parses the serialised bytes here and walks every indirect object, decoding
 * each stream it can and REFUSING one it cannot — a stream this reader cannot decode
 * is *could not look*, never *found nothing*.
 *
 * ## Every fixture has a control that runs the SAME pipeline
 *
 * The mark is placed away from the secret, the same burn-in runs, the same serialise
 * rewrites the page, and the reader must find the secret. Without that, a secret the
 * reader cannot see after MuPDF's rewrite — a string split by kerning, a re-encoded
 * image — would pass as removed.
 */

const SECRET = 'Salary 91000 GBP';
const PAGE: readonly [number, number] = [612, 792];

/** Where the secret sits, in PDF user space, and the same box in MuPDF's page space. */
const SECRET_BOX = { x: 72, y: 690, width: 300, height: 30 } as const;
/** A region of the same page with nothing in it. */
const EMPTY_BOX = { x: 72, y: 100, width: 300, height: 30 } as const;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A `/Redact` over `box`, given in PDF user space, converted to MuPDF's y-down page space. */
function mark(session: MupdfSession, box: Box): Promise<void> {
  return withDocument(session, (document) => {
    const page = document.loadPage(0);
    const annotation = page.createAnnotation('Redact');
    const top = PAGE[1] - (box.y + box.height);
    annotation.setRect([box.x, top, box.x + box.width, top + box.height]);
    annotation.update();
  });
}

/** Opens `bytes`, marks `box`, burns in, and answers the serialised result. */
async function burnIn(bytes: Uint8Array, box: Box): Promise<Uint8Array> {
  const session = await mupdfWriter.open(bytes);
  try {
    await mark(session, box);
    await applyApplyRedactions(session, {
      kind: 'applyRedactions',
      pages: [0],
      cover: 'solid',
      images: 'pixels',
    });
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

const HEX = [...new TextEncoder().encode(SECRET)]
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

/** Every place the secret's text is spelt anywhere in the file, by pdf-lib. */
async function secretSites(bytes: Uint8Array): Promise<string[]> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const sites: string[] = [];

  const visit = (value: unknown, path: string): void => {
    if (value instanceof PDFString || value instanceof PDFHexString) {
      if (value.decodeText().includes(SECRET)) sites.push(`string ${path}`);
    } else if (value instanceof PDFArray) {
      value.asArray().forEach((item, at) => { visit(item, `${path}[${String(at)}]`); });
    } else if (value instanceof PDFDict) {
      for (const [key, item] of value.entries()) visit(item, `${path}${key.asString()}`);
    }
  };

  for (const [ref, object] of document.context.enumerateIndirectObjects()) {
    const at = `${String(ref.objectNumber)} 0 R`;
    if (object instanceof PDFStream) {
      visit(object.dict, at);
      if (!(object instanceof PDFRawStream)) throw new Error(`${at}: a stream this reader cannot decode`);
      const decoded = new TextDecoder('latin1').decode(decodePDFRawStream(object).decode());
      const spelt = decoded.toLowerCase();
      if (decoded.includes(SECRET) || spelt.includes(HEX)) sites.push(`stream ${at}`);
    } else {
      visit(object, at);
    }
  }
  return sites;
}

async function fixture(build: (document: PDFDocument) => Promise<void> | void): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([...PAGE]);
  await build(document);
  return document.save({ useObjectStreams: false });
}

const onPage = (document: PDFDocument) => document.getPage(0);

/** THE TEXT LAYER: the secret drawn as ordinary text. */
const textLayer = () =>
  fixture(async (document) => {
    const font = await document.embedFont(StandardFonts.Helvetica);
    onPage(document).drawText(SECRET, { font, size: 18, x: 76, y: 698 });
  });

/** AN OCR LAYER: the same text in render mode 3, which is how a recognised scan carries it. */
const ocrLayer = () =>
  fixture(async (document) => {
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = onPage(document);
    page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
    page.drawText(SECRET, { font, size: 18, x: 76, y: 698 });
  });

/** A FORM FIELD whose value is the secret, with its widget under the mark. */
const formValue = () =>
  fixture((document) => {
    const field = document.getForm().createTextField('salary');
    field.setText(SECRET);
    field.addToPage(onPage(document), { ...SECRET_BOX });
  });

/** THE OTHER FIELD SHAPE: one dictionary that is both the field and its widget. */
const mergedFormValue = () =>
  fixture((document) => {
    const { context } = document;
    const field = context.register(
      context.obj({
        Type: 'Annot',
        Subtype: 'Widget',
        FT: 'Tx',
        T: PDFString.of('salary'),
        V: PDFString.of(SECRET),
        Rect: [SECRET_BOX.x, SECRET_BOX.y, SECRET_BOX.x + SECRET_BOX.width, SECRET_BOX.y + SECRET_BOX.height],
      }),
    );
    onPage(document).node.addAnnot(field);
    document.catalog.set(PDFName.of('AcroForm'), context.obj({ Fields: [field] }));
  });

/**
 * A LINK under the mark whose address carries the secret — the class `getAnnotations()`
 * hides, so the burn-in reaches it by a separate call.
 */
const linkAddress = () =>
  fixture((document) => {
    const { context } = document;
    const link = context.register(
      context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [SECRET_BOX.x, SECRET_BOX.y, SECRET_BOX.x + SECRET_BOX.width, SECRET_BOX.y + SECRET_BOX.height],
        A: { S: 'URI', URI: PDFString.of(`https://example.invalid/?q=${SECRET}`) },
      }),
    );
    onPage(document).node.addAnnot(link);
  });

/** AN ANNOTATION under the mark whose contents are the secret. */
const annotationContents = () =>
  fixture((document) => {
    const { context } = document;
    const note = context.register(
      context.obj({
        Type: 'Annot',
        Subtype: 'Square',
        Rect: [SECRET_BOX.x, SECRET_BOX.y, SECRET_BOX.x + SECRET_BOX.width, SECRET_BOX.y + SECRET_BOX.height],
        Contents: PDFString.of(SECRET),
      }),
    );
    onPage(document).node.addAnnot(note);
  });

/** XMP AND INFO: the secret in the document's metadata, beside the same text on the page. */
const metadata = () =>
  fixture(async (document) => {
    const font = await document.embedFont(StandardFonts.Helvetica);
    onPage(document).drawText('Payroll', { font, size: 18, x: 76, y: 698 });
    document.setSubject(SECRET);
    const xmp =
      '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">' +
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" ' +
      `xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description>${SECRET}</dc:description>` +
      '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
    const stream = document.context.register(
      document.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' }),
    );
    document.catalog.set(PDFName.of('Metadata'), stream);
  });

describe('the redaction leak corpus', () => {
  const textCases = [
    ['the text layer', textLayer],
    ['an OCR layer in render mode 3', ocrLayer],
    ['a form field value under the mark', formValue],
    ['a field merged with its widget, under the mark', mergedFormValue],
    ['annotation contents under the mark', annotationContents],
    ['a link address under the mark', linkAddress],
  ] as const;

  for (const [name, build] of textCases) {
    describe(name, () => {
      it('CONTROL: a mark elsewhere on the page, through the same burn-in, leaves the secret readable', async () => {
        const sites = await secretSites(await burnIn(await build(), EMPTY_BOX));
        expect(sites.length).toBeGreaterThan(0);
      });

      it('a mark over it leaves the secret nowhere in the file', async () => {
        const sites = await secretSites(await burnIn(await build(), SECRET_BOX));
        expect(sites).toStrictEqual([]);
      });
    });
  }
});

describe('the redaction leak corpus: XMP and Info metadata', () => {
  // NO REGION CAN BE MATCHED TO METADATA, so a burn-in anywhere removes it whole
  // (ADR-0079) and a mark elsewhere is not a control here: its control is a serialise
  // that burns nothing in, which must keep both copies.
  it('CONTROL: a serialise that burns nothing in keeps the secret in both', async () => {
    const session = await mupdfWriter.open(await metadata());
    try {
      const sites = await secretSites(await mupdfWriter.serialise(session));
      expect(sites.some((site) => site.endsWith('/Subject'))).toBe(true);
      expect(sites.some((site) => site.startsWith('stream'))).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a burn-in removes the XMP packet and the Info dictionary', async () => {
    expect(await secretSites(await burnIn(await metadata(), SECRET_BOX))).toStrictEqual([]);
  });
});

/** A PAGE THUMBNAIL: a picture of the page before the burn-in, whatever it shows. */
const thumbnail = () =>
  fixture((document) => {
    const { context } = document;
    const image = context.register(
      context.stream(new Uint8Array([200, 30, 30]), {
        Width: 1,
        Height: 1,
        ColorSpace: 'DeviceRGB',
        BitsPerComponent: 8,
      }),
    );
    onPage(document).node.set(PDFName.of('Thumb'), image);
  });

async function hasThumbnail(bytes: Uint8Array): Promise<boolean> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return document.getPage(0).node.has(PDFName.of('Thumb'));
}

describe('the redaction leak corpus: a page thumbnail', () => {
  it('CONTROL: the thumbnail survives a serialise that burns nothing in', async () => {
    const session = await mupdfWriter.open(await thumbnail());
    try {
      expect(await hasThumbnail(await mupdfWriter.serialise(session))).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a burn-in on the page drops the thumbnail that still pictures what was removed', async () => {
    expect(await hasThumbnail(await burnIn(await thumbnail(), SECRET_BOX))).toBe(false);
  });
});

/** An IMAGE under a black rectangle: the cover somebody drew, and the pixels beneath it. */
const PATTERN = [0x5a, 0xa5, 0x3c] as const;
const IMAGE_BOX = { x: 72, y: 500, width: 200, height: 100 } as const;

const coveredImage = () =>
  fixture((document) => {
    const { context } = document;
    const [width, height] = [40, 20];
    const samples = new Uint8Array(width * height * 3);
    for (let at = 0; at < samples.length; at += 3) samples.set(PATTERN, at);
    const image = context.register(
      context.flateStream(samples, {
        Type: 'XObject',
        Subtype: 'Image',
        Width: width,
        Height: height,
        ColorSpace: 'DeviceRGB',
        BitsPerComponent: 8,
      }),
    );
    const page = onPage(document);
    const name = page.node.newXObject('Im', image);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(IMAGE_BOX.width, 0, 0, IMAGE_BOX.height, IMAGE_BOX.x, IMAGE_BOX.y),
      drawObject(name),
      popGraphicsState(),
    );
    page.drawRectangle({ ...IMAGE_BOX, color: rgb(0, 0, 0) });
  });

/** How many samples of the pattern any image in the file still holds. */
async function patternPixels(bytes: Uint8Array): Promise<number> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  let found = 0;
  for (const [ref, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFStream)) continue;
    if (object.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue;
    if (!(object instanceof PDFRawStream)) throw new Error(`${String(ref.objectNumber)} 0 R: undecodable image`);
    const filter = object.dict.get(PDFName.of('Filter'))?.toString() ?? '';
    if (/DCT|JPX|JBIG2|CCITT/u.test(filter)) {
      throw new Error(`${String(ref.objectNumber)} 0 R is ${filter}, whose samples this reader cannot compare`);
    }
    const samples = decodePDFRawStream(object).decode();
    for (let at = 0; at + 2 < samples.length; at += 3) {
      if (samples[at] === PATTERN[0] && samples[at + 1] === PATTERN[1] && samples[at + 2] === PATTERN[2]) {
        found += 1;
      }
    }
  }
  return found;
}

describe('the redaction leak corpus: an image under a vector cover', () => {
  it('CONTROL: a mark elsewhere leaves every pixel of the image in the file', async () => {
    expect(await patternPixels(await burnIn(await coveredImage(), EMPTY_BOX))).toBe(40 * 20);
  });

  it('a mark over it leaves none of the covered pixels', async () => {
    expect(await patternPixels(await burnIn(await coveredImage(), IMAGE_BOX))).toBe(0);
  });
});

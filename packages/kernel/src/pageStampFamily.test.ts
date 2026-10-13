import { PDFArray, PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CommandOfKind } from '@monstera/contract';

import { bindEditFaces, bindEditFolders, loadEditFaces } from './editFaces.js';
import { appliedTo } from './mupdfAppliedBytes.js';
import { applyBatesNumberPages, applyHeaderFooterPages } from './pageStamp.js';
import { applyWatermarkPages } from './pageWatermark.js';

/**
 * The family a stamp names is the face it is drawn in, read back as the `/BaseFont` of every font the output carries — by
 * pdf-lib, a reader that is not the writer (ADR-0235, the owner's L3).
 *
 * ## A fixture with NO font, so the reading is the writer's alone
 *
 * Here the page carries no font, and the case for Times is the control for the mapping: a writer that ignored `family`
 * and drew Helvetica reads `Helvetica` where `Times-Roman` is asserted.
 *
 * ## The base 14 still write what they wrote, and every other family is the catalogue's
 *
 * The stamps are set by the text box's own typesetter: the base 14 where a standard face writes the words in a standard
 * family, the resolver's faces otherwise. So the three families keep the unembedded faces they always drew, and Arimo — a
 * family the three standard fonts could never draw — arrives as an embedded subset.
 */
async function blankPage(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([300, 400]);
  return document.save({ useObjectStreams: false });
}

/**
 * Every font the pages' resources name: its `/BaseFont`, and whether it carries a font program of its own (embedded).
 * Read through each page's `/Resources /Font`, because a base-14 face is written as a direct dictionary there and is no
 * indirect object a walk of the file would meet.
 */
async function fontsIn(bytes: Uint8Array): Promise<{ readonly base: string; readonly embedded: boolean }[]> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const found: { base: string; embedded: boolean }[] = [];
  for (const page of document.getPages()) {
    const fonts = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
    for (const [, entry] of fonts?.entries() ?? []) {
      const font = document.context.lookup(entry);
      if (!(font instanceof PDFDict)) continue;
      const base = font.get(PDFName.of('BaseFont'));
      const descendants = font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
      found.push({ base: base instanceof PDFName ? base.decodeText() : '', embedded: descendants !== undefined });
    }
  }
  return found.sort((a, b) => a.base.localeCompare(b.base));
}

/** PDF 32000-1 9.6.2.2's names for the three faces: what a reader of the file sees. */
const BASE_FONT: Readonly<Record<'Helvetica' | 'Times' | 'Courier', string>> = { Helvetica: 'Helvetica', Times: 'Times-Roman', Courier: 'Courier' };

const WRITERS: readonly { readonly name: string; readonly run: (image: Uint8Array, family: string, text?: string) => Promise<Uint8Array> }[] = [
  {
    name: 'watermark',
    run: (image, family, text = 'DRAFT') =>
      appliedTo(image, applyWatermarkPages, {
        kind: 'watermarkPages',
        pages: 'all',
        text,
        opacity: 0.3,
        rotationDegrees: 45,
        family,
        fontSize: 36,
      } satisfies CommandOfKind<'watermarkPages'>),
  },
  {
    name: 'header and footer',
    run: (image, family, text = 'Report') =>
      appliedTo(image, applyHeaderFooterPages, {
        kind: 'headerFooterPages',
        pages: 'all',
        header: { left: text, centre: '', right: '' },
        footer: { left: '', centre: '', right: '' },
        family,
        fontSize: 10,
        marginPoints: 36,
      } satisfies CommandOfKind<'headerFooterPages'>),
  },
  {
    name: 'Bates number',
    run: (image, family, text = 'ABC-') =>
      appliedTo(image, applyBatesNumberPages, {
        kind: 'batesNumberPages',
        pages: 'all',
        prefix: text,
        suffix: '',
        start: 1,
        digits: 4,
        edge: 'footer',
        slot: 'right',
        family,
        fontSize: 9,
        marginPoints: 36,
      } satisfies CommandOfKind<'batesNumberPages'>),
  },
];

/** The provisioned bundled set, which the vitest setup names, as the PDFium proofs read it. */
const BUNDLED = process.env['MONSTERA_FONTS_DIRECTORY'] ?? '';

describe('a page stamp is set in the family it names (ADR-0235)', () => {
  beforeEach(async () => {
    bindEditFolders(BUNDLED, null);
    await loadEditFaces();
  });
  afterEach(() => {
    bindEditFaces(null);
  });

  it('CONTROL: the fixture carries no font before a stamp runs', async () => {
    expect(await fontsIn(await blankPage())).toEqual([]);
  });

  for (const writer of WRITERS) {
    for (const family of ['Helvetica', 'Times', 'Courier'] as const) {
      it(`the ${writer.name} in ${family} draws ${BASE_FONT[family]}, unembedded, and no other face`, async () => {
        expect(await fontsIn(await writer.run(await blankPage(), family))).toEqual([{ base: BASE_FONT[family], embedded: false }]);
      });
    }

    it(`the ${writer.name} in Arimo, a family no standard font draws, embeds an Arimo subset and no standard face`, async () => {
      const fonts = await fontsIn(await writer.run(await blankPage(), 'Arimo'));
      expect(fonts).toHaveLength(1);
      expect(fonts[0]?.base).toMatch(/^[A-Z]{6}\+Arimo/u);
      expect(fonts[0]?.embedded).toBe(true);
    });

    it(`the ${writer.name} in Helvetica draws words outside WinAnsi too, in a catalogue face, where it could not before`, async () => {
      // GREEK in Helvetica: the base 14 cannot write it, so the resolver's nearest face does, embedded. The old writer
      // threw here (pdf-lib's WinAnsi encoder), which refused the person's words.
      const fonts = await fontsIn(await writer.run(await blankPage(), 'Helvetica', 'Αθήνα'));
      expect(fonts.some((font) => font.embedded)).toBe(true);
    });
  }
});

describe('without the catalogue, a stamp outside the base 14 is a fault of the process, said as one', () => {
  it('names the missing fonts rather than drawing a chosen face as Helvetica', async () => {
    bindEditFaces(null);
    await expect(WRITERS[0]?.run(await blankPage(), 'Arimo')).rejects.toThrow(/started without its fonts/u);
  });
});

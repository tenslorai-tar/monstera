import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { STAMP_FAMILIES, type StampFamily } from '@monstera/contract';

import { applyBatesNumberPages, applyHeaderFooterPages } from './pageStamp.js';
import { applyWatermarkPages } from './pageWatermark.js';

/**
 * The family a stamp names is the face its writer embeds (D1): read back as the `/BaseFont` of every font the output
 * carries.
 *
 * ## A fixture with NO font, so the reading is the writer's alone
 *
 * `pageWatermark.test.ts`'s fixture embeds Helvetica for its own text, so a Helvetica reading there would pass with a
 * writer that drew nothing. Here the page carries no font, and the case for Times is the control for the mapping: a
 * writer that ignored `family` and drew Helvetica, as all three did before D1, reads `Helvetica` where `Times-Roman` is
 * asserted.
 */
async function blankPage(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([300, 400]);
  return document.save({ useObjectStreams: false });
}

async function baseFonts(bytes: Uint8Array): Promise<string[]> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const names: string[] = [];
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || object.get(PDFName.of('Type')) !== PDFName.of('Font')) continue;
    const base = object.get(PDFName.of('BaseFont'));
    if (base instanceof PDFName) names.push(base.decodeText());
  }
  return names.sort();
}

/** PDF 32000-1 9.6.2.2's names for the three faces: what a reader of the file sees, never our enum spelt again. */
const BASE_FONT: Readonly<Record<StampFamily, string>> = { Helvetica: 'Helvetica', Times: 'Times-Roman', Courier: 'Courier' };

const WRITERS: readonly { readonly name: string; readonly run: (image: Uint8Array, family: StampFamily) => Promise<Uint8Array> }[] = [
  {
    name: 'watermark',
    run: (image, family) =>
      applyWatermarkPages(image, { kind: 'watermarkPages', pages: 'all', text: 'DRAFT', opacity: 0.3, rotationDegrees: 45, family, fontSize: 36 }),
  },
  {
    name: 'header and footer',
    run: (image, family) =>
      applyHeaderFooterPages(image, {
        kind: 'headerFooterPages',
        pages: 'all',
        header: { left: 'Report', centre: '', right: '' },
        footer: { left: '', centre: '', right: '' },
        family,
        fontSize: 10,
        marginPoints: 36,
      }),
  },
  {
    name: 'Bates number',
    run: (image, family) =>
      applyBatesNumberPages(image, {
        kind: 'batesNumberPages',
        pages: 'all',
        prefix: 'ABC-',
        suffix: '',
        start: 1,
        digits: 4,
        edge: 'footer',
        slot: 'right',
        family,
        fontSize: 9,
        marginPoints: 36,
      }),
  },
];

describe('a page stamp is set in the family it names', () => {
  it('CONTROL: the fixture carries no font before a stamp runs', async () => {
    expect(await baseFonts(await blankPage())).toEqual([]);
  });

  for (const writer of WRITERS) {
    for (const family of STAMP_FAMILIES) {
      it(`the ${writer.name} in ${family} embeds ${BASE_FONT[family]} and no other face`, async () => {
        expect(await baseFonts(await writer.run(await blankPage(), family))).toEqual([BASE_FONT[family]]);
      });
    }
  }

  // AN ANCHOR the loop above cannot supply: its cases are derived from the set, so a family leaving the set would take
  // its cases with it and every remaining one would still pass (CLAUDE.md item 4c).
  it('the families the cases above cover are the three named here', () => {
    expect([...STAMP_FAMILIES]).toEqual(['Helvetica', 'Times', 'Courier']);
  });
});

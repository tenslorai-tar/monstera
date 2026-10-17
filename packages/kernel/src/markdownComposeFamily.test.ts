import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { bundledFontsFolder } from './bundledFontsForTests.js';

import { COMPOSED_FAMILY_DEFAULT } from '@monstera/contract';

import { composeCsv } from './csvCompose.js';
import { faceSourceOf, readCatalogue } from './fontCatalogue.js';
import { composeMarkdown } from './markdownCompose.js';

/**
 * The family an imported Markdown file's prose is set in is the one the person chose (D1), and code is Cousine whatever
 * was chosen: read back as the `/BaseFont` of every top-level font the output carries, its subset tag taken off.
 *
 * Tinos is chosen because it is bundled, so the reading does not depend on what this machine has installed, and because
 * it is not the default: a composer that dropped the choice sets Arimo, which the first case refuses.
 */
const FACES = faceSourceOf([{ path: bundledFontsFolder(), origin: 'bundled' }], readCatalogue);
const LETTER = { width: 612, height: 792 };
const SOURCE = new TextEncoder().encode('# Minutes\n\nThe board met on Tuesday.\n\n```\nlet total = 0;\n```\n');

async function familiesIn(pdf: Uint8Array): Promise<string[]> {
  const document = await PDFDocument.load(pdf, { updateMetadata: false });
  const names = new Set<string>();
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || object.get(PDFName.of('Type')) !== PDFName.of('Font')) continue;
    if (object.get(PDFName.of('Subtype')) !== PDFName.of('Type0')) continue;
    const base = object.get(PDFName.of('BaseFont'));
    // `ABCDEF+Tinos-Bold` is the family Tinos: the subset tag and the style after the hyphen are not the family.
    if (base instanceof PDFName) names.add(base.decodeText().replace(/^[A-Z]{6}\+/u, '').split('-')[0] ?? '');
  }
  return [...names].sort();
}

describe('an imported Markdown file is set in the family chosen', () => {
  it('sets the prose in Tinos when Tinos is chosen, and the code in Cousine', async () => {
    const composed = await composeMarkdown(SOURCE, LETTER, FACES, 'Tinos');
    expect(await familiesIn(composed.pdf)).toEqual(['Cousine', 'Tinos']);
  });

  it('CONTROL: the default sets the prose in Arimo, so the case above is the choice and not the fixture', async () => {
    const composed = await composeMarkdown(SOURCE, LETTER, FACES, COMPOSED_FAMILY_DEFAULT);
    expect(await familiesIn(composed.pdf)).toEqual(['Arimo', 'Cousine']);
  });

  it('a standard name the picker offers is set in its bundled stand in: Times in Tinos', async () => {
    const composed = await composeMarkdown(SOURCE, LETTER, FACES, 'Times');
    expect(await familiesIn(composed.pdf)).toEqual(['Cousine', 'Tinos']);
  });
});

/**
 * A CSV file's table is set in the family chosen too (the owner's L4), read the same way: before L4 nothing asked for it,
 * so the composer was handed the default every time and no case could tell it from one that dropped the choice.
 */
describe('a CSV file is set in the family chosen', () => {
  const TABLE = new TextEncoder().encode('Name,Amount\nFirst,1\nSecond,2\n');

  it('sets the table in Tinos when Tinos is chosen', async () => {
    const composed = await composeCsv(TABLE, LETTER, FACES, 'Tinos');
    expect(await familiesIn(composed.pdf)).toEqual(['Tinos']);
  });

  it('CONTROL: the default sets it in Arimo, so the case above is the choice and not the fixture', async () => {
    const composed = await composeCsv(TABLE, LETTER, FACES, COMPOSED_FAMILY_DEFAULT);
    expect(await familiesIn(composed.pdf)).toEqual(['Arimo']);
  });
});

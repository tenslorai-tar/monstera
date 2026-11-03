import { PDFDocument as LibDocument, StandardFonts } from '@cantoo/pdf-lib';
import { blockEditOf, type CommandOfKind, type PageInsert } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bundledFontsFolder, readCatalogueOnce } from './bundledFontsForTests.js';
import { bindEditFaces, bindEditFolders } from './editFaces.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { pageContentStreams } from './pageContent.js';
import { applyEditTextOperators } from './textOperatorEdit.js';
import { joinedContent, showOperators, textObjectCount } from './textOperators.js';

/**
 * A LINE ADDED BY ADD TEXT IS WRITTEN AS ONE RUN, its spaces as glyphs (item 17): it was saved one word per piece, each
 * word at its own `Tm` with nothing between them but distance, because a space in an added box was answered with no
 * glyph at all (`operatorEdit.ts`' `addedSpace`). Readers that infer a space from a gap read the line well enough at an
 * ordinary size; a reader that does not, or whose rule for a gap is another's, joins the words or spreads them
 * ("W1   at   85"), and a phrase search can miss them.
 *
 * READ WITH MuPDF's SPACE INFERENCE OFF (`inhibit-spaces`), so the words read are the ones the content holds, not ones a
 * reader guessed from where the words stand: on the writer before this change every line read with no space at all
 * (`LineoneW1at85`, measured 2026-11-02), while the default reading, which infers them, read the same bytes correctly and
 * could not tell the two apart.
 *
 * The CONTROL is a line the page drew word by word itself, three text objects of its own: it is kept exactly as it was.
 */

const LINES = ['Line one W1 at 85', 'Line two W2 at 86', 'Line three W3 at 87'];
const PIECES = ['Kept', 'as', 'pieces'];
const SIZE = 14;

/** A page whose own line is three pieces, each word its own text object, as a producer that sets words apart writes it. */
async function pagePieces(): Promise<Uint8Array> {
  const document = await LibDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const [at, word] of PIECES.entries()) page.drawText(word, { x: 72 + at * 60, y: 750, size: 12, font });
  return document.save();
}

const command = (insert: PageInsert): CommandOfKind<'editTextOperators'> => ({
  kind: 'editTextOperators',
  page: 0,
  ...blockEditOf([], [insert]),
  fit: 'reflow',
  version: asDocVersion(1),
});

/** The page's content, decoded, with its show operators. */
async function contentOf(bytes: Uint8Array): Promise<{ readonly text: string; readonly objects: number }> {
  const session = await mupdfWriter.open(bytes);
  try {
    const content = await withDocument(session, (document) => joinedContent(pageContentStreams(document.findPage(0))));
    return { text: new TextDecoder('latin1').decode(content), objects: textObjectCount(showOperators(content)) };
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Adds one line as Add text does, one command, and answers the saved bytes. */
async function added(bytes: Uint8Array, text: string, baseline: number): Promise<Uint8Array> {
  const { objects } = await contentOf(bytes);
  const session = await mupdfWriter.open(bytes);
  try {
    // THE PAGE'S TEXT OBJECTS as PDFium's read numbers them, every one left alone: nothing but the box is edited.
    await applyEditTextOperators(session, command({ left: 72, baseline, measure: 400, size: SIZE, text }), {
      textObjects: Array.from({ length: objects }, (_, at) => at),
      runs: [],
    });
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** The page's words as the content says them, and how many places a phrase search finds `phrase`. */
async function readBack(bytes: Uint8Array, phrase: string): Promise<{ readonly said: string; readonly found: number }> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const page = document.loadPage(0);
      return { said: page.toStructuredText('inhibit-spaces').asText(), found: page.search(phrase).length };
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('a line added by Add text is written as one run (item 17)', () => {
  beforeEach(() => {
    bindEditFolders(bundledFontsFolder(), null, readCatalogueOnce);
  });
  afterEach(() => {
    bindEditFaces(null);
  });

  it('three lines added, saved and reopened: each reads with single spaces, as one show operator, and a phrase is found', async () => {
    const original = await pagePieces();
    let bytes = original;
    for (const [at, line] of LINES.entries()) bytes = await added(bytes, line, 700 - at * 40);
    const after = await contentOf(bytes);
    const before = await contentOf(original);
    // ONE SHOW OPERATOR AN ADDED LINE: the page's own three, and one for each line added.
    expect(after.objects).toBe(before.objects + LINES.length);
    expect(showOperators(new TextEncoder().encode(after.text)).length).toBe(PIECES.length + LINES.length);
    for (const line of LINES) {
      const { said, found } = await readBack(bytes, line.split(' ').slice(2).join(' '));
      // THE WORDS THE CONTENT HOLDS, each line with one space between its words.
      expect(said).toContain(line);
      expect(found).toBe(1);
    }
  });

  it('CONTROL: a line the page drew word by word keeps its three pieces, each with its own bytes', async () => {
    const original = await pagePieces();
    let bytes = original;
    for (const [at, line] of LINES.entries()) bytes = await added(bytes, line, 700 - at * 40);
    const kept = (text: string): string[] => [...text.matchAll(/BT[\s\S]*?ET/gu)].map((match) => match[0]).filter((object) => !object.includes('Monstera'));
    // THE PAGE'S OWN TEXT OBJECTS, unchanged and still three: the space added to a box is never given to them.
    expect(kept((await contentOf(bytes)).text)).toStrictEqual(kept((await contentOf(original)).text));
    expect(kept((await contentOf(bytes)).text)).toHaveLength(PIECES.length);
    // AND THEY READ AS THEY DID before anything was added: the page's own reading of its own words, unchanged.
    const was = (await readBack(original, 'Kept')).said.trim();
    expect(was.length).toBeGreaterThan(0);
    expect((await readBack(bytes, 'Kept')).said).toContain(was);
  });
});

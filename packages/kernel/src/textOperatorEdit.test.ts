import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { blockEditOf, type CommandOfKind } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bindEditFaces, bindEditFolders } from './editFaces.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import type { PageRuns } from './operatorEdit.js';
import { pageContentStreams } from './pageContent.js';
import { pageFonts } from './pageFonts.js';
import { EditRefusedError, TextNotWritableError } from './textEditRefusals.js';
import { applyEditTextOperators } from './textOperatorEdit.js';
import { joinedContent, showOperators, textObjectCount } from './textOperators.js';

/** The Chromium print committed as Part B's starting material (`scripts/research/chromiumType3Fixture.mjs`). */
const CHROMIUM = fileURLToPath(new URL('../../testing/fixtures/text-edit/chromium-type3.pdf', import.meta.url));

/**
 * PDFium's reading of the print's heading as `proof:pdfiumcommand` measured it: text objects numbered 0 to 59 with no
 * other object between them, the heading one run of its glyphs, its inkless spaces (code 3) members of none. The
 * proof joins the real reading against the same content; this case needs only the heading, so it states that much.
 */
function headingRuns(content: Uint8Array): PageRuns {
  const ops = showOperators(content);
  const heading = ops.filter((op) => op.textObject === ops[0]?.textObject && op.object !== null);
  const members = heading.filter((op) => !(op.codes.length === 1 && op.codes[0] === 3)).map((op) => op.object ?? -1);
  return {
    textObjects: Array.from({ length: textObjectCount(ops) }, (_, at) => at),
    runs: [{ index: members[0] ?? 0, members, text: 'Monstera fixture heading.', left: 0, right: 0, bottom: 0, top: 0 }],
  };
}

const command = (index: number, text: string): CommandOfKind<'editTextOperators'> => ({
  kind: 'editTextOperators',
  page: 0,
  ...blockEditOf([{ lines: [[index]], text }]),
  fit: 'reflow',
  version: asDocVersion(1),
});

async function withChromium<T>(work: (session: Awaited<ReturnType<typeof mupdfWriter.open>>, content: Uint8Array) => Promise<T>): Promise<T> {
  const session = await mupdfWriter.open(new Uint8Array(readFileSync(CHROMIUM)));
  try {
    const content = await withDocument(session, (document) => joinedContent(pageContentStreams(document.findPage(0))));
    return await work(session, content);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** The page's text as MuPDF reads it, every white space removed. */
const pageWords = (session: Awaited<ReturnType<typeof mupdfWriter.open>>) =>
  withDocument(session, (document) => document.loadPage(0).toStructuredText().asText().replace(/\s/gu, ''));

describe('applyEditTextOperators', () => {
  it('writes the heading in its own Type 3 font, MuPDF reads it back, and it survives a save and a reopen', async () => {
    await withChromium(async (session, content) => {
      const runs = headingRuns(content);
      await applyEditTextOperators(session, command(runs.runs[0]?.index ?? 0, 'Monstera fixture reading.'), runs);
      expect(await pageWords(session)).toContain('Monsterafixturereading.');
      // CONTROL: the old heading is gone from MuPDF's reading, so the read-back above is not reading the old line.
      expect(await pageWords(session)).not.toContain('Monsterafixtureheading.');
      const saved = await mupdfWriter.serialise(session);
      const reopened = await mupdfWriter.open(saved);
      try {
        expect(await pageWords(reopened)).toContain('Monsterafixturereading.');
        // THE BODY LINE IS UNTOUCHED, in its own Type0 font, byte for byte in the page's content.
        const after = await withDocument(reopened, (document) => joinedContent(pageContentStreams(document.findPage(0))));
        const body = '<002500520047005C000300570048005B00570003004C005100030057004B0048000300550048004A0058004F00440055000300490044004600480011> Tj';
        expect(new TextDecoder('latin1').decode(after)).toContain(body);
      } finally {
        await mupdfWriter.close(reopened);
      }
    });
  });

  it('refuses a word no font of the page carries, naming its characters, and leaves the page as it came', async () => {
    await withChromium(async (session, content) => {
      const runs = headingRuns(content);
      const refusal = await applyEditTextOperators(session, command(runs.runs[0]?.index ?? 0, 'Monstera fixture zap.'), runs).then(
        () => null,
        (error: unknown) => error,
      );
      expect(refusal).toBeInstanceOf(TextNotWritableError);
      // THE CHARACTERS THE PERSON IS TOLD, which the case's name claims (SSSSSSS-6): the print's subset holds no z and no p.
      expect((refusal as TextNotWritableError).characters).toBe('zp');
      const after = await withDocument(session, (document) => joinedContent(pageContentStreams(document.findPage(0))));
      expect(after).toStrictEqual(content);
    });
  });

  it('keeps a word wider than the page, which runs past its edge, rather than refusing it (Q7)', async () => {
    await withChromium(async (session, content) => {
      const runs = headingRuns(content);
      // EIGHT TIMES "reading", one word in the print's own letters: wider than the page at the heading's size.
      const long = 'reading'.repeat(8);
      await applyEditTextOperators(session, command(runs.runs[0]?.index ?? 0, `Monstera ${long}.`), runs);
      const unclipped = await withDocument(session, (document) =>
        document.loadPage(0).toStructuredText('clip=no').asText().replace(/\s/gu, ''),
      );
      expect(unclipped).toContain(`Monstera${long}.`);
      // CONTROL: MuPDF's default reading, clipped to the page, does NOT hold the whole word, so this case reaches the
      // part of the word past the edge, which the read-back refused before it read with `clip=no`.
      expect(await pageWords(session)).not.toContain(`Monstera${long}.`);
    });
  });

  describe('with the bundled fonts bound (ADR-0177)', () => {
    // BOUND AS THE MuPDF HOST BINDS THEM, by their folders, so the apply's own load of the catalogue is what runs.
    beforeEach(() => {
      bindEditFolders(process.env['MONSTERA_FONTS_DIRECTORY'] ?? '', null);
    });
    afterEach(() => {
      bindEditFaces(null);
    });

    /** The page's `/Font` names after the edit, and the content as text. */
    const after = (session: Awaited<ReturnType<typeof mupdfWriter.open>>) =>
      withDocument(session, (document) => {
        const leaf = document.findPage(0);
        return { fonts: [...pageFonts(leaf).keys()], content: new TextDecoder('latin1').decode(joinedContent(pageContentStreams(leaf))) };
      });

    it('sets the letters the print has no glyph for in a bundled face, keeps the rest in its Type 3 font, and saves', async () => {
      await withChromium(async (session) => {
        const runs = headingRuns(await withDocument(session, (document) => joinedContent(pageContentStreams(document.findPage(0)))));
        // NO BOX: every letter is in the print's font or a bundled face, so the list the box case reads is not a constant.
        expect(await applyEditTextOperators(session, command(runs.runs[0]?.index ?? 0, 'Monstera fixture zap.'), runs)).toStrictEqual({
          boxed: [],
          more: 0,
        });
        expect(await pageWords(session)).toContain('Monsterafixturezap.');
        const { fonts, content } = await after(session);
        // ONE FONT ADDED, and the inserted object shows in both the print's Type 3 font and the added one.
        const added = fonts.filter((name) => name.startsWith('MonsteraF'));
        expect(added).toHaveLength(1);
        expect(content).toContain(`/${added[0] ?? ''} `);
        expect(content).toContain('/F4 ');
        const reopened = await mupdfWriter.open(await mupdfWriter.serialise(session));
        try {
          expect(await pageWords(reopened)).toContain('Monsterafixturezap.');
        } finally {
          await mupdfWriter.close(reopened);
        }
      });
    });

    it('draws a character no face carries as a box that still reads as the character', async () => {
      await withChromium(async (session) => {
        const runs = headingRuns(await withDocument(session, (document) => joinedContent(pageContentStreams(document.findPage(0)))));
        const unassigned = String.fromCodePoint(0x378);
        const drawn = await applyEditTextOperators(session, command(runs.runs[0]?.index ?? 0, `Monstera fixture ${unassigned}.`), runs);
        // THE PERSON IS TOLD (ADR-0177 Decision 7): the character and its page, answered by the apply.
        expect(drawn).toStrictEqual({ boxed: [{ character: unassigned, page: 0 }], more: 0 });
        // THE REAL CHARACTER in MuPDF's reading: the box font's ToUnicode maps its code to U+0378, not to the box.
        expect(await pageWords(session)).toContain(`Monsterafixture${unassigned}.`);
        expect(await pageWords(session)).not.toContain(String.fromCodePoint(0x25a1));
      });
    });
  });

  it('refuses a reading whose count of text objects is not the page’s with the read-back step, and changes nothing', async () => {
    await withChromium(async (session, content) => {
      const runs = headingRuns(content);
      const wrong = { ...runs, textObjects: [...runs.textObjects, 60] };
      const refusal = await applyEditTextOperators(session, command(runs.runs[0]?.index ?? 0, 'Monstera fixture reading.'), wrong).then(
        () => null,
        (error: unknown) => error,
      );
      // THE STEP THE OWNER'S SENTENCE NAMES: *This page uses a font Monstera can't rewrite yet, so nothing was changed*.
      expect(refusal).toBeInstanceOf(EditRefusedError);
      expect((refusal as EditRefusedError).step).toBe('read-back');
      const after = await withDocument(session, (document) => joinedContent(pageContentStreams(document.findPage(0))));
      expect(after).toStrictEqual(content);
    });
  });
});

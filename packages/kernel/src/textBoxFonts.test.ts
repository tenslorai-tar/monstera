import { PDFDocument as LibDocument } from '@cantoo/pdf-lib';
import type { AnnotationDraft, AnnotationWordsStyle, CommandOfKind } from '@monstera/contract';
import { asDocVersion } from '@monstera/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bindEditFaces, bindEditFolders, loadEditFaces } from './editFaces.js';
import * as mupdf from './mupdfRaw.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { applyAddAnnotation, applyStyleAnnotation, readAnnotations } from './pageAnnotations.js';

/**
 * A text box in a real font (K2,
 * [ADR-0228](../../../docs/DECISIONS/0228-the-formatting-set-is-whole-in-both-text-writers-and-a-tab-is-a-marked-gap.md)
 * Decision 3), against the real engine and the bundled fonts: what the box embeds, what a reader reads back from its
 * appearance, and that a standard family stays the base 14 unembedded.
 */

const STAMP = { author: 'Test', created: '2026-10-11T09:00:00.000Z' } as const;

function textBox(family: string | undefined, text: string): Extract<AnnotationDraft, { type: 'text-box' }> {
  return {
    type: 'text-box',
    rect: { x0: 72, y0: 600, x1: 372, y1: 700 },
    text,
    colour: [0, 0, 0],
    opacity: 1,
    fontSize: 14,
    font: 'sans',
    direction: 'left-to-right',
    ...(family === undefined ? {} : { family }),
  };
}

async function blank(): Promise<Uint8Array> {
  const document = await LibDocument.create();
  document.addPage([612, 792]);
  return document.save();
}

/** The box's appearance: its fonts by `/BaseFont`, whether each is embedded, and its content stream. */
async function appearanceOf(bytes: Uint8Array): Promise<{ fonts: { name: string; embedded: boolean }[]; content: string }> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const page = document.loadPage(0);
      if (!(page instanceof mupdf.PDFPage)) throw new Error('not a PDF page');
      const annotation = page.getAnnotations().find((each) => each.getType() === 'FreeText');
      if (annotation === undefined) throw new Error('no text box');
      const stream = annotation.getObject().get('AP').get('N');
      const fonts: { name: string; embedded: boolean }[] = [];
      stream.get('Resources').get('Font').forEach((font) => {
        const resolved = font.resolve();
        const name = resolved.get('BaseFont').asName();
        const descendant = resolved.get('DescendantFonts');
        const descriptor = descendant.isArray() ? descendant.get(0).get('FontDescriptor') : resolved.get('FontDescriptor');
        fonts.push({ name, embedded: !descriptor.isNull() && !descriptor.get('FontFile2').isNull() });
      });
      return { fonts, content: stream.readStream().asString() };
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/**
 * What MuPDF reads off the page, annotations' appearances included: the page's display list WITH its extras, which a page's
 * own structured text leaves out (measured: it read nothing of a text box).
 */
async function readText(bytes: Uint8Array): Promise<string> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) =>
      document.loadPage(0).toDisplayList(true).toStructuredText('preserve-whitespace').asText(),
    );
  } finally {
    await mupdfWriter.close(session);
  }
}

async function added(draft: Extract<AnnotationDraft, { type: 'text-box' }>): Promise<Uint8Array> {
  const session = await mupdfWriter.open(await blank());
  try {
    await applyAddAnnotation(session, { kind: 'addAnnotation', page: 0, annotation: draft, stamp: STAMP });
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('a text box in a real font (K2), with the bundled fonts bound', () => {
  beforeAll(async () => {
    bindEditFolders(process.env['MONSTERA_FONTS_DIRECTORY'] ?? '', null);
    await loadEditFaces();
  });
  afterAll(() => {
    bindEditFaces(null);
  });

  it('is drawn in that family, EMBEDDED as a subset, and a reader reads its words back', async () => {
    const bytes = await added(textBox('Carlito', 'Quarterly report'));
    const { fonts, content } = await appearanceOf(bytes);
    expect(fonts.map((font) => font.name)).toStrictEqual([expect.stringMatching(/^[A-Z]{6}\+Carlito/u)]);
    expect(fonts.every((font) => font.embedded)).toBe(true);
    // CODES, not a WinAnsi string: the words are drawn by the embedded face's glyphs.
    expect(content).toMatch(/<[0-9A-F]{4}>/u);
    expect(await readText(bytes)).toContain('Quarterly report');
  });

  it('a word the base 14 cannot write, in a Helvetica box, goes to an embedded face and the rest stays Helvetica', async () => {
    // STYLED, so Monstera draws it: a Helvetica box nobody styled is still the engine's, which sets a script it cannot
    // write in faces of its own (measured: MuPDF embedded Nimbus Sans for it).
    const session = await mupdfWriter.open(await added(textBox('Helvetica', 'Hello שלום world')));
    let bytes: Uint8Array;
    try {
      await applyStyleAnnotation(session, { kind: 'styleAnnotation', page: 0, indices: [0], text: { bold: true }, version: asDocVersion(1) });
      bytes = await mupdfWriter.serialise(session);
    } finally {
      await mupdfWriter.close(session);
    }
    const { fonts } = await appearanceOf(bytes);
    const names = fonts.map((font) => font.name);
    expect(names).toContain('Helvetica-Bold');
    expect(names.some((name) => /^[A-Z]{6}\+/u.test(name))).toBe(true);
    const read = await readText(bytes);
    expect(read).toContain('Hello');
    expect(read).toContain('world');
    expect(read).toContain('שלום');
  });

  it('CONTROL: a box in a standard family with Latin words is the base 14, unembedded, as before real fonts', async () => {
    const bytes = await added(textBox('Times', 'Plain words'));
    const { fonts } = await appearanceOf(bytes);
    // NO STYLE WAS ASKED, so the engine drew it from `/DA`: its own Times, unembedded.
    expect(fonts.every((font) => !font.embedded)).toBe(true);
    expect(fonts.map((font) => font.name).join()).toMatch(/Times/u);
  });

  it('a restyle to a real family redraws the box in it, and the panel reads the family back by name', async () => {
    const session = await mupdfWriter.open(await added(textBox(undefined, 'Restyled words')));
    try {
      const restyle: CommandOfKind<'styleAnnotation'> = {
        kind: 'styleAnnotation',
        page: 0,
        indices: [0],
        text: { family: 'Caladea' },
        version: asDocVersion(1),
      };
      await applyStyleAnnotation(session, restyle);
      const bytes = await mupdfWriter.serialise(session);
      expect((await appearanceOf(bytes)).fonts.map((font) => font.name)).toStrictEqual([expect.stringMatching(/^[A-Z]{6}\+Caladea/u)]);
      const typed = await typedOf(session);
      expect(typed?.family).toBe('Caladea');
      // THE /DA CLASS IS THE FAMILY'S: Caladea reads as a serif, so a reader that draws neither /AP nor /RC uses Times.
      expect(typed?.font).toBe('serif');
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

/** The first annotation's words style, as the panel is answered it. */
async function typedOf(session: Awaited<ReturnType<typeof mupdfWriter.open>>): Promise<AnnotationWordsStyle | undefined> {
  const { annotations } = await readAnnotations(session);
  const first = annotations[0];
  return first !== undefined && 'typed' in first ? first.typed : undefined;
}

describe('a text box’s character spacing and highlight (ADR-0228), against the real engine', () => {
  it('draws the spacing as Tc and the highlight behind its words, and MuPDF still reads the words as words', async () => {
    const session = await mupdfWriter.open(await added(textBox('Helvetica', 'Spaced words here')));
    let bytes: Uint8Array;
    try {
      await applyStyleAnnotation(session, {
        kind: 'styleAnnotation',
        page: 0,
        indices: [0],
        text: { spacing: 0.1, words: [{ text: 'Spaced', highlight: [1, 1, 0] }, { text: ' words here' }] },
        version: asDocVersion(1),
      });
      bytes = await mupdfWriter.serialise(session);
      expect((await typedOf(session))?.spacing).toBe(0.1);
    } finally {
      await mupdfWriter.close(session);
    }
    const { content } = await appearanceOf(bytes);
    // 0.1 OF 14 POINTS, and the yellow behind the first word before its words are drawn.
    expect(content).toContain('1.4 Tc');
    expect(content.indexOf('1 1 0 rg')).toBeGreaterThanOrEqual(0);
    expect(content.indexOf('1 1 0 rg')).toBeLessThan(content.indexOf('BT'));
    // THE BOUND'S REASON: at 0.1 of the size MuPDF reads no space between the letters.
    expect(await readText(bytes)).toContain('Spaced words here');
  });

  it('CONTROL: the same box restyled with no spacing says no Tc and draws no colour behind its words', async () => {
    const session = await mupdfWriter.open(await added(textBox('Helvetica', 'Spaced words here')));
    let bytes: Uint8Array;
    try {
      await applyStyleAnnotation(session, { kind: 'styleAnnotation', page: 0, indices: [0], text: { bold: true }, version: asDocVersion(1) });
      bytes = await mupdfWriter.serialise(session);
    } finally {
      await mupdfWriter.close(session);
    }
    const { content } = await appearanceOf(bytes);
    expect(content).not.toContain('Tc');
    expect(content).not.toContain('1 1 0 rg');
  });
});

describe('a text box whose words were styled one by one while typed (B5.8)', () => {
  const RUNS: NonNullable<Extract<AnnotationDraft, { type: 'text-box' }>['words']> = [
    { text: 'Plain ' },
    { text: 'bold', bold: true },
    { text: ' and ' },
    { text: 'red', colour: [1, 0, 0] },
  ];

  it('is placed with its runs as /RC and an appearance Monstera draws, and they survive a save and a reopen', async () => {
    const bytes = await added({ ...textBox('Helvetica', 'Plain bold and red'), words: RUNS });
    const { fonts, content } = await appearanceOf(bytes);
    expect(fonts.map((font) => font.name)).toContain('Helvetica-Bold');
    expect(content).toContain('1 0 0 rg');
    expect(await readText(bytes)).toContain('Plain bold and red');
    // REOPENED FROM THE SAVED BYTES: the runs are the file's, not the session's.
    const session = await mupdfWriter.open(bytes);
    try {
      const rich = await withDocument(session, (document) => {
        const page = document.loadPage(0);
        if (!(page instanceof mupdf.PDFPage)) throw new Error('not a PDF page');
        return page.getAnnotations()[0]?.getObject().get('RC').asString() ?? '';
      });
      expect(rich).toContain('font-weight:bold');
      expect(rich).toContain('#ff0000');
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: the same words placed with no runs draw no bold face and no red', async () => {
    const { fonts, content } = await appearanceOf(await added(textBox('Helvetica', 'Plain bold and red')));
    expect(fonts.map((font) => font.name)).not.toContain('Helvetica-Bold');
    expect(content).not.toContain('1 0 0 rg');
  });

  it('refuses runs that do not join to the box’s words, which would make two readers show two boxes', async () => {
    await expect(added({ ...textBox('Helvetica', 'Other words'), words: RUNS })).rejects.toThrow(/join to its words/u);
  });
});

describe('with no fonts bound', () => {
  it('a real family falls back to the engine’s base 14 and the panel says the styles are unavailable', async () => {
    const session = await mupdfWriter.open(await added(textBox('Carlito', 'No catalogue')));
    try {
      expect((await typedOf(session))?.stylesUnavailable).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

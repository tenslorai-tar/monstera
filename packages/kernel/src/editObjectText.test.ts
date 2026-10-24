import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import { type CommandOfKind, type EditedBlock, blockEditOf } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { runsOfContent as runsOf } from './contentRunsFixture.js';
import { editOperators } from './operatorEdit.js';
import { pageContentStreams, xobjectKinds } from './pageContent.js';
import { rasterisePageRgba } from './pageImages.js';
import { pageFonts } from './pageFonts.js';
import { applyEditTextOperators } from './textOperatorEdit.js';
import { joinedContent } from './textOperators.js';

/**
 * Edit object's edits of a TEXT BLOCK through the operator writer (ADR-0264 Decision 5): recoloured with every line
 * carried as it was, emptied, and arranged. A page set as a design tool's export sets it — each line its own text
 * object, glyph by glyph in `TJ` with kerning, in marked content — in Helvetica, which MuPDF and PDF.js both draw.
 */

/** A heading line, kerned between every glyph as a layout program writes one, and a body line after it. */
const HEADING = '[(G) -12 (a) 8 (r) 8 (d) -12 (e) 8 (n)] TJ';
const CONTENT = [
  `/Span <</MCID 0>> BDC BT 0.1 0.35 0.25 rg /F1 26 Tf 1 0 0 1 52 160 Tm ${HEADING} ET EMC`,
  '/Span <</MCID 1>> BDC BT 0.15 0.15 0.15 rg /F1 11 Tf 1 0 0 1 52 120 Tm (Volunteers meet on Saturday.) Tj ET EMC',
].join('\n');

async function fixture(content = CONTENT): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([300, 200]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const context = document.context;
  // A GREEN PICTURE an arrange can go past, and a half opacity a page can leave in force.
  const picture = context.register(
    context.stream(Uint8Array.of(0, 200, 0), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }),
  );
  page.node.set(
    PDFName.of('Resources'),
    context.obj({ Font: { F1: font.ref }, XObject: { Im1: picture }, ExtGState: { Half: { Type: 'ExtGState', ca: 0.5, CA: 0.5 } } }),
  );
  page.node.set(PDFName.of('Contents'), context.register(context.stream(content)));
  return document.save({ useObjectStreams: false });
}

/** The heading block's edit: its one run, its words, and what else the case asks. */
function heading(text: string, rest: Omit<EditedBlock, 'lines' | 'soft' | 'text'> = {}): EditedBlock {
  return { lines: [[0]], soft: [false], text, ...rest };
}

const RED = { r: 255, g: 0, b: 0 };

/** The edit made by the writer alone, on the fixture's content and fonts. */
async function written(blocks: readonly EditedBlock[], content = CONTENT): Promise<string> {
  const session = await mupdfWriter.open(await fixture(content));
  try {
    return await withDocument(session, (document) => {
      const leaf = document.findPage(0);
      const content = joinedContent(pageContentStreams(leaf));
      const made = editOperators(content, pageFonts(leaf), runsOf(content), blocks, null, 'reflow', [], {
        kinds: xobjectKinds(leaf),
        plainState: 'MonPlain1',
      });
      if (!made.ok) throw new Error(`refused: ${JSON.stringify(made.error)}`);
      return new TextDecoder('latin1').decode(made.value.content);
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/** The command for `blocks`, through the application's own command shape and the writer's apply. */
async function applied(blocks: readonly EditedBlock[], content = CONTENT): Promise<Uint8Array> {
  const session = await mupdfWriter.open(await fixture(content));
  try {
    const content = await withDocument(session, (document) => joinedContent(pageContentStreams(document.findPage(0))));
    const command: CommandOfKind<'editTextOperators'> = { kind: 'editTextOperators', page: 0, ...blockEditOf(blocks), fit: 'reflow', version: asDocVersion(1) };
    await applyEditTextOperators(session, command, runsOf(content));
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** PDF.js's reading: each string it shows, with the fill colour it shows it in. */
async function pdfjsShown(bytes: Uint8Array): Promise<string[]> {
  const entry = createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = (await import(/* @vite-ignore */ pathToFileURL(entry).href)) as typeof import('pdfjs-dist');
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  try {
    const page = await (await task.promise).getPage(1);
    const list = await page.getOperatorList({ intent: 'print' });
    let fill = '#000000';
    const saved: string[] = [];
    const shown: string[] = [];
    for (let at = 0; at < list.fnArray.length; at += 1) {
      const fn = list.fnArray[at];
      const args = list.argsArray[at] as unknown[];
      if (fn === pdfjs.OPS.save) saved.push(fill);
      else if (fn === pdfjs.OPS.restore) fill = saved.pop() ?? fill;
      else if (fn === pdfjs.OPS.setFillRGBColor) fill = String(args[0]);
      else if (fn === pdfjs.OPS.showText) {
        const glyphs = args[0] as ({ unicode?: string } | number)[];
        const words = glyphs.map((glyph) => (typeof glyph === 'number' ? '' : (glyph.unicode ?? ''))).join('');
        if (words !== '') shown.push(`${words} ${fill}`);
      }
    }
    return shown;
  } finally {
    await task.destroy();
  }
}

/** Where PDF.js reads each string: its text and its origin on the page, rounded to a hundredth of a point. */
async function pdfjsPlaces(bytes: Uint8Array): Promise<string[]> {
  const entry = createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = (await import(/* @vite-ignore */ pathToFileURL(entry).href)) as typeof import('pdfjs-dist');
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  try {
    const page = await (await task.promise).getPage(1);
    const content = await page.getTextContent();
    const round = (value: number): number => Math.round(value * 100) / 100;
    return content.items.flatMap((item) =>
      'str' in item && item.str.trim() !== '' ? [`${item.str} @${String(round(item.transform[4] as number))},${String(round(item.transform[5] as number))} x${String(round(item.transform[0] as number))}`] : [],
    );
  } finally {
    await task.destroy();
  }
}

/** Where MuPDF reads the line holding `words`: its box's left and bottom, rounded to a tenth of a point. */
async function mupdfLine(bytes: Uint8Array, words: string): Promise<readonly [number, number] | undefined> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const json = JSON.parse(document.loadPage(0).toStructuredText().asJSON()) as {
        blocks: { lines?: { text?: string; bbox: { x: number; y: number; w: number; h: number } }[] }[];
      };
      const line = json.blocks.flatMap((block) => block.lines ?? []).find((each) => (each.text ?? '').includes(words));
      // MuPDF's BOX IS IN DEVICE SPACE, y down from the top of the 200-point page: its bottom is 200 less its foot.
      return line === undefined ? undefined : ([Math.round(line.bbox.x * 10) / 10, Math.round((200 - line.bbox.y - line.bbox.h) * 10) / 10] as const);
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/** The colours MuPDF draws in the heading's area, each once: what is on top there. */
async function headingColours(bytes: Uint8Array): Promise<Set<string>> {
  const session = await mupdfWriter.open(bytes);
  try {
    const image = await rasterisePageRgba(session, 0, 1);
    const colours = new Set<string>();
    for (let y = 200 - 180; y < 200 - 162; y += 1) {
      for (let x = 54; x < 120; x += 1) {
        const at = (y * image.width + x) * 4;
        colours.add(`${String(image.rgba[at])},${String(image.rgba[at + 1])},${String(image.rgba[at + 2])}`);
      }
    }
    return colours;
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('a text block arranged is carried to its new place in the order (ADR-0264 Decision 5)', () => {
  /** The heading in dark red, set outside its text object; a half opacity and a blue fill; the picture over the heading. */
  const COVERED = [
    `0.8 0 0 rg BT /F1 26 Tf 1 0 0 1 52 160 Tm ${HEADING} ET`,
    '/Half gs 0 0 1 rg',
    'q 120 0 0 40 40 150 cm /Im1 Do Q',
    'BT /F1 11 Tf 1 0 0 1 52 120 Tm (Volunteers meet on Saturday.) Tj ET',
  ].join('\n');
  const forward = { arrange: { to: 'forward', past: { kind: 'image', ordinal: 0 } } } as const;

  it('brings the heading forward past the picture over it: drawn on top, in its own opaque red, by both engines', async () => {
    // CONTROL: the half-opaque picture is over the heading, so no pixel there is the heading's own red, though the red
    // shows through it (the picture's green blended over it).
    const covered = await headingColours(await fixture(COVERED));
    expect(covered.has('204,0,0')).toBe(false);
    expect(covered.has('102,100,0')).toBe(true);
    const bytes = await applied([heading('Garden', { place: forward })], COVERED);
    const colours = await headingColours(bytes);
    // THE HEADING'S OWN RED, OPAQUE: the half opacity and the blue in force past the picture are not its.
    expect(colours.has('204,0,0')).toBe(true);
    expect([...colours].some((colour) => colour.startsWith('0,0,'))).toBe(false);
    const shown = await pdfjsShown(bytes);
    // JUST PAST THE PICTURE, before the body line, which keeps the blue in force where it stands.
    expect(shown).toStrictEqual(['Garden #cc0000', 'Volunteers meet on Saturday. #0000ff']);
  });

  it('carries the heading’s own kerned array, empties it where it stood, and names the plain state it resets with', async () => {
    const text = await written([heading('Garden', { place: forward })], COVERED);
    expect(text).toContain('[<47> -12 <61> 8 <72> 8 <64> -12 <65> 8 <6E>] TJ');
    expect(text).not.toContain(HEADING);
    expect(text.indexOf('/Im1 Do')).toBeLessThan(text.indexOf('<47> -12'));
    expect(text).toMatch(/\/MonPlain1 gs/u);
  });

  it('REFUSES at `cropped` where the picture sits in a window that would cut the heading off; CONTROL: a wider window does not', async () => {
    const narrow = COVERED.replace('q 120 0 0 40 40 150 cm /Im1 Do Q', 'q 70 150 90 40 re W n q 120 0 0 40 40 150 cm /Im1 Do Q 0 0 1 rg 150 150 5 5 re f Q');
    await expect(written([heading('Garden', { place: forward })], narrow)).rejects.toThrow(/"cropped"/u);
    const wide = narrow.replace('70 150 90 40 re', '40 140 140 60 re');
    await expect(written([heading('Garden', { place: forward })], wide)).resolves.toContain('<47> -12');
  });

  it('goes past a TEXT object by PDFium’s number, and backward before the picture', async () => {
    const past = await written([heading('Garden', { place: { arrange: { to: 'forward', past: { kind: 'text', object: 1 } } } })], COVERED);
    expect(past.indexOf('(Volunteers meet on Saturday.) Tj')).toBeLessThan(past.indexOf('<47> -12'));
    const body = { lines: [[1]], soft: [false], text: 'Volunteers meet on Saturday.', place: { arrange: { to: 'backward', past: { kind: 'image', ordinal: 0 } } } } as const;
    const back = await written([body], COVERED);
    expect(back.indexOf('<56>')).toBeLessThan(back.indexOf('/Im1 Do'));
  });
});

describe('a text block moved and resized is carried as it was (ADR-0264 Decision 5)', () => {
  it('moves the heading 30 points right and 40 down: PDF.js and MuPDF read it there, the body line where it was', async () => {
    const before = await pdfjsPlaces(await fixture());
    expect(before).toStrictEqual(['Garden @52,160 x26', 'Volunteers meet on Saturday. @52,120 x11']);
    const bytes = await applied([heading('Garden', { place: { move: { x: 30, y: -40 } } })]);
    expect(await pdfjsPlaces(bytes)).toStrictEqual(['Garden @82,120 x26', 'Volunteers meet on Saturday. @52,120 x11']);
    const was = await mupdfLine(await fixture(), 'Garden');
    const now = await mupdfLine(bytes, 'Garden');
    expect(was).toBeDefined();
    expect(now).toStrictEqual([(was?.[0] ?? 0) + 30, (was?.[1] ?? 0) - 40]);
    // THE KERNING IS THE PAGE'S: the array carried under one placement, its codes and adjustments as they were.
    const session = await mupdfWriter.open(bytes);
    try {
      const text = await withDocument(session, (document) => new TextDecoder('latin1').decode(joinedContent(pageContentStreams(document.findPage(0)))));
      expect(text).toContain('[<47> -12 <61> 8 <72> 8 <64> -12 <65> 8 <6E>] TJ');
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('scales the heading by a half about its top left: PDF.js reads it half as large, its top left where it was', async () => {
    const bytes = await applied([heading('Garden', { place: { scale: 0.5 } })]);
    const [line] = await pdfjsPlaces(bytes);
    // HALF THE SIZE, and its origin moved up toward the top left it was scaled about.
    expect(line).toMatch(/^Garden @52,\d+(\.\d+)? x13$/u);
    expect(Number(/@52,([\d.]+)/u.exec(line ?? '')?.[1])).toBeGreaterThan(160);
  });
});

describe('a text block deleted is emptied where it stands (ADR-0264 Decision 5)', () => {
  it('empties the heading’s operators and adds nothing: PDF.js and MuPDF read the body line alone, after a save', async () => {
    const text = await written([heading('')]);
    expect(text).not.toContain(HEADING);
    expect(text).toContain('1 0 0 1 52 160 Tm [] TJ ET EMC');
    // NOTHING WAS ADDED: the content is the fixture's with the heading's array emptied, every other byte as it was.
    expect(text.trimEnd()).toBe(CONTENT.replace(HEADING, '[] TJ'));
    const bytes = await applied([heading('')]);
    expect(await pdfjsShown(bytes)).toStrictEqual(['Volunteers meet on Saturday. #262626']);
    // CONTROL: the fixture's own reading holds the heading, so its absence above is the deletion's.
    expect(await pdfjsShown(await fixture())).toContain('Garden #1a5940');
    const session = await mupdfWriter.open(bytes);
    try {
      const words = await withDocument(session, (document) => document.loadPage(0).toStructuredText().asText());
      expect(words).not.toContain('Garden');
      expect(words).toContain('Volunteers');
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

describe('a text block recoloured whole is carried as it was (ADR-0264 Decision 5)', () => {
  it('writes the heading’s own kerned TJ again, byte for byte, with the colour set before it', async () => {
    const text = await written([heading('Garden', { marks: [{ from: 0, to: 6, set: { colour: RED } }] })]);
    // THE CODES AND THE KERNING ARE THE PAGE'S: the same array of the same codes (written as hex), and a red fill in
    // front of it in the object that carries it.
    expect(text).toMatch(/1 0 0 rg\n1 0 0 1 52 160 Tm \[<47> -12 <61> 8 <72> 8 <64> -12 <65> 8 <6E>\] TJ/u);
    // THE OLD LINE IS EMPTIED where it stood, so nothing is drawn twice.
    expect(text).not.toContain(HEADING);
    expect(text).toContain('1 0 0 1 52 160 Tm [] TJ ET EMC');
  });

  it('CONTROL: a colour over PART of the words is a mark like any other, set again in a face, which this font cannot give', async () => {
    // HELVETICA HERE CARRIES NO ToUnicode, so words set again need a face: the writer is asked for one, which is the
    // route a whole-block colour no longer takes.
    await expect(written([heading('Garden', { marks: [{ from: 0, to: 3, set: { colour: RED } }] })])).rejects.toThrow(/needs-a-face/u);
  });

  it('PDF.js reads the heading in red and the body line in its own grey, and MuPDF reads both lines, after a save', async () => {
    const bytes = await applied([heading('Garden', { marks: [{ from: 0, to: 6, set: { colour: RED } }] })]);
    expect(await pdfjsShown(await fixture())).toStrictEqual(['Garden #1a5940', 'Volunteers meet on Saturday. #262626']);
    expect(await pdfjsShown(bytes)).toStrictEqual(['Garden #ff0000', 'Volunteers meet on Saturday. #262626']);
    const session = await mupdfWriter.open(bytes);
    try {
      const words = await withDocument(session, (document) => document.loadPage(0).toStructuredText().asText());
      expect(words).toContain('Garden');
      expect(words).toContain('Volunteers meet on Saturday.');
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

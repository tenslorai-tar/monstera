import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream, degrees, grayscale } from '@cantoo/pdf-lib';
import type { CommandOfKind } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { applySetDocumentProtection } from './documentProtection.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { applyRemovePageMarks, readPageMarks, type PageMarks, wholeArtifactKind } from './pageMarks.js';
import { applyBatesNumberPages, applyHeaderFooterPages } from './pageStamp.js';
import { applyWatermarkPages } from './pageWatermark.js';
import { shownOn } from './shownText.js';

/**
 * The stamps found, edited and removed (ADR-0246), against the real engine. What each case asserts is read from the
 * BYTES the writer left, by MuPDF for the marks and by pdf-lib — a reader that is not the writer — for the page's own
 * content, so a removal that left the page looking right while changing its content is seen.
 */

const WATERMARK: CommandOfKind<'watermarkPages'> = {
  kind: 'watermarkPages',
  pages: 'all',
  text: 'DRAFT',
  opacity: 0.4,
  rotationDegrees: 30,
  fontSize: 48,
  family: 'Helvetica',
};

const HEADER_FOOTER: CommandOfKind<'headerFooterPages'> = {
  kind: 'headerFooterPages',
  pages: 'all',
  header: { left: 'Annual report', centre: '', right: '' },
  footer: { left: '', centre: 'Page {n} of {N}', right: '' },
  fontSize: 10,
  family: 'Helvetica',
  marginPoints: 24,
};

const BATES: CommandOfKind<'batesNumberPages'> = {
  kind: 'batesNumberPages',
  pages: 'all',
  prefix: 'ABC-',
  suffix: '',
  start: 1,
  digits: 4,
  edge: 'footer',
  slot: 'right',
  fontSize: 9,
  family: 'Helvetica',
  marginPoints: 20,
};

/** Two pages with words of their own, the second carrying grey turned words that LOOK like a watermark and are not one. */
async function twoPages(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([400, 500]).drawText('The first page’s own words', { font, size: 14, x: 30, y: 440 });
  const second = document.addPage([400, 500]);
  second.drawText('The second page’s own words', { font, size: 14, x: 30, y: 440 });
  // THE CONTROL'S LOOK-ALIKE: page content, grey, turned, large and centred, with no artifact and no record.
  second.drawText('CONFIDENTIAL', { font, size: 48, x: 80, y: 180, rotate: degrees(30), color: grayscale(0.5), opacity: 0.4 });
  return document.save();
}

/** Each step a command runs on the bytes, through the writer the bus uses, the bytes it leaves read back. */
async function run(
  bytes: Uint8Array,
  command:
    | CommandOfKind<'watermarkPages'>
    | CommandOfKind<'headerFooterPages'>
    | CommandOfKind<'batesNumberPages'>
    | CommandOfKind<'removePageMarks'>,
  password?: string,
): Promise<Uint8Array> {
  const session = await mupdfWriter.open(bytes, password);
  try {
    if (command.kind === 'watermarkPages') await applyWatermarkPages(session, command);
    else if (command.kind === 'headerFooterPages') await applyHeaderFooterPages(session, command);
    else if (command.kind === 'batesNumberPages') await applyBatesNumberPages(session, command);
    else await applyRemovePageMarks(session, command);
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** The marks a fresh open of `bytes` reads. */
async function marksOf(bytes: Uint8Array, password?: string): Promise<PageMarks> {
  const session = await mupdfWriter.open(bytes, password);
  try {
    return await withDocument(session, (document) => readPageMarks(document));
  } finally {
    await mupdfWriter.close(session);
  }
}

/** A page's content streams, each decoded, read by pdf-lib. */
async function streamsByPdfLib(bytes: Uint8Array, page: number, password?: string): Promise<string[]> {
  const document = await PDFDocument.load(bytes, password === undefined ? {} : { password, ignoreEncryption: false });
  const node = document.getPage(page).node;
  const contents = node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : contents === undefined ? [] : [contents];
  return refs.map((ref) => {
    const stream = document.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) throw new Error('a content entry that is not a stream');
    return new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
  });
}

/** Appends a content stream holding `text` to every page, as another tool or an older Monstera would have. */
async function withStream(bytes: Uint8Array, text: string): Promise<Uint8Array> {
  const session = await mupdfWriter.open(bytes);
  try {
    await withDocument(session, (document) => {
      for (let index = 0; index < document.countPages(); index += 1) {
        const page = document.findPage(index);
        const stream = document.addStream(new TextEncoder().encode(text), document.newDictionary());
        const existing = page.get('Contents');
        const list = document.newArray();
        if (existing.isArray()) for (let at = 0; at < existing.length; at += 1) list.push(existing.get(at));
        else if (!existing.isNull()) list.push(existing);
        list.push(stream);
        page.put('Contents', list);
      }
    });
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

const NONE = { pages: [], settings: null, others: 0, inline: 0 };

describe('a stamp is marked, found, edited and removed (ADR-0246)', () => {
  it('a watermark is MARKED twice: the artifact in its stream, and Monstera’s record of its settings', async () => {
    const stamped = await run(await twoPages(), { ...WATERMARK, colour: [0.8, 0.1, 0.1] });
    const marks = await marksOf(stamped);
    expect(marks.watermark.pages).toStrictEqual([0, 1]);
    expect(JSON.parse(marks.watermark.settings ?? 'null')).toStrictEqual({
      text: 'DRAFT',
      opacity: 0.4,
      rotationDegrees: 30,
      fontSize: 48,
      family: 'Helvetica',
      colour: [0.8, 0.1, 0.1],
    });
    expect({ headerFooter: marks.headerFooter, bates: marks.bates, older: marks.older }).toStrictEqual({ headerFooter: NONE, bates: NONE, older: 0 });
    const stamp = (await streamsByPdfLib(stamped, 0)).at(-1) ?? '';
    expect(stamp).toContain('/Artifact <</Type /Pagination /Subtype /Watermark>> BDC');
    expect(stamp).toContain('0.80000 0.10000 0.10000 rg');
  });

  it('EDIT replaces: one watermark per page with the new settings, and edited AGAIN after save and reopen', async () => {
    const first = await run(await twoPages(), WATERMARK);
    const edited = await run(first, {
      ...WATERMARK,
      text: 'FINAL',
      fontSize: 36,
      rotationDegrees: -20,
      family: 'Times',
      colour: [0, 0, 0.6],
      replace: true,
    });
    // SAVED AND REOPENED between the two edits: `run` serialises and the next opens the bytes afresh.
    const again = await run(edited, { ...WATERMARK, text: 'COPY', replace: true });
    const marks = await marksOf(again);
    expect(marks.watermark.pages).toStrictEqual([0, 1]);
    expect(JSON.parse(marks.watermark.settings ?? 'null')).toMatchObject({ text: 'COPY' });
    for (const page of [0, 1]) {
      const shown = (await shownOn(again, page)).join(' ');
      expect(shown).toContain('COPY');
      expect(shown).not.toContain('DRAFT');
      expect(shown).not.toContain('FINAL');
      expect((await streamsByPdfLib(again, page)).filter((stream) => stream.includes('/Subtype /Watermark'))).toHaveLength(1);
    }
    // CONTROL: without `replace` the second watermark is ADDED beside the first, which is how Add has always behaved.
    const added = await run(first, { ...WATERMARK, text: 'SECOND' });
    expect((await streamsByPdfLib(added, 0)).filter((stream) => stream.includes('/Subtype /Watermark'))).toHaveLength(2);
  });

  it('REMOVE after save and reopen leaves each page’s own content streams exactly as they were, read by pdf-lib', async () => {
    const plain = await twoPages();
    const before = [await streamsByPdfLib(plain, 0), await streamsByPdfLib(plain, 1)];
    const stamped = await run(plain, WATERMARK);
    const removed = await run(stamped, { kind: 'removePageMarks', marks: 'watermark' });
    expect((await marksOf(removed)).watermark).toStrictEqual(NONE);
    for (const page of [0, 1]) {
      // THE PAGE'S OWN STREAMS, in their order, inside the bracket the stamp put round them, and nothing after it.
      expect(await streamsByPdfLib(removed, page)).toStrictEqual(['q\n', ...(before[page] ?? []), '\nQ\n']);
    }
  });

  it('each KIND is removed on its own: headers and footers go, the watermark and the Bates numbers stay', async () => {
    let bytes = await run(await twoPages(), WATERMARK);
    bytes = await run(bytes, { ...HEADER_FOOTER, colour: [0, 0.4, 0] });
    bytes = await run(bytes, BATES);
    const all = await marksOf(bytes);
    expect([all.watermark.pages, all.headerFooter.pages, all.bates.pages]).toStrictEqual([[0, 1], [0, 1], [0, 1]]);
    const header = (await streamsByPdfLib(bytes, 0)).find((stream) => stream.includes('/Subtype /Header'));
    expect(header).toContain('/Subtype /Footer');
    expect(header).toContain('0.00000 0.40000 0.00000 rg');
    const after = await marksOf(await run(bytes, { kind: 'removePageMarks', marks: 'headerFooter' }));
    expect([after.watermark.pages, after.headerFooter.pages, after.bates.pages]).toStrictEqual([[0, 1], [], [0, 1]]);
  });

  it('a PROTECTED document: marked, found and removed under its password, and still protected', async () => {
    const opened = await mupdfWriter.open(await twoPages());
    let locked: Uint8Array;
    try {
      await applySetDocumentProtection(opened, {
        kind: 'setDocumentProtection',
        encryption: 'aes-256',
        userPassword: 'open-me',
        ownerPassword: 'own-me',
        permissions: ['print'],
      });
      locked = await mupdfWriter.serialise(opened);
    } finally {
      await mupdfWriter.close(opened);
    }
    const stamped = await run(locked, WATERMARK, 'open-me');
    expect((await marksOf(stamped, 'open-me')).watermark.pages).toStrictEqual([0, 1]);
    const removed = await run(stamped, { kind: 'removePageMarks', marks: 'watermark' }, 'open-me');
    expect((await marksOf(removed, 'open-me')).watermark).toStrictEqual(NONE);
    await expect(mupdfWriter.open(removed)).rejects.toBeDefined();
  });

  it('another tool’s WHOLE-STREAM artifact is found and removable; one INSIDE mixed content is counted and left', async () => {
    const whole = '\n/Artifact <</Type /Pagination /Subtype /Watermark>> BDC q 0.5 g BT /F1 40 Tf 100 200 Td (OTHER) Tj ET Q EMC\n';
    const mixed = '\nBT /F1 12 Tf 30 30 Td (Own words) Tj ET\n/Artifact <</Type /Pagination /Subtype /Watermark>> BDC q BT /F1 40 Tf 100 200 Td (INLINE) Tj ET Q EMC\n';
    let bytes = await withStream(await twoPages(), whole);
    bytes = await withStream(bytes, mixed);
    const found = await marksOf(bytes);
    expect(found.watermark).toStrictEqual({ pages: [0, 1], settings: null, others: 2, inline: 2 });
    const removed = await run(bytes, { kind: 'removePageMarks', marks: 'watermark' });
    const streams = await streamsByPdfLib(removed, 0);
    expect(streams.some((stream) => stream.includes('(OTHER)'))).toBe(false);
    // NEVER CUT OUT of a stream that holds anything else.
    expect(streams.some((stream) => stream.includes('(INLINE)') && stream.includes('(Own words)'))).toBe(true);
  });

  it('an OLDER Monstera’s stamp, written with no record, is counted and left by every kind’s removal', async () => {
    const older = '\nq\n0.5 g\nBT\n1 0 0 1 100 200 Tm\n/MonsteraStamp0 48 Tf\n(DRAFT) Tj\nET\nQ\n';
    let bytes = await withStream(await twoPages(), older);
    expect((await marksOf(bytes)).older).toBe(2);
    for (const marks of ['watermark', 'headerFooter', 'bates'] as const) bytes = await run(bytes, { kind: 'removePageMarks', marks });
    expect((await marksOf(bytes)).older).toBe(2);
    expect((await streamsByPdfLib(bytes, 0)).some((stream) => stream.includes('/MonsteraStamp0 48 Tf'))).toBe(true);
  });

  it('CONTROL: grey turned words in the page’s own content are no watermark, and Remove leaves them', async () => {
    const plain = await twoPages();
    expect(await marksOf(plain)).toStrictEqual({ watermark: NONE, headerFooter: NONE, bates: NONE, older: 0 });
    const after = await run(plain, { kind: 'removePageMarks', marks: 'watermark' });
    expect((await shownOn(after, 1)).join(' ')).toContain('CONFIDENTIAL');
    expect(await streamsByPdfLib(after, 1)).toStrictEqual(await streamsByPdfLib(plain, 1));
  });

  it('wholeArtifactKind: one artifact closed by the stream’s last EMC, and nothing else', () => {
    expect(wholeArtifactKind('/Artifact <</Type /Pagination /Subtype /Bates>> BDC q (x) Tj Q EMC')).toBe('bates');
    expect(wholeArtifactKind(' /Artifact <</Subtype /Footer /Type /Pagination>> BDC /Span BDC (a) Tj EMC EMC ')).toBe('headerFooter');
    // CONTROLS: content after the artifact, an artifact of another type, a string holding the operator words.
    expect(wholeArtifactKind('/Artifact <</Type /Pagination /Subtype /Watermark>> BDC (x) Tj EMC (y) Tj')).toBeUndefined();
    expect(wholeArtifactKind('/Artifact <</Type /Layout /Subtype /Watermark>> BDC (x) Tj EMC')).toBeUndefined();
    expect(wholeArtifactKind('/Artifact <</Type /Pagination /Subtype /Watermark>> BDC (EMC BDC) Tj EMC')).toBe('watermark');
  });
});

describe('the page’s own content is bracketed for its stamps ONCE (marks walk C4.3)', () => {
  /** The `q` streams on a page that hold nothing else: the brackets, each one level of nesting. */
  const openings = async (bytes: Uint8Array, page: number): Promise<number> =>
    (await streamsByPdfLib(bytes, page)).filter((text) => text.trim() === 'q').length;

  it('three kinds added, the watermark edited and every kind removed: one bracket throughout, the page’s own content as after the add', async () => {
    const added = await run(await run(await run(await twoPages(), WATERMARK), HEADER_FOOTER), BATES);
    expect(await openings(added, 0)).toBe(1);
    const edited = await run(added, { ...WATERMARK, text: 'FINAL', replace: true });
    expect(await openings(edited, 0)).toBe(1);
    let removed = edited;
    for (const marks of ['watermark', 'headerFooter', 'bates'] as const) removed = await run(removed, { kind: 'removePageMarks', marks });
    expect(await openings(removed, 0)).toBe(1);
    // THE PAGE'S OWN CONTENT, which is what the walk compared: every stream that is not a stamp, joined.
    const own = async (bytes: Uint8Array): Promise<string> =>
      (await streamsByPdfLib(bytes, 0)).filter((text) => !text.includes('/Artifact')).join('\n');
    expect(await own(removed)).toBe(await own(added));
  });

  it('CONTROL: content another tool appended after the bracket is bracketed again, so a stamp never inherits its state', async () => {
    const stamped = await run(await twoPages(), WATERMARK);
    const appended = await withStream(stamped, '1 0 0 RG 5 w');
    const again = await run(appended, HEADER_FOOTER);
    expect(await openings(again, 0)).toBe(2);
  });
});
